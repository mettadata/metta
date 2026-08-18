import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { MergeSafetyPipeline } from '../src/ship/merge-safety.js'
import type { GateRegistry } from '../src/gates/gate-registry.js'

const execAsync = promisify(exec)

async function writePackageJson(dir: string, buildScript?: string): Promise<void> {
  const manifest: Record<string, unknown> = { name: 'merge-safety-fixture', version: '0.0.0' }
  if (buildScript !== undefined) manifest.scripts = { build: buildScript }
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest, null, 2))
}

describe('MergeSafetyPipeline', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-ship-'))
    // Init a git repo
    await execAsync('git init', { cwd: tempDir })
    await execAsync('git config user.email "test@test.com"', { cwd: tempDir })
    await execAsync('git config user.name "Test"', { cwd: tempDir })
    await execAsync('echo "init" > file.txt && git add . && git commit -m "init"', { cwd: tempDir })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('performs a successful merge', async () => {
    // Create a feature branch with a change
    await execAsync('git checkout -b feature', { cwd: tempDir })
    await execAsync('echo "feature" > feature.txt && git add . && git commit -m "add feature"', { cwd: tempDir })
    await execAsync('git checkout main || git checkout master', { cwd: tempDir })
    await writePackageJson(tempDir, 'node -e "process.exit(0)"')

    const mainBranch = (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()

    const pipeline = new MergeSafetyPipeline(tempDir)
    const result = await pipeline.run('feature', mainBranch)

    expect(result.status).toBe('success')
    expect(result.steps.every(s => s.status === 'pass' || s.status === 'skip')).toBe(true)
    expect(result.mergeCommit).toBeDefined()
    expect(result.snapshotTag).toBeDefined()
  })

  it('performs dry-run without merging', async () => {
    await execAsync('git checkout -b dry-feature', { cwd: tempDir })
    await execAsync('echo "dry" > dry.txt && git add . && git commit -m "dry feature"', { cwd: tempDir })
    await execAsync('git checkout main || git checkout master', { cwd: tempDir })

    const mainBranch = (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()

    const pipeline = new MergeSafetyPipeline(tempDir)
    const result = await pipeline.run('dry-feature', mainBranch, true)

    expect(result.status).toBe('success')
    // Merge and post-merge should be skipped
    const mergeStep = result.steps.find(s => s.step === 'merge')
    expect(mergeStep?.status).toBe('skip')
    // No merge happened, so nothing to rebuild
    expect(result.steps.find(s => s.step === 'rebuild-dist')).toBeUndefined()
  })

  it('detects base drift', async () => {
    // Create feature branch
    await execAsync('git checkout -b drift-feature', { cwd: tempDir })
    await execAsync('echo "feature" > feature.txt && git add . && git commit -m "feature"', { cwd: tempDir })

    // Advance main
    await execAsync('git checkout main || git checkout master', { cwd: tempDir })
    await execAsync('echo "main advance" > main.txt && git add . && git commit -m "advance main"', { cwd: tempDir })

    const mainBranch = (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()

    const pipeline = new MergeSafetyPipeline(tempDir)
    const result = await pipeline.run('drift-feature', mainBranch)

    // Should still succeed (merge is possible even with drift)
    expect(result.status).toBe('success')
    const driftStep = result.steps.find(s => s.step === 'base-drift-check')
    expect(driftStep?.status).toBe('pass')
  })

  it('fails when source is metta/* branch with no archive', async () => {
    await execAsync('git checkout -b metta/foo', { cwd: tempDir })
    await execAsync('echo "x" > x.txt && git add . && git commit -m "x"', { cwd: tempDir })
    await execAsync('git checkout main || git checkout master', { cwd: tempDir })

    const mainBranch = (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()
    const targetHeadBefore = (await execAsync(`git rev-parse ${mainBranch}`, { cwd: tempDir })).stdout.trim()

    const pipeline = new MergeSafetyPipeline(tempDir)
    const result = await pipeline.run('metta/foo', mainBranch)

    expect(result.status).toBe('failure')
    const finalizeStep = result.steps.find(s => s.step === 'finalize-check')
    expect(finalizeStep?.status).toBe('fail')
    expect(finalizeStep?.detail).toContain('metta finalize --change foo')

    const targetHeadAfter = (await execAsync(`git rev-parse ${mainBranch}`, { cwd: tempDir })).stdout.trim()
    expect(targetHeadAfter).toBe(targetHeadBefore)
  })

  it('passes finalize-check when archive directory exists', async () => {
    await execAsync('git checkout -b metta/bar', { cwd: tempDir })
    await execAsync('echo "y" > y.txt && git add . && git commit -m "y"', { cwd: tempDir })
    await execAsync('git checkout main || git checkout master', { cwd: tempDir })

    await mkdir(join(tempDir, 'spec', 'archive', '2026-04-15-bar'), { recursive: true })

    const mainBranch = (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()

    const pipeline = new MergeSafetyPipeline(tempDir)
    const result = await pipeline.run('metta/bar', mainBranch)

    const finalizeStep = result.steps.find(s => s.step === 'finalize-check')
    expect(finalizeStep?.status).toBe('pass')
    expect(finalizeStep?.detail).toBe('2026-04-15-bar')
  })

  it('skips finalize-check on non-metta branches', async () => {
    await execAsync('git checkout -b plain-feature', { cwd: tempDir })
    await execAsync('echo "z" > z.txt && git add . && git commit -m "z"', { cwd: tempDir })
    await execAsync('git checkout main || git checkout master', { cwd: tempDir })

    const mainBranch = (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()

    const pipeline = new MergeSafetyPipeline(tempDir)
    const result = await pipeline.run('plain-feature', mainBranch)

    const finalizeStep = result.steps.find(s => s.step === 'finalize-check')
    expect(finalizeStep?.status).toBe('skip')
    expect(result.status).toBe('success')
  })

  it('post-merge gates pass when all gates report pass', async () => {
    await execAsync('git checkout -b gate-pass-feature', { cwd: tempDir })
    await execAsync('echo "gp" > gp.txt && git add . && git commit -m "gp"', { cwd: tempDir })
    await execAsync('git checkout main || git checkout master', { cwd: tempDir })

    const mainBranch = (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()

    const mockRegistry = {
      list: () => [{ name: 'tests' }],
      runAll: async (names: string[]) => names.map(name => ({ gate: name, status: 'pass' as const, duration_ms: 1 })),
    } as unknown as GateRegistry

    const pipeline = new MergeSafetyPipeline(tempDir, mockRegistry)
    const result = await pipeline.run('gate-pass-feature', mainBranch)

    expect(result.status).toBe('success')
    const postStep = result.steps.find(s => s.step === 'post-merge-gates')
    expect(postStep?.status).toBe('pass')
    expect(postStep?.detail).toBe('1 gates passed')
    expect(result.mergeCommit).toBeDefined()
    const headAfter = (await execAsync('git rev-parse HEAD', { cwd: tempDir })).stdout.trim()
    expect(headAfter).toBe(result.mergeCommit)
  })

  it('rolls back to snapshot when a gate fails', async () => {
    await execAsync('git checkout -b gate-fail-feature', { cwd: tempDir })
    await execAsync('echo "gf" > gf.txt && git add . && git commit -m "gf"', { cwd: tempDir })
    await execAsync('git checkout main || git checkout master', { cwd: tempDir })

    const mainBranch = (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()
    const snapshotSha = (await execAsync(`git rev-parse ${mainBranch}`, { cwd: tempDir })).stdout.trim()

    const mockRegistry = {
      list: () => [{ name: 'tests' }],
      runAll: async (names: string[]) => names.map(name => ({ gate: name, status: 'fail' as const, duration_ms: 1 })),
    } as unknown as GateRegistry

    const pipeline = new MergeSafetyPipeline(tempDir, mockRegistry)
    const result = await pipeline.run('gate-fail-feature', mainBranch)

    expect(result.status).toBe('failure')
    const postStep = result.steps.find(s => s.step === 'post-merge-gates')
    expect(postStep?.status).toBe('fail')
    expect(postStep?.detail).toContain('tests failed')
    const rollbackStep = result.steps.find(s => s.step === 'rollback')
    expect(rollbackStep?.status).toBe('pass')
    expect(result.snapshotTag).toBeDefined()

    const headAfter = (await execAsync('git rev-parse HEAD', { cwd: tempDir })).stdout.trim()
    expect(headAfter).toBe(snapshotSha)

    const tagSha = (await execAsync(`git rev-parse ${result.snapshotTag}`, { cwd: tempDir })).stdout.trim()
    expect(tagSha).toBe(snapshotSha)
  })

  it('passes with no-gates-configured detail when registry has no gates', async () => {
    await execAsync('git checkout -b no-gates-feature', { cwd: tempDir })
    await execAsync('echo "ng" > ng.txt && git add . && git commit -m "ng"', { cwd: tempDir })
    await execAsync('git checkout main || git checkout master', { cwd: tempDir })

    const mainBranch = (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()

    const mockRegistry = {
      list: () => [],
      runAll: async () => [],
    } as unknown as GateRegistry

    const pipeline = new MergeSafetyPipeline(tempDir, mockRegistry)
    const result = await pipeline.run('no-gates-feature', mainBranch)

    expect(result.status).toBe('success')
    const postStep = result.steps.find(s => s.step === 'post-merge-gates')
    expect(postStep?.status).toBe('pass')
    expect(postStep?.detail).toBe('no gates configured')
  })

  it('detects merge conflicts', async () => {
    // Create conflicting changes
    await execAsync('git checkout -b conflict-feature', { cwd: tempDir })
    await execAsync('echo "feature version" > file.txt && git add . && git commit -m "feature change"', { cwd: tempDir })

    await execAsync('git checkout main || git checkout master', { cwd: tempDir })
    await execAsync('echo "main version" > file.txt && git add . && git commit -m "main change"', { cwd: tempDir })

    const mainBranch = (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()

    const pipeline = new MergeSafetyPipeline(tempDir)
    const result = await pipeline.run('conflict-feature', mainBranch)

    expect(result.status).toBe('conflict')
    const mergeStep = result.steps.find(s => s.step === 'dry-run-merge')
    expect(mergeStep?.status).toBe('fail')
  })

  describe('rebuild-dist', () => {
    async function setupFeatureBranch(name: string): Promise<string> {
      await execAsync(`git checkout -b ${name}`, { cwd: tempDir })
      await execAsync(`echo "${name}" > ${name}.txt && git add . && git commit -m "${name}"`, { cwd: tempDir })
      await execAsync('git checkout main || git checkout master', { cwd: tempDir })
      return (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()
    }

    it('runs npm run build in the target checkout after a successful merge', async () => {
      const mainBranch = await setupFeatureBranch('rebuild-ok')
      // Build script drops a marker file so we can prove it actually ran
      await writePackageJson(tempDir, 'node -e "require(\'fs\').writeFileSync(\'build-marker.txt\', \'built\')"')

      const pipeline = new MergeSafetyPipeline(tempDir)
      const result = await pipeline.run('rebuild-ok', mainBranch)

      expect(result.status).toBe('success')
      const rebuildStep = result.steps.find(s => s.step === 'rebuild-dist')
      expect(rebuildStep?.status).toBe('pass')
      expect(rebuildStep?.detail).toBe('npm run build')
      await expect(access(join(tempDir, 'build-marker.txt'))).resolves.toBeUndefined()
    })

    it('surfaces a loud failure without failing the merge when the build fails', async () => {
      const mainBranch = await setupFeatureBranch('rebuild-broken')
      await writePackageJson(tempDir, 'node -e "process.exit(1)"')
      const headBefore = (await execAsync(`git rev-parse ${mainBranch}`, { cwd: tempDir })).stdout.trim()

      const pipeline = new MergeSafetyPipeline(tempDir)
      const result = await pipeline.run('rebuild-broken', mainBranch)

      // Merge still completes and is NOT rolled back
      expect(result.status).toBe('success')
      expect(result.mergeCommit).toBeDefined()
      const headAfter = (await execAsync(`git rev-parse ${mainBranch}`, { cwd: tempDir })).stdout.trim()
      expect(headAfter).not.toBe(headBefore)
      expect(headAfter).toBe(result.mergeCommit)

      const rebuildStep = result.steps.find(s => s.step === 'rebuild-dist')
      expect(rebuildStep?.status).toBe('fail')
      expect(rebuildStep?.detail).toContain('npm run build failed')
      expect(rebuildStep?.detail).toContain('stale')
    })

    it('skips the rebuild with an explanation when the target checkout has no package.json', async () => {
      const mainBranch = await setupFeatureBranch('rebuild-missing')

      const pipeline = new MergeSafetyPipeline(tempDir)
      const result = await pipeline.run('rebuild-missing', mainBranch)

      expect(result.status).toBe('success')
      const rebuildStep = result.steps.find(s => s.step === 'rebuild-dist')
      expect(rebuildStep?.status).toBe('skip')
      expect(rebuildStep?.detail).toContain('no package.json')
      expect(rebuildStep?.detail).toContain('not an npm project')
    })

    it('fails loudly when package.json is not valid JSON', async () => {
      const mainBranch = await setupFeatureBranch('rebuild-corrupt')
      await writeFile(join(tempDir, 'package.json'), '{ not valid json')

      const pipeline = new MergeSafetyPipeline(tempDir)
      const result = await pipeline.run('rebuild-corrupt', mainBranch)

      expect(result.status).toBe('success')
      const rebuildStep = result.steps.find(s => s.step === 'rebuild-dist')
      expect(rebuildStep?.status).toBe('fail')
      expect(rebuildStep?.detail).toContain('not valid JSON')
      expect(rebuildStep?.detail).toContain('stale')
    })

    it('skips the rebuild when package.json declares no build script', async () => {
      const mainBranch = await setupFeatureBranch('rebuild-noscript')
      await writePackageJson(tempDir)

      const pipeline = new MergeSafetyPipeline(tempDir)
      const result = await pipeline.run('rebuild-noscript', mainBranch)

      expect(result.status).toBe('success')
      const rebuildStep = result.steps.find(s => s.step === 'rebuild-dist')
      expect(rebuildStep?.status).toBe('skip')
      expect(rebuildStep?.detail).toBe('no build script in package.json')
    })

    it('does not run the rebuild when post-merge gates fail and roll back', async () => {
      const mainBranch = await setupFeatureBranch('rebuild-gatefail')
      await writePackageJson(tempDir, 'node -e "process.exit(0)"')

      const mockRegistry = {
        list: () => [{ name: 'tests' }],
        runAll: async (names: string[]) => names.map(name => ({ gate: name, status: 'fail' as const, duration_ms: 1 })),
      } as unknown as GateRegistry

      const pipeline = new MergeSafetyPipeline(tempDir, mockRegistry)
      const result = await pipeline.run('rebuild-gatefail', mainBranch)

      expect(result.status).toBe('failure')
      expect(result.steps.find(s => s.step === 'rebuild-dist')).toBeUndefined()
    })
  })

  describe('main-checkout-clean', () => {
    /**
     * Worktree-hosted change fixture: a linked worktree at the metta layout
     * path (`<main>/.metta/worktrees/<name>`) on a `metta/<name>` branch with
     * one committed change, mirroring how ship encounters worktree changes.
     */
    async function setupWorktreeChange(name: string): Promise<{ worktreeDir: string; mainBranch: string }> {
      const mainBranch = (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()
      const worktreeDir = join(tempDir, '.metta', 'worktrees', name)
      await mkdir(join(tempDir, '.metta', 'worktrees'), { recursive: true })
      await execAsync(`git worktree add "${worktreeDir}" -b "metta/${name}"`, { cwd: tempDir })
      await execAsync(`echo "${name}" > wt-${name}.txt && git add . && git commit -m "wt ${name}"`, { cwd: worktreeDir })
      return { worktreeDir, mainBranch }
    }

    it('fails the ship when the main checkout accumulated new dirt since the baseline', async () => {
      const { mainBranch } = await setupWorktreeChange('dirt')
      await mkdir(join(tempDir, 'spec', 'archive', '2026-08-18-dirt'), { recursive: true })
      // New dirt: a tracked file modified after the (empty) baseline snapshot.
      await writeFile(join(tempDir, 'file.txt'), 'contaminated\n')
      const targetHeadBefore = (await execAsync(`git rev-parse ${mainBranch}`, { cwd: tempDir })).stdout.trim()

      const pipeline = new MergeSafetyPipeline(tempDir, undefined, {
        mainCheckout: { root: tempDir, baselineEntries: [] },
      })
      const result = await pipeline.run('metta/dirt', mainBranch)

      expect(result.status).toBe('failure')
      const step = result.steps.find(s => s.step === 'main-checkout-clean')
      expect(step?.status).toBe('fail')
      expect(step?.detail).toContain('file.txt')
      // Placed after finalize-check and before preflight; the fail short-circuits.
      expect(result.steps.map(s => s.step)).toEqual(['finalize-check', 'main-checkout-clean'])
      // Detection only — the target branch never moved.
      const targetHeadAfter = (await execAsync(`git rev-parse ${mainBranch}`, { cwd: tempDir })).stdout.trim()
      expect(targetHeadAfter).toBe(targetHeadBefore)
    })

    it('flags a status transition on a pre-existing path as new dirt', async () => {
      const { mainBranch } = await setupWorktreeChange('transition')
      await mkdir(join(tempDir, 'spec', 'archive', '2026-08-18-transition'), { recursive: true })
      // Baseline saw ` M file.txt`; staging it since flips the status to `M ` — new dirt.
      await writeFile(join(tempDir, 'file.txt'), 'staged since baseline\n')
      await execAsync('git add file.txt', { cwd: tempDir })

      const pipeline = new MergeSafetyPipeline(tempDir, undefined, {
        mainCheckout: { root: tempDir, baselineEntries: [{ path: 'file.txt', status: ' M' }] },
      })
      const result = await pipeline.run('metta/transition', mainBranch)

      expect(result.status).toBe('failure')
      const step = result.steps.find(s => s.step === 'main-checkout-clean')
      expect(step?.status).toBe('fail')
      expect(step?.detail).toContain('file.txt')
    })

    it('passes with a warning on pre-existing dirt only and the pipeline continues', async () => {
      const { worktreeDir, mainBranch } = await setupWorktreeChange('preexist')
      // finalize-check reads spec/archive relative to the pipeline cwd (the worktree here).
      await mkdir(join(worktreeDir, 'spec', 'archive', '2026-08-18-preexist'), { recursive: true })
      // Dirt already present at baseline capture time, unchanged since.
      await writeFile(join(tempDir, 'file.txt'), 'operator edit\n')

      const pipeline = new MergeSafetyPipeline(worktreeDir, undefined, {
        mainCheckout: { root: tempDir, baselineEntries: [{ path: 'file.txt', status: ' M' }] },
      })
      const result = await pipeline.run('metta/preexist', mainBranch, true)

      const step = result.steps.find(s => s.step === 'main-checkout-clean')
      expect(step?.status).toBe('pass')
      expect(step?.detail).toContain('pre-existing')
      expect(step?.detail).toContain('file.txt')
      // Warn-never-block: the pipeline proceeded past the step into preflight.
      const names = result.steps.map(s => s.step)
      expect(names.indexOf('main-checkout-clean')).toBe(names.indexOf('finalize-check') + 1)
      expect(names).toContain('preflight')
    })

    it('skips when no baseline was recorded and the ship proceeds to success', async () => {
      const { mainBranch } = await setupWorktreeChange('nobase')
      await mkdir(join(tempDir, 'spec', 'archive', '2026-08-18-nobase'), { recursive: true })

      const pipeline = new MergeSafetyPipeline(tempDir, undefined, {
        mainCheckout: { root: tempDir, baselineEntries: null },
      })
      const result = await pipeline.run('metta/nobase', mainBranch)

      const step = result.steps.find(s => s.step === 'main-checkout-clean')
      expect(step?.status).toBe('skip')
      expect(step?.detail).toContain('no baseline')
      expect(result.status).toBe('success')
      // Placement pin: after finalize-check, before preflight.
      expect(result.steps.slice(0, 3).map(s => s.step)).toEqual([
        'finalize-check',
        'main-checkout-clean',
        'preflight',
      ])
    })

    it('skips (fail-open) when the main checkout status cannot be read', async () => {
      const { mainBranch } = await setupWorktreeChange('gitfail')
      await mkdir(join(tempDir, 'spec', 'archive', '2026-08-18-gitfail'), { recursive: true })

      const pipeline = new MergeSafetyPipeline(tempDir, undefined, {
        mainCheckout: { root: join(tempDir, 'does-not-exist'), baselineEntries: [] },
      })
      const result = await pipeline.run('metta/gitfail', mainBranch)

      const step = result.steps.find(s => s.step === 'main-checkout-clean')
      expect(step?.status).toBe('skip')
      expect(step?.detail).toContain('could not read git status')
      expect(result.status).toBe('success')
    })

    it('non-worktree ships produce a byte-identical step list with no main-checkout-clean step', async () => {
      await execAsync('git checkout -b plain-ship', { cwd: tempDir })
      await execAsync('echo "p" > p.txt && git add . && git commit -m "p"', { cwd: tempDir })
      await execAsync('git checkout main || git checkout master', { cwd: tempDir })
      const mainBranch = (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()

      const pipeline = new MergeSafetyPipeline(tempDir)
      const result = await pipeline.run('plain-ship', mainBranch)

      expect(result.status).toBe('success')
      // Exact pre-change step sequence — pinned so the new step can never leak
      // into non-worktree ships.
      expect(result.steps.map(s => s.step)).toEqual([
        'finalize-check',
        'preflight',
        'base-drift-check',
        'checkout-target',
        'dry-run-merge',
        'scope-check',
        'gate-verification',
        'snapshot',
        'merge',
        'post-merge-gates',
        'rebuild-dist',
      ])
    })
  })
})
