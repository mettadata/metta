import { describe, it, expect } from 'vitest'
import { computeMilestoneRollups, MILESTONE_MARKERS } from '../src/milestones/milestone-rollup.js'
import type { Milestone } from '../src/milestones/milestones-store.js'
import type { IssueRecord } from '../src/issues/issues-store.js'

function milestone(overrides: Partial<Milestone> & { slug: string }): Milestone {
  return {
    name: overrides.slug,
    status: 'open',
    description: '',
    ...overrides,
  }
}

function record(overrides: Partial<IssueRecord> & { slug: string }): IssueRecord {
  return {
    title: overrides.slug,
    severity: 'minor',
    captured: '2026-08-16',
    type: 'issue',
    backlog: false,
    ...overrides,
  }
}

describe('computeMilestoneRollups', () => {
  it('buckets open and resolved records into the referenced milestone', () => {
    const { rollups, warnings } = computeMilestoneRollups(
      [milestone({ slug: 'v0-6', name: 'v0.6', target: '2026-09-01' })],
      [
        record({ slug: 'open-a', title: 'Open A', milestone: 'v0-6' }),
        record({ slug: 'open-b', title: 'Open B', milestone: 'v0-6' }),
      ],
      [record({ slug: 'done-a', title: 'Done A', milestone: 'v0-6' })],
    )

    expect(warnings).toEqual([])
    expect(rollups).toHaveLength(1)
    const [rollup] = rollups
    expect(rollup.slug).toBe('v0-6')
    expect(rollup.name).toBe('v0.6')
    expect(rollup.target).toBe('2026-09-01')
    expect(rollup.status).toBe('open')
    expect(rollup.open).toBe(2)
    expect(rollup.resolved).toBe(1)
    expect(rollup.total).toBe(3)
    expect(rollup.openIssues).toEqual([
      { slug: 'open-a', title: 'Open A' },
      { slug: 'open-b', title: 'Open B' },
    ])
    expect(rollup.resolvedIssues).toEqual([{ slug: 'done-a', title: 'Done A' }])
  })

  it('rounds percent to a whole number (1 of 3 → 33)', () => {
    const { rollups } = computeMilestoneRollups(
      [milestone({ slug: 'v0-6' })],
      [
        record({ slug: 'a', milestone: 'v0-6' }),
        record({ slug: 'b', milestone: 'v0-6' }),
      ],
      [record({ slug: 'c', milestone: 'v0-6' })],
    )
    expect(rollups[0].percent).toBe(33)
  })

  it('rounds 2 of 3 up to 67', () => {
    const { rollups } = computeMilestoneRollups(
      [milestone({ slug: 'v0-6' })],
      [record({ slug: 'a', milestone: 'v0-6' })],
      [
        record({ slug: 'b', milestone: 'v0-6' }),
        record({ slug: 'c', milestone: 'v0-6' }),
      ],
    )
    expect(rollups[0].percent).toBe(67)
  })

  it('rolls up an empty milestone as 0/0/0 at 0% without failing', () => {
    const { rollups, warnings } = computeMilestoneRollups([milestone({ slug: 'v0-7' })], [], [])

    expect(warnings).toEqual([])
    expect(rollups).toEqual([
      {
        slug: 'v0-7',
        name: 'v0-7',
        status: 'open',
        open: 0,
        resolved: 0,
        total: 0,
        percent: 0,
        openIssues: [],
        resolvedIssues: [],
      },
    ])
  })

  it('warns (never fails) on a dangling milestone reference, naming issue and slug', () => {
    const { rollups, warnings } = computeMilestoneRollups(
      [milestone({ slug: 'v0-6' })],
      [record({ slug: 'stray-issue', milestone: 'v9-9' })],
      [record({ slug: 'stray-resolved', milestone: 'v9-9' })],
    )

    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('stray-issue')
    expect(warnings[0]).toContain('v9-9')
    expect(warnings[1]).toContain('stray-resolved')
    expect(warnings[1]).toContain('v9-9')
    // The dangling records contribute to no bucket.
    expect(rollups[0].total).toBe(0)
  })

  it('ignores milestone-less records with no bucket and no warning', () => {
    const { rollups, warnings } = computeMilestoneRollups(
      [milestone({ slug: 'v0-6' })],
      [record({ slug: 'legacy-open' })],
      [record({ slug: 'legacy-resolved' })],
    )

    expect(warnings).toEqual([])
    expect(rollups[0].total).toBe(0)
    expect(rollups[0].openIssues).toEqual([])
    expect(rollups[0].resolvedIssues).toEqual([])
  })

  it('sorts rollups open-first, then slug ascending', () => {
    const { rollups } = computeMilestoneRollups(
      [
        milestone({ slug: 'v0-5', status: 'closed' }),
        milestone({ slug: 'v0-8' }),
        milestone({ slug: 'v0-1', status: 'closed' }),
        milestone({ slug: 'v0-6' }),
      ],
      [],
      [],
    )
    expect(rollups.map(r => r.slug)).toEqual(['v0-6', 'v0-8', 'v0-1', 'v0-5'])
  })

  it('sorts mixed open/closed/abandoned open-first, then terminal slug-ascending', () => {
    const { rollups } = computeMilestoneRollups(
      [
        milestone({ slug: 'v0-3', status: 'abandoned' }),
        milestone({ slug: 'v0-5', status: 'closed' }),
        milestone({ slug: 'v0-8' }),
        milestone({ slug: 'v0-1', status: 'abandoned' }),
        milestone({ slug: 'v0-4', status: 'closed' }),
        milestone({ slug: 'v0-6' }),
      ],
      [],
      [],
    )
    // Open group first (slug ascending), then the terminal group (closed and
    // abandoned interleaved) slug ascending — no closed/abandoned sub-ordering.
    expect(rollups.map(r => r.slug)).toEqual(['v0-6', 'v0-8', 'v0-1', 'v0-3', 'v0-4', 'v0-5'])
  })

  it('orders open/closed-only inputs identically to the pre-rank comparator (byte-compat pin)', () => {
    // The old comparator was: a.status !== b.status ? (a.status === 'open' ? -1 : 1) : slug cmp.
    // Pin its output on a two-state permutation so the rank comparator provably reproduces it.
    const input: Milestone[] = [
      milestone({ slug: 'z-closed', status: 'closed' }),
      milestone({ slug: 'a-open' }),
      milestone({ slug: 'a-closed', status: 'closed' }),
      milestone({ slug: 'z-open' }),
      milestone({ slug: 'm-open' }),
      milestone({ slug: 'm-closed', status: 'closed' }),
    ]
    const legacyComparator = (a: Milestone, b: Milestone): number => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0
    }
    const expected = [...input].sort(legacyComparator).map(m => m.slug)

    const { rollups } = computeMilestoneRollups(input, [], [])
    expect(rollups.map(r => r.slug)).toEqual(expected)
    expect(rollups.map(r => r.slug)).toEqual([
      'a-open',
      'm-open',
      'z-open',
      'a-closed',
      'm-closed',
      'z-closed',
    ])
  })

  it('passes abandoned through the rollup row', () => {
    const { rollups, warnings } = computeMilestoneRollups(
      [milestone({ slug: 'v0-2', status: 'abandoned' })],
      [record({ slug: 'open-a', milestone: 'v0-2' })],
      [record({ slug: 'done-a', milestone: 'v0-2' })],
    )

    expect(warnings).toEqual([])
    expect(rollups).toHaveLength(1)
    expect(rollups[0].status).toBe('abandoned')
    expect(rollups[0].open).toBe(1)
    expect(rollups[0].resolved).toBe(1)
    expect(rollups[0].total).toBe(2)
  })

  it('returns empty rollups and no warnings for empty inputs', () => {
    expect(computeMilestoneRollups([], [], [])).toEqual({ rollups: [], warnings: [] })
  })

  it('omits target when the milestone has none', () => {
    const { rollups } = computeMilestoneRollups([milestone({ slug: 'v0-6' })], [], [])
    expect('target' in rollups[0]).toBe(false)
  })
})

describe('MILESTONE_MARKERS', () => {
  it('covers all three statuses with distinct glyphs', () => {
    expect(MILESTONE_MARKERS).toEqual({ open: '▸', closed: '✓', abandoned: '✗' })
    const statuses: Array<Milestone['status']> = ['open', 'closed', 'abandoned']
    for (const status of statuses) {
      expect(MILESTONE_MARKERS[status]).toBeTruthy()
    }
    expect(new Set(Object.values(MILESTONE_MARKERS)).size).toBe(3)
  })
})
