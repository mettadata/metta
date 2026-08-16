import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, execAsync, installFixture } from './helpers/cli.js'
import { createCliContext } from '../src/cli/helpers.js'
import { loadMilestoneRollups } from '../src/cli/commands/milestone.js'

/** Seed a frontmatter-bearing issue file referencing a milestone slug. */
async function seedIssue(
  dir: string,
  slug: string,
  title: string,
  milestone: string,
  opts: { resolved?: boolean } = {},
): Promise<void> {
  const relDir = opts.resolved
    ? join(dir, 'spec', 'issues', 'resolved')
    : join(dir, 'spec', 'issues')
  await mkdir(relDir, { recursive: true })
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
  await writeFile(join(relDir, `${slug}.md`), content, 'utf8')
}

describe('CLI: milestone create / list / show', { timeout: 60000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  describe('metta milestone create', () => {
    it('creates a milestone file and reports JSON shape with commit', async () => {
      await installFixture(tempDir)
      const { stdout, code } = await runCli(
        ['--json', 'milestone', 'create', 'v0-6', '--name', 'v0.6', '--target', '2026-09-30', '--description', 'Backlog unification release'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.slug).toBe('v0-6')
      expect(data.created).toBe(true)
      expect(data.committed).toBe(true)
      expect(data.commit_sha).toBeTruthy()

      expect(existsSync(join(tempDir, 'spec', 'milestones', 'v0-6.md'))).toBe(true)
      const { stdout: log } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('chore: create milestone v0-6')
    })

    it('text mode reports the created slug', async () => {
      await installFixture(tempDir)
      const { stdout, code } = await runCli(
        ['milestone', 'create', 'v0-7', '--name', 'v0.7'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stdout).toContain('Created milestone: v0-7')
    })

    it('duplicate create exits 4 with milestone_exists', async () => {
      await installFixture(tempDir)
      await runCli(['milestone', 'create', 'v0-6', '--name', 'v0.6'], tempDir)
      const { stdout, code } = await runCli(
        ['--json', 'milestone', 'create', 'v0-6', '--name', 'again'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.type).toBe('milestone_exists')
      expect(data.error.message).toContain('v0-6')
    })

    it('blocks on a feature branch with branch_guard', async () => {
      await installFixture(tempDir)
      await execAsync('git', ['checkout', '-b', 'metta/feature'], { cwd: tempDir })
      const { stdout, code } = await runCli(
        ['--json', 'milestone', 'create', 'v0-8', '--name', 'v0.8'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('branch_guard')
    })
  })

  describe('metta milestone list', () => {
    it('JSON is counts-only with no milestone_warnings key when clean', async () => {
      await installFixture(tempDir)
      await runCli(['milestone', 'create', 'v0-6', '--name', 'v0.6', '--target', '2026-09-30'], tempDir)
      await seedIssue(tempDir, 'gate-runner-swallows-timeout', 'Gate runner swallows timeout', 'v0-6')
      await seedIssue(tempDir, 'config-drift', 'Config drift', 'v0-6', { resolved: true })

      const { stdout, code } = await runCli(['--json', 'milestone', 'list'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.milestones).toHaveLength(1)
      const row = data.milestones[0]
      expect(row.slug).toBe('v0-6')
      expect(row.name).toBe('v0.6')
      expect(row.status).toBe('open')
      expect(row.target).toBe('2026-09-30')
      expect(row.open).toBe(1)
      expect(row.resolved).toBe(1)
      expect(row.total).toBe(2)
      expect(row.percent).toBe(50)
      // Counts only — per-issue detail is show-exclusive.
      expect(row.openIssues).toBeUndefined()
      expect(row.resolvedIssues).toBeUndefined()
      expect(data.milestone_warnings).toBeUndefined()
    })

    it('text mode renders rollup lines', async () => {
      await installFixture(tempDir)
      await runCli(['milestone', 'create', 'v0-6', '--name', 'v0.6', '--target', '2026-09-30'], tempDir)
      await seedIssue(tempDir, 'gate-runner-swallows-timeout', 'Gate runner swallows timeout', 'v0-6')
      await seedIssue(tempDir, 'config-drift', 'Config drift', 'v0-6', { resolved: true })

      const { stdout, code } = await runCli(['milestone', 'list'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('v0-6')
      expect(stdout).toContain('1/2 resolved (50%)')
      expect(stdout).toContain('target 2026-09-30')
    })

    it('surfaces dangling milestone references as warnings with exit 0', async () => {
      await installFixture(tempDir)
      await runCli(['milestone', 'create', 'v0-6', '--name', 'v0.6'], tempDir)
      await seedIssue(tempDir, 'stray-issue', 'Stray issue', 'v9-9')

      const jsonRun = await runCli(['--json', 'milestone', 'list'], tempDir)
      expect(jsonRun.code).toBe(0)
      const data = JSON.parse(jsonRun.stdout)
      expect(data.milestone_warnings).toHaveLength(1)
      expect(data.milestone_warnings[0]).toContain('stray-issue')
      expect(data.milestone_warnings[0]).toContain('v9-9')

      // Text mode mirrors the warning to stderr, still exit 0.
      const textRun = await runCli(['milestone', 'list'], tempDir)
      expect(textRun.code).toBe(0)
      expect(textRun.stderr).toContain('v9-9')
    })

    it('reports empty when no milestones exist', async () => {
      await installFixture(tempDir)
      const { stdout, code } = await runCli(['--json', 'milestone', 'list'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.milestones).toEqual([])
      expect(data.milestone_warnings).toBeUndefined()

      const textRun = await runCli(['milestone', 'list'], tempDir)
      expect(textRun.code).toBe(0)
      expect(textRun.stdout).toContain('No milestones.')
    })
  })

  describe('metta milestone show', () => {
    it('JSON carries per-issue detail with states', async () => {
      await installFixture(tempDir)
      await runCli(
        ['milestone', 'create', 'v0-6', '--name', 'v0.6', '--target', '2026-09-30', '--description', 'Unification release'],
        tempDir,
      )
      await seedIssue(tempDir, 'gate-runner-swallows-timeout', 'Gate runner swallows timeout', 'v0-6')
      await seedIssue(tempDir, 'config-drift', 'Config drift', 'v0-6', { resolved: true })

      const { stdout, code } = await runCli(['--json', 'milestone', 'show', 'v0-6'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.slug).toBe('v0-6')
      expect(data.name).toBe('v0.6')
      expect(data.status).toBe('open')
      expect(data.target).toBe('2026-09-30')
      expect(data.description).toBe('Unification release')
      expect(data.open).toBe(1)
      expect(data.resolved).toBe(1)
      expect(data.total).toBe(2)
      expect(data.percent).toBe(50)
      expect(data.issues).toEqual([
        { slug: 'gate-runner-swallows-timeout', title: 'Gate runner swallows timeout', state: 'open' },
        { slug: 'config-drift', title: 'Config drift', state: 'resolved' },
      ])
    })

    it('text mode renders name, progress, and issue states', async () => {
      await installFixture(tempDir)
      await runCli(['milestone', 'create', 'v0-6', '--name', 'v0.6'], tempDir)
      await seedIssue(tempDir, 'gate-runner-swallows-timeout', 'Gate runner swallows timeout', 'v0-6')

      const { stdout, code } = await runCli(['milestone', 'show', 'v0-6'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('# v0.6')
      expect(stdout).toContain('Status: open')
      expect(stdout).toContain('Progress: 0/1 resolved (0%)')
      expect(stdout).toContain('[open]')
      expect(stdout).toContain('gate-runner-swallows-timeout')
    })

    it('zero-issue milestone exits 0 with empty issues and 0/0 at 0%', async () => {
      await installFixture(tempDir)
      await runCli(['milestone', 'create', 'empty-ms', '--name', 'Empty'], tempDir)
      const { stdout, code } = await runCli(['--json', 'milestone', 'show', 'empty-ms'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.issues).toEqual([])
      expect(data.open).toBe(0)
      expect(data.resolved).toBe(0)
      expect(data.total).toBe(0)
      expect(data.percent).toBe(0)
    })

    it('unknown slug exits 4 with not_found', async () => {
      await installFixture(tempDir)
      const { stdout, code } = await runCli(['--json', 'milestone', 'show', 'does-not-exist'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.type).toBe('not_found')
      expect(data.error.message).toContain('does-not-exist')
    })
  })

  describe('loadMilestoneRollups', () => {
    it('returns null when spec/milestones/ has no milestone files', async () => {
      await mkdir(join(tempDir, 'spec', 'issues'), { recursive: true })
      const ctx = createCliContext(tempDir)
      expect(await loadMilestoneRollups(ctx)).toBeNull()

      // An empty directory (no .md files) is also the null signal.
      await mkdir(join(tempDir, 'spec', 'milestones'), { recursive: true })
      expect(await loadMilestoneRollups(ctx)).toBeNull()
    })

    it('returns rollups and warnings when milestone files exist', async () => {
      await mkdir(join(tempDir, 'spec', 'milestones'), { recursive: true })
      await writeFile(
        join(tempDir, 'spec', 'milestones', 'v0-6.md'),
        '---\nname: v0.6\n---\nDescription.\n',
        'utf8',
      )
      await seedIssue(tempDir, 'gate-runner-swallows-timeout', 'Gate runner swallows timeout', 'v0-6')
      await seedIssue(tempDir, 'stray-issue', 'Stray issue', 'v9-9')

      const ctx = createCliContext(tempDir)
      const loaded = await loadMilestoneRollups(ctx)
      expect(loaded).not.toBeNull()
      expect(loaded?.rollups).toHaveLength(1)
      expect(loaded?.rollups[0].slug).toBe('v0-6')
      expect(loaded?.rollups[0].open).toBe(1)
      expect(loaded?.rollups[0].total).toBe(1)
      expect(loaded?.warnings).toHaveLength(1)
      expect(loaded?.warnings[0]).toContain('v9-9')
    })
  })
})
