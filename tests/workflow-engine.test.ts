import { describe, it, expect } from 'vitest'
import { WorkflowEngine, WorkflowCycleError } from '../src/workflow/workflow-engine.js'
import type { WorkflowDefinition } from '../src/schemas/workflow-definition.js'
import type { ArtifactStatus } from '../src/schemas/change-metadata.js'

function makeWorkflow(name: string, artifacts: Array<{ id: string; requires: string[] }>): WorkflowDefinition {
  return {
    name,
    version: 1,
    artifacts: artifacts.map(a => ({
      id: a.id,
      type: a.id,
      template: `${a.id}.md`,
      generates: `${a.id}.md`,
      requires: a.requires,
      agents: ['default'],
      gates: [],
    })),
  }
}

describe('WorkflowEngine', () => {
  describe('topological sort', () => {
    it('sorts a linear pipeline', () => {
      const engine = new WorkflowEngine()
      const def = makeWorkflow('linear', [
        { id: 'a', requires: [] },
        { id: 'b', requires: ['a'] },
        { id: 'c', requires: ['b'] },
      ])
      const graph = engine.loadWorkflowFromDefinition(def)
      expect(graph.buildOrder).toEqual(['a', 'b', 'c'])
    })

    it('sorts parallel artifacts alphabetically', () => {
      const engine = new WorkflowEngine()
      const def = makeWorkflow('parallel', [
        { id: 'design', requires: [] },
        { id: 'tasks', requires: ['design'] },
        { id: 'architecture', requires: ['design'] },
        { id: 'ux-spec', requires: ['design'] },
        { id: 'implementation', requires: ['tasks', 'architecture'] },
      ])
      const graph = engine.loadWorkflowFromDefinition(def)
      // architecture, tasks, ux-spec are parallelizable after design
      expect(graph.buildOrder[0]).toBe('design')
      expect(graph.buildOrder.indexOf('architecture')).toBeLessThan(graph.buildOrder.indexOf('implementation'))
      expect(graph.buildOrder.indexOf('tasks')).toBeLessThan(graph.buildOrder.indexOf('implementation'))
    })

    it('detects cycles', () => {
      const engine = new WorkflowEngine()
      const def = makeWorkflow('cyclic', [
        { id: 'a', requires: ['c'] },
        { id: 'b', requires: ['a'] },
        { id: 'c', requires: ['b'] },
      ])
      expect(() => engine.loadWorkflowFromDefinition(def)).toThrow(WorkflowCycleError)
    })

    it('throws for unknown dependency', () => {
      const engine = new WorkflowEngine()
      const def = makeWorkflow('missing-dep', [
        { id: 'a', requires: ['nonexistent'] },
      ])
      expect(() => engine.loadWorkflowFromDefinition(def)).toThrow()
    })
  })

  describe('getNext', () => {
    it('returns artifacts with all deps complete', () => {
      const engine = new WorkflowEngine()
      const def = makeWorkflow('standard', [
        { id: 'intent', requires: [] },
        { id: 'spec', requires: ['intent'] },
        { id: 'design', requires: ['spec'] },
      ])
      const graph = engine.loadWorkflowFromDefinition(def)

      const statuses: Record<string, ArtifactStatus> = {
        intent: 'complete',
        spec: 'pending',
        design: 'pending',
      }

      const next = engine.getNext(graph, statuses)
      expect(next.map(a => a.id)).toEqual(['spec'])
    })

    it('returns multiple parallel artifacts', () => {
      const engine = new WorkflowEngine()
      const def = makeWorkflow('parallel', [
        { id: 'design', requires: [] },
        { id: 'tasks', requires: ['design'] },
        { id: 'arch', requires: ['design'] },
      ])
      const graph = engine.loadWorkflowFromDefinition(def)

      const statuses: Record<string, ArtifactStatus> = {
        design: 'complete',
        tasks: 'pending',
        arch: 'ready',
      }

      const next = engine.getNext(graph, statuses)
      expect(next.map(a => a.id).sort()).toEqual(['arch', 'tasks'])
    })

    it('treats skipped as complete for dependency resolution', () => {
      const engine = new WorkflowEngine()
      const def = makeWorkflow('skip', [
        { id: 'a', requires: [] },
        { id: 'b', requires: ['a'] },
      ])
      const graph = engine.loadWorkflowFromDefinition(def)

      const statuses: Record<string, ArtifactStatus> = {
        a: 'skipped',
        b: 'pending',
      }

      const next = engine.getNext(graph, statuses)
      expect(next.map(a => a.id)).toEqual(['b'])
    })

    it('returns root artifacts from empty statuses map', () => {
      const engine = new WorkflowEngine()
      const def = makeWorkflow('fresh', [
        { id: 'a', requires: [] },
        { id: 'b', requires: ['a'] },
      ])
      const graph = engine.loadWorkflowFromDefinition(def)

      const next = engine.getNext(graph, {})
      expect(next.map(a => a.id)).toEqual(['a'])
    })

    it('returns empty when nothing is ready', () => {
      const engine = new WorkflowEngine()
      const def = makeWorkflow('blocked', [
        { id: 'a', requires: [] },
        { id: 'b', requires: ['a'] },
      ])
      const graph = engine.loadWorkflowFromDefinition(def)

      const statuses: Record<string, ArtifactStatus> = {
        a: 'in_progress',
        b: 'pending',
      }

      const next = engine.getNext(graph, statuses)
      expect(next).toEqual([])
    })
  })

  describe('getStatus', () => {
    it('returns status for all artifacts', () => {
      const engine = new WorkflowEngine()
      const def = makeWorkflow('test', [
        { id: 'a', requires: [] },
        { id: 'b', requires: ['a'] },
      ])
      const graph = engine.loadWorkflowFromDefinition(def)

      const statuses: Record<string, ArtifactStatus> = {
        a: 'complete',
        b: 'in_progress',
      }

      const result = engine.getStatus(graph, statuses)
      expect(result).toHaveLength(2)
      expect(result[0].status).toBe('complete')
      expect(result[1].status).toBe('in_progress')
    })

    it('defaults to pending for unknown artifacts', () => {
      const engine = new WorkflowEngine()
      const def = makeWorkflow('test', [
        { id: 'a', requires: [] },
      ])
      const graph = engine.loadWorkflowFromDefinition(def)

      const result = engine.getStatus(graph, {})
      expect(result[0].status).toBe('pending')
    })
  })

  describe('validate', () => {
    it('returns valid for good workflows', () => {
      const engine = new WorkflowEngine()
      const def = makeWorkflow('valid', [
        { id: 'a', requires: [] },
        { id: 'b', requires: ['a'] },
      ])
      const graph = engine.loadWorkflowFromDefinition(def)
      const result = engine.validate(graph)
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })
  })

  describe('workflow loading from YAML', () => {
    it('loads built-in workflows from templates directory', async () => {
      const engine = new WorkflowEngine()
      const searchPaths = [new URL('../src/templates/workflows', import.meta.url).pathname]

      const quick = await engine.loadWorkflow('quick', searchPaths)
      expect(quick.name).toBe('quick')
      expect(quick.artifacts).toHaveLength(3)

      const standard = await engine.loadWorkflow('standard', searchPaths)
      expect(standard.name).toBe('standard')
      expect(standard.artifacts).toHaveLength(7)

      const full = await engine.loadWorkflow('full', searchPaths)
      expect(full.name).toBe('full')
      expect(full.artifacts).toHaveLength(10)
    })

    it('throws for non-existent workflow', async () => {
      const engine = new WorkflowEngine()
      await expect(engine.loadWorkflow('nonexistent', ['/tmp'])).rejects.toThrow()
    })
  })
})
