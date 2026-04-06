import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import YAML from 'yaml'
import {
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
  type WorkflowArtifact,
} from '../schemas/workflow-definition.js'
import type { ArtifactStatus } from '../schemas/change-metadata.js'

export class WorkflowCycleError extends Error {
  constructor(public readonly cyclePath: string[]) {
    super(`Cycle detected in workflow: ${cyclePath.join(' → ')}`)
    this.name = 'WorkflowCycleError'
  }
}

export interface WorkflowGraph {
  name: string
  artifacts: WorkflowArtifact[]
  buildOrder: string[]
}

export class WorkflowEngine {
  private workflows = new Map<string, WorkflowGraph>()

  async loadWorkflow(
    name: string,
    searchPaths: string[],
  ): Promise<WorkflowGraph> {
    const cached = this.workflows.get(name)
    if (cached) return cached

    let definition: WorkflowDefinition | null = null

    for (const searchPath of searchPaths) {
      try {
        const filePath = join(searchPath, `${name}.yaml`)
        const content = await readFile(filePath, 'utf-8')
        const raw = YAML.parse(content)
        definition = WorkflowDefinitionSchema.parse(raw)
        break
      } catch {
        continue
      }
    }

    if (!definition) {
      throw new Error(`Workflow '${name}' not found in: ${searchPaths.join(', ')}`)
    }

    // Handle extends
    if (definition.extends) {
      const base = await this.loadWorkflow(definition.extends, searchPaths)
      definition = this.mergeWorkflows(base, definition)
    }

    const buildOrder = this.topologicalSort(definition.artifacts)
    const graph: WorkflowGraph = {
      name: definition.name,
      artifacts: definition.artifacts,
      buildOrder,
    }

    this.workflows.set(name, graph)
    return graph
  }

  loadWorkflowFromDefinition(definition: WorkflowDefinition): WorkflowGraph {
    const buildOrder = this.topologicalSort(definition.artifacts)
    const graph: WorkflowGraph = {
      name: definition.name,
      artifacts: definition.artifacts,
      buildOrder,
    }
    this.workflows.set(definition.name, graph)
    return graph
  }

  getNext(
    graph: WorkflowGraph,
    statuses: Record<string, ArtifactStatus>,
  ): WorkflowArtifact[] {
    return graph.artifacts.filter(artifact => {
      const status = statuses[artifact.id] ?? 'pending'
      if (status !== 'pending' && status !== 'ready') return false

      return artifact.requires.every(depId => {
        const depStatus = statuses[depId]
        return depStatus === 'complete' || depStatus === 'skipped'
      })
    })
  }

  getStatus(
    graph: WorkflowGraph,
    statuses: Record<string, ArtifactStatus>,
  ): Array<{ artifact: WorkflowArtifact; status: ArtifactStatus }> {
    return graph.artifacts.map(artifact => ({
      artifact,
      status: statuses[artifact.id] ?? 'pending',
    }))
  }

  /**
   * Validates that all artifact `requires` references resolve to known artifact IDs.
   *
   * Note: For graphs produced by the engine (via loadWorkflow or loadWorkflowFromDefinition),
   * topologicalSort already enforces this constraint at load time and will throw on dangling
   * references. This method provides defensive validation for graphs assembled externally --
   * for example, after deserialization from state files or manual construction -- where the
   * load-time check was bypassed.
   */
  validate(graph: WorkflowGraph): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    const artifactIds = new Set(graph.artifacts.map(a => a.id))

    for (const artifact of graph.artifacts) {
      for (const dep of artifact.requires) {
        if (!artifactIds.has(dep)) {
          errors.push(`Artifact '${artifact.id}' depends on unknown artifact '${dep}'`)
        }
      }
    }

    return { valid: errors.length === 0, errors }
  }

  private topologicalSort(artifacts: WorkflowArtifact[]): string[] {
    const inDegree = new Map<string, number>()
    const adjacency = new Map<string, string[]>()
    const artifactIds = new Set<string>()

    for (const artifact of artifacts) {
      artifactIds.add(artifact.id)
      inDegree.set(artifact.id, 0)
      adjacency.set(artifact.id, [])
    }

    for (const artifact of artifacts) {
      for (const dep of artifact.requires) {
        if (!artifactIds.has(dep)) {
          throw new Error(`Artifact '${artifact.id}' depends on unknown artifact '${dep}'`)
        }
        adjacency.get(dep)!.push(artifact.id)
        inDegree.set(artifact.id, (inDegree.get(artifact.id) ?? 0) + 1)
      }
    }

    // Kahn's algorithm with deterministic tie-breaking (alphabetical)
    const queue: string[] = []
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id)
    }
    queue.sort()

    const result: string[] = []

    while (queue.length > 0) {
      const current = queue.shift()!
      result.push(current)

      const newReady: string[] = []
      for (const neighbor of adjacency.get(current) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1
        inDegree.set(neighbor, newDegree)
        if (newDegree === 0) {
          newReady.push(neighbor)
        }
      }
      newReady.sort()
      queue.push(...newReady)
      queue.sort()
    }

    if (result.length !== artifacts.length) {
      // Find cycle
      const remaining = artifacts
        .filter(a => !result.includes(a.id))
        .map(a => a.id)
      throw new WorkflowCycleError(remaining)
    }

    return result
  }

  private mergeWorkflows(
    base: WorkflowGraph,
    extension: WorkflowDefinition,
  ): WorkflowDefinition {
    const artifacts = [...base.artifacts]

    // Add new artifacts from extension
    for (const newArtifact of extension.artifacts) {
      const existingIdx = artifacts.findIndex(a => a.id === newArtifact.id)
      if (existingIdx >= 0) {
        artifacts[existingIdx] = newArtifact
      } else {
        artifacts.push(newArtifact)
      }
    }

    // Apply overrides
    if (extension.overrides) {
      for (const override of extension.overrides) {
        const artifact = artifacts.find(a => a.id === override.id)
        if (artifact) {
          if (override.requires) artifact.requires = override.requires
          if (override.agents) artifact.agents = override.agents
          if (override.gates) artifact.gates = override.gates
        }
      }
    }

    return {
      name: extension.name,
      version: extension.version,
      artifacts,
    }
  }
}
