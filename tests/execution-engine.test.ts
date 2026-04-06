import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { StateStore } from '../src/state/state-store.js'
import { GateRegistry } from '../src/gates/gate-registry.js'
import { ExecutionEngine } from '../src/execution/execution-engine.js'
import { planBatches, type TaskDefinition } from '../src/execution/batch-planner.js'
import { createReviewFanOut, type FanOutPlan, type FanOutResult } from '../src/execution/fan-out.js'

describe('ExecutionEngine', () => {
  let tempDir: string
  let stateStore: StateStore
  let gateRegistry: GateRegistry
  let engine: ExecutionEngine

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-exec-'))
    stateStore = new StateStore(tempDir)
    gateRegistry = new GateRegistry()
    // Register a gate that always passes
    gateRegistry.register({
      name: 'tests',
      description: 'Test gate',
      command: 'echo pass',
      timeout: 5000,
      required: true,
      on_failure: 'stop',
    })
    engine = new ExecutionEngine(stateStore, gateRegistry, tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('creates a batch plan from tasks', () => {
    const tasks: TaskDefinition[] = [
      { id: '1.1', name: 'Task A', files: ['a.ts'], depends_on: [], action: 'do A', verify: 'check A', done: 'A done' },
      { id: '2.1', name: 'Task B', files: ['b.ts'], depends_on: ['1.1'], action: 'do B', verify: 'check B', done: 'B done' },
    ]
    const plan = engine.createBatchPlan(tasks)
    expect(plan.batches).toHaveLength(2)
  })

  it('executes a simple plan and tracks state', async () => {
    const tasks: TaskDefinition[] = [
      { id: '1.1', name: 'Task A', files: ['a.ts'], depends_on: [], action: 'do A', verify: 'check A', done: 'A done' },
    ]
    const plan = planBatches(tasks)

    const events: string[] = []
    const state = await engine.execute('test-change', plan, {
      onTaskStart: async (id) => { events.push(`start:${id}`) },
      onTaskComplete: async (id) => { events.push(`complete:${id}`) },
      onBatchStart: async (id) => { events.push(`batch-start:${id}`) },
      onBatchComplete: async (id) => { events.push(`batch-complete:${id}`) },
    })

    expect(state.change).toBe('test-change')
    expect(state.batches[0].status).toBe('complete')
    expect(state.batches[0].tasks[0].status).toBe('complete')
    expect(events).toContain('start:1.1')
    expect(events).toContain('complete:1.1')
  })

  it('persists execution state to disk', async () => {
    const tasks: TaskDefinition[] = [
      { id: '1.1', name: 'Task A', files: [], depends_on: [], action: '', verify: '', done: '' },
    ]
    const plan = planBatches(tasks)
    await engine.execute('persist-test', plan)

    // State should be on disk
    const exists = await stateStore.exists('state.yaml')
    expect(exists).toBe(true)
  })

  it('handles task failure from gate', async () => {
    // Replace gate with one that fails
    gateRegistry.register({
      name: 'tests',
      description: 'Failing gate',
      command: 'exit 1',
      timeout: 5000,
      required: true,
      on_failure: 'stop',
    })

    const tasks: TaskDefinition[] = [
      { id: '1.1', name: 'Task A', files: [], depends_on: [], action: '', verify: '', done: '' },
    ]
    const plan = planBatches(tasks)

    const failEvents: string[] = []
    const state = await engine.execute('fail-test', plan, {
      onTaskFailed: async (id, err) => { failEvents.push(`fail:${id}:${err}`) },
    })

    expect(state.batches[0].tasks[0].status).toBe('failed')
    expect(state.batches[0].status).toBe('failed')
    expect(failEvents.length).toBeGreaterThan(0)
  })

  it('logs deviations', async () => {
    const tasks: TaskDefinition[] = [
      { id: '1.1', name: 'Task A', files: [], depends_on: [], action: '', verify: '', done: '' },
    ]
    const plan = planBatches(tasks)
    const state = await engine.execute('dev-test', plan)

    engine.logDeviation(state, {
      rule: 1,
      description: 'Fixed null check in middleware',
      commit: 'abc123',
      files: ['src/middleware.ts'],
    })

    expect(state.deviations).toHaveLength(1)
    expect(state.deviations[0].rule).toBe(1)
  })

  it('executes multi-batch plans sequentially', async () => {
    const tasks: TaskDefinition[] = [
      { id: '1.1', name: 'Models', files: ['model.ts'], depends_on: [], action: '', verify: '', done: '' },
      { id: '1.2', name: 'Types', files: ['types.ts'], depends_on: [], action: '', verify: '', done: '' },
      { id: '2.1', name: 'API', files: ['api.ts'], depends_on: ['1.1'], action: '', verify: '', done: '' },
    ]
    const plan = planBatches(tasks)

    const batchOrder: number[] = []
    const state = await engine.execute('multi-test', plan, {
      onBatchStart: async (id) => { batchOrder.push(id) },
    })

    expect(batchOrder).toEqual([1, 2])
    expect(state.batches.every(b => b.status === 'complete')).toBe(true)
  })

  it('isolates callback errors from task status', async () => {
    const tasks: TaskDefinition[] = [
      { id: '1.1', name: 'Task A', files: [], depends_on: [], action: '', verify: '', done: '' },
    ]
    const plan = planBatches(tasks)

    const state = await engine.execute('callback-error-test', plan, {
      onTaskStart: async () => { throw new Error('start callback exploded') },
      onTaskComplete: async () => { throw new Error('complete callback exploded') },
      onBatchStart: async () => { throw new Error('batch start callback exploded') },
      onBatchComplete: async () => { throw new Error('batch complete callback exploded') },
    })

    // Task and batch should still be complete despite all callbacks throwing
    expect(state.batches[0].tasks[0].status).toBe('complete')
    expect(state.batches[0].status).toBe('complete')
  })

  it('executes a fan-out plan and merges results', async () => {
    const plan = createReviewFanOut('test-change', ['src/a.ts'], 'test context')

    const runner = async (task: FanOutPlan['tasks'][0]): Promise<FanOutResult> => ({
      id: task.id,
      agent: task.agent,
      status: 'complete',
      output: `Review from ${task.id}`,
      duration_ms: 10,
    })

    const events: string[] = []
    const { results, merged } = await engine.fanOut(plan, runner, {
      onTaskStart: async (id) => { events.push(`start:${id}`) },
      onTaskComplete: async (id) => { events.push(`complete:${id}`) },
    })

    expect(results).toHaveLength(3)
    expect(results.every(r => r.status === 'complete')).toBe(true)
    expect(merged).toContain('correctness')
    expect(merged).toContain('security')
    expect(merged).toContain('quality')
    expect(events).toContain('start:correctness')
    expect(events).toContain('complete:correctness')
  })

  it('handles fan-out task failures', async () => {
    const plan: FanOutPlan = {
      tasks: [
        { id: 't1', agent: 'test', persona: 'p', task: 'do', context: 'ctx' },
        { id: 't2', agent: 'test', persona: 'p', task: 'do', context: 'ctx' },
      ],
      mergeStrategy: 'concat',
    }

    const runner = async (task: FanOutPlan['tasks'][0]): Promise<FanOutResult> => {
      if (task.id === 't2') throw new Error('agent crashed')
      return { id: task.id, agent: task.agent, status: 'complete', output: 'ok', duration_ms: 5 }
    }

    const failEvents: string[] = []
    const { results, merged } = await engine.fanOut(plan, runner, {
      onTaskFailed: async (id, err) => { failEvents.push(`fail:${id}:${err}`) },
    })

    expect(results).toHaveLength(2)
    const failed = results.find(r => r.id === 't2')
    expect(failed?.status).toBe('failed')
    expect(failEvents).toHaveLength(1)
    expect(merged).toContain('Failed')
  })

  it('stops on batch failure and does not proceed to next batch', async () => {
    gateRegistry.register({
      name: 'tests',
      description: 'Fail gate',
      command: 'exit 1',
      timeout: 5000,
      required: true,
      on_failure: 'stop',
    })

    const tasks: TaskDefinition[] = [
      { id: '1.1', name: 'Fail', files: [], depends_on: [], action: '', verify: '', done: '' },
      { id: '2.1', name: 'Never runs', files: [], depends_on: ['1.1'], action: '', verify: '', done: '' },
    ]
    const plan = planBatches(tasks)
    const state = await engine.execute('stop-test', plan)

    expect(state.batches[0].status).toBe('failed')
    expect(state.batches[1].status).toBe('pending')
  })
})
