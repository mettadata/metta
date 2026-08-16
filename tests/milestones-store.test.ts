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

  it('rejects invalid status naming the allowed values open/closed', async () => {
    await seedMilestoneFile('v0-6', '---\nname: v0.6\nstatus: shipped\n---\nbody\n')

    await expect(store.show('v0-6')).rejects.toThrow(
      /status: .*'open' \| 'closed'.*received 'shipped'/,
    )
    await expect(store.list()).rejects.toThrow(/status/)
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

  it('rejects path-traversal slugs on create/show/exists', async () => {
    const bad = ['../escape', '..\\escape', '/abs/path', 'a/b', 'Foo', '']
    for (const slug of bad) {
      await expect(store.create(slug, { name: 'x' })).rejects.toThrow(/Invalid milestone slug/)
      await expect(store.show(slug)).rejects.toThrow(/Invalid milestone slug/)
      await expect(store.exists(slug)).rejects.toThrow(/Invalid milestone slug/)
    }
  })
})
