import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, execAsync, installFixture } from './helpers/cli.js'

describe('CLI: roadmap', { timeout: 300000 }, () => {
  let tempDir: string

  const roadmapPath = (): string => join(tempDir, 'spec', 'roadmap.md')

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-roadmap-'))
    await installFixture(tempDir)
  }, 60000)

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  // Backlog entries live in the issue store: `backlog add --new` mints a
  // `type: idea` file under spec/issues/.
  async function seedBacklog(title: string): Promise<string> {
    const res = await runCli(['--json', 'backlog', 'add', title, '--new'], tempDir)
    expect(res.code).toBe(0)
    return (JSON.parse(res.stdout) as { slug: string }).slug
  }

  async function checkoutFeatureBranch(): Promise<void> {
    await execAsync('git', ['checkout', '-b', 'metta/feature-x'], { cwd: tempDir })
  }

  // Removing a seeded issue file with `rm` leaves the working tree dirty
  // (the auto-committed spec/issues/<slug>.md becomes an uncommitted
  // deletion). `autoCommitFile` refuses to commit spec/roadmap.md while
  // other tracked paths are dirty, so tests that assert an actual roadmap
  // commit happened must commit that deletion first — simulating the issue
  // file's removal already having landed in a prior commit.
  async function commitDanglingRemoval(): Promise<void> {
    await execAsync('git', ['add', '-A'], { cwd: tempDir })
    await execAsync('git', ['commit', '-m', 'chore: test cleanup — remove issue file'], { cwd: tempDir })
  }

  describe('status view (default action)', () => {
    it('empty roadmap renders the friendly state in both modes, exit 0, no file created', async () => {
      const jsonRes = await runCli(['--json', 'roadmap'], tempDir)
      expect(jsonRes.code).toBe(0)
      expect(JSON.parse(jsonRes.stdout)).toEqual({ roadmap: [] })

      const textRes = await runCli(['roadmap'], tempDir)
      expect(textRes.code).toBe(0)
      expect(textRes.stdout).toContain('Roadmap is empty. Add entries with: metta roadmap add <backlog-slug>')

      expect(existsSync(roadmapPath())).toBe(false)
    })

    it('lists entries in order with resolved titles and notes in both modes, exit 0, no writes', async () => {
      await seedBacklog('Auth refactor')
      await seedBacklog('Dark mode')
      await runCli(['roadmap', 'add', 'auth-refactor', '--note', 'after schema freeze'], tempDir)
      await runCli(['roadmap', 'add', 'dark-mode'], tempDir)
      const before = await readFile(roadmapPath(), 'utf8')

      const jsonRes = await runCli(['--json', 'roadmap'], tempDir)
      expect(jsonRes.code).toBe(0)
      const data = JSON.parse(jsonRes.stdout) as { roadmap: Array<Record<string, unknown>> }
      expect(data.roadmap).toEqual([
        { position: 1, slug: 'auth-refactor', title: 'Auth refactor', note: 'after schema freeze' },
        { position: 2, slug: 'dark-mode', title: 'Dark mode', note: null },
      ])
      // Healthy entries omit the dangling flag entirely.
      expect('dangling' in data.roadmap[0]).toBe(false)

      const textRes = await runCli(['roadmap'], tempDir)
      expect(textRes.code).toBe(0)
      expect(textRes.stdout).toMatch(/1\. auth-refactor\s+Auth refactor — after schema freeze/)
      expect(textRes.stdout).toMatch(/2\. dark-mode\s+Dark mode/)

      // The read-only view never writes.
      expect(await readFile(roadmapPath(), 'utf8')).toBe(before)
    })

    it('works on a non-main branch with no branch guard', async () => {
      await seedBacklog('Auth refactor')
      await runCli(['roadmap', 'add', 'auth-refactor'], tempDir)
      await checkoutFeatureBranch()
      const { stdout, code } = await runCli(['--json', 'roadmap'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout) as { roadmap: Array<{ slug: string }> }
      expect(data.roadmap[0].slug).toBe('auth-refactor')
    })

    it('marks a dangling entry at its position while healthy entries omit the flag, exit 0', async () => {
      await seedBacklog('Auth refactor')
      await seedBacklog('Old idea')
      await runCli(['roadmap', 'add', 'auth-refactor'], tempDir)
      await runCli(['roadmap', 'add', 'old-idea'], tempDir)
      await rm(join(tempDir, 'spec', 'issues', 'old-idea.md'))

      const jsonRes = await runCli(['--json', 'roadmap'], tempDir)
      expect(jsonRes.code).toBe(0)
      const data = JSON.parse(jsonRes.stdout) as { roadmap: Array<Record<string, unknown>> }
      expect(data.roadmap[0]).toEqual({
        position: 1,
        slug: 'auth-refactor',
        title: 'Auth refactor',
        note: null,
      })
      expect(data.roadmap[1]).toEqual({
        position: 2,
        slug: 'old-idea',
        title: null,
        note: null,
        dangling: true,
      })

      const textRes = await runCli(['roadmap'], tempDir)
      expect(textRes.code).toBe(0)
      expect(textRes.stdout).toMatch(/2\. old-idea\s+\(dangling — backlog item missing\)/)
    })
  })

  describe('roadmap add', () => {
    it('appends with a note, reports the position and auto-commits', async () => {
      await seedBacklog('Auth refactor')
      const { stdout, code } = await runCli(
        ['--json', 'roadmap', 'add', 'auth-refactor', '--note', 'after schema freeze'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout) as { slug: string; position: number; committed: boolean; commit_sha?: string }
      expect(data.slug).toBe('auth-refactor')
      expect(data.position).toBe(1)
      expect(data.committed).toBe(true)
      expect(data.commit_sha).toBeTruthy()

      const { stdout: log } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('chore: add roadmap entry auth-refactor')
      expect(await readFile(roadmapPath(), 'utf8')).toBe(
        '# Roadmap\n\n1. `auth-refactor` — after schema freeze\n',
      )
    })

    it('text mode reports position and commit', async () => {
      await seedBacklog('Dark mode')
      const { stdout, code } = await runCli(['roadmap', 'add', 'dark-mode'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('Added to roadmap at position 1: dark-mode')
      expect(stdout).toContain('Committed:')
    })

    it('unknown slug exits 4 with not_found; roadmap.md untouched and spec/issues/ never written', async () => {
      await seedBacklog('Auth refactor')
      await runCli(['roadmap', 'add', 'auth-refactor'], tempDir)
      const before = await readFile(roadmapPath(), 'utf8')

      const { stdout, code } = await runCli(['--json', 'roadmap', 'add', 'ghost-item'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout) as { error: { code: number; type: string; message: string } }
      expect(data.error.type).toBe('not_found')
      expect(data.error.code).toBe(4)

      expect(await readFile(roadmapPath(), 'utf8')).toBe(before)
      expect(existsSync(join(tempDir, 'spec', 'issues', 'ghost-item.md'))).toBe(false)
    })

    it('duplicate slug exits 4 with duplicate_entry', async () => {
      await seedBacklog('Auth refactor')
      await runCli(['roadmap', 'add', 'auth-refactor'], tempDir)
      const before = await readFile(roadmapPath(), 'utf8')

      const { stdout, code } = await runCli(['--json', 'roadmap', 'add', 'auth-refactor'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout) as { error: { type: string } }
      expect(data.error.type).toBe('duplicate_entry')
      expect(await readFile(roadmapPath(), 'utf8')).toBe(before)
    })
  })

  describe('roadmap reorder', () => {
    beforeEach(async () => {
      await seedBacklog('Item a')
      await seedBacklog('Item b')
      await seedBacklog('Item c')
      await runCli(['roadmap', 'add', 'item-a', '--note', 'note a'], tempDir)
      await runCli(['roadmap', 'add', 'item-b'], tempDir)
      await runCli(['roadmap', 'add', 'item-c'], tempDir)
    }, 120000)

    it('rewrites the order preserving notes and auto-commits', async () => {
      const { stdout, code } = await runCli(
        ['--json', 'roadmap', 'reorder', 'item-c', 'item-a', 'item-b'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout) as { reordered: string[]; committed: boolean }
      expect(data.reordered).toEqual(['item-c', 'item-a', 'item-b'])
      expect(data.committed).toBe(true)

      expect(await readFile(roadmapPath(), 'utf8')).toBe(
        '# Roadmap\n\n1. `item-c`\n2. `item-a` — note a\n3. `item-b`\n',
      )
      const { stdout: log } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('chore: reorder roadmap')
    })

    it('omission, addition and duplicate each exit 4 with invalid_reorder; file byte-identical after all three', async () => {
      const before = await readFile(roadmapPath(), 'utf8')

      const omission = await runCli(['--json', 'roadmap', 'reorder', 'item-c', 'item-a'], tempDir)
      expect(omission.code).toBe(4)
      const omissionData = JSON.parse(omission.stdout) as { error: { type: string; message: string } }
      expect(omissionData.error.type).toBe('invalid_reorder')
      expect(omissionData.error.message).toContain('missing: item-b')

      const addition = await runCli(
        ['--json', 'roadmap', 'reorder', 'item-a', 'item-b', 'item-c', 'ghost-item'],
        tempDir,
      )
      expect(addition.code).toBe(4)
      const additionData = JSON.parse(addition.stdout) as { error: { type: string; message: string } }
      expect(additionData.error.type).toBe('invalid_reorder')
      expect(additionData.error.message).toContain('unexpected: ghost-item')

      const duplicate = await runCli(
        ['--json', 'roadmap', 'reorder', 'item-a', 'item-a', 'item-b', 'item-c'],
        tempDir,
      )
      expect(duplicate.code).toBe(4)
      const duplicateData = JSON.parse(duplicate.stdout) as { error: { type: string; message: string } }
      expect(duplicateData.error.type).toBe('invalid_reorder')
      expect(duplicateData.error.message).toContain('duplicated: item-a')

      expect(await readFile(roadmapPath(), 'utf8')).toBe(before)
    })
  })

  describe('roadmap remove', () => {
    beforeEach(async () => {
      await seedBacklog('Item a')
      await seedBacklog('Item b')
      await seedBacklog('Item c')
      await runCli(['roadmap', 'add', 'item-a'], tempDir)
      await runCli(['roadmap', 'add', 'item-b'], tempDir)
      await runCli(['roadmap', 'add', 'item-c'], tempDir)
    }, 120000)

    // C1
    it('removes by position, renumbers through the canonical writer and auto-commits', async () => {
      const { stdout, code } = await runCli(['--json', 'roadmap', 'remove', '2'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout) as { removed: string; position: number; committed: boolean; commit_sha?: string }
      expect(data.removed).toBe('item-b')
      expect(data.position).toBe(2)
      expect(data.committed).toBe(true)
      expect(data.commit_sha).toBeTruthy()

      expect(await readFile(roadmapPath(), 'utf8')).toBe('# Roadmap\n\n1. `item-a`\n2. `item-c`\n')

      const { stdout: log } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('chore: remove roadmap entry item-b')
    })

    // C2
    it('removes by slug even when the entry is dangling; nothing under spec/issues/ is touched', async () => {
      await rm(join(tempDir, 'spec', 'issues', 'item-b.md'))

      const { stdout, code } = await runCli(['--json', 'roadmap', 'remove', 'item-b'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout) as { removed: string; position: number }
      expect(data.removed).toBe('item-b')
      expect(data.position).toBe(2)
      expect(existsSync(join(tempDir, 'spec', 'issues', 'item-b.md'))).toBe(false)
      expect(existsSync(join(tempDir, 'spec', 'issues', 'resolved', 'item-b.md'))).toBe(false)

      const view = await runCli(['--json', 'roadmap'], tempDir)
      const viewData = JSON.parse(view.stdout) as { roadmap: Array<{ slug: string }> }
      expect(viewData.roadmap.map((row) => row.slug)).toEqual(['item-a', 'item-c'])
    })

    // C3
    it('text mode reports position and commit', async () => {
      const { stdout, code } = await runCli(['roadmap', 'remove', 'item-a'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('Removed from roadmap (was position 1): item-a')
      expect(stdout).toContain('Committed:')
    })

    // C4
    it('unknown slug then out-of-range position both exit 4 not_found; file byte-identical after both', async () => {
      const before = await readFile(roadmapPath(), 'utf8')

      const bySlug = await runCli(['--json', 'roadmap', 'remove', 'nope'], tempDir)
      expect(bySlug.code).toBe(4)
      const bySlugData = JSON.parse(bySlug.stdout) as { error: { type: string } }
      expect(bySlugData.error.type).toBe('not_found')

      const byPosition = await runCli(['--json', 'roadmap', 'remove', '9'], tempDir)
      expect(byPosition.code).toBe(4)
      const byPositionData = JSON.parse(byPosition.stdout) as { error: { type: string } }
      expect(byPositionData.error.type).toBe('not_found')

      expect(await readFile(roadmapPath(), 'utf8')).toBe(before)
    })
  })

  describe('roadmap next', () => {
    it('emits the promote-path handoff, pops the top (second entry becomes top) and auto-commits', async () => {
      await seedBacklog('Foo feature')
      await seedBacklog('Bar feature')
      await runCli(['roadmap', 'add', 'foo-feature'], tempDir)
      await runCli(['roadmap', 'add', 'bar-feature'], tempDir)

      const { stdout, code } = await runCli(['--json', 'roadmap', 'next'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout) as { next: string; message: string; committed: boolean; commit_sha?: string }
      expect(data.next).toBe('foo-feature')
      expect(data.message).toBe('Run: metta propose "Foo feature"')
      expect(data.committed).toBe(true)
      expect(data.commit_sha).toBeTruthy()

      const { stdout: log } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('chore: pop roadmap entry foo-feature')

      const view = await runCli(['--json', 'roadmap'], tempDir)
      const viewData = JSON.parse(view.stdout) as { roadmap: Array<{ position: number; slug: string }> }
      expect(viewData.roadmap).toHaveLength(1)
      expect(viewData.roadmap[0]).toMatchObject({ position: 1, slug: 'bar-feature' })
    })

    it('empty roadmap is a no-op in both modes: exit 0, no write, no commit', async () => {
      const { stdout: logBefore } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })

      const jsonRes = await runCli(['--json', 'roadmap', 'next'], tempDir)
      expect(jsonRes.code).toBe(0)
      // C11: additive fields skipped/pruned are always present, [] here.
      expect(JSON.parse(jsonRes.stdout)).toEqual({ next: null, skipped: [], pruned: [] })

      const textRes = await runCli(['roadmap', 'next'], tempDir)
      expect(textRes.code).toBe(0)
      expect(textRes.stdout).toContain('Roadmap is empty — nothing to activate.')

      expect(existsSync(roadmapPath())).toBe(false)
      const { stdout: logAfter } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(logAfter).toBe(logBefore)
    })

    it('sanitizes the promote handoff title in text mode while JSON stays byte-faithful', async () => {
      await seedBacklog('Evil one')
      await seedBacklog('Evil two')
      // Inject ANSI color sequences into both stored titles.
      for (const [slug, heading] of [
        ['evil-one', '# Evil one'],
        ['evil-two', '# Evil two'],
      ] as const) {
        const path = join(tempDir, 'spec', 'issues', `${slug}.md`)
        const original = await readFile(path, 'utf8')
        const hostile = original.replace(heading, heading.replace('Evil', '\x1b[31mEVIL\x1b[0m'))
        expect(hostile).not.toBe(original)
        await writeFile(path, hostile, 'utf8')
      }
      await runCli(['roadmap', 'add', 'evil-one'], tempDir)
      await runCli(['roadmap', 'add', 'evil-two'], tempDir)

      // JSON branch: the handoff message carries the title byte-faithfully.
      const jsonRes = await runCli(['--json', 'roadmap', 'next'], tempDir)
      expect(jsonRes.code).toBe(0)
      const data = JSON.parse(jsonRes.stdout) as { next: string; message: string }
      expect(data.next).toBe('evil-one')
      expect(data.message).toBe('Run: metta propose "\x1b[31mEVIL\x1b[0m one"')

      // Text branch: escape sequences are stripped at the render edge.
      const textRes = await runCli(['roadmap', 'next'], tempDir)
      expect(textRes.code).toBe(0)
      expect(textRes.stdout).toContain('activate by running: metta propose "EVIL two"')
      expect(textRes.stdout).not.toContain('\x1b')
    })

    // C12: inverts the old ADR-4 fail-stop test — dangling entries no longer
    // surface through the error contract on `next`; the healthy second entry
    // activates instead.
    it('dangling head is skipped, healthy second entry activates: exit 0, no error object', async () => {
      await seedBacklog('Foo feature')
      await seedBacklog('Bar feature')
      await runCli(['roadmap', 'add', 'foo-feature'], tempDir)
      await runCli(['roadmap', 'add', 'bar-feature'], tempDir)
      await rm(join(tempDir, 'spec', 'issues', 'foo-feature.md'))

      const { stdout, code } = await runCli(['--json', 'roadmap', 'next'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout) as {
        next: string
        skipped: string[]
        pruned: string[]
        error?: unknown
      }
      expect(data.error).toBeUndefined()
      expect(data.next).toBe('bar-feature')
      expect(data.skipped).toEqual(['foo-feature'])
      expect(data.pruned).toEqual([])

      // Dangling entry is skipped, not deleted: it survives in the roadmap.
      const view = await runCli(['--json', 'roadmap'], tempDir)
      const viewData = JSON.parse(view.stdout) as { roadmap: Array<{ slug: string }> }
      expect(viewData.roadmap.map((row) => row.slug)).toEqual(['foo-feature'])
    })

    // C7
    it('dangling head skipped, healthy second activates: stderr warning + JSON skipped/next; ghost stays in the roadmap', async () => {
      await seedBacklog('Ghost feature')
      await seedBacklog('Foo feature')
      await runCli(['roadmap', 'add', 'ghost-feature'], tempDir)
      await runCli(['roadmap', 'add', 'foo-feature'], tempDir)
      await rm(join(tempDir, 'spec', 'issues', 'ghost-feature.md'))
      await commitDanglingRemoval()

      const { stdout, stderr, code } = await runCli(['--json', 'roadmap', 'next'], tempDir)
      expect(code).toBe(0)
      expect(stderr).toContain('ghost-feature')
      expect(stderr).toContain('metta roadmap remove ghost-feature')
      expect(stderr).toContain('spec/issues/ghost-feature.md')
      const data = JSON.parse(stdout) as { next: string; skipped: string[]; pruned: string[] }
      expect(data.next).toBe('foo-feature')
      expect(data.skipped).toEqual(['ghost-feature'])
      expect(data.pruned).toEqual([])

      const { stdout: log } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('chore: pop roadmap entry foo-feature')

      const view = await runCli(['--json', 'roadmap'], tempDir)
      const viewData = JSON.parse(view.stdout) as { roadmap: Array<{ slug: string }> }
      expect(viewData.roadmap.map((row) => row.slug)).toEqual(['ghost-feature'])
    })

    // C8
    it('two consecutive dangling entries then a healthy third: one warning line per slug, both ghosts remain', async () => {
      await seedBacklog('Ghost a')
      await seedBacklog('Ghost b')
      await seedBacklog('Foo feature')
      await runCli(['roadmap', 'add', 'ghost-a'], tempDir)
      await runCli(['roadmap', 'add', 'ghost-b'], tempDir)
      await runCli(['roadmap', 'add', 'foo-feature'], tempDir)
      await rm(join(tempDir, 'spec', 'issues', 'ghost-a.md'))
      await rm(join(tempDir, 'spec', 'issues', 'ghost-b.md'))

      const { stdout, stderr, code } = await runCli(['--json', 'roadmap', 'next'], tempDir)
      expect(code).toBe(0)
      const ghostALines = stderr.split('\n').filter((line) => line.includes('ghost-a'))
      const ghostBLines = stderr.split('\n').filter((line) => line.includes('ghost-b'))
      expect(ghostALines).toHaveLength(1)
      expect(ghostBLines).toHaveLength(1)

      const data = JSON.parse(stdout) as { next: string; skipped: string[] }
      expect(data.next).toBe('foo-feature')
      expect(data.skipped).toEqual(['ghost-a', 'ghost-b'])

      const view = await runCli(['--json', 'roadmap'], tempDir)
      const viewData = JSON.parse(view.stdout) as { roadmap: Array<{ slug: string }> }
      expect(viewData.roadmap.map((row) => row.slug)).toEqual(['ghost-a', 'ghost-b'])
    })

    // C9
    it('--prune removes the skipped dangling entries and the activated entry in the same write and commit', async () => {
      await seedBacklog('Ghost a')
      await seedBacklog('Ghost b')
      await seedBacklog('Foo feature')
      await runCli(['roadmap', 'add', 'ghost-a'], tempDir)
      await runCli(['roadmap', 'add', 'ghost-b'], tempDir)
      await runCli(['roadmap', 'add', 'foo-feature'], tempDir)
      await rm(join(tempDir, 'spec', 'issues', 'ghost-a.md'))
      await rm(join(tempDir, 'spec', 'issues', 'ghost-b.md'))
      await commitDanglingRemoval()

      const { stdout: countBefore } = await execAsync('git', ['rev-list', '--count', 'HEAD'], { cwd: tempDir })

      const { stdout, code } = await runCli(['--json', 'roadmap', 'next', '--prune'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout) as { next: string; skipped: string[]; pruned: string[] }
      expect(data.next).toBe('foo-feature')
      expect(data.skipped).toEqual(['ghost-a', 'ghost-b'])
      expect(data.pruned).toEqual(data.skipped)

      const { stdout: countAfter } = await execAsync('git', ['rev-list', '--count', 'HEAD'], { cwd: tempDir })
      expect(Number(countAfter.trim())).toBe(Number(countBefore.trim()) + 1)

      const view = await runCli(['--json', 'roadmap'], tempDir)
      const viewData = JSON.parse(view.stdout) as { roadmap: Array<{ slug: string }> }
      expect(viewData.roadmap).toEqual([])

      const { stdout: log } = await execAsync('git', ['log', '-1', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('chore: pop roadmap entry foo-feature')
      expect(log).toContain('(pruned 2 dangling)')
    })

    // C10
    it('all-dangling roadmap is a non-error no-op, with and without --prune', async () => {
      await seedBacklog('Ghost a')
      await seedBacklog('Ghost b')
      await runCli(['roadmap', 'add', 'ghost-a'], tempDir)
      await runCli(['roadmap', 'add', 'ghost-b'], tempDir)
      await rm(join(tempDir, 'spec', 'issues', 'ghost-a.md'))
      await rm(join(tempDir, 'spec', 'issues', 'ghost-b.md'))
      const before = await readFile(roadmapPath(), 'utf8')
      const { stdout: logBefore } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })

      const plain = await runCli(['--json', 'roadmap', 'next'], tempDir)
      expect(plain.code).toBe(0)
      const plainData = JSON.parse(plain.stdout) as {
        next: null
        skipped: string[]
        pruned: string[]
        error?: unknown
      }
      expect(plainData.error).toBeUndefined()
      expect(plainData.next).toBeNull()
      expect(plainData.skipped).toEqual(['ghost-a', 'ghost-b'])
      expect(plainData.pruned).toEqual([])
      expect(await readFile(roadmapPath(), 'utf8')).toBe(before)

      const pruned = await runCli(['--json', 'roadmap', 'next', '--prune'], tempDir)
      expect(pruned.code).toBe(0)
      const prunedData = JSON.parse(pruned.stdout) as {
        next: null
        skipped: string[]
        pruned: string[]
        error?: unknown
      }
      expect(prunedData.error).toBeUndefined()
      expect(prunedData.next).toBeNull()
      // --prune is structurally inert with no candidate: no store call at all.
      expect(prunedData.pruned).toEqual([])
      expect(await readFile(roadmapPath(), 'utf8')).toBe(before)

      const { stdout: logAfter } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(logAfter).toBe(logBefore)
    })

    // C13
    it('healthy head yields an empty skip signal', async () => {
      await seedBacklog('Foo feature')
      await runCli(['roadmap', 'add', 'foo-feature'], tempDir)

      const { stdout, code } = await runCli(['--json', 'roadmap', 'next'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout) as {
        next: string
        message: string
        committed: boolean
        commit_sha?: string
        skipped: string[]
        pruned: string[]
      }
      expect(data.skipped).toEqual([])
      expect(data.pruned).toEqual([])
      expect(data.next).toBe('foo-feature')
      expect(data.message).toBe('Run: metta propose "Foo feature"')
      expect(data.committed).toBe(true)
      expect(data.commit_sha).toBeTruthy()
    })

    // C14
    it('text mode warns once per skipped slug on stderr, naming the literal slugs', async () => {
      await seedBacklog('Ghost a')
      await seedBacklog('Ghost b')
      await seedBacklog('Foo feature')
      await runCli(['roadmap', 'add', 'ghost-a'], tempDir)
      await runCli(['roadmap', 'add', 'ghost-b'], tempDir)
      await runCli(['roadmap', 'add', 'foo-feature'], tempDir)
      await rm(join(tempDir, 'spec', 'issues', 'ghost-a.md'))
      await rm(join(tempDir, 'spec', 'issues', 'ghost-b.md'))

      const { stderr, code } = await runCli(['roadmap', 'next'], tempDir)
      expect(code).toBe(0)
      const ghostALines = stderr.split('\n').filter((line) => line.includes('ghost-a'))
      const ghostBLines = stderr.split('\n').filter((line) => line.includes('ghost-b'))
      expect(ghostALines).toHaveLength(1)
      expect(ghostBLines).toHaveLength(1)
      expect(ghostALines[0]).toContain('metta roadmap remove ghost-a')
      expect(ghostBLines[0]).toContain('metta roadmap remove ghost-b')
    })
  })

  describe('branch discipline', () => {
    beforeEach(async () => {
      await seedBacklog('Item a')
      await seedBacklog('Item b')
      await runCli(['roadmap', 'add', 'item-a'], tempDir)
      await runCli(['roadmap', 'add', 'item-b'], tempDir)
      await checkoutFeatureBranch()
    }, 120000)

    it('blocks add, reorder, remove and next off-main with branch_guard exit 4', async () => {
      const add = await runCli(['--json', 'roadmap', 'add', 'item-a'], tempDir)
      expect(add.code).toBe(4)
      expect((JSON.parse(add.stdout) as { error: { type: string } }).error.type).toBe('branch_guard')

      // Guard fires BEFORE permutation validation: an invalid reorder off-main
      // is still branch_guard, not invalid_reorder.
      const reorder = await runCli(['--json', 'roadmap', 'reorder', 'item-a'], tempDir)
      expect(reorder.code).toBe(4)
      expect((JSON.parse(reorder.stdout) as { error: { type: string } }).error.type).toBe('branch_guard')

      // C5: guard fires BEFORE target validation — an invalid (unknown)
      // target off-main is still branch_guard, not not_found.
      const remove = await runCli(['--json', 'roadmap', 'remove', 'nope'], tempDir)
      expect(remove.code).toBe(4)
      expect((JSON.parse(remove.stdout) as { error: { type: string } }).error.type).toBe('branch_guard')

      const next = await runCli(['--json', 'roadmap', 'next'], tempDir)
      expect(next.code).toBe(4)
      expect((JSON.parse(next.stdout) as { error: { type: string } }).error.type).toBe('branch_guard')
    })

    // C15: off-main + a dangling head is still branch_guard (guard runs
    // before the roadmap read that would classify the entry).
    it('off-main with a dangling head still fails branch_guard, not not_found', async () => {
      await rm(join(tempDir, 'spec', 'issues', 'item-a.md'))
      const next = await runCli(['--json', 'roadmap', 'next'], tempDir)
      expect(next.code).toBe(4)
      expect((JSON.parse(next.stdout) as { error: { type: string } }).error.type).toBe('branch_guard')
    })

    it('--on-branch escape hatch proceeds and commits on the current branch', async () => {
      const { stdout, code } = await runCli(
        ['--json', 'roadmap', 'reorder', 'item-b', 'item-a', '--on-branch', 'metta/feature-x'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout) as { committed: boolean; commit_sha?: string }
      expect(data.committed).toBe(true)

      const { stdout: branch } = await execAsync('git', ['branch', '--show-current'], { cwd: tempDir })
      expect(branch.trim()).toBe('metta/feature-x')
      const { stdout: log } = await execAsync('git', ['log', '-1', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('chore: reorder roadmap')
    })
  })

  describe('error contract', () => {
    it('all five failure types share the envelope shape: code 4, non-empty message', async () => {
      await seedBacklog('Item a')
      await runCli(['roadmap', 'add', 'item-a'], tempDir)

      const notFound = await runCli(['--json', 'roadmap', 'add', 'ghost-item'], tempDir)
      const duplicate = await runCli(['--json', 'roadmap', 'add', 'item-a'], tempDir)
      const invalidReorder = await runCli(['--json', 'roadmap', 'reorder', 'item-a', 'ghost-item'], tempDir)
      // C6: the remove not_found case shares the same envelope shape.
      const removeNotFound = await runCli(['--json', 'roadmap', 'remove', 'nope'], tempDir)
      await checkoutFeatureBranch()
      const branchGuard = await runCli(['--json', 'roadmap', 'add', 'item-a'], tempDir)

      const cases: Array<[{ stdout: string; code: number }, string]> = [
        [notFound, 'not_found'],
        [duplicate, 'duplicate_entry'],
        [invalidReorder, 'invalid_reorder'],
        [removeNotFound, 'not_found'],
        [branchGuard, 'branch_guard'],
      ]
      for (const [res, type] of cases) {
        expect(res.code, `exit code for ${type}`).toBe(4)
        const data = JSON.parse(res.stdout) as { error: { code: number; type: string; message: string } }
        expect(data.error.code).toBe(4)
        expect(data.error.type).toBe(type)
        expect(data.error.message.length).toBeGreaterThan(0)
      }
    })

    it('text-mode failures print the message on stderr and exit 4', async () => {
      const { stdout, stderr, code } = await runCli(['roadmap', 'add', 'ghost-item'], tempDir)
      expect(code).toBe(4)
      expect(stderr).toContain("Backlog item 'ghost-item' not found")
      expect(stdout).not.toContain('ghost-item')
    })
  })

  describe('additive wiring', () => {
    it('createCliContext exposes roadmapStore and RoadmapStore is exported from the barrel', async () => {
      const { createCliContext } = await import('../src/cli/helpers.js')
      const { RoadmapStore } = await import('../src/index.js')
      const ctx = createCliContext(tempDir)
      expect(ctx.roadmapStore).toBeInstanceOf(RoadmapStore)
    })
  })
})
