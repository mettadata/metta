import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  RoadmapStore,
  RoadmapValidationError,
  RoadmapSchema,
  parseRoadmap,
  formatRoadmap,
  validateReorder,
  type RoadmapEntry,
} from '../src/roadmap/roadmap-store.js'

describe('RoadmapStore', () => {
  let tempDir: string
  let store: RoadmapStore

  const roadmapPath = (): string => join(tempDir, 'roadmap.md')

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-roadmap-'))
    store = new RoadmapStore(tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  describe('functional core', () => {
    it('format → parse round-trips ordered entries with notes verbatim', () => {
      const entries: RoadmapEntry[] = [
        { slug: 'auth-refactor', note: 'after schema freeze' },
        { slug: 'dark-mode' },
        { slug: 'billing', note: 'phase one — then phase two' },
      ]
      const content = formatRoadmap(entries)
      expect(content).toBe(
        '# Roadmap\n' +
          '\n' +
          '1. `auth-refactor` — after schema freeze\n' +
          '2. `dark-mode`\n' +
          '3. `billing` — phase one — then phase two\n',
      )
      const parsed = parseRoadmap(content)
      expect(parsed).toEqual(entries)
      // Embedded ` — ` inside a note survives verbatim (first-separator split).
      expect(parsed[2].note).toBe('phase one — then phase two')
      // Round-tripped entries stay schema-valid.
      expect(() => RoadmapSchema.parse(parsed)).not.toThrow()
    })

    it('parseRoadmap ignores non-matching lines (heading, blanks, malformed)', () => {
      const parsed = parseRoadmap(
        '# Roadmap\n\nnot an entry\n1. unbackticked-slug\n2. `valid-entry`\n',
      )
      expect(parsed).toEqual([{ slug: 'valid-entry' }])
    })

    it('validateReorder accepts an exact permutation', () => {
      expect(validateReorder(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual({ ok: true })
    })

    it('validateReorder reports duplicates, missing and extra slugs', () => {
      const check = validateReorder(['a', 'b', 'c'], ['a', 'a', 'd'])
      expect(check).toEqual({
        ok: false,
        duplicates: ['a'],
        missing: ['b', 'c'],
        extra: ['d'],
      })
    })
  })

  describe('list()', () => {
    it('returns [] when the file is missing, without creating it', async () => {
      expect(await store.list()).toEqual([])
      expect(existsSync(roadmapPath())).toBe(false)
    })
  })

  describe('add()', () => {
    it('appends entries and returns the 1-based position', async () => {
      expect(await store.add('first-item')).toBe(1)
      expect(await store.add('second-item', 'a note')).toBe(2)
      expect(await store.list()).toEqual([
        { slug: 'first-item' },
        { slug: 'second-item', note: 'a note' },
      ])
    })

    it('treats a whitespace-only note as absent', async () => {
      await store.add('no-note-item', '   ')
      expect(await store.list()).toEqual([{ slug: 'no-note-item' }])
    })

    it('rejects an unsafe slug before any I/O — file never created', async () => {
      await expect(store.add('../etc/passwd')).rejects.toThrow(/Invalid roadmap slug/)
      expect(existsSync(roadmapPath())).toBe(false)
    })

    it('duplicate slug throws duplicate_entry and leaves the file byte-for-byte unchanged', async () => {
      await store.add('the-item', 'note')
      const before = await readFile(roadmapPath(), 'utf8')
      const err = await store.add('the-item').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(RoadmapValidationError)
      expect((err as RoadmapValidationError).type).toBe('duplicate_entry')
      const after = await readFile(roadmapPath(), 'utf8')
      expect(after).toBe(before)
    })
  })

  describe('reorder()', () => {
    beforeEach(async () => {
      await store.add('a', 'note a')
      await store.add('b')
      await store.add('c', 'note c')
    })

    it('rewrites in the proposed order preserving notes verbatim', async () => {
      await store.reorder(['c', 'a', 'b'])
      expect(await store.list()).toEqual([
        { slug: 'c', note: 'note c' },
        { slug: 'a', note: 'note a' },
        { slug: 'b' },
      ])
      // Canonical rewrite renumbers ordinals from 1.
      const content = await readFile(roadmapPath(), 'utf8')
      expect(content).toBe('# Roadmap\n\n1. `c` — note c\n2. `a` — note a\n3. `b`\n')
    })

    it('rejects an unsafe slug argument before touching the file', async () => {
      const before = await readFile(roadmapPath(), 'utf8')
      await expect(store.reorder(['a', 'b', '../evil'])).rejects.toThrow(/Invalid roadmap slug/)
      expect(await readFile(roadmapPath(), 'utf8')).toBe(before)
    })

    it('rejects omission with invalid_reorder naming the missing slug, file untouched', async () => {
      const before = await readFile(roadmapPath(), 'utf8')
      const err = await store.reorder(['c', 'a']).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(RoadmapValidationError)
      expect((err as RoadmapValidationError).type).toBe('invalid_reorder')
      expect((err as RoadmapValidationError).message).toContain('missing: b')
      expect(await readFile(roadmapPath(), 'utf8')).toBe(before)
    })

    it('rejects addition with invalid_reorder naming the unexpected slug, file untouched', async () => {
      const before = await readFile(roadmapPath(), 'utf8')
      const err = await store.reorder(['a', 'b', 'c', 'ghost']).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(RoadmapValidationError)
      expect((err as RoadmapValidationError).type).toBe('invalid_reorder')
      expect((err as RoadmapValidationError).message).toContain('unexpected: ghost')
      expect(await readFile(roadmapPath(), 'utf8')).toBe(before)
    })

    it('rejects duplicates with invalid_reorder naming the duplicated slug, file untouched', async () => {
      const before = await readFile(roadmapPath(), 'utf8')
      const err = await store.reorder(['a', 'a', 'b', 'c']).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(RoadmapValidationError)
      expect((err as RoadmapValidationError).type).toBe('invalid_reorder')
      expect((err as RoadmapValidationError).message).toContain('duplicated: a')
      expect(await readFile(roadmapPath(), 'utf8')).toBe(before)
    })
  })

  describe('removeTop()', () => {
    it('pops entry 1 and returns it; the next entry becomes top', async () => {
      await store.add('top-item', 'top note')
      await store.add('runner-up')
      const popped = await store.removeTop()
      expect(popped).toEqual({ slug: 'top-item', note: 'top note' })
      expect(await store.list()).toEqual([{ slug: 'runner-up' }])
      // Canonical rewrite renumbers the survivor to ordinal 1.
      expect(await readFile(roadmapPath(), 'utf8')).toBe('# Roadmap\n\n1. `runner-up`\n')
    })

    it('returns null on an empty roadmap with no write', async () => {
      expect(await store.removeTop()).toBeNull()
      expect(existsSync(roadmapPath())).toBe(false)
    })
  })

  it('canonically renumbers cosmetic ordinals from a hand-edited file on the next write', async () => {
    await writeFile(
      roadmapPath(),
      '# Roadmap\n\n7. `zeta`\n3. `alpha` — keep me\n',
      'utf8',
    )
    // Line order is authoritative; ordinals are cosmetic.
    expect(await store.list()).toEqual([{ slug: 'zeta' }, { slug: 'alpha', note: 'keep me' }])
    await store.add('omega')
    expect(await readFile(roadmapPath(), 'utf8')).toBe(
      '# Roadmap\n\n1. `zeta`\n2. `alpha` — keep me\n3. `omega`\n',
    )
  })
})
