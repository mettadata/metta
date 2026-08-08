import type { ReleasesRecord } from '../schemas/releases-record.js'

export interface ChangelogEntryInput {
  dirName: string
  date: string
  changeName: string
  summaryContent: string
}

export interface ReleaseGroup {
  /** Semver string for a cut release; null means the Unreleased group. */
  version: string | null
  /** Release date for a cut release; null for the Unreleased group. */
  date: string | null
  entries: ChangelogEntryInput[]
}

/**
 * Groups archive changelog entries by release, using the releases record as
 * the source of attribution: an entry belongs to the release whose `changes`
 * array lists its dirName; entries listed in no release go to Unreleased.
 *
 * Guarantees:
 * - Every input entry appears in exactly one group. If a corrupt record lists
 *   the same dirName in more than one release, the first match in
 *   `record.releases` order (newest first) wins — later listings are ignored.
 * - Return order is `[Unreleased, ...record.releases order]`, with the
 *   Unreleased group included only when it has entries. Release groups are
 *   kept even when empty (e.g. a recorded release whose archive dirs no
 *   longer exist) so recorded history always renders.
 * - Unknown dirNames in the record (no matching archive entry) are ignored.
 *
 * Pure: no I/O, inputs are not mutated.
 */
export function groupEntriesByRelease(
  entries: ChangelogEntryInput[],
  record: ReleasesRecord,
): ReleaseGroup[] {
  const byDirName = new Map<string, ChangelogEntryInput>()
  for (const entry of entries) {
    byDirName.set(entry.dirName, entry)
  }

  const claimed = new Set<string>()
  const releaseGroups: ReleaseGroup[] = []

  for (const release of record.releases) {
    const groupEntries: ChangelogEntryInput[] = []
    for (const dirName of release.changes) {
      if (claimed.has(dirName)) {
        // Corrupt record: dirName already attributed to an earlier
        // (newer) release in record order — first match wins.
        continue
      }
      claimed.add(dirName)
      const entry = byDirName.get(dirName)
      if (entry !== undefined) {
        groupEntries.push(entry)
      }
    }
    releaseGroups.push({
      version: release.version,
      date: release.date,
      entries: groupEntries,
    })
  }

  const unreleasedEntries = entries.filter(
    (entry) => !claimed.has(entry.dirName),
  )

  if (unreleasedEntries.length === 0) {
    return releaseGroups
  }

  return [
    { version: null, date: null, entries: unreleasedEntries },
    ...releaseGroups,
  ]
}
