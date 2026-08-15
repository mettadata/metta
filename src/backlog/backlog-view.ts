import type { IssueRecord } from '../issues/issues-store.js'

export interface BacklogEntry {
  slug: string
  title: string
  type: 'issue' | 'idea'
  priority?: 'high' | 'medium' | 'low'
  order?: number
  milestone?: string
  captured: string
}

const PRIORITY_RANK: Record<'high' | 'medium' | 'low', number> = {
  high: 0,
  medium: 1,
  low: 2,
}

function priorityRank(priority: BacklogEntry['priority']): number {
  return priority === undefined ? 3 : PRIORITY_RANK[priority]
}

/**
 * Filter: exactly the records with `backlog === true` (any type). Legacy
 * frontmatter-less records are excluded structurally because `backlog`
 * defaults to false.
 */
export function toBacklogEntries(records: IssueRecord[]): BacklogEntry[] {
  return records
    .filter((record) => record.backlog)
    .map((record) => ({
      slug: record.slug,
      title: record.title,
      type: record.type,
      priority: record.priority,
      order: record.order,
      milestone: record.milestone,
      captured: record.captured,
    }))
}

/**
 * Sort: priority (`high` < `medium` < `low` < none) → `order` ascending within
 * a priority bucket (undefined after defined) → captured date ascending →
 * slug ascending (determinism tiebreak). Pure — returns a new array.
 */
export function sortBacklogEntries(entries: BacklogEntry[]): BacklogEntry[] {
  return [...entries].sort((a, b) => {
    const byPriority = priorityRank(a.priority) - priorityRank(b.priority)
    if (byPriority !== 0) {
      return byPriority
    }
    if (a.order !== b.order) {
      if (a.order === undefined) {
        return 1
      }
      if (b.order === undefined) {
        return -1
      }
      return a.order - b.order
    }
    if (a.captured !== b.captured) {
      return a.captured < b.captured ? -1 : 1
    }
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0
  })
}
