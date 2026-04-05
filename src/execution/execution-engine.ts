import { StateStore } from '../state/state-store.js'
import { StateFileSchema, type StateFile } from '../schemas/state-file.js'
import type { ExecutionState, ExecutionBatch, ExecutionTask, Deviation } from '../schemas/execution-state.js'
import type { GateResult } from '../schemas/gate-result.js'
import { GateRegistry } from '../gates/gate-registry.js'
import { type BatchPlan, type TaskDefinition, planBatches } from './batch-planner.js'

export interface ExecutionCallbacks {
  onTaskStart?(taskId: string): Promise<void>
  onTaskComplete?(taskId: string, commit?: string): Promise<void>
  onTaskFailed?(taskId: string, error: string): Promise<void>
  onBatchStart?(batchId: number): Promise<void>
  onBatchComplete?(batchId: number): Promise<void>
  onDeviation?(deviation: Deviation): Promise<void>
  onGateResult?(result: GateResult): Promise<void>
}

export class ExecutionEngine {
  constructor(
    private stateStore: StateStore,
    private gateRegistry: GateRegistry,
    private cwd: string,
  ) {}

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

    for (const batch of state.batches) {
      batch.status = 'in_progress'
      await callbacks?.onBatchStart?.(batch.id)
      await this.saveState(state)

      // Sequential execution in v0.1
      for (const task of batch.tasks) {
        task.status = 'in_progress'
        await callbacks?.onTaskStart?.(task.id)
        await this.saveState(state)

        try {
          // The actual task execution is done by the AI tool via instructions.
          // The engine tracks state and runs gates.
          await callbacks?.onTaskComplete?.(task.id)

          // Run gates after task
          const batchDef = batchPlan.batches.find(b => b.id === batch.id)
          const taskDef = batchDef?.tasks.find(t => t.id === task.id)

          if (taskDef) {
            const gateResults = await this.runTaskGates(task)
            const allPassed = gateResults.every(g => g.status === 'pass' || g.status === 'skip')

            if (allPassed) {
              task.status = 'complete'
            } else {
              task.status = 'failed'
              await callbacks?.onTaskFailed?.(task.id, 'Gate failure')
            }
          } else {
            task.status = 'complete'
          }
        } catch (err: unknown) {
          task.status = 'failed'
          const message = err instanceof Error ? err.message : String(err)
          await callbacks?.onTaskFailed?.(task.id, message)
        }

        await this.saveState(state)
      }

      const allComplete = batch.tasks.every(t => t.status === 'complete')
      const anyFailed = batch.tasks.some(t => t.status === 'failed')

      batch.status = anyFailed ? 'failed' : (allComplete ? 'complete' : 'in_progress')
      await callbacks?.onBatchComplete?.(batch.id)
      await this.saveState(state)

      // If batch failed, check if downstream batches are blocked
      if (anyFailed) {
        const failedTaskIds = batch.tasks.filter(t => t.status === 'failed').map(t => t.id)
        // Mark remaining batches that depend on failed tasks
        // In sequential mode, we stop on batch failure
        break
      }
    }

    return state
  }

  async resume(changeName: string, batchPlan: BatchPlan, callbacks?: ExecutionCallbacks): Promise<ExecutionState> {
    const stateFile = await this.loadState()
    if (!stateFile?.execution || stateFile.execution.change !== changeName) {
      return this.execute(changeName, batchPlan, callbacks)
    }

    const state = stateFile.execution

    // Find first incomplete batch
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

  private async runTaskGates(task: ExecutionTask): Promise<GateResult[]> {
    const gates = this.gateRegistry.list().filter(g => g.required)
    const results: GateResult[] = []

    for (const gate of gates) {
      const result = await this.gateRegistry.runWithRetry(gate.name, this.cwd)
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
