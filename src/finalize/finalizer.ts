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
  /**
   * Effective `uat.enforce_on_ship` from project config; hardcoded `true` on
   * abort/dry-run paths (config never loaded there); ship skills gate only on
   * the real (non-dry-run) success payload; absent in older payloads means
   * consumers treat as `true` (fail-toward-enforce).
   */
  uatEnforceOnShip: boolean
  /**
   * Post-archive path to the generated TOKENS.md; null when generation was
   * disabled, skipped (dry-run / abort paths / no projectRoot), or degraded.
   */
  tokensPath: string | null
  /** Set only when tokens-report generation failed and finalize degraded. */
  tokensError?: string
}

export class Finalizer {
  constructor(
    /**
     * Spec dir of the checkout that HOSTS the change (worktree-aware) — must
     * agree with `ArtifactStore.specDirFor(change)`, never a session-cwd
     * derivation. Every path join below (gates.yaml staging, generateUat's
     * changeDir, cleanup rm paths, reported uatPath/tokensPath) lands in the
     * same checkout the archive move operates on.
     */
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
        uatEnforceOnShip: true,
        tokensPath: null,
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
        uatEnforceOnShip: true,
        tokensPath: null,
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
          uatEnforceOnShip: true,
          tokensPath: null,
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
        uatEnforceOnShip: true,
        tokensPath: null,
      }
    }

    const specMerge = await merger.merge(changeName, metadata.base_versions, false)
    if (specMerge.status === 'conflict') {
      // The compute phase runs the full conflict-detection set identically in
      // dry-run and applying mode, so a conflict here after a clean Step 3
      // dry-run can only mean the spec store drifted on disk between the two
      // calls — not a conflict class the dry-run structurally could not see.
      // The merge is all-or-nothing: a conflict here means zero files and
      // zero locks were written, so specs/ is untouched.
      return {
        changeName,
        archiveName: '',
        specMerge,
        gates,
        gatesPassed,
        docsGenerated: [],
        refreshed: false,
        uatPath: null,
        uatEnforceOnShip: true,
        tokensPath: null,
      }
    }

    // Step 5b: Generate UAT.md (pre-archive so the move sweeps it in)
    let uatGenerated = false
    let uatError: string | undefined
    // Fail-toward-enforce: config-load failure or missing projectRoot keeps
    // the default `true`.
    let uatEnforceOnShip = true
    let configLoader: import('../config/config-loader.js').ConfigLoader | undefined
    if (this.projectRoot) {
      try {
        const { ConfigLoader } = await import('../config/config-loader.js')
        configLoader ??= new ConfigLoader(this.projectRoot)
        const config = await configLoader.load()
        // Set before the enabled branch so `uat.enabled: false` (uatPath
        // null) still reports the configured enforce value.
        uatEnforceOnShip = config.uat.enforce_on_ship
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

    // Step 5c: Generate TOKENS.md (pre-archive so the move sweeps it in)
    let tokensGenerated = false
    let tokensError: string | undefined
    if (this.projectRoot) {
      try {
        const { ConfigLoader } = await import('../config/config-loader.js')
        configLoader ??= new ConfigLoader(this.projectRoot)
        const config = await configLoader.load()
        if (config.tokens.enabled) {
          const { generateTokensReport } = await import('./tokens-report-generator.js')
          const tokensResult = await generateTokensReport({
            changeName,
            generatedAt: new Date().toISOString().slice(0, 10),
            tokenUsage: metadata.token_usage ?? [],
            artifactTimings: metadata.artifact_timings ?? {},
          })
          await this.artifactStore.writeArtifact(changeName, 'TOKENS.md', tokensResult.markdown)
          tokensGenerated = true
        }
      } catch (err) {
        tokensError = getErrorMessage(err) // warn-and-continue; finalize proceeds
        // Best-effort cleanup of a partially written TOKENS.md so a truncated
        // file is never swept into the archive.
        const { rm } = await import('node:fs/promises')
        await rm(join(this.specDir, 'changes', changeName, 'TOKENS.md'), { force: true }).catch(() => {})
      }
    }

    // Step 5d: Stage gate results in the change dir (pre-archive) so the
    // archive move sweeps gates.yaml in — the same pattern UAT.md and
    // TOKENS.md use. Writing into the archive dir AFTER the move could fail
    // (e.g. a wrong-root path) and strand a half-archived change: change dir
    // gone, required archive artifact missing. Staged pre-move, a write
    // failure aborts finalize while the change is still fully active.
    if (gates.length > 0) {
      const YAML = (await import('yaml')).default
      await this.artifactStore.writeArtifact(changeName, 'gates.yaml', YAML.stringify({
        finalized_at: new Date().toISOString(),
        all_passed: gatesPassed,
        results: gates.map(g => ({
          gate: g.gate,
          status: g.status,
          duration_ms: g.duration_ms,
        })),
      }))
    }

    // Step 6: Archive the change (the move sweeps UAT.md, TOKENS.md, and
    // gates.yaml into the archive dir).
    const archiveName = await this.artifactStore.archive(changeName)
    const uatPath = uatGenerated ? join(this.specDir, 'archive', archiveName, 'UAT.md') : null
    const tokensPath = tokensGenerated ? join(this.specDir, 'archive', archiveName, 'TOKENS.md') : null

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
      uatEnforceOnShip,
      tokensPath,
      ...(tokensError ? { tokensError } : {}),
    }
  }
}
