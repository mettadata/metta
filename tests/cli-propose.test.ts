import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, execAsync, CLI_PATH, disableWorktrees, installFixture } from './helpers/cli.js'

describe("CLI: propose / quick / complete pre-complete validation", { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  describe('metta propose', () => {
    it('creates a change with standard workflow', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      const { stdout, code } = await runCli(['--json', 'propose', 'add user profiles'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.change).toBe('user-profiles')
      expect(data.workflow).toBe('standard')
      expect(data.artifacts.length).toBeGreaterThan(0)
    })
  })


  describe('metta quick', () => {
    it('creates a quick-mode change', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      const { stdout, code } = await runCli(['--json', 'quick', 'fix typo'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.change).toBe('fix-typo')
      expect(data.workflow).toBe('quick')
    })
  })


  describe('metta propose --auto / --accept-recommended', () => {
    async function readChangeMeta(changeName: string): Promise<string> {
      const { readFile } = await import('node:fs/promises')
      return readFile(
        join(tempDir, 'spec', 'changes', changeName, '.metta.yaml'),
        'utf8',
      )
    }

    it('--auto persists auto_accept_recommendation: true', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      const { code } = await runCli(['propose', 'auto flag probe', '--auto'], tempDir)
      expect(code).toBe(0)
      const yaml = await readChangeMeta('auto-flag-probe')
      expect(yaml).toContain('auto_accept_recommendation: true')
    })

    it('--accept-recommended alias behaves identically', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      const { code } = await runCli(
        ['propose', 'alias flag probe', '--accept-recommended'],
        tempDir,
      )
      expect(code).toBe(0)
      const yaml = await readChangeMeta('alias-flag-probe')
      expect(yaml).toContain('auto_accept_recommendation: true')
    })

    it('--workflow standard --auto persists both workflow_locked and auto_accept_recommendation', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      const { code } = await runCli(
        ['propose', 'combo flag probe', '--workflow', 'standard', '--auto'],
        tempDir,
      )
      expect(code).toBe(0)
      const yaml = await readChangeMeta('combo-flag-probe')
      expect(yaml).toContain('auto_accept_recommendation: true')
      expect(yaml).toContain('workflow_locked: true')
    })

    it('no flags does NOT persist auto_accept_recommendation or workflow_locked', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      const { code } = await runCli(['propose', 'bare flag probe'], tempDir)
      expect(code).toBe(0)
      const yaml = await readChangeMeta('bare-flag-probe')
      expect(yaml).not.toContain('auto_accept_recommendation')
      expect(yaml).not.toContain('workflow_locked')
    })
  })


  describe('metta quick --auto / --accept-recommended', () => {
    async function readChangeMeta(changeName: string): Promise<string> {
      const { readFile } = await import('node:fs/promises')
      return readFile(
        join(tempDir, 'spec', 'changes', changeName, '.metta.yaml'),
        'utf8',
      )
    }

    it('--auto persists auto_accept_recommendation: true', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      const { code } = await runCli(['quick', 'quick auto probe', '--auto'], tempDir)
      expect(code).toBe(0)
      const yaml = await readChangeMeta('quick-auto-probe')
      expect(yaml).toContain('auto_accept_recommendation: true')
    })

    it('--accept-recommended alias behaves identically', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      const { code } = await runCli(
        ['quick', 'quick alias probe', '--accept-recommended'],
        tempDir,
      )
      expect(code).toBe(0)
      const yaml = await readChangeMeta('quick-alias-probe')
      expect(yaml).toContain('auto_accept_recommendation: true')
    })

    it('no flags does NOT persist auto_accept_recommendation', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      const { code } = await runCli(['quick', 'quick bare probe'], tempDir)
      expect(code).toBe(0)
      const yaml = await readChangeMeta('quick-bare-probe')
      expect(yaml).not.toContain('auto_accept_recommendation')
    })
  })


  describe('metta complete pre-complete validation', () => {
    // Real content bodies used across these tests.
    // ~400 bytes of real prose — safely above the 200-byte floor and stub-marker free.
    const realIntent = [
      '# Real Change Intent',
      '',
      '## Problem',
      '',
      'We need to validate artifact content at completion time so that placeholder',
      'or template text cannot slip through the workflow. This protects downstream',
      'stages which get authored against malformed upstream artifacts.',
      '',
      '## Proposal',
      '',
      'Add a content sanity check inside metta complete that rejects stub markers,',
      'short content, and unfilled template placeholders in the H1 heading.',
      '',
    ].join('\n')

    it('rejects artifact with stub marker', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'validate stubs'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'validate-stubs')
      // Big enough to pass min-length but contains "intent stub" marker
      const body = '# Validate stubs\n\n' + 'intent stub\n\n' + 'x'.repeat(300)
      await writeFile(join(changeDir, 'intent.md'), body, 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'complete', 'intent', '--change', 'validate-stubs'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.message.toLowerCase()).toContain('intent stub')
    })

    it('rejects too-short artifact', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'shortness'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'shortness')
      // ~40 bytes, well under the 200-byte floor
      await writeFile(join(changeDir, 'intent.md'), '# Shortness\n\nOnly a few bytes here.\n', 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'complete', 'intent', '--change', 'shortness'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.message).toContain('too short')
    })

    it('rejects artifact with {change_name} in H1', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'unfilled template'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'unfilled-template')
      // H1 contains the literal template placeholder; body padded past min-length.
      const body = '# {change_name}\n\n' + 'x'.repeat(400)
      await writeFile(join(changeDir, 'intent.md'), body, 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'complete', 'intent', '--change', 'unfilled-template'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.message).toContain('{change_name}')
    })

    it('stories rejects bad stories.md (missing required fields)', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'bad stories'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'bad-stories')
      // Write a plausible intent so earlier artifacts look normal, then
      // complete intent to unblock stories.
      await writeFile(join(changeDir, 'intent.md'), realIntent, 'utf8')
      const intentResult = await runCli(
        ['--json', 'complete', 'intent', '--change', 'bad-stories'],
        tempDir,
      )
      expect(intentResult.code).toBe(0)
      // stories.md that passes the content sanity check (no stub, >200 bytes,
      // no {change_name}) but is missing required fields on US-1.
      const badStories = [
        '# Bad stories',
        '',
        '## US-1: missing fields',
        '',
        'This story intentionally omits the required As a / I want to / So that /',
        'Priority / Independent Test Criteria fields so that the stories-valid',
        'gate catches it at complete time rather than at finalize.',
        '',
        '**Acceptance Criteria:**',
        '',
        '- **Given** x **When** y **Then** z',
        '',
        'Extra padding so the content sanity check passes: ' + 'x'.repeat(100),
        '',
      ].join('\n')
      await writeFile(join(changeDir, 'stories.md'), badStories, 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'complete', 'stories', '--change', 'bad-stories'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.message.toLowerCase()).toContain('stories.md')
    })

    it('happy path with real content passes', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'happy complete'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'happy-complete')
      await writeFile(join(changeDir, 'intent.md'), realIntent, 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'complete', 'intent', '--change', 'happy-complete'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.completed).toBe('intent')
      expect(data.change).toBe('happy-complete')
    })

    // Spec body long enough to pass the 200-byte content-sanity floor. Shared by
    // all three spec-delta pre-complete tests below so we only author it once.
    const specBodyPadding = [
      'This requirement exists so the delta-target gate runs against real',
      'content. The body is deliberately padded beyond the min-length floor so',
      'that content-sanity never fires ahead of the capability-exists branch,',
      'keeping these tests focused on the delta-target check.',
    ].join(' ')

    it('spec rejects MODIFIED for non-existent capability', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'bad modified'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'bad-modified')
      const specBody = [
        '# Capability Name (Delta)',
        '',
        '## MODIFIED: Requirement: Foo',
        '',
        'The system MUST foo.',
        '',
        specBodyPadding,
        '',
      ].join('\n')
      await writeFile(join(changeDir, 'spec.md'), specBody, 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'complete', 'spec', '--change', 'bad-modified'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.message.toLowerCase()).toContain('unknown capability')
      expect(data.error.message).toContain('capability-name')
    })

    it('spec accepts ADDED for new capability', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'good added'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'good-added')
      const specBody = [
        '# Capability Name (Delta)',
        '',
        '## ADDED: Requirement: Foo',
        '',
        'The system MUST foo.',
        '',
        specBodyPadding,
        '',
      ].join('\n')
      await writeFile(join(changeDir, 'spec.md'), specBody, 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'complete', 'spec', '--change', 'good-added'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.completed).toBe('spec')
      expect(data.change).toBe('good-added')
    })

    it('spec accepts MODIFIED for existing capability', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'good modified'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'good-modified')
      // Seed the capability spec so the MODIFIED target resolves to an existing
      // capability at complete-time.
      const capDir = join(tempDir, 'spec', 'specs', 'capability-name')
      await mkdir(capDir, { recursive: true })
      await writeFile(
        join(capDir, 'spec.md'),
        '# Capability Name\n\n## Requirement: Foo\n\nThe system MUST foo.\n',
        'utf8',
      )
      const specBody = [
        '# Capability Name (Delta)',
        '',
        '## MODIFIED: Requirement: Foo',
        '',
        'The system MUST foo differently.',
        '',
        specBodyPadding,
        '',
      ].join('\n')
      await writeFile(join(changeDir, 'spec.md'), specBody, 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'complete', 'spec', '--change', 'good-modified'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.completed).toBe('spec')
      expect(data.change).toBe('good-modified')
    })
  })

})
