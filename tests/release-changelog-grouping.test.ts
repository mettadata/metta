import { describe, expect, it } from 'vitest'
import {
  groupEntriesByRelease,
  type ChangelogEntryInput,
} from '../src/release/changelog-grouping.js'
import type { ReleaseEntry, ReleasesRecord } from '../src/schemas/releases-record.js'

function entry(dirName: string, date = '2026-08-01'): ChangelogEntryInput {
  return {
    dirName,
    date,
    changeName: dirName.replace(/^\d{4}-\d{2}-\d{2}-/, ''),
    summaryContent: `Summary for ${dirName}`,
  }
}

function release(overrides: Partial<ReleaseEntry> & Pick<ReleaseEntry, 'version' | 'changes'>): ReleaseEntry {
  return {
    tag: `v${overrides.version}`,
    date: '2026-08-01',
    backfilled: false,
    ...overrides,
  }
}

function record(...releases: ReleaseEntry[]): ReleasesRecord {
  return { releases }
}

describe('groupEntriesByRelease', () => {
  it('splits entries across the release boundary: recorded entries in the version, rest in Unreleased', () => {
    const a = entry('2026-07-01-change-a')
    const b = entry('2026-07-02-change-b')
    const c = entry('2026-07-03-change-c')
    const groups = groupEntriesByRelease(
      [a, b, c],
      record(release({ version: '0.5.0', date: '2026-07-10', changes: [a.dirName, b.dirName] })),
    )

    expect(groups).toHaveLength(2)
    expect(groups[0]).toEqual({ version: null, date: null, entries: [c] })
    expect(groups[1]).toEqual({
      version: '0.5.0',
      date: '2026-07-10',
      entries: [a, b],
    })
  })

  it('returns release groups in record order (newest first) after Unreleased', () => {
    const a = entry('2026-06-01-old-change')
    const b = entry('2026-07-01-new-change')
    const c = entry('2026-08-01-pending-change')
    const groups = groupEntriesByRelease(
      [a, b, c],
      record(
        release({ version: '0.6.0', date: '2026-07-05', changes: [b.dirName] }),
        release({ version: '0.5.0', date: '2026-06-05', changes: [a.dirName] }),
      ),
    )

    expect(groups.map((g) => g.version)).toEqual([null, '0.6.0', '0.5.0'])
    expect(groups[1]!.entries).toEqual([b])
    expect(groups[2]!.entries).toEqual([a])
    expect(groups[0]!.entries).toEqual([c])
  })

  it('omits the Unreleased group when every entry is attributed', () => {
    const a = entry('2026-07-01-change-a')
    const groups = groupEntriesByRelease(
      [a],
      record(release({ version: '0.5.0', changes: [a.dirName] })),
    )

    expect(groups.map((g) => g.version)).toEqual(['0.5.0'])
  })

  it('keeps empty release groups when no archive entries survive for a recorded release', () => {
    const groups = groupEntriesByRelease(
      [],
      record(release({ version: '0.4.0', changes: ['2026-05-01-vanished-change'] })),
    )

    expect(groups).toEqual([
      { version: '0.4.0', date: '2026-08-01', entries: [] },
    ])
  })

  it('places each entry exactly once when a corrupt record lists a dirName in two releases (first match wins)', () => {
    const a = entry('2026-07-01-duplicated-change')
    const groups = groupEntriesByRelease(
      [a],
      record(
        release({ version: '0.6.0', changes: [a.dirName] }),
        release({ version: '0.5.0', changes: [a.dirName] }),
      ),
    )

    const appearances = groups.flatMap((g) =>
      g.entries.filter((e) => e.dirName === a.dirName).map(() => g.version),
    )
    expect(appearances).toEqual(['0.6.0'])
    expect(groups.find((g) => g.version === '0.5.0')!.entries).toEqual([])
  })

  it('ignores unknown dirNames in the record without inventing entries', () => {
    const a = entry('2026-07-01-real-change')
    const groups = groupEntriesByRelease(
      [a],
      record(
        release({
          version: '0.5.0',
          changes: ['2026-01-01-never-existed', a.dirName],
        }),
      ),
    )

    expect(groups).toEqual([
      { version: '0.5.0', date: '2026-08-01', entries: [a] },
    ])
  })

  it('returns a single Unreleased group when the record has no releases', () => {
    const a = entry('2026-07-01-change-a')
    const b = entry('2026-07-02-change-b')
    const groups = groupEntriesByRelease([a, b], record())

    expect(groups).toEqual([{ version: null, date: null, entries: [a, b] }])
  })

  it('returns an empty array for no entries and no releases', () => {
    expect(groupEntriesByRelease([], record())).toEqual([])
  })

  it('does not mutate its inputs', () => {
    const a = entry('2026-07-01-change-a')
    const entries = [a]
    const rec = record(release({ version: '0.5.0', changes: [a.dirName] }))
    const entriesSnapshot = JSON.parse(JSON.stringify(entries))
    const recordSnapshot = JSON.parse(JSON.stringify(rec))

    groupEntriesByRelease(entries, rec)

    expect(entries).toEqual(entriesSnapshot)
    expect(rec).toEqual(recordSnapshot)
  })
})
