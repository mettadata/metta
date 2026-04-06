import { StateStore } from '../state/state-store.js'
import { StateFileSchema, type StateFile } from '../schemas/state-file.js'
import type { ExecutionState, ExecutionBatch, ExecutionTask, Deviation } from '../schemas/execution-state.js'
import type { GateResult } from '../schemas/gate-result.js'
import { GateRegistry } from '../gates/gate-registry.js'
import { type BatchPlan, type TaskDefinition, planBatches } from './batch-planner.js'
import { WorktreeManager, HeadAdvancedError, type Worktree } from './worktree-manager.js'
import { type FanOutPlan, type FanOutResult, mergeFanOutResults } from './fan-out.js'

export interface FanOutCallbacks {
  onTaskStart?(taskId: string): Promise<void>
  onTaskComplete?(taskId: string, result: FanOutResult): Promise<void>
  onTaskFailed?(taskId: string, error: string): Promise<void>
}

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

async function safeCallback(fn: (() => Promise<void>) | undefined): Promise<void> {
  if (!fn) return
  try {
    await fn()
  } catch {
    // Callback errors are intentionally swallowed to prevent them from
    // affecting task or batch status. See spec/gaps/execution-engine-callback-errors.md.
  }
}

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
      await safeCallback(() => callbacks?.onBatchStart?.(batch.id, useParallel) ?? Promise.resolve())
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
      await safeCallback(() => callbacks?.onBatchComplete?.(batch.id) ?? Promise.resolve())
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
        await safeCallback(() => callbacks?.onWorktreeCreated?.(task.id, wt) ?? Promise.resolve())
      } catch {
        // Worktree creation failed — will run this task sequentially
      }
    }

    // Execute all tasks concurrently
    const promises = batch.tasks.map(async (task) => {
      task.status = 'in_progress'
      const wt = worktrees.get(task.id)
      await safeCallback(() => callbacks?.onTaskStart?.(task.id, wt) ?? Promise.resolve())

      try {
        // Run gates in the worktree directory (or main if no worktree)
        const gateCwd = wt?.path ?? this.cwd
        const gateResults = await this.runTaskGatesInDir(task, gateCwd)
        const allPassed = gateResults.every(g => g.status === 'pass' || g.status === 'skip')

        task.status = allPassed ? 'complete' : 'failed'
        if (allPassed) {
          await safeCallback(() => callbacks?.onTaskComplete?.(task.id) ?? Promise.resolve())
        } else {
          await safeCallback(() => callbacks?.onTaskFailed?.(task.id, 'Gate failure') ?? Promise.resolve())
        }
      } catch (err: unknown) {
        task.status = 'failed'
        const message = err instanceof Error ? err.message : String(err)
        await safeCallback(() => callbacks?.onTaskFailed?.(task.id, message) ?? Promise.resolve())
      }
    })

    await Promise.all(promises)

    // Merge completed worktrees back in task-definition order.
    // Each merge completes before the next begins (sequential merge after
    // parallel execution). The worktree manager verifies the base commit
    // and rebases if HEAD has advanced.
    for (const task of batch.tasks) {
      const wt = worktrees.get(task.id)
      if (!wt) continue

      if (task.status === 'complete') {
        try {
          const mergeResult = await this.worktreeManager.merge(wt)
          if (mergeResult.status === 'clean') {
            await safeCallback(() => callbacks?.onWorktreeMerged?.(task.id, mergeResult.changedFiles) ?? Promise.resolve())
          } else {
            task.status = 'failed'
            await safeCallback(() => callbacks?.onTaskFailed?.(task.id, `Worktree merge conflict: ${mergeResult.detail}`) ?? Promise.resolve())
          }
        } catch (err) {
          task.status = 'failed'
          const message = err instanceof HeadAdvancedError
            ? `Base commit check failed: ${err.message}`
            : `Worktree merge error: ${err instanceof Error ? err.message : String(err)}`
          await safeCallback(() => callbacks?.onTaskFailed?.(task.id, message) ?? Promise.resolve())
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
      await safeCallback(() => callbacks?.onTaskStart?.(task.id) ?? Promise.resolve())

      try {
        const gateResults = await this.runTaskGates(task)
        const allPassed = gateResults.every(g => g.status === 'pass' || g.status === 'skip')

        task.status = allPassed ? 'complete' : 'failed'
        if (allPassed) {
          await safeCallback(() => callbacks?.onTaskComplete?.(task.id) ?? Promise.resolve())
        } else {
          await safeCallback(() => callbacks?.onTaskFailed?.(task.id, 'Gate failure') ?? Promise.resolve())
        }
      } catch (err: unknown) {
        task.status = 'failed'
        const message = err instanceof Error ? err.message : String(err)
        await safeCallback(() => callbacks?.onTaskFailed?.(task.id, message) ?? Promise.resolve())
      }
    }
  }

  async resume(changeName: string, batchPlan: BatchPlan, callbacks?: ExecutionCallbacks): Promise<ExecutionState> {
    const stateFile = await this.loadState()
    if (!stateFile?.execution || stateFile.execution.change !== changeName) {
      return this.execute(changeName, batchPlan, callbacks)
    }

    const state = stateFile.execution

    for (let i = 0; i < state.batches.length; i++) {
      const batch = state.batches[i]
      if (batch.status === 'complete') continue

      const batchDef = batchPlan.batches[i]
      const useParallel = batchDef ? this.shouldRunParallel(batchDef) : false

      // Build a filtered view containing only incomplete tasks for re-execution
      const incompleteTasks = batch.tasks.filter(
        t => t.status !== 'complete' && t.status !== 'skipped',
      )

      if (incompleteTasks.length === 0) {
        batch.status = 'complete'
        await this.saveState(state)
        continue
      }

      batch.status = 'in_progress'
      await safeCallback(() => callbacks?.onBatchStart?.(batch.id, useParallel) ?? Promise.resolve())
      await this.saveState(state)

      // Create a temporary batch containing only the tasks that need re-execution
      const resumeBatch: ExecutionBatch = {
        id: batch.id,
        status: 'in_progress',
        tasks: incompleteTasks,
      }

      if (useParallel && incompleteTasks.length > 1 && batchDef) {
        // Build a filtered batchDef containing only the tasks to resume
        const incompleteIds = new Set(incompleteTasks.map(t => t.id))
        const filteredBatchDef = {
          ...batchDef,
          tasks: batchDef.tasks.filter(t => incompleteIds.has(t.id)),
        }
        await this.executeBatchParallel(changeName, resumeBatch, filteredBatchDef, callbacks)
      } else if (batchDef) {
        await this.executeBatchSequential(resumeBatch, batchDef, callbacks)
      } else {
        // No matching batchDef — fall back to sequential inline execution
        for (const task of incompleteTasks) {
          task.status = 'in_progress'
          await safeCallback(() => callbacks?.onTaskStart?.(task.id) ?? Promise.resolve())
          try {
            const gateResults = await this.runTaskGates(task)
            const allPassed = gateResults.every(g => g.status === 'pass' || g.status === 'skip')
            task.status = allPassed ? 'complete' : 'failed'
            if (allPassed) {
              await safeCallback(() => callbacks?.onTaskComplete?.(task.id) ?? Promise.resolve())
            } else {
              await safeCallback(() => callbacks?.onTaskFailed?.(task.id, 'Gate failure') ?? Promise.resolve())
            }
          } catch (err: unknown) {
            task.status = 'failed'
            const message = err instanceof Error ? err.message : String(err)
            await safeCallback(() => callbacks?.onTaskFailed?.(task.id, message) ?? Promise.resolve())
          }
        }
      }

      await this.saveState(state)

      const allComplete = batch.tasks.every(t => t.status === 'complete')
      const anyFailed = batch.tasks.some(t => t.status === 'failed')
      batch.status = anyFailed ? 'failed' : (allComplete ? 'complete' : 'in_progress')
      await safeCallback(() => callbacks?.onBatchComplete?.(batch.id) ?? Promise.resolve())
      await this.saveState(state)

      if (anyFailed) break
    }

    return state
  }

  async fanOut(
    plan: FanOutPlan,
    runner: (task: FanOutPlan['tasks'][0]) => Promise<FanOutResult>,
    callbacks?: FanOutCallbacks,
  ): Promise<{ results: FanOutResult[]; merged: string }> {
    const results: FanOutResult[] = []

    const promises = plan.tasks.map(async (task) => {
      await safeCallback(() => callbacks?.onTaskStart?.(task.id) ?? Promise.resolve())
      try {
        const result = await runner(task)
        results.push(result)
        if (result.status === 'complete') {
          await safeCallback(() => callbacks?.onTaskComplete?.(task.id, result) ?? Promise.resolve())
        } else {
          await safeCallback(() => callbacks?.onTaskFailed?.(task.id, result.output) ?? Promise.resolve())
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        const failedResult: FanOutResult = {
          id: task.id,
          agent: task.agent,
          status: 'failed',
          output: message,
          duration_ms: 0,
        }
        results.push(failedResult)
        await safeCallback(() => callbacks?.onTaskFailed?.(task.id, message) ?? Promise.resolve())
      }
    })

    await Promise.all(promises)

    const merged = mergeFanOutResults(results, plan.mergeStrategy)
    return { results, merged }
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
