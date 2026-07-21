import { join } from 'node:path'
import { ArtifactStore } from '../artifacts/artifact-store.js'
import { SpecMerger, type MergeResult } from './spec-merger.js'
import { SpecLockManager } from '../specs/spec-lock-manager.js'
import { GateRegistry } from '../gates/gate-registry.js'
import type { GateResult } from '../schemas/gate-result.js'
import { DocGenerator } from '../docs/doc-generator.js'
import { WorkflowEngine } from '../workflow/workflow-engine.js'
import type { ArtifactStatus } from '../schemas/change-metadata.js'
import { getErrorMessage } from '../util/errors.js'

export interface FinalizeResult {
  changeName: string
  archiveName: string
  specMerge: MergeResult
  gates: GateResult[]
  gatesPassed: boolean
  docsGenerated: string[]
  refreshed: boolean
  /**
   * Workflow-required artifacts that are not yet 'complete'. Set only on the
   * completeness-gate abort path — when present, no merge ran and no gates ran.
   */
  incompleteArtifacts?: Array<{ id: string; status: ArtifactStatus }>
  /**
   * Post-archive path to the generated UAT.md; null when generation was
   * disabled, skipped (dry-run / abort paths / no projectRoot), or degraded.
   */
  uatPath: string | null
  /** Set only when UAT generation failed and finalize degraded. */
  uatError?: string
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
    // Step 1: Load change metadata
    const metadata = await this.artifactStore.getChange(changeName)

    // Step 2: Resolve workflow-required artifact ids and workflow-scoped gate
    // names from a single workflow load (when the engine is available).
    // Gate names union the `gates` arrays across every artifact declared in the
    // workflow YAML so gates like stories-valid don't fire on workflows that
    // don't produce them. Required artifact ids fall back to the change's own
    // artifact map when the workflow can't be loaded.
    let scopedGateNames: string[] | undefined
    let requiredArtifactIds: string[] = Object.keys(metadata.artifacts)
    if (this.workflowEngine && this.workflowSearchPaths) {
      try {
        const workflow = await this.workflowEngine.loadWorkflow(metadata.workflow, this.workflowSearchPaths)
        scopedGateNames = [...new Set(workflow.artifacts.flatMap(a => a.gates ?? []))]
        requiredArtifactIds = workflow.artifacts.map(a => a.id)
      } catch {
        // If workflow loading fails, fall back to registry.list() behavior below
        // and to the metadata's own artifact ids above.
        scopedGateNames = undefined
        requiredArtifactIds = Object.keys(metadata.artifacts)
      }
    }

    // Completeness gate: every required artifact must be 'complete' before any
    // merge or gate work happens. Only 'complete' counts —
    // pending/ready/in_progress/failed/skipped all block.
    const incompleteArtifacts = requiredArtifactIds
      .map(id => ({ id, status: (metadata.artifacts[id] ?? 'pending') as ArtifactStatus }))
      .filter(a => a.status !== 'complete')
    if (incompleteArtifacts.length > 0) {
      return {
        changeName,
        archiveName: '',
        specMerge: { status: 'clean', merged: [], conflicts: [] },
        gates: [],
        gatesPassed: false,
        docsGenerated: [],
        refreshed: false,
        incompleteArtifacts,
        uatPath: null,
      }
    }

    // Step 3: Dry-run merge for conflict detection only — no spec writes yet,
    // regardless of the caller's dryRun param.
    const merger = new SpecMerger(this.specDir, this.specLockManager)
    const dryRunMerge = await merger.merge(changeName, metadata.base_versions, true)

    if (dryRunMerge.status === 'conflict') {
      return {
        changeName,
        archiveName: '',
        specMerge: dryRunMerge,
        gates: [],
        gatesPassed: false,
        docsGenerated: [],
        refreshed: false,
        uatPath: null,
      }
    }

    // Step 4: Run quality gates (tests, lint, typecheck, build) — before any
    // spec write, so a gate failure leaves specs/ untouched.
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
          specMerge: dryRunMerge,
          gates,
          gatesPassed: false,
          docsGenerated: [],
          refreshed: false,
          uatPath: null,
        }
      }
    }

    // Step 5: Only after gates pass. A caller dry-run returns here reusing the
    // Step 3 result (no second merge call); otherwise perform the real write.
    if (dryRun) {
      return {
        changeName,
        archiveName: `(dry-run)`,
        specMerge: dryRunMerge,
        gates,
        gatesPassed,
        docsGenerated: [],
        refreshed: false,
        uatPath: null,
      }
    }

    const specMerge = await merger.merge(changeName, metadata.base_versions, false)
    if (specMerge.status === 'conflict') {
      // Conflicts that only surface on the applying write (e.g. MODIFIED
      // targeting a requirement the dry run cannot see) still abort here.
      return {
        changeName,
        archiveName: '',
        specMerge,
        gates,
        gatesPassed,
        docsGenerated: [],
        refreshed: false,
        uatPath: null,
      }
    }

    // Step 5b: Generate UAT.md (pre-archive so the move sweeps it in)
    let uatGenerated = false
    let uatError: string | undefined
    let configLoader: import('../config/config-loader.js').ConfigLoader | undefined
    if (this.projectRoot) {
      try {
        const { ConfigLoader } = await import('../config/config-loader.js')
        configLoader ??= new ConfigLoader(this.projectRoot)
        const config = await configLoader.load()
        if (config.uat.enabled) {
          const { generateUat } = await import('./uat-generator.js')
          const uatResult = await generateUat({
            changeName,
            changeDir: join(this.specDir, 'changes', changeName),
            generatedAt: new Date().toISOString().slice(0, 10),
            gates,
            gatesPassed,
          })
          await this.artifactStore.writeArtifact(changeName, 'UAT.md', uatResult.markdown)
          uatGenerated = true
        }
      } catch (err) {
        uatError = getErrorMessage(err) // warn-and-continue; finalize proceeds
        // Best-effort cleanup of a partially written UAT.md so a truncated
        // file is never swept into the archive.
        const { rm } = await import('node:fs/promises')
        await rm(join(this.specDir, 'changes', changeName, 'UAT.md'), { force: true }).catch(() => {})
      }
    }

    // Step 6: Archive the change
    const archiveName = await this.artifactStore.archive(changeName)
    const uatPath = uatGenerated ? join(this.specDir, 'archive', archiveName, 'UAT.md') : null

    // Step 6b: Write gate results to archive
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

    // Step 7: Generate docs (if configured)
    let docsGenerated: string[] = []
    if (this.projectRoot) {
      try {
        // Reuse the Step 5b loader instance when it exists (per-instance cache
        // makes the second load() free); construct our own otherwise. The
        // independent try/catch keeps doc-generation degradation independent
        // of UAT degradation.
        configLoader ??= new (await import('../config/config-loader.js')).ConfigLoader(this.projectRoot)
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

    // Step 8: Refresh context files (placeholder for v0.1)
    const refreshed = false

    return {
      changeName,
      archiveName,
      specMerge,
      gates,
      gatesPassed,
      docsGenerated,
      refreshed,
      uatPath,
      ...(uatError ? { uatError } : {}),
    }
  }
}
