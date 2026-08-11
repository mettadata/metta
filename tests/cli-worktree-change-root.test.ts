import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, execAsync, installFixture } from './helpers/cli.js'
import { ArtifactStore } from '../src/artifacts/artifact-store.js'

// Worktree-aware change-scoped paths: `metta instructions`, `metta context
// stats`, and `metta complete` invoked from the MAIN checkout root for a
// change hosted in `.metta/worktrees/<name>/` must emit paths and target git
// side effects in the hosting worktree — identical to an in-worktree
// invocation. Non-worktree changes stay exactly projectRoot-rooted.

const WT_CHANGE = 'wt-change'

describe('CLI: worktree-hosted change-root resolution (no git)', { timeout: 60000 }, () => {
  let tempDir: string
  let wtDir: string
  let wtChangeDir: string

  beforeEach(async () => {
    tempDir = await realpath(await mkdtemp(join(tmpdir(), 'metta-chroot-')))

    // Main checkout: empty spec/changes, its own project.md and capability.
    await mkdir(join(tempDir, 'spec', 'changes'), { recursive: true })
    await mkdir(join(tempDir, 'spec', 'specs', 'main-only-cap'), { recursive: true })
    await writeFile(
      join(tempDir, 'spec', 'specs', 'main-only-cap', 'spec.md'),
      '# main-only-cap\n\n## Requirement: Main Thing\n\nThe system MUST do the main thing.\n',
    )
    await writeFile(join(tempDir, 'spec', 'project.md'), '# Project\n\nMAIN-CHECKOUT-PROJECT-MARKER\n')

    // Worktree checkout hosting the change, with its own full spec/ tree.
    wtDir = join(tempDir, '.metta', 'worktrees', WT_CHANGE)
    await mkdir(join(wtDir, 'spec', 'specs', 'wt-only-cap'), { recursive: true })
    await writeFile(
      join(wtDir, 'spec', 'specs', 'wt-only-cap', 'spec.md'),
      '# wt-only-cap\n\n## Requirement: Session Management\n\nThe system MUST manage sessions.\n',
    )
    await writeFile(join(wtDir, 'spec', 'project.md'), '# Project\n\nWORKTREE-PROJECT-MARKER\n')

    const wtStore = new ArtifactStore(join(wtDir, 'spec'))
    await wtStore.createChange('wt change', 'standard', [
      'intent', 'stories', 'spec', 'research', 'design', 'tasks', 'implementation', 'verification',
    ])
    wtChangeDir = join(wtDir, 'spec', 'changes', WT_CHANGE)
    await writeFile(
      join(wtChangeDir, 'intent.md'),
      `# ${WT_CHANGE}\n\n## Problem\n\nWorktree-hosted intent body used for context resolution.\n`,
    )
    // A fully valid stories document (parseable by the stories-valid gate)
    // that exists ONLY in the worktree change dir.
    await writeFile(
      join(wtChangeDir, 'stories.md'),
      [
        `# ${WT_CHANGE} stories`,
        '',
        '## US-1: Root invocation works',
        '',
        '**As a** developer',
        '',
        '**I want to** run change-scoped commands from the main checkout root',
        '',
        '**So that** worktree-hosted changes behave identically from either root',
        '',
        '**Priority:** P1',
        '',
        '**Independent Test Criteria:** Invoke the command from the main root and observe worktree-rooted paths.',
        '',
        '### Acceptance Criteria',
        '',
        '- **Given** a worktree-hosted change **When** the command runs from the main root **Then** the gate reads the worktree copy of stories.md',
        '',
      ].join('\n'),
    )
    // A MODIFIED delta targeting a capability that exists ONLY in the
    // worktree's spec/specs tree — the capability-existence gate must
    // resolve against the change root, not the main checkout.
    await writeFile(
      join(wtChangeDir, 'spec.md'),
      [
        '# wt-only-cap (Delta)',
        '',
        '## MODIFIED: Requirement: Session Management',
        '',
        'The system MUST manage user sessions with secure token rotation and',
        'expiry so that stale credentials can never be replayed by an attacker',
        'after they have been superseded by a fresh token issuance.',
        '',
        '### Scenario: Token rotation',
        '- GIVEN an authenticated session',
        '- WHEN the token approaches expiry',
        '- THEN a fresh token is issued and the old one is revoked',
        '',
      ].join('\n'),
    )
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  describe('metta context stats', () => {
    it('main-root invocation reads the worktree artifacts instead of erroring', async () => {
      const { stdout, code } = await runCli(
        ['--json', 'context', 'stats', '--change', WT_CHANGE, '--artifact', 'stories'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.change).toBe(WT_CHANGE)
      // stories context requires intent.md — only present in the worktree.
      expect(data.artifacts[0].tokens).toBeGreaterThan(0)
    })

    it('main-root and in-worktree invocations report identical numbers', async () => {
      const fromRoot = await runCli(
        ['--json', 'context', 'stats', '--change', WT_CHANGE, '--artifact', 'stories'],
        tempDir,
      )
      const fromWorktree = await runCli(
        ['--json', 'context', 'stats', '--change', WT_CHANGE, '--artifact', 'stories'],
        wtDir,
      )
      expect(fromRoot.code).toBe(0)
      expect(fromWorktree.code).toBe(0)
      expect(JSON.parse(fromRoot.stdout)).toEqual(JSON.parse(fromWorktree.stdout))
    })

    it('non-worktree changes stay projectRoot-rooted (zero behavior change)', async () => {
      const localStore = new ArtifactStore(join(tempDir, 'spec'))
      await localStore.createChange('local change', 'quick', ['intent', 'implementation', 'verification'])
      await writeFile(
        join(tempDir, 'spec', 'changes', 'local-change', 'intent.md'),
        '# local-change\n\nLocal intent content in the main checkout.\n',
      )
      const { stdout, code } = await runCli(
        ['--json', 'context', 'stats', '--change', 'local-change', '--artifact', 'stories'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.change).toBe('local-change')
      expect(data.artifacts[0].tokens).toBeGreaterThan(0)
    })

    it('a missing change still yields the canonical not_found error', async () => {
      const { stdout, code } = await runCli(
        ['--json', 'context', 'stats', '--change', 'no-such-change'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('not_found')
      expect(String(data.error.message)).toContain(
        join(tempDir, 'spec', 'changes', 'no-such-change'),
      )
    })

    it('corrupt change metadata propagates as an error, not a misleading not_found', async () => {
      const corruptDir = join(tempDir, 'spec', 'changes', 'corrupt-change')
      await mkdir(corruptDir, { recursive: true })
      // Schema-invalid metadata: `workflow` must be a string and required
      // fields are missing — getChange throws StateValidationError, which
      // must NOT be swallowed into a projectRoot fallback.
      await writeFile(join(corruptDir, '.metta.yaml'), 'workflow: [not, a, string]\n')
      const { stdout, code } = await runCli(
        ['--json', 'context', 'stats', '--change', 'corrupt-change'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('context_stats_error')
      expect(String(data.error.message)).toContain('Schema validation failed')
    })
  })

  describe('metta instructions', () => {
    it('main-root invocation emits worktree-rooted context (specDir + changePath)', async () => {
      const { stdout, code } = await runCli(
        ['--json', 'instructions', 'spec', '--change', WT_CHANGE],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      // existing_specs listed from the worktree's spec/specs tree, not the
      // main checkout's.
      expect(data.context.existing_specs).toContain('wt-only-cap')
      expect(data.context.existing_specs).not.toContain('main-only-cap')
      // project context read from the worktree's spec/project.md.
      expect(data.context.project).toContain('WORKTREE-PROJECT-MARKER')
      expect(data.context.project).not.toContain('MAIN-CHECKOUT-PROJECT-MARKER')
      // required context (intent.md/stories.md) resolved from the worktree
      // change dir — the main checkout has no copy at all.
      expect(data.budget.context_tokens).toBeGreaterThan(0)
    })

    it('main-root and in-worktree invocations emit identical instruction payloads', async () => {
      const fromRoot = await runCli(
        ['--json', 'instructions', 'spec', '--change', WT_CHANGE],
        tempDir,
      )
      const fromWorktree = await runCli(
        ['--json', 'instructions', 'spec', '--change', WT_CHANGE],
        wtDir,
      )
      expect(fromRoot.code).toBe(0)
      expect(fromWorktree.code).toBe(0)
      expect(JSON.parse(fromRoot.stdout)).toEqual(JSON.parse(fromWorktree.stdout))
    })
  })

  describe('metta complete', () => {
    it('spec gates, invoked from the main root, read worktree artifacts and capability specs', async () => {
      const { stderr, code } = await runCli(
        ['complete', 'spec', '--change', WT_CHANGE],
        tempDir,
      )
      // Before re-rooting this failed with "targets unknown capability" —
      // the capability exists only in the worktree's spec/specs tree.
      expect(stderr).not.toContain('targets unknown capability')
      expect(code).toBe(0)

      // The completion landed on the worktree copy of the change state.
      const meta = await readFile(join(wtChangeDir, '.metta.yaml'), 'utf8')
      expect(meta).toContain('spec: complete')
      // Nothing leaked into the main checkout.
      expect(existsSync(join(tempDir, 'spec', 'changes', WT_CHANGE))).toBe(false)
    })

    it('stories-valid gate, invoked from the main root, reads stories.md/spec.md from the worktree', async () => {
      const { stderr, code } = await runCli(
        ['complete', 'stories', '--change', WT_CHANGE],
        tempDir,
      )
      // Before re-rooting the gate parsed a main-checkout path with no
      // stories.md and failed with "stories.md not found".
      expect(stderr).not.toContain('stories.md not found')
      expect(stderr).not.toContain('parse error')
      expect(code).toBe(0)

      // The completion landed on the worktree copy of the change state.
      const meta = await readFile(join(wtChangeDir, '.metta.yaml'), 'utf8')
      expect(meta).toContain('stories: complete')
      // Nothing leaked into the main checkout.
      expect(existsSync(join(tempDir, 'spec', 'changes', WT_CHANGE))).toBe(false)
    })
  })
})

describe('CLI: worktree-hosted change git side effects target the hosting checkout', { timeout: 60000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await realpath(await mkdtemp(join(tmpdir(), 'metta-chroot-git-')))
    await installFixture(tempDir)
    await execAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: tempDir })
    await execAsync('git', ['config', 'user.name', 'Test'], { cwd: tempDir })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  async function gitLog(cwd: string): Promise<string> {
    const { stdout } = await execAsync('git', ['log', '--oneline'], { cwd })
    return stdout
  }

  async function gitHead(cwd: string): Promise<string> {
    const { stdout } = await execAsync('git', ['rev-parse', 'HEAD'], { cwd })
    return stdout.trim()
  }

  it('instructions emission auto-commit lands on the worktree branch, not the main checkout', async () => {
    const quick = await runCli(['--json', 'quick', 'emit here'], tempDir)
    expect(quick.code).toBe(0)
    const worktreePath = JSON.parse(quick.stdout).worktree as string
    expect(worktreePath).toBe(join(tempDir, '.metta', 'worktrees', 'emit-here'))

    const mainHeadBefore = await gitHead(tempDir)

    // `intent` is the quick workflow's ready artifact, so emission stamps
    // timing/token metrics and auto-commits the change's .metta.yaml.
    const result = await runCli(
      ['--json', 'instructions', 'intent', '--change', 'emit-here'],
      tempDir,
    )
    expect(result.code).toBe(0)

    const worktreeLog = await gitLog(worktreePath)
    expect(worktreeLog).toContain('chore(emit-here): record instruction emission')

    // The main checkout gained no commit and no staged/tracked change files.
    expect(await gitHead(tempDir)).toBe(mainHeadBefore)
    const mainLog = await gitLog(tempDir)
    expect(mainLog).not.toContain('record instruction emission')
    const { stdout: mainStatus } = await execAsync(
      'git', ['status', '--porcelain', '--', 'spec/changes'], { cwd: tempDir },
    )
    expect(mainStatus.trim()).toBe('')
  })

  it('complete auto-commit lands on the worktree branch, not the main checkout', async () => {
    const quick = await runCli(['--json', 'quick', 'finish here'], tempDir)
    expect(quick.code).toBe(0)
    const worktreePath = JSON.parse(quick.stdout).worktree as string

    // Real intent content in the WORKTREE change dir (root-invoked complete
    // must validate this copy, not a main-checkout path).
    await writeFile(
      join(worktreePath, 'spec', 'changes', 'finish-here', 'intent.md'),
      [
        '# finish-here',
        '',
        '## Problem',
        '',
        'A small, well-understood fix that needs no planning artifacts and is',
        'entirely contained inside the hosting worktree checkout for the change.',
        '',
        '## Proposal',
        '',
        'Apply the localized fix and verify the behavior with the test suite.',
        '',
      ].join('\n'),
    )

    const mainHeadBefore = await gitHead(tempDir)

    const result = await runCli(['complete', 'intent', '--change', 'finish-here'], tempDir)
    expect(result.code).toBe(0)

    const worktreeLog = await gitLog(worktreePath)
    expect(worktreeLog).toContain('docs(finish-here): complete intent')

    expect(await gitHead(tempDir)).toBe(mainHeadBefore)
    const mainLog = await gitLog(tempDir)
    expect(mainLog).not.toContain('complete intent')

    // Completion state lives in the worktree copy only.
    const meta = await readFile(
      join(worktreePath, 'spec', 'changes', 'finish-here', '.metta.yaml'), 'utf8',
    )
    expect(meta).toContain('intent: complete')
    expect(existsSync(join(tempDir, 'spec', 'changes', 'finish-here'))).toBe(false)
  })
})
