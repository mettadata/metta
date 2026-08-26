import type { Milestone } from './milestones-store.js'
import type { IssueRecord } from '../issues/issues-store.js'

/**
 * Single glyph source for milestone status markers across all render sites
 * (milestone list, status, progress) so glyphs cannot drift.
 */
export const MILESTONE_MARKERS = { open: '▸', closed: '✓', abandoned: '✗' } as const

export interface MilestoneRollup {
  slug: string
  name: string
  status: Milestone['status']
  target?: string
  open: number
  resolved: number
  total: number
  /** `Math.round(resolved / total * 100)`, 0 when `total === 0`. */
  percent: number
  openIssues: Array<{ slug: string; title: string }>
  resolvedIssues: Array<{ slug: string; title: string }>
}

/**
 * Pure single-pass bucketing: O(issues + milestones). Issues whose milestone
 * slug has no milestone file produce a warning string (naming the issue and
 * the unknown slug), never a failure. Issues without a `milestone` field
 * contribute to no bucket and no warning. Milestones with zero issues roll up
 * 0/0/0 at 0%. Rollups are sorted open-first, then terminal, then slug
 * ascending.
 */
export function computeMilestoneRollups(
  milestones: Milestone[],
  openIssues: IssueRecord[],
  resolvedIssues: IssueRecord[],
): { rollups: MilestoneRollup[]; warnings: string[] } {
  const bySlug = new Map<string, MilestoneRollup>()
  for (const milestone of milestones) {
    bySlug.set(milestone.slug, {
      slug: milestone.slug,
      name: milestone.name,
      status: milestone.status,
      ...(milestone.target !== undefined ? { target: milestone.target } : {}),
      open: 0,
      resolved: 0,
      total: 0,
      percent: 0,
      openIssues: [],
      resolvedIssues: [],
    })
  }

  const warnings: string[] = []

  function bucket(records: IssueRecord[], kind: 'open' | 'resolved'): void {
    for (const record of records) {
      if (record.milestone === undefined) continue
      const rollup = bySlug.get(record.milestone)
      if (rollup === undefined) {
        warnings.push(
          `Issue '${record.slug}' references unknown milestone '${record.milestone}' (no spec/milestones/${record.milestone}.md)`,
        )
        continue
      }
      if (kind === 'open') {
        rollup.open += 1
        rollup.openIssues.push({ slug: record.slug, title: record.title })
      } else {
        rollup.resolved += 1
        rollup.resolvedIssues.push({ slug: record.slug, title: record.title })
      }
    }
  }

  bucket(openIssues, 'open')
  bucket(resolvedIssues, 'resolved')

  const rollups = [...bySlug.values()]
  for (const rollup of rollups) {
    rollup.total = rollup.open + rollup.resolved
    rollup.percent = rollup.total === 0 ? 0 : Math.round((rollup.resolved / rollup.total) * 100)
  }

  const rank = (s: Milestone['status']): number => (s === 'open' ? 0 : 1)
  rollups.sort(
    (a, b) => rank(a.status) - rank(b.status) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  )

  return { rollups, warnings }
}
