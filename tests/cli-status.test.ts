import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, execAsync, CLI_PATH, disableWorktrees, installFixture } from './helpers/cli.js'

describe("CLI: status / next / changes / doctor / gate / validate-stories", { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  describe('metta status', () => {
    it('reports no active changes', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      const { stdout } = await runCli(['--json', 'status'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.changes).toEqual([])
    })

    it('aggregates worktree-hosted changes when run from the main root', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      // Simulate a worktree-per-change checkout hosting the only active
      // change — the main checkout's own spec/changes stays empty.
      const host = join(tempDir, '.metta', 'worktrees', 'demo-change')
      const changeDir = join(host, 'spec', 'changes', 'demo-change')
      await mkdir(changeDir, { recursive: true })
      await writeFile(
        join(changeDir, '.metta.yaml'),
        [
          'workflow: quick',
          'created: "2026-08-08T00:00:00.000Z"',
          'status: active',
          'current_artifact: intent',
          'base_versions: {}',
          'artifacts:',
          '  intent: ready',
          '',
        ].join('\n'),
      )
      const { stdout } = await runCli(['--json', 'status'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.change).toBe('demo-change')
      expect(data.worktree).toBe(host)
    })
  })


  describe('metta next post-finalize', () => {
    async function git(args: string[]): Promise<void> {
      await execAsync('git', args, { cwd: tempDir })
    }

    async function setupRepoWithMain(): Promise<void> {
      await git(['init', '--initial-branch=main'])
      await git(['config', 'user.email', 'test@example.com'])
      await git(['config', 'user.name', 'Test'])
      await writeFile(join(tempDir, 'README.md'), '# test\n')
      await git(['add', '.'])
      await git(['commit', '-m', 'initial'])
    }

    it('returns ship when on metta/* branch ahead of main', async () => {
      await setupRepoWithMain()
      await git(['checkout', '-b', 'metta/example'])
      await writeFile(join(tempDir, 'change.txt'), 'work\n')
      await git(['add', '.'])
      await git(['commit', '-m', 'change'])
      const { stdout } = await runCli(['--json', 'next'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.next).toBe('ship')
      expect(data.change).toBe('example')
      expect(data.branch).toBe('metta/example')
      expect(data.command).toContain('--branch metta/example')
    })

    it('returns propose when on metta/* branch with zero commits ahead', async () => {
      await setupRepoWithMain()
      await git(['checkout', '-b', 'metta/clean'])
      const { stdout } = await runCli(['--json', 'next'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.next).toBe('propose')
    })

    it('returns propose when on main', async () => {
      await setupRepoWithMain()
      const { stdout } = await runCli(['--json', 'next'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.next).toBe('propose')
    })

    it('returns propose when main branch is missing', async () => {
      await git(['init', '--initial-branch=metta/orphan'])
      await git(['config', 'user.email', 'test@example.com'])
      await git(['config', 'user.name', 'Test'])
      await writeFile(join(tempDir, 'README.md'), '# test\n')
      await git(['add', '.'])
      await git(['commit', '-m', 'initial'])
      const { stdout, code } = await runCli(['--json', 'next'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.next).toBe('propose')
    })
  })


  describe('metta status after propose', () => {
    it('shows the active change', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'test change'], tempDir)
      const { stdout } = await runCli(['--json', 'status'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.change).toBe('test-change')
      expect(data.workflow).toBe('standard')
    })

    it('surfaces stop_after from the change record when propose --stop-after was used', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'status stop after probe', '--stop-after', 'tasks'], tempDir)
      const { stdout } = await runCli(['--json', 'status'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stop_after).toBe('tasks')
    })

    it('omits stop_after from status JSON when no --stop-after was used', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'status no stop probe'], tempDir)
      const { stdout } = await runCli(['--json', 'status'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stop_after === undefined || data.stop_after === null).toBe(true)
    })
  })


  describe('metta doctor', () => {
    it('runs health checks', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      const { stdout, code } = await runCli(['--json', 'doctor'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.checks.length).toBeGreaterThan(0)
    })

    it('reports the framework version from package.json', async () => {
      const { readFile } = await import('node:fs/promises')
      const pkg = JSON.parse(
        await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
      ) as { version: string }
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      const { stdout, code } = await runCli(['--json', 'doctor'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      const versionCheck = data.checks.find((c: { check: string }) => c.check === 'Framework version')
      expect(versionCheck).toBeDefined()
      expect(versionCheck.detail).toBe(pkg.version)
    })
  })


  describe('metta doctor --fix', { timeout: 30000 }, () => {
    it('dedupes three duplicate stacks: entries and auto-commits', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      const configPath = join(tempDir, '.metta', 'config.yaml')
      const corrupt = [
        'project:',
        '  name: test',
        '  stacks: ["js"]',
        '  stacks: ["rust"]',
        '  stacks: ["py"]',
        '',
      ].join('\n')
      await writeFile(configPath, corrupt, 'utf8')
      await execAsync('git', ['add', '--', '.metta/config.yaml'], { cwd: tempDir })
      await execAsync('git', ['commit', '-m', 'corrupt config fixture'], { cwd: tempDir })

      const { code } = await runCli(['doctor', '--fix'], tempDir)
      expect(code).toBe(0)

      const { readFile } = await import('node:fs/promises')
      const written = await readFile(configPath, 'utf8')
      const stacksLines = written.split('\n').filter(l => /^\s*stacks:/.test(l))
      expect(stacksLines).toHaveLength(1)
      expect(stacksLines[0]).toContain('py')

      const { stdout: subject } = await execAsync('git', ['log', '-1', '--format=%s'], { cwd: tempDir })
      expect(subject.trim()).toBe('chore: metta doctor repaired .metta/config.yaml')
    })

    it('drops a schema-invalid top-level key', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      const configPath = join(tempDir, '.metta', 'config.yaml')
      const { readFile } = await import('node:fs/promises')
      const existing = await readFile(configPath, 'utf8')
      const withBadKey = existing + (existing.endsWith('\n') ? '' : '\n') + 'foo: "bar"\n'
      await writeFile(configPath, withBadKey, 'utf8')
      await execAsync('git', ['add', '--', '.metta/config.yaml'], { cwd: tempDir })
      await execAsync('git', ['commit', '-m', 'invalid config fixture'], { cwd: tempDir })

      const { stdout, code } = await runCli(['doctor', '--fix'], tempDir)
      expect(code).toBe(0)

      const written = await readFile(configPath, 'utf8')
      expect(written).not.toContain('foo:')
      expect(stdout).toContain("dropped unrecognized key 'foo'")
    })

    it('is a no-op on an already-valid config', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      const configPath = join(tempDir, '.metta', 'config.yaml')
      const { readFile } = await import('node:fs/promises')
      const baseline = await readFile(configPath, 'utf8')
      const { stdout: beforeLog } = await execAsync('git', ['log', '--oneline'], { cwd: tempDir })

      const { code } = await runCli(['doctor', '--fix'], tempDir)
      expect(code).toBe(0)

      const after = await readFile(configPath, 'utf8')
      expect(after).toBe(baseline)
      const { stdout: afterLog } = await execAsync('git', ['log', '--oneline'], { cwd: tempDir })
      expect(afterLog).toBe(beforeLog)
    })
  })


  describe('corrupt config error boundary', () => {
    async function corruptConfig(): Promise<void> {
      const configPath = join(tempDir, '.metta', 'config.yaml')
      await writeFile(
        configPath,
        'project:\n  name: foo\nproject:\n  name: bar\n',
        'utf8',
      )
    }

    it('blocks metta status with actionable doctor --fix remedy', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await corruptConfig()
      const { stdout, stderr, code } = await runCli(['--json', 'status'], tempDir)
      expect(code).toBe(4)
      const combined = stdout + stderr
      expect(combined).toContain('.metta/config.yaml')
      expect(combined).toContain("metta doctor --fix")
      // JSON payload shape sanity check when --json is set.
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.type).toBe('config_parse_error')
      expect(data.error.path).toContain('.metta/config.yaml')
      expect(data.error.remedy).toBe("Run 'metta doctor --fix' to repair.")
    })

    it('emits actionable stderr without --json', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await corruptConfig()
      const { stderr, code } = await runCli(['status'], tempDir)
      expect(code).toBe(4)
      expect(stderr).toContain('.metta/config.yaml')
      expect(stderr).toContain("metta doctor --fix")
    })

    it('does not block metta doctor on corrupt config', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await corruptConfig()
      const { stdout, stderr } = await runCli(['doctor'], tempDir)
      // Doctor's own diagnostic output is fine; it must NOT surface the
      // ConfigParseError remedy line since it owns the repair path.
      const combined = stdout + stderr
      expect(combined).not.toContain("metta doctor --fix")
    })
  })


  describe('metta changes list', () => {
    it('lists active changes', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'change one'], tempDir)
      await runCli(['propose', 'change two'], tempDir)
      const { stdout } = await runCli(['--json', 'changes', 'list'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.changes.length).toBe(2)
    })
  })


  describe('metta changes abandon', () => {
    it('abandons a change', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'something to abandon'], tempDir)
      const { stdout, code } = await runCli(['--json', 'changes', 'abandon', 'something-abandon'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.abandoned).toBe('something-abandon')
    })
  })


  describe('metta gate list', () => {
    it('lists built-in gates', async () => {
      const { stdout } = await runCli(['--json', 'gate', 'list'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.gates.length).toBeGreaterThanOrEqual(4)
      expect(data.gates.map((g: { name: string }) => g.name)).toContain('tests')
    })
  })


  describe('metta validate-stories', () => {
    it('errors with exit 4 on missing change', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      const { stdout, code } = await runCli(
        ['--json', 'validate-stories', '--change', 'does-not-exist'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(typeof data.error.type).toBe('string')
      expect(data.error.type.length).toBeGreaterThan(0)
    })

    it('errors with exit 4 when stories.md is missing', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'my-feature')
      await mkdir(changeDir, { recursive: true })
      await writeFile(join(changeDir, 'intent.md'), '# Intent\n\nSomething.\n', 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'validate-stories', '--change', 'my-feature'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.message).toContain('stories.md not found')
    })

    it('--help shows the command description', async () => {
      const { stdout, code } = await runCli(['validate-stories', '--help'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('validate-stories')
      expect(stdout).toContain('--change')
      expect(stdout.toLowerCase()).toContain('stories')
    })

    it('is registered in the main help listing', async () => {
      const { stdout, code } = await runCli(['--help'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('validate-stories')
    })
  })


  describe('metta status --change with complexity', () => {
    async function writeComplexityField(changeName: string): Promise<void> {
      const { readFile, writeFile } = await import('node:fs/promises')
      const YAML = (await import('yaml')).default
      const path = join(tempDir, 'spec', 'changes', changeName, '.metta.yaml')
      const raw = await readFile(path, 'utf8')
      const doc = YAML.parse(raw) as Record<string, unknown>
      doc.complexity_score = {
        score: 2,
        signals: { file_count: 5 },
        recommended_workflow: 'standard',
      }
      await writeFile(path, YAML.stringify(doc, { lineWidth: 0 }), 'utf8')
    }

    it('JSON mode with no complexity_score emits null fields and exit 0', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'score absent'], tempDir)
      const { stdout, code } = await runCli(
        ['--json', 'status', '--change', 'score-absent'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.change).toBe('score-absent')
      expect(data.complexity_score).toBeNull()
      expect(data.actual_complexity_score).toBeNull()
    })

    it('JSON mode with complexity_score includes object and exit 0', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'score present'], tempDir)
      await writeComplexityField('score-present')
      const { stdout, code } = await runCli(
        ['--json', 'status', '--change', 'score-present'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.complexity_score).toEqual({
        score: 2,
        signals: { file_count: 5 },
        recommended_workflow: 'standard',
      })
      expect(data.actual_complexity_score).toBeNull()
    })

    it('human mode with no complexity_score shows "not yet scored" and exit 0', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'human absent'], tempDir)
      const { stdout, code } = await runCli(
        ['status', '--change', 'human-absent'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stdout).toContain('Complexity: not yet scored')
    })

    it('human mode with complexity_score shows Complexity line and recommended text', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'human present'], tempDir)
      await writeComplexityField('human-present')
      const { stdout, code } = await runCli(
        ['status', '--change', 'human-present'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stdout).toContain('Complexity:')
      expect(stdout).toContain('standard')
      expect(stdout).toContain('recommended:')
    })
  })


  describe('metta status escalation surface', () => {
    const escalation = {
      from_tier: 'quick',
      to_tier: 'standard',
      justification: 'kept standard: workflow_locked',
      timestamp: '2026-07-01T10:00:00.000Z',
    }

    async function writeEscalationField(changeName: string): Promise<void> {
      const { readFile, writeFile } = await import('node:fs/promises')
      const YAML = (await import('yaml')).default
      const path = join(tempDir, 'spec', 'changes', changeName, '.metta.yaml')
      const raw = await readFile(path, 'utf8')
      const doc = YAML.parse(raw) as Record<string, unknown>
      doc.escalation = escalation
      await writeFile(path, YAML.stringify(doc, { lineWidth: 0 }), 'utf8')
    }

    it('human mode shows the escalation line with from/to/justification when present', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'escalated change human'], tempDir)
      await writeEscalationField('escalated-change-human')
      const { stdout, code } = await runCli(
        ['status', '--change', 'escalated-change-human'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stdout).toContain('Escalation: quick -> standard (kept standard: workflow_locked)')
    })

    it('JSON mode includes the escalation field verbatim when present', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'escalated change json'], tempDir)
      await writeEscalationField('escalated-change-json')
      const { stdout, code } = await runCli(
        ['--json', 'status', '--change', 'escalated-change-json'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.escalation).toEqual(escalation)
    })

    it('renders normally with no escalation section/field in either mode when absent', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'no escalation change'], tempDir)

      const human = await runCli(['status', '--change', 'no-escalation-change'], tempDir)
      expect(human.code).toBe(0)
      expect(human.stdout).not.toContain('Escalation:')

      const jsonRun = await runCli(
        ['--json', 'status', '--change', 'no-escalation-change'],
        tempDir,
      )
      expect(jsonRun.code).toBe(0)
      const data = JSON.parse(jsonRun.stdout)
      expect('escalation' in data).toBe(false)
      // Absent means absent — not normalized to null like complexity_score.
      expect(data.escalation).toBeUndefined()
    })
  })


  describe('metta status stale finalize lock', () => {
    const DEAD_PID = 2147483646

    async function writeLockFile(changeName: string, pid: number): Promise<void> {
      const locksDir = join(tempDir, '.metta', 'locks')
      await mkdir(locksDir, { recursive: true })
      await writeFile(
        join(locksDir, `finalize-${changeName}.lock`),
        JSON.stringify({ pid, startedAt: new Date().toISOString(), change: changeName }),
        'utf8',
      )
    }

    it('surfaces a dead-pid lock in human and JSON output', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'stale lock dead pid'], tempDir)
      await writeLockFile('stale-lock-dead-pid', DEAD_PID)

      const human = await runCli(['status', '--change', 'stale-lock-dead-pid'], tempDir)
      expect(human.code).toBe(0)
      expect(human.stdout).toContain('Finalize lock: stale finalize lock detected, safe to retry')

      const jsonRun = await runCli(['--json', 'status', '--change', 'stale-lock-dead-pid'], tempDir)
      expect(jsonRun.code).toBe(0)
      const data = JSON.parse(jsonRun.stdout)
      expect(data.finalize_lock_stale).toBe(true)
      expect(data.finalize_lock_reason).toBe('dead-pid')
    })

    it('does not surface a fresh live-owned lock', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'fresh lock live pid'], tempDir)
      await writeLockFile('fresh-lock-live-pid', process.pid)

      const human = await runCli(['status', '--change', 'fresh-lock-live-pid'], tempDir)
      expect(human.code).toBe(0)
      expect(human.stdout).not.toContain('Finalize lock:')

      const jsonRun = await runCli(['--json', 'status', '--change', 'fresh-lock-live-pid'], tempDir)
      expect(jsonRun.code).toBe(0)
      const data = JSON.parse(jsonRun.stdout)
      expect(data.finalize_lock_stale).toBe(false)
    })

    it('leaves output unchanged when no lock file exists', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'no lock at all'], tempDir)

      const human = await runCli(['status', '--change', 'no-lock-at-all'], tempDir)
      expect(human.code).toBe(0)
      expect(human.stdout).not.toContain('Finalize lock:')

      const jsonRun = await runCli(['--json', 'status', '--change', 'no-lock-at-all'], tempDir)
      expect(jsonRun.code).toBe(0)
      const data = JSON.parse(jsonRun.stdout)
      expect('finalize_lock_stale' in data).toBe(true)
      expect(data.finalize_lock_stale).toBe(false)
    })
  })


  describe('milestone rollups in status and progress', () => {
    async function seedMilestone(
      slug: string,
      name: string,
      opts: { target?: string; status?: 'open' | 'closed' } = {},
    ): Promise<void> {
      const dir = join(tempDir, 'spec', 'milestones')
      await mkdir(dir, { recursive: true })
      const lines = ['---', `name: ${name}`]
      if (opts.target !== undefined) lines.push(`target: ${opts.target}`)
      lines.push(`status: ${opts.status ?? 'open'}`, '---', '')
      await writeFile(join(dir, `${slug}.md`), lines.join('\n'), 'utf8')
    }

    async function seedIssue(
      slug: string,
      title: string,
      milestone: string,
      opts: { resolved?: boolean } = {},
    ): Promise<void> {
      const dir = opts.resolved
        ? join(tempDir, 'spec', 'issues', 'resolved')
        : join(tempDir, 'spec', 'issues')
      await mkdir(dir, { recursive: true })
      const content = [
        '---',
        `milestone: ${milestone}`,
        '---',
        `# ${title}`,
        '',
        '**Captured**: 2026-08-01',
        '**Status**: logged',
        '**Severity**: minor',
        '',
        'Fixture body.',
        '',
      ].join('\n')
      await writeFile(join(dir, `${slug}.md`), content, 'utf8')
    }

    describe('absent without milestone files (pre-change envelopes)', () => {
      it('status zero-changes JSON envelope is structurally identical', async () => {
        await installFixture(tempDir)
        await disableWorktrees(tempDir)
        const { stdout } = await runCli(['--json', 'status'], tempDir)
        const data = JSON.parse(stdout)
        expect(Object.keys(data).sort()).toEqual(['changes', 'message'])
        expect('milestones' in data).toBe(false)
        expect('milestone_warnings' in data).toBe(false)
      })

      it('status single-change JSON and text carry no milestone section', async () => {
        await installFixture(tempDir)
        await disableWorktrees(tempDir)
        await runCli(['propose', 'no milestones here'], tempDir)

        const jsonRun = await runCli(['--json', 'status'], tempDir)
        const data = JSON.parse(jsonRun.stdout)
        expect(data.change).toBe('no-milestones-here')
        expect('milestones' in data).toBe(false)
        expect('milestone_warnings' in data).toBe(false)

        const human = await runCli(['status'], tempDir)
        expect(human.code).toBe(0)
        expect(human.stdout).not.toContain('Milestones:')
      })

      it('progress JSON and text carry no milestone section', async () => {
        await installFixture(tempDir)
        await disableWorktrees(tempDir)
        const jsonRun = await runCli(['--json', 'progress'], tempDir)
        const data = JSON.parse(jsonRun.stdout)
        expect('milestones' in data).toBe(false)
        expect('milestone_warnings' in data).toBe(false)

        const human = await runCli(['progress'], tempDir)
        expect(human.code).toBe(0)
        expect(human.stdout).not.toContain('Milestones:')
      })
    })

    describe('present with milestones and assigned issues', () => {
      it('status single-change envelope gains top-level milestones with counts (never per change)', async () => {
        await installFixture(tempDir)
        await disableWorktrees(tempDir)
        await seedMilestone('v0-6', 'v0.6', { target: '2026-09-30' })
        await seedIssue('open-one', 'Open one', 'v0-6')
        await seedIssue('done-one', 'Done one', 'v0-6', { resolved: true })
        await seedIssue('done-two', 'Done two', 'v0-6', { resolved: true })
        await runCli(['propose', 'rollup single change'], tempDir)

        const { stdout, code } = await runCli(['--json', 'status'], tempDir)
        expect(code).toBe(0)
        const data = JSON.parse(stdout)
        expect(data.change).toBe('rollup-single-change')
        expect(data.milestones).toHaveLength(1)
        expect(data.milestones[0]).toMatchObject({
          slug: 'v0-6',
          name: 'v0.6',
          status: 'open',
          target: '2026-09-30',
          open: 1,
          resolved: 2,
          total: 3,
          percent: 67,
        })
        // Counts-only rows — same element shape as `milestone list`.
        expect('openIssues' in data.milestones[0]).toBe(false)
        expect('resolvedIssues' in data.milestones[0]).toBe(false)
        expect('milestone_warnings' in data).toBe(false)

        const human = await runCli(['status'], tempDir)
        expect(human.code).toBe(0)
        expect(human.stdout).toContain('Milestones:')
        expect(human.stdout).toContain('v0-6')
        expect(human.stdout).toContain('2/3 resolved (67%)')
        expect(human.stdout).toContain('target 2026-09-30')
      })

      it('status multi-change envelope carries milestones at top level only', async () => {
        await installFixture(tempDir)
        await disableWorktrees(tempDir)
        await seedMilestone('v0-6', 'v0.6')
        await seedIssue('open-one', 'Open one', 'v0-6')
        await runCli(['propose', 'multi one'], tempDir)
        await runCli(['propose', 'multi two'], tempDir)

        const { stdout, code } = await runCli(['--json', 'status'], tempDir)
        expect(code).toBe(0)
        const data = JSON.parse(stdout)
        expect(data.changes).toHaveLength(2)
        expect(data.milestones).toHaveLength(1)
        expect(data.milestones[0]).toMatchObject({ slug: 'v0-6', open: 1, resolved: 0, total: 1, percent: 0 })
        for (const change of data.changes) {
          expect('milestones' in change).toBe(false)
        }
      })

      it('status zero-changes envelope gains the milestone keys', async () => {
        await installFixture(tempDir)
        await disableWorktrees(tempDir)
        await seedMilestone('v0-6', 'v0.6')
        await seedIssue('dangler', 'Dangling ref', 'no-such-milestone')

        const { stdout, code } = await runCli(['--json', 'status'], tempDir)
        expect(code).toBe(0)
        const data = JSON.parse(stdout)
        expect(data.changes).toEqual([])
        expect(data.message).toBe('No active changes')
        expect(data.milestones).toHaveLength(1)
        // Warnings only when non-empty — the dangling reference produces one.
        expect(data.milestone_warnings).toHaveLength(1)
        expect(data.milestone_warnings[0]).toContain('no-such-milestone')
      })

      it('progress JSON gains milestones and text renders the block after Completed', async () => {
        await installFixture(tempDir)
        await disableWorktrees(tempDir)
        await seedMilestone('v0-6', 'v0.6', { target: '2026-09-30' })
        await seedMilestone('v0-5', 'v0.5', { status: 'closed' })
        await seedIssue('open-one', 'Open one', 'v0-6')
        await seedIssue('done-one', 'Done one', 'v0-5', { resolved: true })

        const jsonRun = await runCli(['--json', 'progress'], tempDir)
        expect(jsonRun.code).toBe(0)
        const data = JSON.parse(jsonRun.stdout)
        expect(data.milestones).toHaveLength(2)
        // Open sorts before closed (rollup ordering).
        expect(data.milestones[0]).toMatchObject({ slug: 'v0-6', status: 'open', open: 1, resolved: 0, total: 1 })
        expect(data.milestones[1]).toMatchObject({ slug: 'v0-5', status: 'closed', open: 0, resolved: 1, total: 1, percent: 100 })
        expect('milestone_warnings' in data).toBe(false)

        const human = await runCli(['progress'], tempDir)
        expect(human.code).toBe(0)
        expect(human.stdout).toContain('Milestones:')
        expect(human.stdout).toContain('v0-6')
        expect(human.stdout).toContain('0/1 resolved (0%)')
        expect(human.stdout).toContain('target 2026-09-30')
        expect(human.stdout).toContain('1/1 resolved (100%)')
        expect(human.stdout.indexOf('v0-6')).toBeLessThan(human.stdout.indexOf('v0-5'))
      })
    })
  })


  describe('metta next stale finalize lock', () => {
    const DEAD_PID = 2147483646

    async function writeLockFile(changeName: string, pid: number): Promise<void> {
      const locksDir = join(tempDir, '.metta', 'locks')
      await mkdir(locksDir, { recursive: true })
      await writeFile(
        join(locksDir, `finalize-${changeName}.lock`),
        JSON.stringify({ pid, startedAt: new Date().toISOString(), change: changeName }),
        'utf8',
      )
    }

    async function markAllArtifactsComplete(changeName: string): Promise<void> {
      const { readFile, writeFile } = await import('node:fs/promises')
      const YAML = (await import('yaml')).default
      const path = join(tempDir, 'spec', 'changes', changeName, '.metta.yaml')
      const raw = await readFile(path, 'utf8')
      const doc = YAML.parse(raw) as { artifacts: Record<string, string> }
      for (const id of Object.keys(doc.artifacts)) {
        doc.artifacts[id] = 'complete'
      }
      await writeFile(path, YAML.stringify(doc, { lineWidth: 0 }), 'utf8')
    }

    it('warns on a dead-pid lock while keeping next=finalize', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'next stale lock'], tempDir)
      await markAllArtifactsComplete('next-stale-lock')
      await writeLockFile('next-stale-lock', DEAD_PID)

      const human = await runCli(['next', '--change', 'next-stale-lock'], tempDir)
      expect(human.code).toBe(0)
      expect(human.stdout).toContain('Stale finalize lock detected for next-stale-lock — safe to retry.')
      expect(human.stdout).toContain('All artifacts complete for next-stale-lock.')

      const jsonRun = await runCli(['--json', 'next', '--change', 'next-stale-lock'], tempDir)
      expect(jsonRun.code).toBe(0)
      const data = JSON.parse(jsonRun.stdout)
      expect(data.next).toBe('finalize')
      expect(data.finalize_lock_stale).toBe(true)
      expect(data.finalize_lock_reason).toBe('dead-pid')
    })

    it('emits no warning and no extra JSON fields for a fresh live-owned lock', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'next fresh lock'], tempDir)
      await markAllArtifactsComplete('next-fresh-lock')
      await writeLockFile('next-fresh-lock', process.pid)

      const human = await runCli(['next', '--change', 'next-fresh-lock'], tempDir)
      expect(human.code).toBe(0)
      expect(human.stdout).not.toContain('Stale finalize lock detected')
      expect(human.stdout).toContain('All artifacts complete for next-fresh-lock.')

      const jsonRun = await runCli(['--json', 'next', '--change', 'next-fresh-lock'], tempDir)
      expect(jsonRun.code).toBe(0)
      const data = JSON.parse(jsonRun.stdout)
      expect(data.next).toBe('finalize')
      expect('finalize_lock_stale' in data).toBe(false)
      expect('finalize_lock_reason' in data).toBe(false)
    })
  })

})
