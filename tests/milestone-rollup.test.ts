import { describe, it, expect } from 'vitest'
import { computeMilestoneRollups } from '../src/milestones/milestone-rollup.js'
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

  it('returns empty rollups and no warnings for empty inputs', () => {
    expect(computeMilestoneRollups([], [], [])).toEqual({ rollups: [], warnings: [] })
  })

  it('omits target when the milestone has none', () => {
    const { rollups } = computeMilestoneRollups([milestone({ slug: 'v0-6' })], [], [])
    expect('target' in rollups[0]).toBe(false)
  })
})
