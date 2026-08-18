import { z } from 'zod'
import { StateStore } from '../state/state-store.js'
import { SLUG_RE, assertSafeSlug } from '../util/slug.js'

// The roadmap lives in a single ordered markdown file, spec/roadmap.md, owned
// by RoadmapStore. Entry-line grammar (canonical, per schemas/roadmap-file.md):
//
//   <ordinal>. `<slug>`[ — <note>]
//
// - <slug> matches SLUG_RE, wrapped in backticks.
// - The note separator is space + em dash (U+2014) + space; the note is
//   everything after the FIRST separator to end of line, verbatim (embedded
//   ` — ` inside a note round-trips). Notes are single-line; empty or
//   whitespace-only notes are absent.
// - Line order is authoritative; ordinals are cosmetic and renumbered
//   canonically on every write.
// - Non-matching lines (heading, blanks) are ignored on parse; the writer
//   always emits `# Roadmap` + blank line + numbered entries + trailing newline.
const ROADMAP_FILE = 'roadmap.md'
const ENTRY_RE = /^\d+\.\s+`([a-z0-9][a-z0-9-]{0,59})`(?:\s+—\s+(.+))?\s*$/

// Zod schemas — validation runs on every read and write path.
export const RoadmapEntrySchema = z.object({
  slug: z.string().regex(SLUG_RE),
  note: z.string().min(1).optional(),
})
export const RoadmapSchema = z.array(RoadmapEntrySchema)
export type RoadmapEntry = z.infer<typeof RoadmapEntrySchema>

// Typed error discriminators for the CLI envelope (ADR-2): the CLI maps
// `instanceof RoadmapValidationError` to `err.type` instead of sniffing
// message prefixes.
export class RoadmapValidationError extends Error {
  constructor(
    readonly type: 'duplicate_entry' | 'invalid_reorder' | 'not_found',
    message: string,
  ) {
    super(message)
    this.name = 'RoadmapValidationError'
  }
}

// --- Pure functional core (exported for direct unit testing) ---

export function parseRoadmap(content: string): RoadmapEntry[] {
  const entries: RoadmapEntry[] = []
  for (const line of content.split('\n')) {
    const match = ENTRY_RE.exec(line)
    if (!match) continue
    const entry: RoadmapEntry = { slug: match[1] }
    if (match[2] !== undefined) entry.note = match[2]
    entries.push(entry)
  }
  return entries
}

export function formatRoadmap(entries: RoadmapEntry[]): string {
  const lines = ['# Roadmap', '']
  entries.forEach((entry, index) => {
    const note = entry.note !== undefined ? ` — ${entry.note}` : ''
    lines.push(`${index + 1}. \`${entry.slug}\`${note}`)
  })
  return lines.join('\n') + '\n'
}

export type ReorderCheck =
  | { ok: true }
  | { ok: false; duplicates: string[]; missing: string[]; extra: string[] }

export function validateReorder(current: string[], proposed: string[]): ReorderCheck {
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const slug of proposed) {
    if (seen.has(slug)) {
      if (!duplicates.includes(slug)) duplicates.push(slug)
    } else {
      seen.add(slug)
    }
  }
  const currentSet = new Set(current)
  const missing = current.filter((slug) => !seen.has(slug))
  const extra = [...seen].filter((slug) => !currentSet.has(slug))
  if (duplicates.length === 0 && missing.length === 0 && extra.length === 0) {
    return { ok: true }
  }
  return { ok: false, duplicates, missing, extra }
}

// --- Imperative shell ---

export class RoadmapStore {
  private readonly state: StateStore

  constructor(private readonly specDir: string) {
    this.state = new StateStore(specDir)
  }

  // Read path: readRaw → parseRoadmap → RoadmapSchema.parse → return.
  // Missing file → [] without creating it.
  private async load(): Promise<RoadmapEntry[]> {
    if (!(await this.state.exists(ROADMAP_FILE))) return []
    return RoadmapSchema.parse(parseRoadmap(await this.state.readRaw(ROADMAP_FILE)))
  }

  // Write path: RoadmapSchema.parse → formatRoadmap → single full writeRaw.
  // Only schema-validated data is ever serialized; validation always precedes
  // the write, so a failing invocation leaves the file untouched.
  private async save(entries: RoadmapEntry[]): Promise<void> {
    await this.state.writeRaw(ROADMAP_FILE, formatRoadmap(RoadmapSchema.parse(entries)))
  }

  async list(): Promise<RoadmapEntry[]> {
    return this.load()
  }

  /** Appends a backlog slug to the end of the roadmap; returns its 1-based position. */
  async add(slug: string, note?: string): Promise<number> {
    assertSafeSlug(slug, 'roadmap slug')
    const trimmedNote = note?.trim()
    const entries = await this.load()
    if (entries.some((entry) => entry.slug === slug)) {
      throw new RoadmapValidationError(
        'duplicate_entry',
        `Roadmap already contains '${slug}'`,
      )
    }
    const entry: RoadmapEntry = { slug }
    // Whitespace-only note is treated as absent.
    if (trimmedNote !== undefined && trimmedNote.length > 0) entry.note = trimmedNote
    entries.push(entry)
    await this.save(entries)
    return entries.length
  }

  /** Rewrites the roadmap in the proposed order; args must be an exact permutation. */
  async reorder(slugs: string[]): Promise<void> {
    for (const slug of slugs) assertSafeSlug(slug, 'roadmap slug')
    const entries = await this.load()
    const check = validateReorder(entries.map((entry) => entry.slug), slugs)
    if (!check.ok) {
      const parts: string[] = []
      if (check.duplicates.length > 0) parts.push(`duplicated: ${check.duplicates.join(', ')}`)
      if (check.missing.length > 0) parts.push(`missing: ${check.missing.join(', ')}`)
      if (check.extra.length > 0) parts.push(`unexpected: ${check.extra.join(', ')}`)
      throw new RoadmapValidationError('invalid_reorder', `invalid reorder — ${parts.join('; ')}`)
    }
    const bySlug = new Map(entries.map((entry) => [entry.slug, entry]))
    // Notes are preserved verbatim: entries are re-mapped, never re-built.
    const reordered = slugs.map((slug) => bySlug.get(slug) as RoadmapEntry)
    await this.save(reordered)
  }

  // Shared write core for remove/removeSlugs/retire (design "One write
  // path"): filters out the entries at `indices`, persists via the
  // canonical save(), and returns the removed entries in roadmap order.
  private async spliceAndSave(
    entries: RoadmapEntry[],
    indices: ReadonlySet<number>,
  ): Promise<RoadmapEntry[]> {
    const kept: RoadmapEntry[] = []
    const removed: RoadmapEntry[] = []
    entries.forEach((entry, index) => {
      if (indices.has(index)) {
        removed.push(entry)
      } else {
        kept.push(entry)
      }
    })
    await this.save(kept)
    return removed
  }

  /**
   * Removes one entry by 1-based position (number) or slug (string).
   * Miss → throws RoadmapValidationError('not_found', ...), file untouched.
   * The string branch never calls assertSafeSlug: `remove` never writes the
   * target string into the file and builds no path from it.
   */
  async remove(target: string | number): Promise<{ entry: RoadmapEntry; position: number }> {
    const entries = await this.load()
    let index: number
    if (typeof target === 'number') {
      index = target - 1
      if (index < 0 || index >= entries.length) {
        throw new RoadmapValidationError(
          'not_found',
          `No roadmap entry at position ${target} (roadmap has ${entries.length} entries)`,
        )
      }
    } else {
      index = entries.findIndex((entry) => entry.slug === target)
      if (index === -1) {
        throw new RoadmapValidationError('not_found', `No roadmap entry with slug '${target}'`)
      }
    }
    const [entry] = await this.spliceAndSave(entries, new Set([index]))
    return { entry, position: index + 1 }
  }

  /**
   * Removes every entry whose slug is in `slugs`, in a single
   * load/validate/save. Any slug matching no entry → throws
   * RoadmapValidationError('not_found', ...), file untouched (defensive:
   * callers passing slugs they just read means a miss is a concurrent
   * write). Empty input → no-op, returns [], no write. Returns removed
   * entries in roadmap order.
   */
  async removeSlugs(slugs: string[]): Promise<RoadmapEntry[]> {
    if (slugs.length === 0) return []
    const entries = await this.load()
    const wanted = new Set(slugs)
    const indices = new Set<number>()
    entries.forEach((entry, index) => {
      if (wanted.has(entry.slug)) indices.add(index)
    })
    const foundSlugs = new Set(
      [...indices].map((index) => entries[index].slug),
    )
    for (const slug of slugs) {
      if (!foundSlugs.has(slug)) {
        throw new RoadmapValidationError('not_found', `No roadmap entry with slug '${slug}'`)
      }
    }
    return this.spliceAndSave(entries, indices)
  }

  /**
   * No-throw retire for resolution hooks: removes ALL entries matching
   * `slug` (duplicate-tolerant). No match (including absent
   * spec/roadmap.md) → returns [] with no write and no file creation.
   * Returns removed entries.
   */
  async retire(slug: string): Promise<RoadmapEntry[]> {
    const entries = await this.load()
    const indices = new Set<number>()
    entries.forEach((entry, index) => {
      if (entry.slug === slug) indices.add(index)
    })
    if (indices.size === 0) return []
    return this.spliceAndSave(entries, indices)
  }
}
