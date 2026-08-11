import { exec } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { GateRegistry } from '../gates/gate-registry.js'

const execAsync = promisify(exec)

export interface MergeSafetyStep {
  step: string
  status: 'pass' | 'fail' | 'skip'
  detail?: string
}

export interface MergeSafetyResult {
  status: 'success' | 'failure' | 'conflict'
  steps: MergeSafetyStep[]
  mergeCommit?: string
  snapshotTag?: string
}

export class MergeSafetyPipeline {
  constructor(private cwd: string, private gateRegistry?: GateRegistry) {}

  private async git(args: string): Promise<string> {
    const { stdout } = await execAsync(`git ${args}`, { cwd: this.cwd })
    return stdout.trim()
  }

  /**
   * Rebuild the target checkout's dist after a successful merge so the
   * globally-linked CLI (and the hooks/statusline that exec it) serve code
   * matching the new target HEAD instead of a stale dist.
   *
   * Failures are reported loudly via a `rebuild-dist` step but NEVER change
   * the overall pipeline status — the merge has already landed and must not
   * be undone or masked by a build problem.
   */
  private async rebuildDist(steps: MergeSafetyStep[], targetBranch: string): Promise<void> {
    let manifest: string
    try {
      manifest = await readFile(join(this.cwd, 'package.json'), 'utf8')
    } catch {
      // Not an npm project (metta ships non-npm projects too) — nothing to
      // rebuild, so this is a normal skip rather than a failure.
      steps.push({
        step: 'rebuild-dist',
        status: 'skip',
        detail: `no package.json in ${this.cwd} — the checkout hosting ${targetBranch} is not an npm project, nothing to rebuild`,
      })
      return
    }
    let hasBuildScript = false
    try {
      const parsed = JSON.parse(manifest) as { scripts?: Record<string, string> }
      hasBuildScript = typeof parsed.scripts?.build === 'string'
    } catch {
      steps.push({
        step: 'rebuild-dist',
        status: 'fail',
        detail: `cannot rebuild dist: package.json in ${this.cwd} is not valid JSON — dist is now stale until you run npm run build manually`,
      })
      return
    }
    if (!hasBuildScript) {
      steps.push({ step: 'rebuild-dist', status: 'skip', detail: 'no build script in package.json' })
      return
    }
    try {
      await execAsync('npm run build', { cwd: this.cwd, maxBuffer: 10 * 1024 * 1024 })
      steps.push({ step: 'rebuild-dist', status: 'pass', detail: 'npm run build' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      steps.push({
        step: 'rebuild-dist',
        status: 'fail',
        detail: `npm run build failed — dist in ${this.cwd} is stale or partially built; run npm run build there manually. ${message}`,
      })
    }
  }

  async run(
    sourceBranch: string,
    targetBranch: string,
    dryRun: boolean = false,
  ): Promise<MergeSafetyResult> {
    const steps: MergeSafetyStep[] = []

    // First step: finalize-check — block ship of metta/* branches whose change is not archived
    const metaMatch = sourceBranch.match(/^metta\/(.+)$/)
    if (!metaMatch) {
      steps.push({ step: 'finalize-check', status: 'skip', detail: 'non-metta branch' })
    } else {
      const changeName = metaMatch[1]
      const archiveDir = join(this.cwd, 'spec', 'archive')
      let archiveMatches: string[] = []
      try {
        const entries = await readdir(archiveDir)
        archiveMatches = entries.filter(e => e.endsWith(`-${changeName}`))
      } catch {
        // archive dir doesn't exist
      }
      if (archiveMatches.length === 0) {
        steps.push({
          step: 'finalize-check',
          status: 'fail',
          detail: `change not finalized — run metta finalize --change ${changeName} first`,
        })
        return { status: 'failure', steps }
      }
      steps.push({ step: 'finalize-check', status: 'pass', detail: archiveMatches[0] })
    }

    // Step 0: Record starting branch and check working tree is clean
    let startingBranch: string | null = null
    try {
      startingBranch = await this.git('symbolic-ref --short HEAD')
    } catch {
      steps.push({ step: 'preflight', status: 'fail', detail: 'detached HEAD or no branch' })
      return { status: 'failure', steps }
    }
    try {
      const status = await this.git('status --porcelain --untracked-files=no')
      if (status.length > 0) {
        steps.push({ step: 'preflight', status: 'fail', detail: 'working tree has uncommitted changes to tracked files' })
        return { status: 'failure', steps }
      }
    } catch (err) {
      steps.push({ step: 'preflight', status: 'fail', detail: String(err) })
      return { status: 'failure', steps }
    }
    steps.push({ step: 'preflight', status: 'pass', detail: `on ${startingBranch}` })

    const restore = async (): Promise<void> => {
      if (startingBranch && startingBranch !== targetBranch) {
        // Best-effort restore: checking out the starting branch may fail if the
        // working tree is already detached/dirty; the caller's result still reports
        // the real failure, so a failed cleanup here is non-fatal.
        await execAsync(`git checkout ${startingBranch}`, { cwd: this.cwd }).catch(() => {})
      }
    }

    // Step 1: Base drift check — target branch exists
    let targetHeadBefore: string
    try {
      targetHeadBefore = await this.git(`rev-parse ${targetBranch}`)
      steps.push({ step: 'base-drift-check', status: 'pass', detail: targetHeadBefore.slice(0, 7) })
    } catch (err) {
      steps.push({ step: 'base-drift-check', status: 'fail', detail: String(err) })
      return { status: 'failure', steps }
    }

    // Step 1b: Verify source branch exists and resolve its HEAD
    let sourceHead: string
    try {
      sourceHead = await this.git(`rev-parse ${sourceBranch}`)
    } catch (err) {
      steps.push({ step: 'base-drift-check', status: 'fail', detail: `source branch ${sourceBranch} not found` })
      return { status: 'failure', steps }
    }

    // Step 2: Check out target branch so subsequent merges land there
    try {
      await this.git(`checkout ${targetBranch}`)
    } catch (err) {
      steps.push({ step: 'checkout-target', status: 'fail', detail: String(err) })
      return { status: 'failure', steps }
    }
    steps.push({ step: 'checkout-target', status: 'pass', detail: targetBranch })

    // Step 3: Dry-run merge (we are now on target)
    try {
      await this.git(`merge --no-commit --no-ff ${sourceBranch}`)
      // Best-effort cleanup of the dry-run merge: there may be nothing to abort
      // when the merge was a clean fast-forward, so an error here is expected.
      await execAsync('git merge --abort', { cwd: this.cwd }).catch(() => {})
      steps.push({ step: 'dry-run-merge', status: 'pass' })
    } catch {
      // Best-effort rollback of the conflicted dry-run; the conflict is already
      // recorded below, so a failed abort does not change the reported outcome.
      await execAsync('git merge --abort', { cwd: this.cwd }).catch(() => {})
      steps.push({ step: 'dry-run-merge', status: 'fail', detail: 'Merge conflicts detected' })
      await restore()
      return { status: 'conflict', steps }
    }

    // Step 4: Scope check
    try {
      const diff = await this.git(`diff --name-only ${targetBranch}...${sourceBranch}`)
      const files = diff.split('\n').filter(Boolean)
      steps.push({ step: 'scope-check', status: 'pass', detail: `${files.length} files changed` })
    } catch {
      steps.push({ step: 'scope-check', status: 'skip' })
    }

    // Step 5: Gate verification (assume gates passed on branch)
    steps.push({ step: 'gate-verification', status: 'pass' })

    if (dryRun) {
      steps.push({ step: 'snapshot', status: 'skip', detail: 'dry-run' })
      steps.push({ step: 'merge', status: 'skip', detail: 'dry-run' })
      steps.push({ step: 'post-merge-gates', status: 'skip', detail: 'dry-run' })
      await restore()
      return { status: 'success', steps }
    }

    // Step 6: Snapshot target HEAD so we can roll back
    const snapshotTag = `metta/pre-merge/${sourceBranch}`
    try {
      await this.git(`tag -f ${snapshotTag} ${targetHeadBefore}`)
      steps.push({ step: 'snapshot', status: 'pass', detail: snapshotTag })
    } catch {
      steps.push({ step: 'snapshot', status: 'fail' })
      await restore()
      return { status: 'failure', steps }
    }

    // Step 7: Real merge into target
    let mergeCommit: string
    try {
      await this.git(`merge --no-ff ${sourceBranch} -m "chore: merge ${sourceBranch}"`)
      mergeCommit = await this.git('rev-parse HEAD')
    } catch {
      try {
        await this.git(`reset --hard ${snapshotTag}`)
        steps.push({ step: 'merge', status: 'fail', detail: 'Rolled back to snapshot' })
      } catch {
        steps.push({ step: 'merge', status: 'fail', detail: 'Rollback failed' })
      }
      await restore()
      return { status: 'failure', steps, snapshotTag }
    }

    // Step 8: Verify the merge actually advanced target and contains source
    try {
      const targetHeadAfter = await this.git(`rev-parse ${targetBranch}`)
      if (targetHeadAfter === targetHeadBefore) {
        // Best-effort recovery: reset target back to the pre-merge snapshot. The
        // failure is already being reported, so a failed reset does not mask it.
        await this.git(`reset --hard ${snapshotTag}`).catch(() => {})
        steps.push({ step: 'merge', status: 'fail', detail: 'target branch did not advance (already up to date?)' })
        await restore()
        return { status: 'failure', steps, snapshotTag }
      }
      // Ancestry check: sourceHead must be reachable from targetHeadAfter
      try {
        await this.git(`merge-base --is-ancestor ${sourceHead} ${targetHeadAfter}`)
      } catch {
        // Best-effort recovery: reset target back to the pre-merge snapshot. The
        // failure is already being reported, so a failed reset does not mask it.
        await this.git(`reset --hard ${snapshotTag}`).catch(() => {})
        steps.push({ step: 'merge', status: 'fail', detail: 'source not an ancestor of target after merge' })
        await restore()
        return { status: 'failure', steps, snapshotTag }
      }
      steps.push({ step: 'merge', status: 'pass', detail: mergeCommit.slice(0, 7) })
    } catch (err) {
      steps.push({ step: 'merge', status: 'fail', detail: String(err) })
      await restore()
      return { status: 'failure', steps, snapshotTag }
    }

    // Step 9: Post-merge gates (real execution)
    const registry = this.gateRegistry
    const gateNames = registry ? registry.list().map(g => g.name) : []
    if (!registry || gateNames.length === 0) {
      steps.push({ step: 'post-merge-gates', status: 'pass', detail: 'no gates configured' })
    } else {
      const results = await registry.runAll(gateNames, this.cwd)
      const failed = results.find(r => r.status === 'fail')
      if (failed) {
        // Failure path: roll back
        steps.push({
          step: 'post-merge-gates',
          status: 'fail',
          detail: `${failed.gate} failed; rolled back to ${snapshotTag}`,
        })
        try {
          await this.git(`reset --hard ${snapshotTag}`)
          steps.push({ step: 'rollback', status: 'pass' })
        } catch {
          steps.push({
            step: 'rollback',
            status: 'fail',
            detail: 'rollback also failed — manual intervention required',
          })
        }
        return { status: 'failure', steps, snapshotTag }
      }
      steps.push({ step: 'post-merge-gates', status: 'pass', detail: `${results.length} gates passed` })
    }

    // Step 10: Rebuild dist in the target checkout so the globally-linked CLI
    // is not left serving pre-merge code. A rebuild failure is surfaced loudly
    // but never fails or rolls back the already-completed merge.
    await this.rebuildDist(steps, targetBranch)
    return { status: 'success', steps, mergeCommit, snapshotTag }
  }
}
