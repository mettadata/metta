import { join } from 'node:path'
import { ArtifactStore } from '../artifacts/artifact-store.js'
import { SpecMerger, type MergeResult } from './spec-merger.js'
import { SpecLockManager } from '../specs/spec-lock-manager.js'

export interface FinalizeResult {
  changeName: string
  archiveName: string
  specMerge: MergeResult
  docsGenerated: string[]
  refreshed: boolean
}

export class Finalizer {
  constructor(
    private specDir: string,
    private artifactStore: ArtifactStore,
    private specLockManager: SpecLockManager,
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
        docsGenerated: [],
        refreshed: false,
      }
    }

    if (dryRun) {
      return {
        changeName,
        archiveName: `(dry-run)`,
        specMerge,
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
      docsGenerated,
      refreshed,
    }
  }
}
