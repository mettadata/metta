import { join } from 'node:path'
import { ArtifactStore } from '../artifacts/artifact-store.js'
import { SpecMerger, type MergeResult } from './spec-merger.js'
import { SpecLockManager } from '../specs/spec-lock-manager.js'
import { GateRegistry } from '../gates/gate-registry.js'
import type { GateResult } from '../schemas/gate-result.js'

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
  ) {}

  async finalize(changeName: string, dryRun: boolean = false): Promise<FinalizeResult> {
    const metadata = await this.artifactStore.getChange(changeName)

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
      const gateNames = this.gateRegistry.list().map(g => g.name)
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

    // Step 4: Generate docs (placeholder for v0.1)
    const docsGenerated: string[] = []

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
