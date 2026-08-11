import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ZodError } from 'zod'
import YAML from 'yaml'
import { loadReleasesRecord, saveReleasesRecord } from '../src/release/releases-record-store.js'
import { ReleasesRecordSchema, type ReleasesRecord } from '../src/schemas/releases-record.js'

const sampleRecord: ReleasesRecord = {
  releases: [
    {
      version: '0.5.0',
      tag: 'v0.5.0',
      date: '2026-08-09',
      bump: 'minor',
      bump_source: 'derived',
      backfilled: false,
      changes: ['2026-08-09-add-release-capability'],
    },
    {
      version: '0.4.0',
      tag: 'v0.4.0',
      date: '2026-06-01',
      backfilled: true,
      changes: ['2026-05-30-roadmap-feature', '2026-05-28-fix-issues-command'],
    },
  ],
}

describe('releases-record-store', () => {
  let specDir: string

  beforeEach(async () => {
    specDir = await mkdtemp(join(tmpdir(), 'metta-releases-'))
  })

  afterEach(async () => {
    await rm(specDir, { recursive: true, force: true })
  })

  describe('loadReleasesRecord', () => {
    it('returns null when releases.yaml is absent', async () => {
      const result = await loadReleasesRecord(specDir)
      expect(result).toBeNull()
    })

    it('rethrows non-ENOENT filesystem errors', async () => {
      // A directory at the record path yields EISDIR on read, not ENOENT.
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(specDir, 'releases.yaml'))
      await expect(loadReleasesRecord(specDir)).rejects.toThrow()
    })

    it('throws on malformed YAML', async () => {
      await writeFile(join(specDir, 'releases.yaml'), 'releases: [\n  {unclosed', 'utf-8')
      await expect(loadReleasesRecord(specDir)).rejects.toThrow()
    })

    it('throws a ZodError on schema-invalid content', async () => {
      await writeFile(
        join(specDir, 'releases.yaml'),
        YAML.stringify({ releases: [{ version: 'not-semver', tag: '', date: 'yesterday', changes: [] }] }),
        'utf-8',
      )
      await expect(loadReleasesRecord(specDir)).rejects.toThrow(ZodError)
    })

    it('throws a ZodError on unknown keys (strict schema)', async () => {
      await writeFile(
        join(specDir, 'releases.yaml'),
        YAML.stringify({ releases: [], extra: true }),
        'utf-8',
      )
      await expect(loadReleasesRecord(specDir)).rejects.toThrow(ZodError)
    })

    it('applies schema defaults (backfilled defaults to false)', async () => {
      await writeFile(
        join(specDir, 'releases.yaml'),
        YAML.stringify({
          releases: [{ version: '1.0.0', tag: 'v1.0.0', date: '2026-01-01', changes: [] }],
        }),
        'utf-8',
      )
      const result = await loadReleasesRecord(specDir)
      expect(result?.releases[0]?.backfilled).toBe(false)
    })
  })

  describe('saveReleasesRecord', () => {
    it('round-trips save then load', async () => {
      await saveReleasesRecord(specDir, sampleRecord)
      const result = await loadReleasesRecord(specDir)
      expect(result).toEqual(sampleRecord)
    })

    it('rejects invalid records before writing (no unvalidated writes)', async () => {
      const invalid = {
        releases: [{ version: 'v1.2.3', tag: 'v1.2.3', date: '2026-01-01', changes: [] }],
      } as unknown as ReleasesRecord
      await expect(saveReleasesRecord(specDir, invalid)).rejects.toThrow(ZodError)
      expect(await loadReleasesRecord(specDir)).toBeNull()
    })

    it('writes valid YAML re-parseable by the schema', async () => {
      await saveReleasesRecord(specDir, sampleRecord)
      const raw = await readFile(join(specDir, 'releases.yaml'), 'utf-8')
      const reparsed = ReleasesRecordSchema.parse(YAML.parse(raw))
      expect(reparsed).toEqual(sampleRecord)
    })

    it('creates the spec directory if missing', async () => {
      const nested = join(specDir, 'nested', 'spec')
      await saveReleasesRecord(nested, { releases: [] })
      expect(await loadReleasesRecord(nested)).toEqual({ releases: [] })
    })

    it('overwrites an existing record', async () => {
      await saveReleasesRecord(specDir, sampleRecord)
      const updated: ReleasesRecord = { releases: [] }
      await saveReleasesRecord(specDir, updated)
      expect(await loadReleasesRecord(specDir)).toEqual(updated)
    })
  })
})
