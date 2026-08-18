import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile, appendFile, realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ArtifactStore } from '../src/artifacts/artifact-store.js'
import { installFixture } from './helpers/cli.js'

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

describe('metta instructions stamps timings + tokens', { timeout: 30000 }, () => {
  let tempDir: string
  let specDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-instr-stamp-'))
    specDir = join(tempDir, 'spec')
    await mkdir(specDir, { recursive: true })
    await mkdir(join(tempDir, '.metta'), { recursive: true })
    await writeFile(
      join(tempDir, '.metta', 'config.yaml'),
      'project:\n  name: instr-test\n',
    )
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('stamps artifact_timings[intent].started and artifact_tokens[intent] on first call', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('instr demo', 'quick', ['intent'])

    const before = Date.now()
    const result = await runCli(
      ['--json', 'instructions', 'intent', '--change', 'instr-demo'],
      tempDir,
    )
    const after = Date.now()
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.budget?.context_tokens).toBeGreaterThanOrEqual(0)
    expect(payload.budget?.budget_tokens).toBeGreaterThan(0)

    const meta = await store.getChange('instr-demo')
    const started = meta.artifact_timings?.intent?.started
    expect(typeof started).toBe('string')
    const t = Date.parse(started ?? '')
    expect(t).toBeGreaterThanOrEqual(before - 1000)
    expect(t).toBeLessThanOrEqual(after + 1000)

    expect(meta.artifact_tokens?.intent?.context).toBe(payload.budget.context_tokens)
    expect(meta.artifact_tokens?.intent?.budget).toBe(payload.budget.budget_tokens)

    // No models config and a non-executor artifact: the stamp block must not
    // write a model_runs record.
    expect(meta.model_runs).toBeUndefined()
  })

  it('does not overwrite artifact_timings[intent].started on re-invocation', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('instr demo', 'quick', ['intent'])
    await store.updateChange('instr-demo', {
      artifact_timings: { intent: { started: '2026-04-21T08:00:00.000Z' } },
    })

    const result = await runCli(
      ['--json', 'instructions', 'intent', '--change', 'instr-demo'],
      tempDir,
    )
    expect(result.code).toBe(0)

    const meta = await store.getChange('instr-demo')
    expect(meta.artifact_timings?.intent?.started).toBe(
      '2026-04-21T08:00:00.000Z',
    )
  })

  it('overwrites artifact_tokens[intent] on re-invocation', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('instr demo', 'quick', ['intent'])
    await store.updateChange('instr-demo', {
      artifact_tokens: { intent: { context: 999, budget: 111 } },
    })

    const result = await runCli(
      ['--json', 'instructions', 'intent', '--change', 'instr-demo'],
      tempDir,
    )
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)

    const meta = await store.getChange('instr-demo')
    // Overwritten with the freshly-computed budget numbers (not 999/111).
    expect(meta.artifact_tokens?.intent?.context).toBe(payload.budget.context_tokens)
    expect(meta.artifact_tokens?.intent?.budget).toBe(payload.budget.budget_tokens)
  })
})

// ---------------------------------------------------------------------------
// Layer-3 main-tree baseline capture at implementation-instruction emission.
// ---------------------------------------------------------------------------

const INTENT_BODY = [
  '# baseline demo',
  '',
  '## Problem',
  '',
  'A worktree-hosted change whose implementation instructions must trigger a',
  'write-once snapshot of the MAIN checkout tracked-file status.',
  '',
  '## Proposal',
  '',
  'Emit implementation instructions and verify the baseline side effects.',
  '',
].join('\n')

describe('metta instructions captures main-tree baseline (worktree-hosted)', { timeout: 60000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await realpath(await mkdtemp(join(tmpdir(), 'metta-instr-baseline-')))
    await installFixture(tempDir)
    await execAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: tempDir })
    await execAsync('git', ['config', 'user.name', 'Test'], { cwd: tempDir })
    // A committed tracked file we can dirty to simulate main-checkout state.
    await writeFile(join(tempDir, 'tracked.txt'), 'clean\n')
    await execAsync('git', ['add', 'tracked.txt'], { cwd: tempDir })
    await execAsync('git', ['commit', '-m', 'add tracked file'], { cwd: tempDir })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  /** Create a worktree-hosted quick change with implementation ready. */
  async function setupWorktreeChange(): Promise<string> {
    const quick = await runCli(['--json', 'quick', 'baseline demo'], tempDir)
    expect(quick.code).toBe(0)
    const worktreePath = JSON.parse(quick.stdout).worktree as string
    await writeFile(
      join(worktreePath, 'spec', 'changes', 'baseline-demo', 'intent.md'),
      INTENT_BODY,
    )
    const wtStore = new ArtifactStore(join(worktreePath, 'spec'))
    await wtStore.markArtifact('baseline-demo', 'implementation', 'ready')
    return worktreePath
  }

  const baselinePath = () =>
    join(tempDir, '.metta', 'scratch', 'tree-baselines', 'baseline-demo.yaml')

  it('records the baseline write-once for a worktree-hosted implementation instruction', async () => {
    await setupWorktreeChange()

    const first = await runCli(
      ['--json', 'instructions', 'implementation', '--change', 'baseline-demo'],
      tempDir,
    )
    expect(first.code).toBe(0)
    expect(existsSync(baselinePath())).toBe(true)
    const firstContent = await readFile(baselinePath(), 'utf8')
    expect(firstContent).toContain('change: baseline-demo')
    expect(firstContent).toContain(tempDir)

    // Dirty main AFTER capture, then re-emit (verify-fail → re-execute
    // retry shape): the original snapshot must survive byte for byte, so
    // the later comparison attributes this dirt as NEW.
    await appendFile(join(tempDir, 'tracked.txt'), 'contaminated\n')
    const second = await runCli(
      ['--json', 'instructions', 'implementation', '--change', 'baseline-demo'],
      tempDir,
    )
    expect(second.code).toBe(0)
    expect(await readFile(baselinePath(), 'utf8')).toBe(firstContent)
    expect(await readFile(baselinePath(), 'utf8')).not.toContain('tracked.txt')
  })

  it('surfaces pre-existing main-checkout dirt as a stderr warning at capture time', async () => {
    await setupWorktreeChange()
    // Dirty main BEFORE the first implementation instruction: recorded in
    // the baseline (never fails completion later) and warned about now.
    await appendFile(join(tempDir, 'tracked.txt'), 'operator edit\n')

    const result = await runCli(
      ['--json', 'instructions', 'implementation', '--change', 'baseline-demo'],
      tempDir,
    )
    expect(result.code).toBe(0)
    expect(result.stderr).toContain('pre-existing dirty paths')
    expect(result.stderr).toContain('tracked.txt')
    expect(await readFile(baselinePath(), 'utf8')).toContain('tracked.txt')
  })

  it('does not capture a baseline for non-implementation artifacts', async () => {
    await setupWorktreeChange()
    const result = await runCli(
      ['--json', 'instructions', 'intent', '--change', 'baseline-demo'],
      tempDir,
    )
    expect(result.code).toBe(0)
    expect(existsSync(join(tempDir, '.metta', 'scratch', 'tree-baselines'))).toBe(false)
  })
})

describe('metta instructions baseline capture disengages / fails open (no git)', { timeout: 60000 }, () => {
  let tempDir: string
  let specDir: string

  beforeEach(async () => {
    tempDir = await realpath(await mkdtemp(join(tmpdir(), 'metta-instr-baseline-ng-')))
    specDir = join(tempDir, 'spec')
    await mkdir(specDir, { recursive: true })
    await mkdir(join(tempDir, '.metta'), { recursive: true })
    await writeFile(
      join(tempDir, '.metta', 'config.yaml'),
      'project:\n  name: instr-baseline-test\n',
    )
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('does not capture a baseline for a non-worktree change', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('local demo', 'quick', ['intent', 'implementation', 'verification'])
    await writeFile(join(specDir, 'changes', 'local-demo', 'intent.md'), INTENT_BODY)
    await store.markArtifact('local-demo', 'implementation', 'ready')

    const result = await runCli(
      ['--json', 'instructions', 'implementation', '--change', 'local-demo'],
      tempDir,
    )
    expect(result.code).toBe(0)
    // Layer 3 disengaged: no baseline dir, no baseline-related stderr.
    expect(existsSync(join(tempDir, '.metta', 'scratch', 'tree-baselines'))).toBe(false)
    expect(result.stderr).not.toContain('tree baseline')
  })

  it('git failure at capture warns and never blocks instruction emission', async () => {
    // Worktree-hosted change layout with NO git repo anywhere: root
    // resolution succeeds (path math), then `git status` at the main root
    // fails — the capture must warn and the command must still succeed.
    const wtDir = join(tempDir, '.metta', 'worktrees', 'gitless-wt')
    await mkdir(join(wtDir, 'spec', 'changes'), { recursive: true })
    const wtStore = new ArtifactStore(join(wtDir, 'spec'))
    await wtStore.createChange('gitless wt', 'quick', ['intent', 'implementation', 'verification'])
    await writeFile(join(wtDir, 'spec', 'changes', 'gitless-wt', 'intent.md'), INTENT_BODY)
    await wtStore.markArtifact('gitless-wt', 'implementation', 'ready')

    const result = await runCli(
      ['--json', 'instructions', 'implementation', '--change', 'gitless-wt'],
      tempDir,
    )
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.metta_agent).toBeTruthy()
    expect(result.stderr).toContain('failed to capture main-checkout tree baseline for gitless-wt')
    expect(
      existsSync(join(tempDir, '.metta', 'scratch', 'tree-baselines', 'gitless-wt.yaml')),
    ).toBe(false)
  })
})
