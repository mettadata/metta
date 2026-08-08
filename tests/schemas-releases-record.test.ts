import { describe, it, expect } from 'vitest'
import {
  BumpLevelEnum,
  ReleaseEntrySchema,
  ReleasesRecordSchema,
} from '../src/schemas/releases-record.js'

const validEntry = {
  version: '0.5.0',
  tag: 'v0.5.0',
  date: '2026-08-09',
  bump: 'minor',
  bump_source: 'derived',
  changes: ['fix-automatic-versioning-release-capability-metta'],
}

describe('BumpLevelEnum', () => {
  it('accepts major, minor, and patch', () => {
    for (const level of ['major', 'minor', 'patch']) {
      expect(BumpLevelEnum.safeParse(level).success).toBe(true)
    }
  })

  it('rejects unknown levels', () => {
    expect(BumpLevelEnum.safeParse('breaking').success).toBe(false)
  })
})

describe('ReleaseEntrySchema', () => {
  it('parses a valid entry and defaults backfilled to false', () => {
    const result = ReleaseEntrySchema.parse(validEntry)
    expect(result.version).toBe('0.5.0')
    expect(result.tag).toBe('v0.5.0')
    expect(result.date).toBe('2026-08-09')
    expect(result.bump).toBe('minor')
    expect(result.bump_source).toBe('derived')
    expect(result.backfilled).toBe(false)
    expect(result.changes).toEqual(['fix-automatic-versioning-release-capability-metta'])
  })

  it('accepts a backfilled entry without bump or bump_source', () => {
    const result = ReleaseEntrySchema.parse({
      version: '0.2.0',
      tag: 'v0.2.0',
      date: '2026-05-01',
      backfilled: true,
      changes: [],
    })
    expect(result.backfilled).toBe(true)
    expect(result.bump).toBeUndefined()
    expect(result.bump_source).toBeUndefined()
  })

  it('rejects a version that is not strict x.y.z', () => {
    for (const version of ['0.5', 'v0.5.0', '0.5.0-rc.1', '0.5.0+build', 'abc']) {
      const result = ReleaseEntrySchema.safeParse({ ...validEntry, version })
      expect(result.success).toBe(false)
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.join('.') === 'version')
        expect(issue).toBeDefined()
      }
    }
  })

  it('rejects a date that is not YYYY-MM-DD', () => {
    for (const date of ['2026-8-9', '09-08-2026', '2026/08/09', 'today']) {
      const result = ReleaseEntrySchema.safeParse({ ...validEntry, date })
      expect(result.success).toBe(false)
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.join('.') === 'date')
        expect(issue).toBeDefined()
      }
    }
  })

  it('rejects an empty tag', () => {
    const result = ReleaseEntrySchema.safeParse({ ...validEntry, tag: '' })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown bump_source', () => {
    const result = ReleaseEntrySchema.safeParse({ ...validEntry, bump_source: 'guessed' })
    expect(result.success).toBe(false)
  })

  it('rejects unknown keys (.strict())', () => {
    const result = ReleaseEntrySchema.safeParse({ ...validEntry, notes: 'extra' })
    expect(result.success).toBe(false)
  })

  it('rejects non-string members of changes', () => {
    const result = ReleaseEntrySchema.safeParse({ ...validEntry, changes: [42] })
    expect(result.success).toBe(false)
  })
})

describe('ReleasesRecordSchema', () => {
  it('parses a valid record with releases newest first', () => {
    const result = ReleasesRecordSchema.parse({
      releases: [
        validEntry,
        {
          version: '0.4.0',
          tag: 'v0.4.0',
          date: '2026-06-01',
          backfilled: true,
          changes: ['roadmap-feature'],
        },
      ],
    })
    expect(result.releases).toHaveLength(2)
    expect(result.releases[0].version).toBe('0.5.0')
    expect(result.releases[1].backfilled).toBe(true)
  })

  it('parses an empty releases array', () => {
    const result = ReleasesRecordSchema.parse({ releases: [] })
    expect(result.releases).toEqual([])
  })

  it('rejects a record missing the releases key', () => {
    expect(ReleasesRecordSchema.safeParse({}).success).toBe(false)
  })

  it('rejects unknown top-level keys (.strict())', () => {
    const result = ReleasesRecordSchema.safeParse({ releases: [], schema_version: 1 })
    expect(result.success).toBe(false)
  })

  it('rejects a record containing an invalid entry', () => {
    const result = ReleasesRecordSchema.safeParse({
      releases: [{ ...validEntry, version: 'not-semver' }],
    })
    expect(result.success).toBe(false)
  })
})
