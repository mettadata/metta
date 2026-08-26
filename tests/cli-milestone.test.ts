import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
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

    it('text mode keeps columns aligned across ▸ / ✓ / ✗ markers', async () => {
      await installFixture(tempDir)
      await runCli(['milestone', 'create', 'a-open', '--name', 'Open one'], tempDir)
      await runCli(['milestone', 'create', 'b-closed', '--name', 'Closed one'], tempDir)
      await runCli(['milestone', 'create', 'c-abandoned', '--name', 'Abandoned one'], tempDir)
      await runCli(['milestone', 'close', 'b-closed'], tempDir)
      await runCli(['milestone', 'close', 'c-abandoned', '--abandoned'], tempDir)

      const { stdout, code } = await runCli(['milestone', 'list'], tempDir)
      expect(code).toBe(0)
      const lines = stdout.split('\n').filter((l) => l.trim().length > 0)
      expect(lines).toHaveLength(3)

      const markers = lines.map((l) => l.trim()[0])
      expect(markers).toContain('▸')
      expect(markers).toContain('✓')
      expect(markers).toContain('✗')

      // Every marker is a single UTF-16 unit at the same column, and the
      // padEnd(30) slug column keeps the counts column aligned.
      const slugStarts = lines.map((l) => l.search(/[a-z]/))
      expect(new Set(slugStarts).size).toBe(1)
      const countStarts = lines.map((l) => l.search(/\d+\/\d+ resolved/))
      expect(new Set(countStarts).size).toBe(1)
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

  describe('metta milestone close', () => {
    it('closes an open milestone: frontmatter, commit message, JSON shape', async () => {
      await installFixture(tempDir)
      await runCli(['milestone', 'create', 'v0-6', '--name', 'v0.6'], tempDir)

      const { stdout, code } = await runCli(['--json', 'milestone', 'close', 'v0-6'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.slug).toBe('v0-6')
      expect(data.status).toBe('closed')
      expect(data.committed).toBe(true)
      expect(data.commit_sha).toBeTruthy()

      const file = await readFile(join(tempDir, 'spec', 'milestones', 'v0-6.md'), 'utf8')
      expect(file).toContain('status: closed')
      const { stdout: log } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('chore: close milestone v0-6')
    })

    it('--abandoned writes abandoned with the same commit message', async () => {
      await installFixture(tempDir)
      await runCli(['milestone', 'create', 'v0-6', '--name', 'v0.6'], tempDir)

      const { stdout, code } = await runCli(['--json', 'milestone', 'close', 'v0-6', '--abandoned'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.status).toBe('abandoned')

      const file = await readFile(join(tempDir, 'spec', 'milestones', 'v0-6.md'), 'utf8')
      expect(file).toContain('status: abandoned')
      const { stdout: log } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('chore: close milestone v0-6')
    })

    it('text mode reports Closed / Abandoned respectively', async () => {
      await installFixture(tempDir)
      await runCli(['milestone', 'create', 'a-ms', '--name', 'A'], tempDir)
      await runCli(['milestone', 'create', 'b-ms', '--name', 'B'], tempDir)

      const closed = await runCli(['milestone', 'close', 'a-ms'], tempDir)
      expect(closed.code).toBe(0)
      expect(closed.stdout).toContain('Closed milestone: a-ms')

      const abandoned = await runCli(['milestone', 'close', 'b-ms', '--abandoned'], tempDir)
      expect(abandoned.code).toBe(0)
      expect(abandoned.stdout).toContain('Abandoned milestone: b-ms')
    })

    it('already-closed milestone exits 4 with milestone_conflict and a byte-identical file', async () => {
      await installFixture(tempDir)
      await runCli(['milestone', 'create', 'v0-6', '--name', 'v0.6'], tempDir)
      await runCli(['milestone', 'close', 'v0-6'], tempDir)

      const milestonePath = join(tempDir, 'spec', 'milestones', 'v0-6.md')
      const bytesBefore = await readFile(milestonePath)

      const { stdout, code } = await runCli(['--json', 'milestone', 'close', 'v0-6'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.type).toBe('milestone_conflict')
      expect(data.error.message).toBe("Milestone 'v0-6' is already closed")

      const bytesAfter = await readFile(milestonePath)
      expect(bytesAfter.equals(bytesBefore)).toBe(true)
    })

    it('missing slug exits 4 with not_found and creates no file', async () => {
      await installFixture(tempDir)
      const { stdout, code } = await runCli(['--json', 'milestone', 'close', 'does-not-exist'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('not_found')
      expect(data.error.message).toContain('does-not-exist')
      expect(existsSync(join(tempDir, 'spec', 'milestones', 'does-not-exist.md'))).toBe(false)
    })

    it('blocks on a feature branch with branch_guard without --on-branch', async () => {
      await installFixture(tempDir)
      await runCli(['milestone', 'create', 'v0-6', '--name', 'v0.6'], tempDir)
      await execAsync('git', ['checkout', '-b', 'metta/feature'], { cwd: tempDir })
      const { stdout, code } = await runCli(['--json', 'milestone', 'close', 'v0-6'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('branch_guard')
    })
  })

  describe('metta milestone update', () => {
    it('--description replaces the body only', async () => {
      await installFixture(tempDir)
      await runCli(
        ['milestone', 'create', 'v0-6', '--name', 'v0.6', '--target', '2026-09-30', '--description', 'Old body'],
        tempDir,
      )

      const { stdout, code } = await runCli(
        ['--json', 'milestone', 'update', 'v0-6', '--description', 'New body'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.slug).toBe('v0-6')
      expect(data.changed).toEqual(['description'])
      expect(data.committed).toBe(true)

      const file = await readFile(join(tempDir, 'spec', 'milestones', 'v0-6.md'), 'utf8')
      expect(file).toContain('name: v0.6')
      expect(file).toContain('target: 2026-09-30')
      expect(file).toContain('status: open')
      expect(file).toContain('New body')
      expect(file).not.toContain('Old body')
      const { stdout: log } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('chore: update milestone v0-6')
    })

    it('--clear-target removes the target key and reports changed: [target]', async () => {
      await installFixture(tempDir)
      await runCli(['milestone', 'create', 'v0-6', '--name', 'v0.6', '--target', '2026-09-30'], tempDir)

      const { stdout, code } = await runCli(['--json', 'milestone', 'update', 'v0-6', '--clear-target'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.changed).toEqual(['target'])

      const file = await readFile(join(tempDir, 'spec', 'milestones', 'v0-6.md'), 'utf8')
      expect(file).not.toContain('target:')
    })

    it('--status open reopens a closed milestone', async () => {
      await installFixture(tempDir)
      await runCli(['milestone', 'create', 'v0-6', '--name', 'v0.6'], tempDir)
      await runCli(['milestone', 'close', 'v0-6'], tempDir)

      const { stdout, code } = await runCli(['--json', 'milestone', 'update', 'v0-6', '--status', 'open'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.changed).toEqual(['status'])

      const show = await runCli(['--json', 'milestone', 'show', 'v0-6'], tempDir)
      expect(JSON.parse(show.stdout).status).toBe('open')
    })

    it('invalid target date exits 4 naming target with a byte-identical file', async () => {
      await installFixture(tempDir)
      await runCli(['milestone', 'create', 'v0-6', '--name', 'v0.6', '--target', '2026-09-30'], tempDir)
      const milestonePath = join(tempDir, 'spec', 'milestones', 'v0-6.md')
      const bytesBefore = await readFile(milestonePath)

      const { stdout, code } = await runCli(
        ['--json', 'milestone', 'update', 'v0-6', '--target', '2026-02-30'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.type).toBe('milestone_error')
      expect(data.error.message).toContain('target')

      const bytesAfter = await readFile(milestonePath)
      expect(bytesAfter.equals(bytesBefore)).toBe(true)
    })

    it('missing slug exits 4 with not_found', async () => {
      await installFixture(tempDir)
      const { stdout, code } = await runCli(
        ['--json', 'milestone', 'update', 'does-not-exist', '--name', 'New'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('not_found')
      expect(data.error.message).toContain('does-not-exist')
    })

    it('zero field options exits 4 with the file untouched', async () => {
      await installFixture(tempDir)
      await runCli(['milestone', 'create', 'v0-6', '--name', 'v0.6'], tempDir)
      const milestonePath = join(tempDir, 'spec', 'milestones', 'v0-6.md')
      const bytesBefore = await readFile(milestonePath)

      const { stdout, code } = await runCli(['--json', 'milestone', 'update', 'v0-6'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('milestone_error')
      expect(data.error.message).toBe(
        'At least one field option is required (--name, --target, --clear-target, --description, --status)',
      )

      const bytesAfter = await readFile(milestonePath)
      expect(bytesAfter.equals(bytesBefore)).toBe(true)
    })

    it('--target with --clear-target is rejected by Commander', async () => {
      await installFixture(tempDir)
      await runCli(['milestone', 'create', 'v0-6', '--name', 'v0.6'], tempDir)
      const { stderr, code } = await runCli(
        ['milestone', 'update', 'v0-6', '--target', '2026-09-30', '--clear-target'],
        tempDir,
      )
      expect(code).not.toBe(0)
      expect(code).not.toBe(4)
      expect(stderr).toContain('cannot be used with')
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

    it('sanitizes hostile issue titles in text output without rewriting the file', async () => {
      await installFixture(tempDir)
      await runCli(['milestone', 'create', 'v0-6', '--name', 'v0.6'], tempDir)
      // ANSI CSI color sequences plus a raw BEL control byte in the title.
      const hostileTitle = '\x1b[31mEVIL\x1b[0m title\x07 end'
      await seedIssue(tempDir, 'hostile-issue', hostileTitle, 'v0-6')

      const issuePath = join(tempDir, 'spec', 'issues', 'hostile-issue.md')
      const bytesBefore = await readFile(issuePath)

      const { stdout, code } = await runCli(['milestone', 'show', 'v0-6'], tempDir)
      expect(code).toBe(0)
      // Printable text survives, control sequences do not.
      expect(stdout).toContain('EVIL title end')
      expect(stdout).not.toContain('\x1b')
      // No control bytes at all beyond structural newlines.
      // eslint-disable-next-line no-control-regex
      expect(stdout).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/)

      // Render is read-only: the issue file on disk is byte-identical.
      const bytesAfter = await readFile(issuePath)
      expect(bytesAfter.equals(bytesBefore)).toBe(true)
    })

    it('reports the abandoned state accurately in both modes', async () => {
      await installFixture(tempDir)
      await runCli(['milestone', 'create', 'v0-6', '--name', 'v0.6'], tempDir)
      const closed = await runCli(['--json', 'milestone', 'close', 'v0-6', '--abandoned'], tempDir)
      expect(closed.code).toBe(0)
      expect(JSON.parse(closed.stdout).status).toBe('abandoned')

      const text = await runCli(['milestone', 'show', 'v0-6'], tempDir)
      expect(text.code).toBe(0)
      expect(text.stdout).toContain('Status: abandoned')

      const json = await runCli(['--json', 'milestone', 'show', 'v0-6'], tempDir)
      expect(json.code).toBe(0)
      expect(JSON.parse(json.stdout).status).toBe('abandoned')
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
