import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MilestonesStore } from '../src/milestones/milestones-store.js'

describe('MilestonesStore', () => {
  let tempDir: string
  let store: MilestonesStore

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-milestones-'))
    store = new MilestonesStore(tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  async function seedMilestoneFile(slug: string, content: string): Promise<void> {
    await mkdir(join(tempDir, 'milestones'), { recursive: true })
    await writeFile(join(tempDir, 'milestones', `${slug}.md`), content, 'utf-8')
  }

  it('round-trips create/show/exists with all fields', async () => {
    await store.create('v0-6', {
      name: 'v0.6',
      target: '2026-09-30',
      description: 'Backlog/milestone unification release.',
    })

    expect(await store.exists('v0-6')).toBe(true)

    const milestone = await store.show('v0-6')
    expect(milestone).toEqual({
      slug: 'v0-6',
      name: 'v0.6',
      target: '2026-09-30',
      status: 'open',
      description: 'Backlog/milestone unification release.',
    })
  })

  it('creates with defaults: status open, empty description, no target key', async () => {
    await store.create('v0-7', { name: 'v0.7' })

    const milestone = await store.show('v0-7')
    expect(milestone.status).toBe('open')
    expect(milestone.target).toBeUndefined()
    expect(milestone.description).toBe('')

    const content = await readFile(join(tempDir, 'milestones', 'v0-7.md'), 'utf-8')
    expect(content).not.toContain('target')
    expect(content).toContain('status: open')
  })

  it('lists all milestones, [] entries sorted by slug', async () => {
    await store.create('v0-7', { name: 'v0.7' })
    await store.create('v0-6', { name: 'v0.6', target: '2026-09-30' })

    const list = await store.list()
    expect(list.map(m => m.slug)).toEqual(['v0-6', 'v0-7'])
    expect(list[0].name).toBe('v0.6')
    expect(list[0].target).toBe('2026-09-30')
  })

  it('returns [] from list() when the milestones directory is absent', async () => {
    await expect(store.list()).resolves.toEqual([])
  })

  it('refuses duplicate create and leaves the existing file unmodified', async () => {
    await store.create('v0-6', { name: 'v0.6', description: 'original' })
    const path = join(tempDir, 'milestones', 'v0-6.md')
    const before = await readFile(path, 'utf-8')

    await expect(
      store.create('v0-6', { name: 'overwrite attempt', description: 'clobber' }),
    ).rejects.toThrow(/Milestone 'v0-6' already exists/)

    const after = await readFile(path, 'utf-8')
    expect(after).toBe(before)
  })

  it('rejects invalid status naming the allowed values open/closed/abandoned', async () => {
    await seedMilestoneFile('v0-6', '---\nname: v0.6\nstatus: shipped\n---\nbody\n')

    await expect(store.show('v0-6')).rejects.toThrow(
      /status: .*'open' \| 'closed' \| 'abandoned'.*received 'shipped'/,
    )
    await expect(store.list()).rejects.toThrow(/status/)
  })

  it('accepts a seeded status: abandoned file', async () => {
    await seedMilestoneFile('v0-6', '---\nname: v0.6\nstatus: abandoned\n---\ndropped\n')

    const milestone = await store.show('v0-6')
    expect(milestone.status).toBe('abandoned')
    expect(milestone.description).toBe('dropped')
  })

  it('parses seeded pre-change open and closed files identically (back-compat)', async () => {
    await seedMilestoneFile('v0-6', '---\nname: v0.6\ntarget: "2026-09-30"\nstatus: open\n---\nrelease\n')
    await seedMilestoneFile('v0-5', '---\nname: v0.5\nstatus: closed\n---\nshipped release\n')

    expect(await store.show('v0-6')).toEqual({
      slug: 'v0-6',
      name: 'v0.6',
      target: '2026-09-30',
      status: 'open',
      description: 'release',
    })
    expect(await store.show('v0-5')).toEqual({
      slug: 'v0-5',
      name: 'v0.5',
      target: undefined,
      status: 'closed',
      description: 'shipped release',
    })
  })

  it('rejects a malformed target naming the field', async () => {
    await seedMilestoneFile('v0-6', '---\nname: v0.6\ntarget: sometime soon\n---\n')
    await expect(store.show('v0-6')).rejects.toThrow(/target/)
  })

  it('rejects a non-calendar target date', async () => {
    await seedMilestoneFile('v0-6', '---\nname: v0.6\ntarget: "2026-02-30"\n---\n')
    await expect(store.show('v0-6')).rejects.toThrow(
      /target: .*real calendar date/,
    )
  })

  it('rejects invalid create fields before any write', async () => {
    await expect(
      store.create('v0-6', { name: 'v0.6', target: 'Q3' }),
    ).rejects.toThrow(/target/)
    expect(await store.exists('v0-6')).toBe(false)
  })

  it('rejects unknown frontmatter keys', async () => {
    await seedMilestoneFile('v0-6', '---\nname: v0.6\nowner: alice\n---\n')
    await expect(store.show('v0-6')).rejects.toThrow(/owner/)
  })

  it('throws not-found from show for a missing slug', async () => {
    await expect(store.show('never-created')).rejects.toThrow(
      /Milestone 'never-created' not found/,
    )
  })

  it('throws on a milestone file with no frontmatter block', async () => {
    await seedMilestoneFile('bare', '# just a heading\n')
    await expect(store.show('bare')).rejects.toThrow(/missing YAML frontmatter/)
  })

  describe('update', () => {
    it('patches status while preserving name, target, and body', async () => {
      await store.create('v0-6', {
        name: 'v0.6',
        target: '2026-09-30',
        description: 'Backlog/milestone unification release.',
      })

      const updated = await store.update('v0-6', { status: 'closed' })
      expect(updated).toEqual({
        slug: 'v0-6',
        name: 'v0.6',
        target: '2026-09-30',
        status: 'closed',
        description: 'Backlog/milestone unification release.',
      })

      const shown = await store.show('v0-6')
      expect(shown).toEqual(updated)
    })

    it('clearTarget removes the target key entirely from the raw file', async () => {
      await store.create('v0-6', { name: 'v0.6', target: '2026-09-30', description: 'body' })

      const updated = await store.update('v0-6', { clearTarget: true })
      expect(updated.target).toBeUndefined()

      const raw = await readFile(join(tempDir, 'milestones', 'v0-6.md'), 'utf-8')
      expect(raw).not.toContain('target:')
      expect(raw).toContain('name: v0.6')
      expect(raw).toContain('body')
    })

    it('rejects an invalid target date naming the field and leaves the file byte-identical', async () => {
      await store.create('v0-6', { name: 'v0.6', target: '2026-09-30', description: 'body' })
      const path = join(tempDir, 'milestones', 'v0-6.md')
      const before = await readFile(path, 'utf-8')

      await expect(store.update('v0-6', { target: '2026-02-30' })).rejects.toThrow(
        /target: .*real calendar date/,
      )

      expect(await readFile(path, 'utf-8')).toBe(before)
    })

    it('rejects an empty name naming the field and leaves the file byte-identical', async () => {
      await store.create('v0-6', { name: 'v0.6', description: 'body' })
      const path = join(tempDir, 'milestones', 'v0-6.md')
      const before = await readFile(path, 'utf-8')

      await expect(store.update('v0-6', { name: '' })).rejects.toThrow(/name/)

      expect(await readFile(path, 'utf-8')).toBe(before)
    })

    it('rejects target and clearTarget together', async () => {
      await store.create('v0-6', { name: 'v0.6' })
      await expect(
        store.update('v0-6', { target: '2026-09-30', clearTarget: true }),
      ).rejects.toThrow(/clearTarget and target are mutually exclusive/)
    })

    it('throws not-found for a missing slug without creating a file', async () => {
      await expect(store.update('never-created', { status: 'closed' })).rejects.toThrow(
        /Milestone 'never-created' not found/,
      )
      expect(await store.exists('never-created')).toBe(false)
    })

    it('round-trips abandoned status through show', async () => {
      await store.create('v0-6', { name: 'v0.6', description: 'dropped scope' })

      const updated = await store.update('v0-6', { status: 'abandoned' })
      expect(updated.status).toBe('abandoned')

      const shown = await store.show('v0-6')
      expect(shown.status).toBe('abandoned')
      expect(shown.description).toBe('dropped scope')
    })

    it('treats an empty patch as a validated no-op', async () => {
      await store.create('v0-6', { name: 'v0.6', target: '2026-09-30', description: 'body' })
      const path = join(tempDir, 'milestones', 'v0-6.md')
      const before = await readFile(path, 'utf-8')

      const updated = await store.update('v0-6', {})
      expect(updated).toEqual({
        slug: 'v0-6',
        name: 'v0.6',
        target: '2026-09-30',
        status: 'open',
        description: 'body',
      })
      expect(await readFile(path, 'utf-8')).toBe(before)
    })

    it('rejects path-traversal slugs', async () => {
      await expect(store.update('../escape', { status: 'closed' })).rejects.toThrow(
        /Invalid milestone slug/,
      )
    })
  })

  it('rejects path-traversal slugs on create/show/exists', async () => {
    const bad = ['../escape', '..\\escape', '/abs/path', 'a/b', 'Foo', '']
    for (const slug of bad) {
      await expect(store.create(slug, { name: 'x' })).rejects.toThrow(/Invalid milestone slug/)
      await expect(store.show(slug)).rejects.toThrow(/Invalid milestone slug/)
      await expect(store.exists(slug)).rejects.toThrow(/Invalid milestone slug/)
    }
  })
})
