import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { runCli } from './helpers/cli.js'
import { baselineRelPath, captureMainTreeBaseline } from '../src/util/git-tree-baseline.js'
import type { MergeSafetyResult } from '../src/ship/merge-safety.js'

const execAsync = promisify(exec)

// Builtin gate names shipped in src/templates/gates/ — each is overridden
// with a trivial pass in the fixture so the REAL post-merge gate run stays
// hermetic and fast (no npm test/build inside the temp repo).
const BUILTIN_GATE_NAMES = ['build', 'lint', 'stories-valid', 'tests', 'typecheck']

/**
 * CLI-level ship tests for the worktree-hosted POST-FINALIZE topology: by the
 * time `metta ship` runs, `metta finalize` has already archived the change
 * (spec/changes/<name> is gone, only spec/archive/<date>-<name> remains), so
 * the ship command cannot learn the topology from ArtifactStore.getChange —
 * it must fall back to durable evidence (the worktree dir on disk and/or the
 * recorded baseline file).
 */
describe('metta ship — worktree-hosted change after finalize archived it', { timeout: 60_000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    // realpathSync so the baseline's recorded main_root matches the
    // projectRoot the CLI subprocess resolves (tmpdir may be symlinked).
    tempDir = realpathSync(await mkdtemp(join(tmpdir(), 'metta-ship-cli-')))
    await execAsync('git init -b main || (git init && git symbolic-ref HEAD refs/heads/main)', {
      cwd: tempDir,
    })
    await execAsync('git config user.email "test@test.com"', { cwd: tempDir })
    await execAsync('git config user.name "Test"', { cwd: tempDir })
    await writeFile(join(tempDir, 'file.txt'), 'init\n')
    await execAsync('git add . && git commit -m "init"', { cwd: tempDir })
    // Pin the merge target at the project layer so a developer's global
    // ~/.metta/config.yaml cannot skew the fixture.
    await mkdir(join(tempDir, '.metta'), { recursive: true })
    await writeFile(join(tempDir, '.metta', 'config.yaml'), 'git:\n  pr_base: main\n')
    await mkdir(join(tempDir, '.metta', 'gates'), { recursive: true })
    for (const name of BUILTIN_GATE_NAMES) {
      await writeFile(
        join(tempDir, '.metta', 'gates', `${name}.yaml`),
        `name: ${name}\ndescription: hermetic test override\ncommand: "true"\non_failure: stop\n`,
      )
    }
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  /**
   * Simulate the archived post-finalize state for a worktree-hosted change:
   * a linked worktree on `metta/<name>` with one commit, an archive dir (the
   * only remaining trace of the change — no spec/changes/<name> anywhere),
   * and the implementation-time baseline recorded via the real capture path.
   */
  async function setupArchivedWorktreeChange(name: string): Promise<string> {
    const worktreeDir = join(tempDir, '.metta', 'worktrees', name)
    await mkdir(join(tempDir, '.metta', 'worktrees'), { recursive: true })
    await execAsync(`git worktree add "${worktreeDir}" -b "metta/${name}"`, { cwd: tempDir })
    await writeFile(join(worktreeDir, `wt-${name}.txt`), `${name}\n`)
    await execAsync(`git add . && git commit -m "wt ${name}"`, { cwd: worktreeDir })
    await mkdir(join(tempDir, 'spec', 'archive', `2026-08-18-${name}`), { recursive: true })
    await captureMainTreeBaseline(tempDir, name)
    return worktreeDir
  }

  it('emits main-checkout-clean and deletes the baseline on a successful non-dry-run ship', async () => {
    await setupArchivedWorktreeChange('demo')
    const baselineFile = join(tempDir, '.metta', baselineRelPath('demo'))
    await expect(access(baselineFile)).resolves.toBeUndefined()

    const { stdout, stderr, code } = await runCli(
      ['--json', 'ship', '--branch', 'metta/demo'],
      tempDir,
      30000,
    )
    expect(code, `ship failed\nstderr: ${stderr}\nstdout: ${stdout}`).toBe(0)
    const result = JSON.parse(stdout) as MergeSafetyResult

    expect(result.status).toBe('success')
    const step = result.steps.find((s) => s.step === 'main-checkout-clean')
    expect(step?.status).toBe('pass')
    // Placement pin: emitted right after finalize-check, before preflight.
    const names = result.steps.map((s) => s.step)
    expect(names.indexOf('main-checkout-clean')).toBe(names.indexOf('finalize-check') + 1)
    // Baseline lifecycle: the shipped change's snapshot is cleaned up.
    await expect(access(baselineFile)).rejects.toThrow()
  })

  it('resolves topology from the baseline alone when the worktree dir is already gone; dry-run keeps the baseline', async () => {
    const worktreeDir = await setupArchivedWorktreeChange('gone')
    await execAsync(`git worktree remove --force "${worktreeDir}"`, { cwd: tempDir })

    const { stdout, stderr, code } = await runCli(
      ['--json', 'ship', '--branch', 'metta/gone', '--dry-run'],
      tempDir,
      30000,
    )
    expect(code, `ship failed\nstderr: ${stderr}\nstdout: ${stdout}`).toBe(0)
    const result = JSON.parse(stdout) as MergeSafetyResult

    expect(result.status).toBe('success')
    const step = result.steps.find((s) => s.step === 'main-checkout-clean')
    expect(step?.status).toBe('pass')
    // Dry-run never consumes the baseline — the real ship still needs it.
    await expect(access(join(tempDir, '.metta', baselineRelPath('gone')))).resolves.toBeUndefined()
  })

  it('fails the ship when the main checkout accumulated new dirt since the baseline (archived topology)', async () => {
    await setupArchivedWorktreeChange('dirt')
    // Contaminate the main checkout AFTER the baseline snapshot.
    await writeFile(join(tempDir, 'file.txt'), 'contaminated\n')

    const { stdout, code } = await runCli(['--json', 'ship', '--branch', 'metta/dirt'], tempDir, 30000)
    expect(code).toBe(1)
    const result = JSON.parse(stdout) as MergeSafetyResult

    expect(result.status).toBe('failure')
    const step = result.steps.find((s) => s.step === 'main-checkout-clean')
    expect(step?.status).toBe('fail')
    expect(step?.detail).toContain('file.txt')
    // Failed ship: the baseline survives for the retry.
    await expect(access(join(tempDir, '.metta', baselineRelPath('dirt')))).resolves.toBeUndefined()
  })

  it('fail-open: an unsafe branch-derived change name disengages the main-checkout wiring', async () => {
    // Underscore + uppercase fails assertSafeSlug; evidence (worktree dir,
    // baseline, archive) all exists, but the unsafe name must skip the wiring
    // entirely — no filesystem paths are built from it.
    await setupArchivedWorktreeChange('Bad_Name')

    const { stdout, stderr, code } = await runCli(
      ['--json', 'ship', '--branch', 'metta/Bad_Name', '--dry-run'],
      tempDir,
      30000,
    )
    expect(code, `ship failed\nstderr: ${stderr}\nstdout: ${stdout}`).toBe(0)
    const result = JSON.parse(stdout) as MergeSafetyResult

    expect(result.status).toBe('success')
    expect(result.steps.find((s) => s.step === 'main-checkout-clean')).toBeUndefined()
  })
})
