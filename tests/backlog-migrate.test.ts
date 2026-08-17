import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migrateLegacyBacklog } from '../src/backlog/backlog-migrate.js'

function legacyItem(title: string, opts: { priority?: string; shippedIn?: string } = {}): string {
  const lines = [`# ${title}`, '', '**Added**: 2026-01-15', '**Status**: backlog']
  if (opts.priority) lines.push(`**Priority**: ${opts.priority}`)
  lines.push('', `Description body for ${title}`, '')
  let content = lines.join('\n')
  if (opts.shippedIn) content += `\n**Shipped-in**: ${opts.shippedIn}\n`
  return content
}

/** Old-format item with a legacy YAML frontmatter block (slug/title/priority/added). */
function legacyFrontmatterItem(slug: string, opts: { priority?: string } = {}): { content: string; body: string } {
  const fields = [`slug: ${slug}`, `title: Some legacy title for ${slug}`]
  if (opts.priority) fields.push(`priority: ${opts.priority}`)
  fields.push('added: 2026-04-16')
  const body = `\nDescription body for ${slug}.\n\n**Shipped-in**: some-change\n`
  return { content: `---\n${fields.join('\n')}\n---\n${body}`, body }
}

describe('migrateLegacyBacklog', () => {
  let specDir: string

  beforeEach(async () => {
    specDir = await mkdtemp(join(tmpdir(), 'metta-backlog-migrate-'))
  })

  afterEach(async () => {
    await rm(specDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  async function seedActive(slug: string, content: string): Promise<void> {
    await mkdir(join(specDir, 'backlog'), { recursive: true })
    await writeFile(join(specDir, 'backlog', `${slug}.md`), content, 'utf8')
  }

  async function seedDone(slug: string, content: string): Promise<void> {
    await mkdir(join(specDir, 'backlog', 'done'), { recursive: true })
    await writeFile(join(specDir, 'backlog', 'done', `${slug}.md`), content, 'utf8')
  }

  async function exists(...segments: string[]): Promise<boolean> {
    try {
      await stat(join(specDir, ...segments))
      return true
    } catch {
      return false
    }
  }

  it('reports nothingToDo with zero writes when no legacy backlog exists', async () => {
    const result = await migrateLegacyBacklog(specDir)
    expect(result).toEqual({
      nothingToDo: true,
      converted: { active: 0, done: 0 },
      collisions: [],
      archivedTo: 'spec/archive/backlog-legacy',
      changedPaths: [],
    })
    expect(await exists('issues')).toBe(false)
    expect(await exists('archive')).toBe(false)
  })

  it('reports nothingToDo when the backlog dirs exist but hold no markdown', async () => {
    await mkdir(join(specDir, 'backlog', 'done'), { recursive: true })
    const result = await migrateLegacyBacklog(specDir)
    expect(result.nothingToDo).toBe(true)
    expect(await exists('issues')).toBe(false)
  })

  it('converts active items to spec/issues with idea/backlog/priority frontmatter and verbatim body', async () => {
    const original = legacyItem('Dark mode', { priority: 'high' })
    await seedActive('dark-mode', original)

    const result = await migrateLegacyBacklog(specDir)
    expect(result.nothingToDo).toBe(false)
    expect(result.converted).toEqual({ active: 1, done: 0 })
    expect(result.collisions).toEqual([])
    expect(result.changedPaths).toEqual([
      'spec/issues/dark-mode.md',
      'spec/backlog/dark-mode.md',
      'spec/archive/backlog-legacy/dark-mode.md',
    ])

    const converted = await readFile(join(specDir, 'issues', 'dark-mode.md'), 'utf8')
    expect(converted).toBe(`---\ntype: idea\nbacklog: true\npriority: high\n---\n${original}`)
  })

  it('converts done items to spec/issues/resolved with type: idea frontmatter only', async () => {
    const original = legacyItem('Old thing', { priority: 'low', shippedIn: 'some-change' })
    await seedDone('old-thing', original)

    const result = await migrateLegacyBacklog(specDir)
    expect(result.converted).toEqual({ active: 0, done: 1 })
    expect(result.changedPaths).toEqual([
      'spec/issues/resolved/old-thing.md',
      'spec/backlog/done/old-thing.md',
      'spec/archive/backlog-legacy/done/old-thing.md',
    ])

    const converted = await readFile(join(specDir, 'issues', 'resolved', 'old-thing.md'), 'utf8')
    expect(converted).toBe(`---\ntype: idea\n---\n${original}`)
  })

  it('omits priority when the legacy Priority line does not parse to high/medium/low', async () => {
    const original = legacyItem('Weird priority', { priority: 'urgent' })
    await seedActive('weird-priority', original)

    await migrateLegacyBacklog(specDir)

    const converted = await readFile(join(specDir, 'issues', 'weird-priority.md'), 'utf8')
    expect(converted).toBe(`---\ntype: idea\nbacklog: true\n---\n${original}`)
  })

  it('omits priority when the legacy item has no Priority line', async () => {
    const original = legacyItem('No priority')
    await seedActive('no-priority', original)

    await migrateLegacyBacklog(specDir)

    const converted = await readFile(join(specDir, 'issues', 'no-priority.md'), 'utf8')
    expect(converted).toBe(`---\ntype: idea\nbacklog: true\n---\n${original}`)
  })

  it('replaces a legacy YAML frontmatter block on done items, carrying the body verbatim', async () => {
    const { content, body } = legacyFrontmatterItem('old-format-done', { priority: 'medium' })
    await seedDone('old-format-done', content)

    const result = await migrateLegacyBacklog(specDir)
    expect(result.converted).toEqual({ active: 0, done: 1 })
    expect(result.collisions).toEqual([])

    const converted = await readFile(join(specDir, 'issues', 'resolved', 'old-format-done.md'), 'utf8')
    expect(converted).toBe(`---\ntype: idea\n---\n${body}`)
    // Archived original keeps the legacy block byte-identically.
    const archived = await readFile(join(specDir, 'archive', 'backlog-legacy', 'done', 'old-format-done.md'), 'utf8')
    expect(archived).toBe(content)
  })

  it('carries priority out of a legacy YAML frontmatter block on active items', async () => {
    const { content, body } = legacyFrontmatterItem('old-format-active', { priority: 'high' })
    await seedActive('old-format-active', content)

    await migrateLegacyBacklog(specDir)

    const converted = await readFile(join(specDir, 'issues', 'old-format-active.md'), 'utf8')
    expect(converted).toBe(`---\ntype: idea\nbacklog: true\npriority: high\n---\n${body}`)
  })

  it('omits priority when the legacy frontmatter priority does not parse to high/medium/low', async () => {
    const { content, body } = legacyFrontmatterItem('old-format-weird', { priority: 'urgent' })
    await seedActive('old-format-weird', content)

    await migrateLegacyBacklog(specDir)

    const converted = await readFile(join(specDir, 'issues', 'old-format-weird.md'), 'utf8')
    expect(converted).toBe(`---\ntype: idea\nbacklog: true\n---\n${body}`)
  })

  it('archives originals byte-identically, preserving the done/ subpath', async () => {
    const activeOriginal = legacyItem('Active item', { priority: 'medium' })
    const doneOriginal = legacyItem('Done item')
    await seedActive('active-item', activeOriginal)
    await seedDone('done-item', doneOriginal)

    await migrateLegacyBacklog(specDir)

    const archivedActive = await readFile(join(specDir, 'archive', 'backlog-legacy', 'active-item.md'), 'utf8')
    const archivedDone = await readFile(join(specDir, 'archive', 'backlog-legacy', 'done', 'done-item.md'), 'utf8')
    expect(archivedActive).toBe(activeOriginal)
    expect(archivedDone).toBe(doneOriginal)
    expect(await exists('backlog', 'active-item.md')).toBe(false)
    expect(await exists('backlog', 'done', 'done-item.md')).toBe(false)
  })

  it('removes spec/backlog/done then spec/backlog when fully emptied', async () => {
    await seedActive('one', legacyItem('One'))
    await seedDone('two', legacyItem('Two'))

    await migrateLegacyBacklog(specDir)

    expect(await exists('backlog', 'done')).toBe(false)
    expect(await exists('backlog')).toBe(false)
  })

  it('reports a collision against spec/issues, never overwriting, and retains the legacy file', async () => {
    const existing = '# Dark mode\n\nA pre-existing, unrelated issue.\n'
    await mkdir(join(specDir, 'issues'), { recursive: true })
    await writeFile(join(specDir, 'issues', 'dark-mode.md'), existing, 'utf8')
    const legacy = legacyItem('Dark mode', { priority: 'high' })
    await seedActive('dark-mode', legacy)

    const result = await migrateLegacyBacklog(specDir)
    expect(result.nothingToDo).toBe(false)
    expect(result.converted).toEqual({ active: 0, done: 0 })
    expect(result.collisions).toEqual([
      {
        slug: 'dark-mode',
        legacy_path: 'spec/backlog/dark-mode.md',
        existing_path: 'spec/issues/dark-mode.md',
      },
    ])

    expect(await readFile(join(specDir, 'issues', 'dark-mode.md'), 'utf8')).toBe(existing)
    expect(await readFile(join(specDir, 'backlog', 'dark-mode.md'), 'utf8')).toBe(legacy)
    expect(await exists('backlog')).toBe(true)
  })

  it('reports a collision against spec/issues/resolved for done items', async () => {
    const existing = '# Old thing\n\nAlready resolved elsewhere.\n'
    await mkdir(join(specDir, 'issues', 'resolved'), { recursive: true })
    await writeFile(join(specDir, 'issues', 'resolved', 'old-thing.md'), existing, 'utf8')
    const legacy = legacyItem('Old thing')
    await seedDone('old-thing', legacy)

    const result = await migrateLegacyBacklog(specDir)
    expect(result.collisions).toEqual([
      {
        slug: 'old-thing',
        legacy_path: 'spec/backlog/done/old-thing.md',
        existing_path: 'spec/issues/resolved/old-thing.md',
      },
    ])
    expect(await readFile(join(specDir, 'issues', 'resolved', 'old-thing.md'), 'utf8')).toBe(existing)
    expect(await readFile(join(specDir, 'backlog', 'done', 'old-thing.md'), 'utf8')).toBe(legacy)
  })

  it('treats an existing archive copy as a collision instead of overwriting provenance', async () => {
    const archived = legacyItem('Ghost', { priority: 'low' })
    await mkdir(join(specDir, 'archive', 'backlog-legacy'), { recursive: true })
    await writeFile(join(specDir, 'archive', 'backlog-legacy', 'ghost.md'), archived, 'utf8')
    const legacy = legacyItem('Ghost (recreated)')
    await seedActive('ghost', legacy)

    const result = await migrateLegacyBacklog(specDir)
    expect(result.converted).toEqual({ active: 0, done: 0 })
    expect(result.collisions).toEqual([
      {
        slug: 'ghost',
        legacy_path: 'spec/backlog/ghost.md',
        existing_path: 'spec/archive/backlog-legacy/ghost.md',
      },
    ])
    expect(await readFile(join(specDir, 'archive', 'backlog-legacy', 'ghost.md'), 'utf8')).toBe(archived)
    expect(await exists('issues', 'ghost.md')).toBe(false)
  })

  it('migrates clean items while skipping colliding ones, keeping only the needed dirs', async () => {
    await mkdir(join(specDir, 'issues'), { recursive: true })
    await writeFile(join(specDir, 'issues', 'collide.md'), '# Collide\n', 'utf8')
    await seedActive('collide', legacyItem('Collide'))
    await seedDone('clean-done', legacyItem('Clean done'))

    const result = await migrateLegacyBacklog(specDir)
    expect(result.converted).toEqual({ active: 0, done: 1 })
    expect(result.collisions).toHaveLength(1)
    // Collision-skipped items contribute nothing to changedPaths.
    expect(result.changedPaths).toEqual([
      'spec/issues/resolved/clean-done.md',
      'spec/backlog/done/clean-done.md',
      'spec/archive/backlog-legacy/done/clean-done.md',
    ])

    // done/ emptied and removed; backlog/ kept for the collision straggler.
    expect(await exists('backlog', 'done')).toBe(false)
    expect(await exists('backlog', 'collide.md')).toBe(true)
  })

  it('is a no-op on a second run after full migration', async () => {
    await seedActive('one', legacyItem('One', { priority: 'medium' }))
    await seedDone('two', legacyItem('Two'))
    await migrateLegacyBacklog(specDir)

    const firstIssue = await readFile(join(specDir, 'issues', 'one.md'), 'utf8')
    const secondRun = await migrateLegacyBacklog(specDir)

    expect(secondRun).toEqual({
      nothingToDo: true,
      converted: { active: 0, done: 0 },
      collisions: [],
      archivedTo: 'spec/archive/backlog-legacy',
      changedPaths: [],
    })
    expect(await readFile(join(specDir, 'issues', 'one.md'), 'utf8')).toBe(firstIssue)
  })

  it('re-reports identical collisions with zero writes on repeated runs', async () => {
    const existing = '# Collide\n\nUnrelated.\n'
    await mkdir(join(specDir, 'issues'), { recursive: true })
    await writeFile(join(specDir, 'issues', 'collide.md'), existing, 'utf8')
    const legacy = legacyItem('Collide')
    await seedActive('collide', legacy)

    const first = await migrateLegacyBacklog(specDir)
    const second = await migrateLegacyBacklog(specDir)

    expect(second.nothingToDo).toBe(false)
    expect(second.collisions).toEqual(first.collisions)
    expect(second.converted).toEqual({ active: 0, done: 0 })
    expect(second.changedPaths).toEqual([])
    expect(await readFile(join(specDir, 'issues', 'collide.md'), 'utf8')).toBe(existing)
    expect(await readFile(join(specDir, 'backlog', 'collide.md'), 'utf8')).toBe(legacy)
  })
})
