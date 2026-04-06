import { StateStore } from '../state/state-store.js'
import { StateFileSchema, type StateFile } from '../schemas/state-file.js'
import type { ExecutionState, ExecutionBatch, ExecutionTask, Deviation } from '../schemas/execution-state.js'
import type { GateResult } from '../schemas/gate-result.js'
import { GateRegistry } from '../gates/gate-registry.js'
import { type BatchPlan, type TaskDefinition, planBatches } from './batch-planner.js'
import { WorktreeManager, type Worktree } from './worktree-manager.js'

export interface ExecutionCallbacks {
  onTaskStart?(taskId: string, worktree?: Worktree): Promise<void>
  onTaskComplete?(taskId: string, commit?: string): Promise<void>
  onTaskFailed?(taskId: string, error: string): Promise<void>
  onBatchStart?(batchId: number, parallel: boolean): Promise<void>
  onBatchComplete?(batchId: number): Promise<void>
  onDeviation?(deviation: Deviation): Promise<void>
  onGateResult?(result: GateResult): Promise<void>
  onWorktreeCreated?(taskId: string, worktree: Worktree): Promise<void>
  onWorktreeMerged?(taskId: string, changedFiles: string[]): Promise<void>
}

export type ExecutionMode = 'sequential' | 'parallel' | 'auto'

export class ExecutionEngine {
  private worktreeManager: WorktreeManager

  constructor(
    private stateStore: StateStore,
    private gateRegistry: GateRegistry,
    private cwd: string,
    private mode: ExecutionMode = 'auto',
  ) {
    this.worktreeManager = new WorktreeManager(cwd)
  }

  createBatchPlan(tasks: TaskDefinition[]): BatchPlan {
    return planBatches(tasks)
  }

  async execute(
    changeName: string,
    batchPlan: BatchPlan,
    callbacks?: ExecutionCallbacks,
  ): Promise<ExecutionState> {
    const state: ExecutionState = {
      change: changeName,
      started: new Date().toISOString(),
      batches: batchPlan.batches.map(b => ({
        id: b.id,
        status: 'pending' as const,
        tasks: b.tasks.map(t => ({
          id: t.id,
          status: 'pending' as const,
        })),
      })),
      deviations: [],
    }

    await this.saveState(state)

    for (let i = 0; i < state.batches.length; i++) {
      const batch = state.batches[i]
      const batchDef = batchPlan.batches[i]
      const useParallel = this.shouldRunParallel(batchDef)

      batch.status = 'in_progress'
      await callbacks?.onBatchStart?.(batch.id, useParallel)
      await this.saveState(state)

      if (useParallel && batch.tasks.length > 1) {
        await this.executeBatchParallel(changeName, batch, batchDef, callbacks)
      } else {
        await this.executeBatchSequential(batch, batchDef, callbacks)
      }

      await this.saveState(state)

      const allComplete = batch.tasks.every(t => t.status === 'complete')
      const anyFailed = batch.tasks.some(t => t.status === 'failed')

      batch.status = anyFailed ? 'failed' : (allComplete ? 'complete' : 'in_progress')
      await callbacks?.onBatchComplete?.(batch.id)
      await this.saveState(state)

      if (anyFailed) break
    }

    return state
  }

  private shouldRunParallel(batchDef: BatchPlan['batches'][0]): boolean {
    if (this.mode === 'sequential') return false
    if (this.mode === 'parallel') return batchDef.parallel
    // auto: use parallel if batch supports it and has multiple tasks
    return batchDef.parallel && batchDef.tasks.length > 1
  }

  private async executeBatchParallel(
    changeName: string,
    batch: ExecutionBatch,
    batchDef: BatchPlan['batches'][0],
    callbacks?: ExecutionCallbacks,
  ): Promise<void> {
    // Create worktrees for each task
    const worktrees = new Map<string, Worktree>()

    for (const task of batch.tasks) {
      try {
        const wt = await this.worktreeManager.create(changeName, task.id)
        worktrees.set(task.id, wt)
        task.worktree = wt.path
        await callbacks?.onWorktreeCreated?.(task.id, wt)
      } catch {
        // Worktree creation failed — will run this task sequentially
      }
    }

    // Execute all tasks concurrently
    const promises = batch.tasks.map(async (task) => {
      task.status = 'in_progress'
      const wt = worktrees.get(task.id)
      await callbacks?.onTaskStart?.(task.id, wt)

      try {
        await callbacks?.onTaskComplete?.(task.id)

        // Run gates in the worktree directory (or main if no worktree)
        const gateCwd = wt?.path ?? this.cwd
        const gateResults = await this.runTaskGatesInDir(task, gateCwd)
        const allPassed = gateResults.every(g => g.status === 'pass' || g.status === 'skip')

        task.status = allPassed ? 'complete' : 'failed'
        if (!allPassed) {
          await callbacks?.onTaskFailed?.(task.id, 'Gate failure')
        }
      } catch (err: unknown) {
        task.status = 'failed'
        const message = err instanceof Error ? err.message : String(err)
        await callbacks?.onTaskFailed?.(task.id, message)
      }
    })

    await Promise.all(promises)

    // Merge completed worktrees back in order
    for (const task of batch.tasks) {
      const wt = worktrees.get(task.id)
      if (!wt) continue

      if (task.status === 'complete') {
        const mergeResult = await this.worktreeManager.merge(wt)
        if (mergeResult.status === 'clean') {
          await callbacks?.onWorktreeMerged?.(task.id, mergeResult.changedFiles)
        } else {
          task.status = 'failed'
          await callbacks?.onTaskFailed?.(task.id, `Worktree merge conflict: ${mergeResult.detail}`)
        }
      }

      await this.worktreeManager.remove(wt)
    }
  }

  private async executeBatchSequential(
    batch: ExecutionBatch,
    _batchDef: BatchPlan['batches'][0],
    callbacks?: ExecutionCallbacks,
  ): Promise<void> {
    for (const task of batch.tasks) {
      task.status = 'in_progress'
      await callbacks?.onTaskStart?.(task.id)

      try {
        await callbacks?.onTaskComplete?.(task.id)

        const gateResults = await this.runTaskGates(task)
        const allPassed = gateResults.every(g => g.status === 'pass' || g.status === 'skip')

        task.status = allPassed ? 'complete' : 'failed'
        if (!allPassed) {
          await callbacks?.onTaskFailed?.(task.id, 'Gate failure')
        }
      } catch (err: unknown) {
        task.status = 'failed'
        const message = err instanceof Error ? err.message : String(err)
        await callbacks?.onTaskFailed?.(task.id, message)
      }
    }
  }

  async resume(changeName: string, batchPlan: BatchPlan, callbacks?: ExecutionCallbacks): Promise<ExecutionState> {
    const stateFile = await this.loadState()
    if (!stateFile?.execution || stateFile.execution.change !== changeName) {
      return this.execute(changeName, batchPlan, callbacks)
    }

    const state = stateFile.execution

    for (const batch of state.batches) {
      if (batch.status === 'complete') continue

      batch.status = 'in_progress'
      await this.saveState(state)

      for (const task of batch.tasks) {
        if (task.status === 'complete' || task.status === 'skipped') continue

        task.status = 'in_progress'
        await callbacks?.onTaskStart?.(task.id)
        await this.saveState(state)

        try {
          await callbacks?.onTaskComplete?.(task.id)
          const gateResults = await this.runTaskGates(task)
          const allPassed = gateResults.every(g => g.status === 'pass' || g.status === 'skip')
          task.status = allPassed ? 'complete' : 'failed'
        } catch (err: unknown) {
          task.status = 'failed'
          const message = err instanceof Error ? err.message : String(err)
          await callbacks?.onTaskFailed?.(task.id, message)
        }

        await this.saveState(state)
      }

      const allComplete = batch.tasks.every(t => t.status === 'complete')
      batch.status = allComplete ? 'complete' : 'failed'
      await this.saveState(state)

      if (batch.status === 'failed') break
    }

    return state
  }

  logDeviation(state: ExecutionState, deviation: Deviation): void {
    state.deviations.push(deviation)
  }

  getWorktreeManager(): WorktreeManager {
    return this.worktreeManager
  }

  private async runTaskGates(task: ExecutionTask): Promise<GateResult[]> {
    return this.runTaskGatesInDir(task, this.cwd)
  }

  private async runTaskGatesInDir(task: ExecutionTask, cwd: string): Promise<GateResult[]> {
    const gates = this.gateRegistry.list().filter(g => g.required)
    const results: GateResult[] = []

    for (const gate of gates) {
      const result = await this.gateRegistry.runWithRetry(gate.name, cwd)
      results.push(result)
      task.gates = task.gates ?? {}
      task.gates[gate.name] = result.status
    }

    return results
  }

  private async saveState(execution: ExecutionState): Promise<void> {
    const loaded = await this.loadState()
    const toSave: StateFile = {
      schema_version: loaded?.schema_version ?? 1,
      execution,
      auto: loaded?.auto,
    }
    await this.stateStore.write('state.yaml', StateFileSchema, toSave)
  }

  private async loadState(): Promise<StateFile | null> {
    try {
      return await this.stateStore.read('state.yaml', StateFileSchema)
    } catch {
      return null
    }
  }
}
