import { describe, it, expect } from 'vitest'
import { toBacklogEntries, sortBacklogEntries, type BacklogEntry } from '../src/backlog/backlog-view.js'
import type { IssueRecord } from '../src/issues/issues-store.js'

function record(overrides: Partial<IssueRecord> & { slug: string }): IssueRecord {
  return {
    title: overrides.slug,
    severity: 'minor',
    captured: '2026-08-01',
    type: 'issue',
    backlog: false,
    ...overrides,
  }
}

function entry(overrides: Partial<BacklogEntry> & { slug: string }): BacklogEntry {
  return {
    title: overrides.slug,
    type: 'issue',
    captured: '2026-08-01',
    ...overrides,
  }
}

describe('toBacklogEntries', () => {
  it('selects exactly the records with backlog === true, any type', () => {
    const records = [
      record({ slug: 'flagged-issue', backlog: true }),
      record({ slug: 'flagged-idea', backlog: true, type: 'idea' }),
      record({ slug: 'unflagged', backlog: false }),
    ]

    const entries = toBacklogEntries(records)
    expect(entries.map((e) => e.slug)).toEqual(['flagged-issue', 'flagged-idea'])
    expect(entries[1].type).toBe('idea')
  })

  it('excludes frontmatter-less legacy records (backlog defaults false)', () => {
    // A frontmatter-less file parses to type: 'issue', backlog: false — the
    // record shape carries no marker beyond those defaults.
    const legacy = record({ slug: 'legacy-no-frontmatter' })
    expect(toBacklogEntries([legacy])).toEqual([])
  })

  it('renders defaults: backlog-only frontmatter yields a valid entry without priority or order', () => {
    const entries = toBacklogEntries([record({ slug: 'bare', title: 'Bare item', backlog: true })])

    expect(entries).toEqual([
      {
        slug: 'bare',
        title: 'Bare item',
        type: 'issue',
        priority: undefined,
        order: undefined,
        milestone: undefined,
        captured: '2026-08-01',
      },
    ])
  })

  it('carries optional fields through when present', () => {
    const entries = toBacklogEntries([
      record({
        slug: 'full',
        backlog: true,
        type: 'idea',
        priority: 'medium',
        order: 3,
        milestone: 'v0.6',
        captured: '2026-07-15',
      }),
    ])

    expect(entries[0]).toMatchObject({
      priority: 'medium',
      order: 3,
      milestone: 'v0.6',
      captured: '2026-07-15',
    })
  })

  it('returns an empty array for no records', () => {
    expect(toBacklogEntries([])).toEqual([])
  })
})

describe('sortBacklogEntries', () => {
  it('orders the spec scenario deterministically: C, B, A, D', () => {
    const a = entry({ slug: 'a', priority: 'low', order: 1 })
    const b = entry({ slug: 'b', priority: 'high', order: 2 })
    const c = entry({ slug: 'c', priority: 'high', order: 1 })
    const d = entry({ slug: 'd' })

    const sorted = sortBacklogEntries([a, b, c, d])
    expect(sorted.map((e) => e.slug)).toEqual(['c', 'b', 'a', 'd'])
  })

  it('sorts priority high < medium < low < none', () => {
    const sorted = sortBacklogEntries([
      entry({ slug: 'none' }),
      entry({ slug: 'low', priority: 'low' }),
      entry({ slug: 'medium', priority: 'medium' }),
      entry({ slug: 'high', priority: 'high' }),
    ])
    expect(sorted.map((e) => e.slug)).toEqual(['high', 'medium', 'low', 'none'])
  })

  it('within a priority bucket, undefined order sorts after defined order', () => {
    const sorted = sortBacklogEntries([
      entry({ slug: 'no-order', priority: 'high' }),
      entry({ slug: 'order-2', priority: 'high', order: 2 }),
      entry({ slug: 'order-1', priority: 'high', order: 1 }),
    ])
    expect(sorted.map((e) => e.slug)).toEqual(['order-1', 'order-2', 'no-order'])
  })

  it('breaks order ties by captured date ascending', () => {
    const sorted = sortBacklogEntries([
      entry({ slug: 'newer', priority: 'medium', order: 1, captured: '2026-08-10' }),
      entry({ slug: 'older', priority: 'medium', order: 1, captured: '2026-08-01' }),
    ])
    expect(sorted.map((e) => e.slug)).toEqual(['older', 'newer'])
  })

  it('breaks captured-date ties by slug ascending', () => {
    const sorted = sortBacklogEntries([
      entry({ slug: 'zeta', captured: '2026-08-01' }),
      entry({ slug: 'alpha', captured: '2026-08-01' }),
    ])
    expect(sorted.map((e) => e.slug)).toEqual(['alpha', 'zeta'])
  })

  it('does not mutate its input', () => {
    const input = [entry({ slug: 'b', priority: 'low' }), entry({ slug: 'a', priority: 'high' })]
    const snapshot = input.map((e) => e.slug)

    sortBacklogEntries(input)
    expect(input.map((e) => e.slug)).toEqual(snapshot)
  })
})
