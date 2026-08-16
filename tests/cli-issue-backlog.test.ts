import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, execAsync, CLI_PATH, installFixture } from './helpers/cli.js'

describe("CLI: issue / fix-issue / backlog / branch-safety / check-constitution", { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  describe('metta issue', () => {
    it('logs an issue with severity', async () => {
      await installFixture(tempDir)
      const { stdout, code } = await runCli(['--json', 'issue', 'login flash', '--severity', 'major'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.slug).toBe('login-flash')
      expect(data.severity).toBe('major')
    })

    it('--priority writes a priority frontmatter field', async () => {
      await installFixture(tempDir)
      const { code } = await runCli(['issue', 'slow gate', '--priority', 'high'], tempDir)
      expect(code).toBe(0)
      const content = await readFile(join(tempDir, 'spec', 'issues', 'slow-gate.md'), 'utf8')
      expect(content.startsWith('---\n')).toBe(true)
      expect(content).toContain('priority: high')
    })

    it('invalid --priority exits 4 naming allowed values and creates no file', async () => {
      await installFixture(tempDir)
      const { stdout, code } = await runCli(
        ['--json', 'issue', 'bad priority', '--priority', 'urgent'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('invalid_priority')
      expect(data.error.message).toContain('high, medium, low')
      expect(existsSync(join(tempDir, 'spec', 'issues', 'bad-priority.md'))).toBe(false)
    })

    it('--milestone with an existing milestone writes frontmatter without a warning', async () => {
      await installFixture(tempDir)
      const created = await runCli(['milestone', 'create', 'v0-6', '--name', 'v0.6'], tempDir)
      expect(created.code).toBe(0)
      const { stderr, code } = await runCli(['issue', 'gate timeout', '--milestone', 'v0-6'], tempDir)
      expect(code).toBe(0)
      expect(stderr).not.toContain('Warning')
      const content = await readFile(join(tempDir, 'spec', 'issues', 'gate-timeout.md'), 'utf8')
      expect(content).toContain('milestone: v0-6')
    })

    it('dangling --milestone warns on stderr but still creates the issue', async () => {
      await installFixture(tempDir)
      const { stderr, code } = await runCli(['issue', 'gate timeout', '--milestone', 'v9-9'], tempDir)
      expect(code).toBe(0)
      expect(stderr).toContain("Warning: milestone 'v9-9'")
      expect(existsSync(join(tempDir, 'spec', 'issues', 'gate-timeout.md'))).toBe(true)
    })

    it('issues list marks type: idea rows and JSON carries the record fields', async () => {
      await installFixture(tempDir)
      await runCli(['issue', 'real problem', '--severity', 'major'], tempDir)
      await runCli(['backlog', 'add', 'Shiny idea', '--new', '--priority', 'low'], tempDir)

      const jsonRes = await runCli(['--json', 'issues', 'list'], tempDir)
      expect(jsonRes.code).toBe(0)
      const data = JSON.parse(jsonRes.stdout) as { issues: Array<Record<string, unknown>> }
      const issueRow = data.issues.find((i) => i.slug === 'real-problem')
      const ideaRow = data.issues.find((i) => i.slug === 'shiny-idea')
      expect(issueRow).toMatchObject({ type: 'issue', backlog: false, severity: 'major' })
      expect(ideaRow).toMatchObject({ type: 'idea', backlog: true, priority: 'low' })
      expect(typeof ideaRow?.captured).toBe('string')

      const textRes = await runCli(['issues', 'list'], tempDir)
      expect(textRes.code).toBe(0)
      expect(textRes.stdout).toMatch(/\[idea\] \[minor\] shiny-idea/)
      expect(textRes.stdout).not.toMatch(/\[idea\].*real-problem/)
    })
  })


  describe('metta fix-issue', () => {
    it('no args emits skill-usage hint', async () => {
      await installFixture(tempDir)
      const { stdout, code } = await runCli(['fix-issue'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('Usage: metta fix-issue')
      expect(stdout).toContain('/metta-fix-issues')
    })

    it('errors with exit 4 on unknown slug', async () => {
      await installFixture(tempDir)
      const { stdout, stderr, code } = await runCli(['--json', 'fix-issue', 'does-not-exist'], tempDir)
      expect(code).toBe(4)
      const combined = stdout + stderr
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.type).toBe('not_found')
      expect(combined).toContain('does-not-exist')
    })

    it('single-slug prints pipeline instructions', async () => {
      await installFixture(tempDir)
      const seed = await runCli(['--json', 'issue', 'foo problem', '--severity', 'minor'], tempDir)
      const seedData = JSON.parse(seed.stdout)
      const slug = seedData.slug
      const { stdout, code } = await runCli(['--json', 'fix-issue', slug], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.issue.slug).toBe(slug)
      expect(data.issue.severity).toBe('minor')
      expect(data.issue.title).toBeTruthy()
    })

    it('single-slug prose output includes delegate hint', async () => {
      await installFixture(tempDir)
      await runCli(['issue', 'spec merger strips inline backticks', '--severity', 'major'], tempDir)
      const { stdout, code } = await runCli(['fix-issue', 'spec-merger-strips-inline-backticks'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('Severity: major')
      expect(stdout).toContain('Status: logged')
      expect(stdout).toContain('metta execute --skill fix-issues --target spec-merger-strips-inline-backticks')
    })

    it('--all sorts by severity critical then major then minor', async () => {
      await installFixture(tempDir)
      // Seed out of order: minor, critical, major
      await runCli(['issue', 'zeta minor thing', '--severity', 'minor'], tempDir)
      await runCli(['issue', 'alpha critical thing', '--severity', 'critical'], tempDir)
      await runCli(['issue', 'mu major thing', '--severity', 'major'], tempDir)

      const { stdout, code } = await runCli(['--json', 'fix-issue', '--all'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.issues.length).toBe(3)
      expect(data.issues[0].severity).toBe('critical')
      expect(data.issues[1].severity).toBe('major')
      expect(data.issues[2].severity).toBe('minor')
      expect(data.severity_filter).toBeNull()
    })

    it('--all --severity major filters to major only', async () => {
      await installFixture(tempDir)
      await runCli(['issue', 'zeta minor thing', '--severity', 'minor'], tempDir)
      await runCli(['issue', 'alpha critical thing', '--severity', 'critical'], tempDir)
      await runCli(['issue', 'mu major thing', '--severity', 'major'], tempDir)

      const { stdout, code } = await runCli(['--json', 'fix-issue', '--all', '--severity', 'major'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.issues.length).toBe(1)
      expect(data.issues[0].severity).toBe('major')
      expect(data.severity_filter).toBe('major')
    })

    it('--remove-issue archives to spec/issues/resolved/ and deletes original', async () => {
      await installFixture(tempDir)
      await runCli(['issue', 'stale issue', '--severity', 'minor'], tempDir)
      const { existsSync } = await import('node:fs')
      // Precondition
      expect(existsSync(join(tempDir, 'spec', 'issues', 'stale-issue.md'))).toBe(true)

      const { code } = await runCli(['fix-issue', '--remove-issue', 'stale-issue'], tempDir)
      expect(code).toBe(0)

      expect(existsSync(join(tempDir, 'spec', 'issues', 'resolved', 'stale-issue.md'))).toBe(true)
      expect(existsSync(join(tempDir, 'spec', 'issues', 'stale-issue.md'))).toBe(false)
    })

    it('--remove-issue errors with exit 4 on unknown slug', async () => {
      await installFixture(tempDir)
      const { stdout, code } = await runCli(['--json', 'fix-issue', '--remove-issue', 'does-not-exist'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.type).toBe('not_found')
    })

    it('--remove-issue commits the archive move', async () => {
      await installFixture(tempDir)
      await runCli(['issue', 'stale issue', '--severity', 'minor'], tempDir)
      const { code } = await runCli(['fix-issue', '--remove-issue', 'stale-issue'], tempDir)
      expect(code).toBe(0)
      const { stdout: log } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('fix(issues): remove resolved issue stale-issue')
    })
  })


  describe('branch-safety guard', () => {
    async function initAndCheckoutFeature(): Promise<void> {
      await installFixture(tempDir)
      const { execFile: ef } = await import('node:child_process')
      const { promisify: p } = await import('node:util')
      const exec = p(ef)
      await exec('git', ['checkout', '-b', 'metta/fix-foo'], { cwd: tempDir })
    }

    it('metta issue blocks on feature branch with code 4', async () => {
      await initAndCheckoutFeature()
      const { code, stderr } = await runCli(['issue', 'test issue'], tempDir)
      expect(code).toBe(4)
      expect(stderr).toContain('Refusing to write')
      expect(stderr).toContain('metta/fix-foo')
      expect(stderr).toContain('main')
    })

    it('metta issue allows with --on-branch override', async () => {
      await initAndCheckoutFeature()
      const { code } = await runCli(
        ['issue', 'override ok', '--on-branch', 'metta/fix-foo'],
        tempDir,
      )
      expect(code).toBe(0)
    })

    it('metta backlog add blocks on feature branch', async () => {
      await initAndCheckoutFeature()
      const { code, stderr } = await runCli(['backlog', 'add', 'test idea', '--new'], tempDir)
      expect(code).toBe(4)
      expect(stderr).toContain('Refusing to write')
    })

    it('metta backlog done blocks on feature branch', async () => {
      // Create a backlog entry on main first
      await installFixture(tempDir)
      await runCli(['backlog', 'add', 'shippable', '--new'], tempDir)
      // Switch to feature branch
      const { execFile: ef } = await import('node:child_process')
      const { promisify: p } = await import('node:util')
      const exec = p(ef)
      await exec('git', ['checkout', '-b', 'metta/fix-foo'], { cwd: tempDir })
      // Try done — should be blocked
      const { code, stderr } = await runCli(['backlog', 'done', 'shippable'], tempDir)
      expect(code).toBe(4)
      expect(stderr).toContain('Refusing to write')
    })

    it('metta backlog migrate blocks on feature branch', async () => {
      await initAndCheckoutFeature()
      const { stdout, code } = await runCli(['--json', 'backlog', 'migrate'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('branch_guard')
    })
  })


  describe('metta backlog add', () => {
    it('--new mints a type: idea entry in spec/issues/ with backlog frontmatter', async () => {
      await installFixture(tempDir)
      const { stdout, code } = await runCli(
        ['--json', 'backlog', 'add', 'Dark mode', '--new', '--priority', 'high'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.slug).toBe('dark-mode')
      expect(data.status).toBe('created')
      expect(data.type).toBe('idea')
      expect(data.committed).toBe(true)

      const content = await readFile(join(tempDir, 'spec', 'issues', 'dark-mode.md'), 'utf8')
      expect(content.startsWith('---\n')).toBe(true)
      expect(content).toContain('type: idea')
      expect(content).toContain('backlog: true')
      expect(content).toContain('priority: high')
      expect(content).toContain('# Dark mode')
      // No legacy backlog file is ever written.
      expect(existsSync(join(tempDir, 'spec', 'backlog', 'dark-mode.md'))).toBe(false)
    })

    it('--new --description populates the body; omitted description defaults to title', async () => {
      await installFixture(tempDir)
      await runCli(['backlog', 'add', 'Dark mode', '--new', '--description', 'Toggle in settings panel'], tempDir)
      const withDesc = await readFile(join(tempDir, 'spec', 'issues', 'dark-mode.md'), 'utf8')
      expect(withDesc).toContain('Toggle in settings panel')

      await runCli(['backlog', 'add', 'Light mode', '--new'], tempDir)
      const withoutDesc = await readFile(join(tempDir, 'spec', 'issues', 'light-mode.md'), 'utf8')
      expect(withoutDesc).toContain('# Light mode')
      expect(withoutDesc).toContain('Light mode')
    })

    it('existing issue slug is backlogged via frontmatter', async () => {
      await installFixture(tempDir)
      await runCli(['issue', 'gate runner swallows timeout', '--severity', 'major'], tempDir)

      const { stdout, code } = await runCli(
        ['--json', 'backlog', 'add', 'gate-runner-swallows-timeout', '--priority', 'medium', '--order', '2'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.slug).toBe('gate-runner-swallows-timeout')
      expect(data.status).toBe('backlogged')
      expect(data.type).toBe('issue')

      const content = await readFile(join(tempDir, 'spec', 'issues', 'gate-runner-swallows-timeout.md'), 'utf8')
      expect(content).toContain('backlog: true')
      expect(content).toContain('priority: medium')
      expect(content).toContain('order: 2')
      // Body preserved below the frontmatter.
      expect(content).toContain('# gate runner swallows timeout')
      expect(content).toContain('**Severity**: major')
    })

    it('re-adding an already backlogged slug reports already_backlogged with exit 0', async () => {
      await installFixture(tempDir)
      await runCli(['issue', 'flaky test', '--severity', 'minor'], tempDir)
      await runCli(['backlog', 'add', 'flaky-test', '--priority', 'low'], tempDir)

      const { stdout, code } = await runCli(['--json', 'backlog', 'add', 'flaky-test', '--priority', 'low'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.status).toBe('already_backlogged')
      expect(data.committed).toBe(false)
    })

    it('unresolved slug without --new exits 4 naming the slug and suggesting --new', async () => {
      await installFixture(tempDir)
      const { stdout, code } = await runCli(['--json', 'backlog', 'add', 'ghost-item'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('not_found')
      expect(data.error.message).toContain('ghost-item')
      expect(data.error.message).toContain('--new')
      // Never silently mints from a typo.
      expect(existsSync(join(tempDir, 'spec', 'issues', 'ghost-item.md'))).toBe(false)
    })

    it('invalid --priority exits 4 naming allowed values', async () => {
      await installFixture(tempDir)
      const { stdout, code } = await runCli(
        ['--json', 'backlog', 'add', 'Some idea', '--new', '--priority', 'urgent'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('invalid_priority')
      expect(data.error.message).toContain('high, medium, low')
      expect(existsSync(join(tempDir, 'spec', 'issues', 'some-idea.md'))).toBe(false)
    })
  })


  describe('metta backlog list', () => {
    it('lists only backlog entries sorted by priority; never reads spec/backlog/', async () => {
      await installFixture(tempDir)
      // A plain issue (backlog: false) must not appear.
      await runCli(['issue', 'plain issue', '--severity', 'minor'], tempDir)
      await runCli(['backlog', 'add', 'Low idea', '--new', '--priority', 'low'], tempDir)
      await runCli(['backlog', 'add', 'High idea', '--new', '--priority', 'high'], tempDir)
      await runCli(['backlog', 'add', 'No priority idea', '--new'], tempDir)
      // A stray legacy file must be invisible to the view.
      await mkdir(join(tempDir, 'spec', 'backlog'), { recursive: true })
      await writeFile(join(tempDir, 'spec', 'backlog', 'legacy-item.md'), '# Legacy item\n', 'utf8')

      const { stdout, code } = await runCli(['--json', 'backlog', 'list'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout) as { backlog: Array<Record<string, unknown>> }
      expect(data.backlog.map((e) => e.slug)).toEqual(['high-idea', 'low-idea', 'no-priority-idea'])
      expect(data.backlog[0]).toMatchObject({
        slug: 'high-idea',
        title: 'High idea',
        type: 'idea',
        priority: 'high',
        order: null,
        milestone: null,
      })
      expect(data.backlog[2]).toMatchObject({ priority: null })
      expect(data.backlog.some((e) => e.slug === 'plain-issue')).toBe(false)
      expect(data.backlog.some((e) => e.slug === 'legacy-item')).toBe(false)

      const textRes = await runCli(['backlog', 'list'], tempDir)
      expect(textRes.code).toBe(0)
      expect(textRes.stdout).toMatch(/\[high\] high-idea/)
      expect(textRes.stdout).toMatch(/\[none\] no-priority-idea/)
    })

    it('empty backlog renders the friendly state', async () => {
      await installFixture(tempDir)
      const { stdout, code } = await runCli(['backlog', 'list'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('Backlog is empty.')
    })
  })


  describe('metta backlog show', () => {
    it('renders title, type, backlog fields and body', async () => {
      await installFixture(tempDir)
      await runCli(
        ['backlog', 'add', 'Dark mode', '--new', '--description', 'Toggle in settings panel', '--priority', 'high'],
        tempDir,
      )

      const { stdout, code } = await runCli(['--json', 'backlog', 'show', 'dark-mode'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data).toMatchObject({
        slug: 'dark-mode',
        title: 'Dark mode',
        type: 'idea',
        backlog: true,
        priority: 'high',
      })
      expect(data.description).toContain('Toggle in settings panel')

      const textRes = await runCli(['backlog', 'show', 'dark-mode'], tempDir)
      expect(textRes.code).toBe(0)
      expect(textRes.stdout).toContain('# Dark mode')
      expect(textRes.stdout).toContain('Type: idea')
      expect(textRes.stdout).toContain('Toggle in settings panel')
    })

    it('unknown slug exits 4 with not_found', async () => {
      await installFixture(tempDir)
      const { stdout, code } = await runCli(['--json', 'backlog', 'show', 'ghost-item'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('not_found')
    })
  })


  describe('metta backlog promote', () => {
    it('emits the fix-issues handoff and performs zero writes', async () => {
      await installFixture(tempDir)
      await runCli(['backlog', 'add', 'Dark mode', '--new'], tempDir)
      const path = join(tempDir, 'spec', 'issues', 'dark-mode.md')
      const before = await readFile(path, 'utf8')

      const jsonRes = await runCli(['--json', 'backlog', 'promote', 'dark-mode'], tempDir)
      expect(jsonRes.code).toBe(0)
      expect(JSON.parse(jsonRes.stdout)).toMatchObject({
        promoted: 'dark-mode',
        message: 'Run: /metta-fix-issues dark-mode',
      })

      const textRes = await runCli(['backlog', 'promote', 'dark-mode'], tempDir)
      expect(textRes.code).toBe(0)
      expect(textRes.stdout).toContain("Promote 'dark-mode' by running: /metta-fix-issues dark-mode")

      // Zero writes: the issue file is byte-identical and still present.
      expect(await readFile(path, 'utf8')).toBe(before)
    })

    it('unknown slug exits 4 with not_found', async () => {
      await installFixture(tempDir)
      const { stdout, code } = await runCli(['--json', 'backlog', 'promote', 'ghost-item'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('not_found')
    })
  })


  describe('metta backlog done', () => {
    it('happy path — archives to spec/issues/resolved/, --json reports archived slug', async () => {
      await installFixture(tempDir)
      await runCli(['backlog', 'add', 'foo', '--new', '--priority', 'medium'], tempDir)

      const { stdout, code } = await runCli(['--json', 'backlog', 'done', 'foo'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.archived).toBe('foo')

      expect(existsSync(join(tempDir, 'spec', 'issues', 'resolved', 'foo.md'))).toBe(true)
      expect(existsSync(join(tempDir, 'spec', 'issues', 'foo.md'))).toBe(false)
    })

    it('--change stamps Shipped-in metadata and preserves frontmatter in the archived file', async () => {
      await installFixture(tempDir)
      await runCli(['backlog', 'add', 'bar', '--new', '--priority', 'low'], tempDir)

      const { code } = await runCli(['backlog', 'done', 'bar', '--change', 'my-change'], tempDir)
      expect(code).toBe(0)

      const archived = await readFile(join(tempDir, 'spec', 'issues', 'resolved', 'bar.md'), 'utf8')
      expect(archived).toContain('**Shipped-in**: my-change')
      // Frontmatter carried through end to end.
      expect(archived).toContain('type: idea')
      expect(archived).toContain('priority: low')
    })

    it('unknown slug exits 4 with not_found error', async () => {
      await installFixture(tempDir)
      const { stdout, code } = await runCli(['--json', 'backlog', 'done', 'does-not-exist'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('not_found')
    })

    it('hostile --change value exits 4 with invalid_change error', async () => {
      await installFixture(tempDir)
      await runCli(['backlog', 'add', 'baz', '--new'], tempDir)

      const { stdout, code } = await runCli(
        ['--json', 'backlog', 'done', 'baz', '--change', '../../etc/passwd'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('invalid_change')
    })

    it('commits archive with conventional message staging spec/issues and spec/issues/resolved', async () => {
      await installFixture(tempDir)
      await runCli(['backlog', 'add', 'qux', '--new'], tempDir)

      const { code } = await runCli(['backlog', 'done', 'qux'], tempDir)
      expect(code).toBe(0)

      const { stdout: log } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('chore: archive shipped backlog item qux')

      // Commit must move the file from spec/issues/ to spec/issues/resolved/.
      // Git detects this as a rename (R) or separate D + A lines — either way
      // both paths appear on the status output, proving both sides were staged.
      const { stdout: status } = await execAsync(
        'git', ['show', '--name-status', '--format=', 'HEAD'], { cwd: tempDir },
      )
      expect(status).toMatch(/spec\/issues\/qux\.md/)
      expect(status).toMatch(/spec\/issues\/resolved\/qux\.md/)
    })
  })


  describe('metta backlog migrate', () => {
    async function seedLegacyBacklog(): Promise<void> {
      await mkdir(join(tempDir, 'spec', 'backlog', 'done'), { recursive: true })
      await writeFile(
        join(tempDir, 'spec', 'backlog', 'dark-mode.md'),
        '# Dark mode\n\n**Added**: 2026-01-05\n**Priority**: high\n\nToggle in settings panel\n',
        'utf8',
      )
      await writeFile(
        join(tempDir, 'spec', 'backlog', 'done', 'old-thing.md'),
        '# Old thing\n\n**Added**: 2025-11-01\n\nAlready shipped.\n',
        'utf8',
      )
    }

    it('converts active and done items, archives originals, commits, and reports JSON', async () => {
      await installFixture(tempDir)
      await seedLegacyBacklog()

      const { stdout, code } = await runCli(['--json', 'backlog', 'migrate'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.nothing_to_do).toBe(false)
      expect(data.converted).toEqual({ active: 1, done: 1 })
      expect(data.collisions).toEqual([])
      expect(data.archived_to).toBe('spec/archive/backlog-legacy')
      expect(data.committed).toBe(true)
      expect(data.commit_sha).toBeTruthy()

      // Active item → spec/issues/ with idea/backlog/priority frontmatter.
      const active = await readFile(join(tempDir, 'spec', 'issues', 'dark-mode.md'), 'utf8')
      expect(active).toContain('type: idea')
      expect(active).toContain('backlog: true')
      expect(active).toContain('priority: high')
      expect(active).toContain('Toggle in settings panel')
      // Done item → spec/issues/resolved/ with type: idea only.
      const done = await readFile(join(tempDir, 'spec', 'issues', 'resolved', 'old-thing.md'), 'utf8')
      expect(done).toContain('type: idea')
      expect(done).not.toContain('backlog: true')
      // Originals renamed to the provenance archive; legacy dirs removed.
      expect(existsSync(join(tempDir, 'spec', 'archive', 'backlog-legacy', 'dark-mode.md'))).toBe(true)
      expect(existsSync(join(tempDir, 'spec', 'archive', 'backlog-legacy', 'done', 'old-thing.md'))).toBe(true)
      expect(existsSync(join(tempDir, 'spec', 'backlog'))).toBe(false)

      const { stdout: log } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('chore: migrate legacy backlog to issue store')

      // Migrated ideas appear in the backlog view.
      const list = await runCli(['--json', 'backlog', 'list'], tempDir)
      const listData = JSON.parse(list.stdout) as { backlog: Array<{ slug: string }> }
      expect(listData.backlog.some((e) => e.slug === 'dark-mode')).toBe(true)
    })

    it('second run is a derived no-op: nothing_to_do true, no commit', async () => {
      await installFixture(tempDir)
      await seedLegacyBacklog()
      await runCli(['backlog', 'migrate'], tempDir)

      const { stdout, code } = await runCli(['--json', 'backlog', 'migrate'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.nothing_to_do).toBe(true)
      expect(data.converted).toEqual({ active: 0, done: 0 })
      expect(data.committed).toBe(false)
    })

    it('collisions are reported, never overwritten, exit 0', async () => {
      await installFixture(tempDir)
      await seedLegacyBacklog()
      // Pre-existing issue with the same slug as the legacy active item.
      await runCli(['issue', 'dark mode', '--severity', 'minor'], tempDir)
      const existingBefore = await readFile(join(tempDir, 'spec', 'issues', 'dark-mode.md'), 'utf8')

      const { stdout, code } = await runCli(['--json', 'backlog', 'migrate'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.converted).toEqual({ active: 0, done: 1 })
      expect(data.collisions).toEqual([
        {
          slug: 'dark-mode',
          legacy_path: 'spec/backlog/dark-mode.md',
          existing_path: 'spec/issues/dark-mode.md',
        },
      ])

      // Neither side touched: existing issue byte-identical, legacy straggler kept.
      expect(await readFile(join(tempDir, 'spec', 'issues', 'dark-mode.md'), 'utf8')).toBe(existingBefore)
      expect(existsSync(join(tempDir, 'spec', 'backlog', 'dark-mode.md'))).toBe(true)
    })
  })


  describe('metta check-constitution', () => {
    async function runCliWithEnv(
      args: string[],
      cwd: string,
      env: NodeJS.ProcessEnv,
    ): Promise<{ stdout: string; stderr: string; code: number }> {
      try {
        const { stdout, stderr } = await execAsync(
          'npx',
          ['tsx', CLI_PATH, ...args],
          { cwd, timeout: 30000, env },
        )
        return { stdout, stderr, code: 0 }
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; code?: number }
        return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
      }
    }

    const PROJECT_MD = [
      '# Project',
      '',
      '## Conventions',
      '',
      '- Validate all state and config with Zod schemas',
      '',
      '## Off-Limits',
      '',
      '- No singletons',
      '- No `--force` pushes',
      '',
    ].join('\n')

    async function createChangeFixture(slug: string): Promise<void> {
      await mkdir(join(tempDir, 'spec', 'changes', slug), { recursive: true })
      await writeFile(join(tempDir, 'spec', 'project.md'), PROJECT_MD, 'utf8')
      await writeFile(
        join(tempDir, 'spec', 'changes', slug, 'spec.md'),
        '# Spec\n\n## Overview\nFixture change for check-constitution.\n',
        'utf8',
      )
    }

    function envWithoutApiKey(): NodeJS.ProcessEnv {
      const env: NodeJS.ProcessEnv = {}
      for (const [k, v] of Object.entries(process.env)) {
        if (k !== 'ANTHROPIC_API_KEY' && v !== undefined) env[k] = v
      }
      return env
    }

    it('errors with exit 4 on missing change', async () => {
      await installFixture(tempDir)
      const { stdout, code } = await runCli(
        ['--json', 'check-constitution', '--change', 'does-not-exist'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.type).toBe('check_constitution_error')
      expect(data.error.message.length).toBeGreaterThan(0)
    })

    it('emits the check contract with no ANTHROPIC_API_KEY set (emission mode)', async () => {
      await installFixture(tempDir)
      await createChangeFixture('probe-change')
      const { stdout, code } = await runCliWithEnv(
        ['--json', 'check-constitution', '--change', 'probe-change'],
        tempDir,
        envWithoutApiKey(),
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.articles.conventions).toEqual([
        'Validate all state and config with Zod schemas',
      ])
      expect(data.articles.offLimits).toEqual(['No singletons', 'No `--force` pushes'])
      expect(data.spec_path).toContain(join('spec', 'changes', 'probe-change', 'spec.md'))
      expect(data.spec_content).toContain('Fixture change for check-constitution.')
      expect(data.verdict_schema).toContain('violations')
      expect(data.instructions.length).toBeGreaterThan(0)
      // output_path is absolute — anchored at the invoking checkout's scratch dir.
      expect(data.output_path).toBe(join(tempDir, '.metta', 'scratch', 'probe-change', 'verdict.json'))
    })

    it('records a clean verdict and exits 0', async () => {
      await installFixture(tempDir)
      await createChangeFixture('probe-change')
      const verdictFile = join(tempDir, 'verdict.json')
      await writeFile(verdictFile, '{"violations":[]}', 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'check-constitution', '--change', 'probe-change', '--record', verdictFile],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      // violations_path is absolute and change-rooted.
      expect(data.violations_path).toBe(join(tempDir, 'spec', 'changes', 'probe-change', 'violations.md'))
      const md = await readFile(data.violations_path, 'utf8')
      expect(md).toContain('No violations found.')
    })

    it('records a blocking verdict and exits 4', async () => {
      await installFixture(tempDir)
      await createChangeFixture('probe-change')
      const verdictFile = join(tempDir, 'verdict.json')
      await writeFile(
        verdictFile,
        JSON.stringify({
          violations: [
            {
              article: 'No singletons',
              severity: 'critical',
              evidence: 'shared singleton across modules',
              suggestion: 'inject the dependency',
            },
          ],
        }),
        'utf8',
      )
      const { stdout, code } = await runCli(
        ['--json', 'check-constitution', '--change', 'probe-change', '--record', verdictFile],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.blocking).toBe(true)
      const md = await readFile(data.violations_path, 'utf8')
      expect(md).toContain('BLOCKING')
    })

    it('rejects malformed verdict JSON with exit 4 and does not write violations.md', async () => {
      await installFixture(tempDir)
      await createChangeFixture('malformed-change')
      const verdictFile = join(tempDir, 'verdict.json')
      await writeFile(verdictFile, 'this is not JSON at all', 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'check-constitution', '--change', 'malformed-change', '--record', verdictFile],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('verdict_validation_error')
      expect(existsSync(join(tempDir, 'spec/changes/malformed-change/violations.md'))).toBe(false)
    })

    it('--help shows the command description', async () => {
      const { stdout, code } = await runCli(['check-constitution', '--help'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('check-constitution')
      expect(stdout.toLowerCase()).toContain('constitution')
      expect(stdout).toContain('--change')
      expect(stdout).toContain('--record')
    })

    it('is registered in the main help listing', async () => {
      const { stdout, code } = await runCli(['--help'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('check-constitution')
    })
  })

})
