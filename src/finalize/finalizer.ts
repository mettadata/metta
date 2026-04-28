import { join } from 'node:path'
import { ArtifactStore } from '../artifacts/artifact-store.js'
import { SpecMerger, type MergeResult } from './spec-merger.js'
import { SpecLockManager } from '../specs/spec-lock-manager.js'
import { GateRegistry } from '../gates/gate-registry.js'
import type { GateResult } from '../schemas/gate-result.js'
import { DocGenerator } from '../docs/doc-generator.js'
import { WorkflowEngine } from '../workflow/workflow-engine.js'

export interface FinalizeResult {
  changeName: string
  archiveName: string
  specMerge: MergeResult
  gates: GateResult[]
  gatesPassed: boolean
  docsGenerated: string[]
  refreshed: boolean
}

export class Finalizer {
  constructor(
    private specDir: string,
    private artifactStore: ArtifactStore,
    private specLockManager: SpecLockManager,
    private gateRegistry?: GateRegistry,
    private projectRoot?: string,
    private workflowEngine?: WorkflowEngine,
    private workflowSearchPaths?: string[],
  ) {}

  async finalize(changeName: string, dryRun: boolean = false): Promise<FinalizeResult> {
    const metadata = await this.artifactStore.getChange(changeName)

    // Derive workflow-scoped gate names (when the workflow engine is available).
    // Unions the `gates` arrays across every artifact declared in the workflow YAML
    // so gates like stories-valid don't fire on workflows that don't produce them.
    let scopedGateNames: string[] | undefined
    if (this.workflowEngine && this.workflowSearchPaths) {
      try {
        const workflow = await this.workflowEngine.loadWorkflow(metadata.workflow, this.workflowSearchPaths)
        scopedGateNames = [...new Set(workflow.artifacts.flatMap(a => a.gates ?? []))]
      } catch {
        // If workflow loading fails, fall back to registry.list() behavior below.
        scopedGateNames = undefined
      }
    }

    // Step 1-2: Merge delta specs
    const merger = new SpecMerger(this.specDir, this.specLockManager)
    const specMerge = await merger.merge(changeName, metadata.base_versions, dryRun)

    if (specMerge.status === 'conflict') {
      return {
        changeName,
        archiveName: '',
        specMerge,
        gates: [],
        gatesPassed: false,
        docsGenerated: [],
        refreshed: false,
      }
    }

    // Step 2: Run quality gates (tests, lint, typecheck, build)
    let gates: GateResult[] = []
    let gatesPassed = true
    if (this.gateRegistry && this.projectRoot) {
      const gateNames = scopedGateNames ?? this.gateRegistry.list().map(g => g.name)
      if (gateNames.length > 0) {
        gates = await this.gateRegistry.runAll(gateNames, this.projectRoot)
        gatesPassed = gates.every(g => g.status === 'pass' || g.status === 'skip' || g.status === 'warn')
      }
      // Empty gate list = no gates configured = pass

      if (!gatesPassed && !dryRun) {
        return {
          changeName,
          archiveName: '',
          specMerge,
          gates,
          gatesPassed: false,
          docsGenerated: [],
          refreshed: false,
        }
      }
    }

    if (dryRun) {
      return {
        changeName,
        archiveName: `(dry-run)`,
        specMerge,
        gates,
        gatesPassed,
        docsGenerated: [],
        refreshed: false,
      }
    }

    // Step 3: Archive the change
    const archiveName = await this.artifactStore.archive(changeName)

    // Step 3b: Write gate results to archive
    if (gates.length > 0) {
      const { writeFile } = await import('node:fs/promises')
      const YAML = (await import('yaml')).default
      const gateResultsPath = join(this.specDir, 'archive', archiveName, 'gates.yaml')
      await writeFile(gateResultsPath, YAML.stringify({
        finalized_at: new Date().toISOString(),
        all_passed: gatesPassed,
        results: gates.map(g => ({
          gate: g.gate,
          status: g.status,
          duration_ms: g.duration_ms,
        })),
      }))
    }

    // Step 4: Generate docs (if configured)
    let docsGenerated: string[] = []
    if (this.projectRoot) {
      try {
        const { ConfigLoader } = await import('../config/config-loader.js')
        const configLoader = new ConfigLoader(this.projectRoot)
        const config = await configLoader.load()
        const docsConfig = config.docs

        if (docsConfig.generate_on === 'finalize') {
          const generator = new DocGenerator(this.specDir, this.projectRoot, docsConfig)
          const docResult = await generator.generate()
          docsGenerated = docResult.generated
        }
      } catch {
        // Doc generation failure MUST NOT block finalize
      }
    }

    // Step 5: Refresh context files (placeholder for v0.1)
    const refreshed = false

    return {
      changeName,
      archiveName,
      specMerge,
      gates,
      gatesPassed,
      docsGenerated,
      refreshed,
    }
  }
}
