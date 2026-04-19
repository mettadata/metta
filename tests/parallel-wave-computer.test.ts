import { describe, it, expect } from 'vitest'
import {
  computeWaves,
  type TaskGraph,
} from '../src/planning/parallel-wave-computer.js'

describe('computeWaves', () => {
  it('emits one parallel wave for three disjoint tasks in one batch', () => {
    const graph: TaskGraph = {
      batches: [
        {
          batch: 1,
          label: 'Batch 1',
          tasks: [
            { id: '1.1', files: ['src/a.ts'], dependsOn: [] },
            { id: '1.2', files: ['src/b.ts'], dependsOn: [] },
            { id: '1.3', files: ['src/c.ts'], dependsOn: [] },
          ],
        },
      ],
    }

    const plan = computeWaves(graph, 'change-x')
    expect(plan.change).toBe('change-x')
    expect(plan.batches).toHaveLength(1)
    expect(plan.batches[0].waves).toHaveLength(1)
    const wave = plan.batches[0].waves[0]
    expect(wave.wave).toBe('Wave 1')
    expect(wave.mode).toBe('parallel')
    expect(wave.tasks.sort()).toEqual(['1.1', '1.2', '1.3'])
  })

  it('emits three sequential waves when all tasks share the same file', () => {
    const graph: TaskGraph = {
      batches: [
        {
          batch: 1,
          label: 'Batch 1',
          tasks: [
            { id: '1.3', files: ['src/shared.ts'], dependsOn: [] },
            { id: '1.1', files: ['src/shared.ts'], dependsOn: [] },
            { id: '1.2', files: ['src/shared.ts'], dependsOn: [] },
          ],
        },
      ],
    }

    const plan = computeWaves(graph, 'change-y')
    expect(plan.batches[0].waves).toHaveLength(3)
    const waves = plan.batches[0].waves
    // Alphabetical tiebreak: 1.1 -> 1.2 -> 1.3
    expect(waves[0].tasks).toEqual(['1.1'])
    expect(waves[0].mode).toBe('sequential')
    expect(waves[0].wave).toBe('Wave 1')
    expect(waves[1].tasks).toEqual(['1.2'])
    expect(waves[1].mode).toBe('sequential')
    expect(waves[1].wave).toBe('Wave 2')
    expect(waves[2].tasks).toEqual(['1.3'])
    expect(waves[2].mode).toBe('sequential')
    expect(waves[2].wave).toBe('Wave 3')
  })

  it('groups a disjoint task with the first task of a shared-file chain in wave 1', () => {
    const graph: TaskGraph = {
      batches: [
        {
          batch: 1,
          label: 'Batch 1',
          tasks: [
            { id: '1.1', files: ['src/shared.ts'], dependsOn: [] },
            { id: '1.2', files: ['src/shared.ts'], dependsOn: [] },
            { id: '1.3', files: ['src/disjoint.ts'], dependsOn: [] },
          ],
        },
      ],
    }

    const plan = computeWaves(graph, 'change-z')
    const waves = plan.batches[0].waves
    expect(waves).toHaveLength(2)
    // Wave 1: the disjoint task + the first (alphabetically) of the chain
    expect(waves[0].tasks.sort()).toEqual(['1.1', '1.3'])
    expect(waves[0].mode).toBe('parallel')
    // Wave 2: the second task of the chain on its own
    expect(waves[1].tasks).toEqual(['1.2'])
    expect(waves[1].mode).toBe('sequential')
  })

  it('treats batches as independent even when tasks across batches share files', () => {
    const graph: TaskGraph = {
      batches: [
        {
          batch: 1,
          label: 'Batch 1',
          tasks: [
            { id: '1.1', files: ['src/shared.ts'], dependsOn: [] },
            { id: '1.2', files: ['src/a.ts'], dependsOn: [] },
          ],
        },
        {
          batch: 2,
          label: 'Batch 2',
          tasks: [
            { id: '2.1', files: ['src/shared.ts'], dependsOn: [] },
            { id: '2.2', files: ['src/b.ts'], dependsOn: [] },
          ],
        },
      ],
    }

    const plan = computeWaves(graph, 'change-cross')
    expect(plan.batches).toHaveLength(2)
    // Batch 1: one parallel wave, both tasks fit (no intra-batch overlap)
    expect(plan.batches[0].waves).toHaveLength(1)
    expect(plan.batches[0].waves[0].tasks.sort()).toEqual(['1.1', '1.2'])
    expect(plan.batches[0].waves[0].mode).toBe('parallel')
    // Wave numbering is global: batch 2's first wave is Wave 2
    expect(plan.batches[1].waves).toHaveLength(1)
    expect(plan.batches[1].waves[0].wave).toBe('Wave 2')
    expect(plan.batches[1].waves[0].tasks.sort()).toEqual(['2.1', '2.2'])
    expect(plan.batches[1].waves[0].mode).toBe('parallel')
  })

  it('honors a dependsOn edge that has no file-overlap justification', () => {
    const graph: TaskGraph = {
      batches: [
        {
          batch: 1,
          label: 'Batch 1',
          tasks: [
            { id: '1.1', files: ['src/a.ts'], dependsOn: [] },
            { id: '1.2', files: ['src/b.ts'], dependsOn: ['1.1'] },
          ],
        },
      ],
    }

    const plan = computeWaves(graph, 'change-dep')
    const waves = plan.batches[0].waves
    expect(waves).toHaveLength(2)
    expect(waves[0].tasks).toEqual(['1.1'])
    expect(waves[0].mode).toBe('sequential')
    expect(waves[1].tasks).toEqual(['1.2'])
    expect(waves[1].mode).toBe('sequential')
  })

  it('throws with task IDs on a dependency cycle', () => {
    const graph: TaskGraph = {
      batches: [
        {
          batch: 1,
          label: 'Batch 1',
          tasks: [
            { id: '1.1', files: ['src/a.ts'], dependsOn: ['1.2'] },
            { id: '1.2', files: ['src/b.ts'], dependsOn: ['1.1'] },
          ],
        },
      ],
    }

    expect(() => computeWaves(graph, 'change-cycle')).toThrow(/1\.1/)
    expect(() => computeWaves(graph, 'change-cycle')).toThrow(/1\.2/)
  })

  it('treats tasks with missing or empty files as disjoint singleton clusters', () => {
    const graph: TaskGraph = {
      batches: [
        {
          batch: 1,
          label: 'Batch 1',
          tasks: [
            { id: '1.1', files: [], dependsOn: [] },
            { id: '1.2', files: [], dependsOn: [] },
            { id: '1.3', files: ['src/a.ts'], dependsOn: [] },
          ],
        },
      ],
    }

    const plan = computeWaves(graph, 'change-empty')
    expect(plan.batches[0].waves).toHaveLength(1)
    expect(plan.batches[0].waves[0].tasks.sort()).toEqual(['1.1', '1.2', '1.3'])
    expect(plan.batches[0].waves[0].mode).toBe('parallel')
  })
})
