import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IssuesStore } from './issues-store.js'

let tmpDir: string
let store: IssuesStore

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'metta-issues-'))
  store = new IssuesStore(tmpDir)
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function issuePath(slug: string): string {
  return join(tmpDir, 'issues', `${slug}.md`)
}

function resolvedPath(slug: string): string {
  return join(tmpDir, 'issues', 'resolved', `${slug}.md`)
}

function seedIssueFile(relPath: string, content: string): void {
  const abs = join(tmpDir, relPath)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
}

describe('IssuesStore parseIssue body tolerance', () => {
  it('round-trips a freeform body with no headings', async () => {
    const description = 'A plain paragraph with no headings.'
    const slug = await store.create('freeform title', description, 'minor')

    const issue = await store.show(slug)

    expect(issue.description).toBe(description)
  })

  it('round-trips a structured H2 body without leaking headings into the title', async () => {
    const description =
      '## Symptom\nfoo fails\n\n## Root Cause Analysis\nbar is broken\n\n### Evidence\nsrc/foo.ts:42 — confirms failure\n\n## Candidate Solutions\n1. Fix bar. Tradeoff: risky.'
    const slug = await store.create('structured title', description, 'minor')

    const issue = await store.show(slug)

    expect(issue.title).toBe('structured title')
    expect(issue.description).toContain('## Symptom')
    expect(issue.description).toContain('## Root Cause Analysis')
    expect(issue.description).toContain('## Candidate Solutions')
    expect(issue.title).not.toContain('##')
  })

  it('keeps metadata boundaries intact when the body starts with an H2', async () => {
    const description = '## Symptom\nsome symptom text here'
    const slug = await store.create('metadata boundary title', description, 'minor')

    const issue = await store.show(slug)

    expect(issue.severity).toBe('minor')
    expect(issue.description.startsWith('## Symptom')).toBe(true)
    expect(issue.severity).not.toContain('##')
  })
})

describe('IssuesStore legacy (frontmatter-less) files', () => {
  it('parses legacy files byte-unchanged with type issue / backlog false defaults', async () => {
    const slug = await store.create('legacy issue', 'plain legacy body', 'major')
    const before = readFileSync(issuePath(slug), 'utf-8')
    expect(before.startsWith('---')).toBe(false)

    const records = await store.list()
    const issue = await store.show(slug)

    // No frontmatter added as a side effect of reading.
    expect(readFileSync(issuePath(slug), 'utf-8')).toBe(before)
    expect(issue.frontmatter).toBeUndefined()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      slug,
      title: 'legacy issue',
      severity: 'major',
      type: 'issue',
      backlog: false,
    })
    expect(records[0].priority).toBeUndefined()
    expect(records[0].milestone).toBeUndefined()
    expect(records[0].order).toBeUndefined()
  })

  it('legacy archive + remove flow is unchanged (verbatim copy, no stamp)', async () => {
    const slug = await store.create('legacy resolve', 'desc', 'minor')
    const original = readFileSync(issuePath(slug), 'utf-8')

    await store.archive(slug)
    await store.remove(slug)

    expect(readFileSync(resolvedPath(slug), 'utf-8')).toBe(original)
    expect(await store.exists(slug)).toBe(false)
  })
})

describe('IssuesStore frontmatter-aware list/show', () => {
  it('list surfaces frontmatter fields and strips the block from titles', async () => {
    seedIssueFile(
      'issues/fm-issue.md',
      '---\ntype: idea\nbacklog: true\npriority: high\nmilestone: v0-6\norder: 2\n---\n# fm issue\n\n**Captured**: 2026-08-01\n**Status**: logged\n**Severity**: major\n\nbody text\n',
    )

    const records = await store.list()

    expect(records).toHaveLength(1)
    expect(records[0]).toEqual({
      slug: 'fm-issue',
      title: 'fm issue',
      severity: 'major',
      captured: '2026-08-01',
      type: 'idea',
      backlog: true,
      priority: 'high',
      milestone: 'v0-6',
      order: 2,
    })
  })

  it('captured falls back to **Added** for migrated ideas', async () => {
    seedIssueFile(
      'issues/migrated-idea.md',
      '---\ntype: idea\nbacklog: true\n---\n# migrated idea\n\n**Added**: 2026-07-15\n**Priority**: high\n\nlegacy backlog body\n',
    )

    const records = await store.list()

    expect(records[0].captured).toBe('2026-07-15')
    expect(records[0].type).toBe('idea')
  })

  it('show strips the frontmatter block and populates the frontmatter field', async () => {
    seedIssueFile(
      'issues/fm-show.md',
      '---\nbacklog: true\npriority: low\n---\n# fm show\n\n**Captured**: 2026-08-02\n**Status**: logged\n**Severity**: minor\n\nthe body below frontmatter\n',
    )

    const issue = await store.show('fm-show')

    expect(issue.title).toBe('fm show')
    expect(issue.description).toBe('the body below frontmatter')
    expect(issue.description).not.toContain('---')
    expect(issue.frontmatter).toEqual({
      type: 'issue',
      backlog: true,
      priority: 'low',
    })
  })

  it('accepts partial frontmatter with defaults applied', async () => {
    seedIssueFile(
      'issues/partial-fm.md',
      '---\npriority: medium\n---\n# partial fm\n\n**Captured**: 2026-08-03\n**Status**: logged\n**Severity**: minor\n\nbody\n',
    )

    const records = await store.list()

    expect(records[0]).toMatchObject({ type: 'issue', backlog: false, priority: 'medium' })
  })
})

describe('IssuesStore.create with frontmatter fields', () => {
  it('writes priority and milestone as a frontmatter block', async () => {
    const slug = await store.create('prioritized issue', 'desc', 'major', undefined, {
      priority: 'high',
      milestone: 'v0-6',
    })

    const content = readFileSync(issuePath(slug), 'utf-8')
    expect(content.startsWith('---\n')).toBe(true)

    const records = await store.list()
    expect(records[0]).toMatchObject({
      slug,
      type: 'issue',
      backlog: false,
      priority: 'high',
      milestone: 'v0-6',
      severity: 'major',
    })
  })

  it('adds no frontmatter block when the fifth param has no defined keys', async () => {
    const slug = await store.create('plain create', 'desc', 'minor', undefined, {})
    expect(readFileSync(issuePath(slug), 'utf-8').startsWith('---')).toBe(false)
  })
})

describe('IssuesStore.createIdea', () => {
  it('mints a type idea / backlog true entry above a standard issue body', async () => {
    const slug = await store.createIdea('dark mode', 'Add a dark theme.', {
      priority: 'medium',
      order: 3,
      milestone: 'v0-6',
    })
    expect(slug).toBe('dark-mode')

    const content = readFileSync(issuePath(slug), 'utf-8')
    expect(content.startsWith('---\n')).toBe(true)

    const issue = await store.show(slug)
    expect(issue.frontmatter).toEqual({
      type: 'idea',
      backlog: true,
      priority: 'medium',
      order: 3,
      milestone: 'v0-6',
    })
    expect(issue.title).toBe('dark mode')
    expect(issue.severity).toBe('minor')
    expect(issue.status).toBe('logged')
    expect(issue.captured).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(issue.description).toBe('Add a dark theme.')
  })

  it('works without optional fields and shows up in list as a backlogged idea', async () => {
    const slug = await store.createIdea('simple idea', 'just a thought')

    const records = await store.list()
    expect(records[0]).toMatchObject({ slug, type: 'idea', backlog: true })
    expect(records[0].priority).toBeUndefined()
  })
})

describe('IssuesStore.updateFrontmatter', () => {
  it('adds a frontmatter block to a legacy file and preserves the body bytes', async () => {
    const slug = await store.create('to backlog', 'body to preserve', 'minor')
    const before = readFileSync(issuePath(slug), 'utf-8')

    const result = await store.updateFrontmatter(slug, { backlog: true, priority: 'high' })

    expect(result.changed).toBe(true)
    const after = readFileSync(issuePath(slug), 'utf-8')
    expect(after.endsWith(before)).toBe(true) // original content byte-preserved below the block
    const issue = await store.show(slug)
    expect(issue.frontmatter).toMatchObject({ backlog: true, priority: 'high' })
  })

  it('is idempotent: identical patch returns changed false and leaves the file untouched', async () => {
    const slug = await store.create('idempotent target', 'desc', 'minor')
    await store.updateFrontmatter(slug, { backlog: true })
    const before = readFileSync(issuePath(slug), 'utf-8')

    const result = await store.updateFrontmatter(slug, { backlog: true })

    expect(result.changed).toBe(false)
    expect(readFileSync(issuePath(slug), 'utf-8')).toBe(before)
  })

  it('targeted patch leaves untouched fields and body intact', async () => {
    seedIssueFile(
      'issues/targeted.md',
      '---\ntype: idea\nbacklog: true\npriority: high\n---\n# targeted\n\n**Captured**: 2026-08-01\n**Status**: logged\n**Severity**: minor\n\nbody stays\n',
    )

    const result = await store.updateFrontmatter('targeted', { order: 1 })

    expect(result.changed).toBe(true)
    const content = readFileSync(join(tmpDir, 'issues', 'targeted.md'), 'utf-8')
    expect(content).toContain('type: idea')
    expect(content).toContain('priority: high')
    expect(content).toContain('order: 1')
    expect(content.endsWith('# targeted\n\n**Captured**: 2026-08-01\n**Status**: logged\n**Severity**: minor\n\nbody stays\n')).toBe(true)
  })

  it('throws not-found for an unknown slug', async () => {
    await expect(store.updateFrontmatter('nope', { backlog: true })).rejects.toThrow(
      /Issue 'nope' not found/,
    )
  })
})

describe('IssuesStore.listResolved', () => {
  it('returns records over spec/issues/resolved with the same shape', async () => {
    seedIssueFile(
      'issues/resolved/done-idea.md',
      '---\ntype: idea\nmilestone: v0-6\n---\n# done idea\n\n**Captured**: 2026-07-01\n**Status**: logged\n**Severity**: minor\n\nresolved body\n',
    )
    seedIssueFile(
      'issues/resolved/legacy-done.md',
      '# legacy done\n\n**Captured**: 2026-06-01\n**Status**: logged\n**Severity**: major\n\nold resolved\n',
    )

    const records = await store.listResolved()

    expect(records).toHaveLength(2)
    const idea = records.find(r => r.slug === 'done-idea')
    const legacy = records.find(r => r.slug === 'legacy-done')
    expect(idea).toMatchObject({ type: 'idea', milestone: 'v0-6', captured: '2026-07-01' })
    expect(legacy).toMatchObject({ type: 'issue', backlog: false, severity: 'major' })
  })

  it('returns empty when the resolved directory is absent', async () => {
    expect(await store.listResolved()).toEqual([])
  })
})

describe('IssuesStore.archive frontmatter carry-through and Shipped-in stamp', () => {
  it('carries frontmatter into resolved/ verbatim without a changeName', async () => {
    const slug = await store.createIdea('archive idea', 'idea body', { priority: 'low' })
    const original = readFileSync(issuePath(slug), 'utf-8')

    await store.archive(slug)

    expect(readFileSync(resolvedPath(slug), 'utf-8')).toBe(original)
  })

  it('appends the Shipped-in stamp after the body when changeName is given', async () => {
    const slug = await store.createIdea('shipped idea', 'idea body', { milestone: 'v0-6' })
    const original = readFileSync(issuePath(slug), 'utf-8')

    await store.archive(slug, 'some-change-name')

    const archived = readFileSync(resolvedPath(slug), 'utf-8')
    expect(archived.startsWith(original)).toBe(true) // frontmatter + body untouched
    expect(archived.endsWith('\n**Shipped-in**: some-change-name\n')).toBe(true)

    const resolved = await store.listResolved()
    expect(resolved[0]).toMatchObject({ slug, type: 'idea', milestone: 'v0-6' })
  })

  it('rejects an unsafe changeName', async () => {
    const slug = await store.create('safe issue', 'desc', 'minor')
    await expect(store.archive(slug, '../escape')).rejects.toThrow(/Invalid change name/)
  })
})
