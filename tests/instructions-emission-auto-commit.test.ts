import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ArtifactStore } from '../src/artifacts/artifact-store.js'

const execAsync = promisify(execFile)
const CLI_PATH = join(import.meta.dirname, '..', 'src', 'cli', 'index.ts')

async function runCli(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execAsync(
      'npx',
      ['tsx', CLI_PATH, ...args],
      { cwd, timeout: 20000 },
    )
    return { stdout, stderr, code: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execAsync('git', args, { cwd })
  return stdout
}

// Covers the RCA in spec/issues/a-metadata-write-path-drops-the-model-runs-array-between.md:
// the instruction-time metrics stamp must be committed at emission so it is
// immune to routine executor git hygiene (checkout/stash/restore) run before
// the implementation window's own atomic commit.
describe('metta instructions — durable auto-commit of the instruction-time metrics stamp', { timeout: 30000 }, () => {
  let tempDir: string
  let specDir: string
  let store: ArtifactStore

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-instr-commit-'))
    specDir = join(tempDir, 'spec')
    await mkdir(specDir, { recursive: true })
    await mkdir(join(tempDir, '.metta'), { recursive: true })
    store = new ArtifactStore(specDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  async function initGitFixture(configYaml: string): Promise<void> {
    await writeFile(join(tempDir, '.metta', 'config.yaml'), configYaml)
    await execAsync('git', ['init'], { cwd: tempDir })
    await execAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: tempDir })
    await execAsync('git', ['config', 'user.name', 'Test'], { cwd: tempDir })
  }

  async function commitAll(message: string): Promise<void> {
    await execAsync('git', ['add', '-A'], { cwd: tempDir })
    await execAsync('git', ['commit', '-m', message], { cwd: tempDir })
  }

  it('commits only the .metta.yaml stamp when git is enabled', async () => {
    await initGitFixture('project:\n  name: instr-commit-test\n')
    await store.createChange('emit commit', 'quick', ['implementation', 'verification'])
    await commitAll('init')

    const result = await runCli(
      ['--json', 'instructions', 'implementation', '--change', 'emit-commit'],
      tempDir,
    )
    expect(result.code).toBe(0)

    const log = await git(['log', '--oneline'], tempDir)
    expect(log).toContain('chore(emit-commit): record instruction emission')

    // The working tree must be clean for the stamped file — it was
    // committed, not left dangling.
    const status = await git(
      ['status', '--porcelain', '--', 'spec/changes/emit-commit/.metta.yaml'],
      tempDir,
    )
    expect(status.trim()).toBe('')

    // The commit itself only touches the stamped file.
    const changedFiles = (await git(['show', '--name-only', '--format=', 'HEAD'], tempDir)).trim()
    expect(changedFiles).toBe('spec/changes/emit-commit/.metta.yaml')
  })

  it('does not create an empty commit on a second emission within the sliding window', async () => {
    await initGitFixture('project:\n  name: instr-commit-test\n')
    await store.createChange('emit twice', 'quick', ['implementation', 'verification'])
    await commitAll('init')

    const first = await runCli(
      ['--json', 'instructions', 'implementation', '--change', 'emit-twice'],
      tempDir,
    )
    expect(first.code).toBe(0)
    const countAfterFirst = (await git(['rev-list', '--count', 'HEAD'], tempDir)).trim()

    const second = await runCli(
      ['--json', 'instructions', 'implementation', '--change', 'emit-twice'],
      tempDir,
    )
    expect(second.code).toBe(0)
    const countAfterSecond = (await git(['rev-list', '--count', 'HEAD'], tempDir)).trim()

    expect(countAfterSecond).toBe(countAfterFirst)

    const log = await git(['log', '--oneline'], tempDir)
    expect(log.match(/record instruction emission/g)?.length ?? 0).toBe(1)
  })

  it('does not attempt a commit when git.enabled is false, but still writes the stamp to disk', async () => {
    await initGitFixture('project:\n  name: instr-commit-test\ngit:\n  enabled: false\n')
    await store.createChange('emit disabled', 'quick', ['implementation', 'verification'])
    await commitAll('init')

    const result = await runCli(
      ['--json', 'instructions', 'implementation', '--change', 'emit-disabled'],
      tempDir,
    )
    expect(result.code).toBe(0)

    const log = await git(['log', '--oneline'], tempDir)
    expect(log).not.toContain('record instruction emission')

    // The stamp is still on disk, just uncommitted.
    const meta = await store.getChange('emit-disabled')
    expect(meta.artifact_timings?.implementation?.started).toBeDefined()

    const status = await git(['status', '--porcelain'], tempDir)
    expect(status).toContain('.metta.yaml')
  })

  it('the stamp survives `git checkout -- .` after emission — the exact erasure vector from the incident', async () => {
    await initGitFixture('project:\n  name: instr-commit-test\n')
    await store.createChange('emit survive', 'quick', ['implementation', 'verification'])
    await commitAll('init')

    const result = await runCli(
      ['--json', 'instructions', 'implementation', '--change', 'emit-survive'],
      tempDir,
    )
    expect(result.code).toBe(0)

    // Simulate the routine executor git hygiene that erased the stamp in
    // the incident: cleaning the working tree before an atomic commit.
    await execAsync('git', ['checkout', '--', '.'], { cwd: tempDir })

    const meta = await store.getChange('emit-survive')
    expect(meta.artifact_timings?.implementation?.started).toBeDefined()
  })
})
