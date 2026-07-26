# Data Model: spec/roadmap.md file format

## On-disk format (canonical)

A single markdown file at `spec/roadmap.md`, owned exclusively by `RoadmapStore`. Line order is the authoritative execution order; the ordinal numbers are cosmetic and rewritten canonically on every write.

```markdown
# Roadmap

1. `auth-refactor` — after schema freeze
2. `dark-mode`
```

Grammar per entry line:

```
<ordinal>. `<slug>`[ — <note>]
```

- `<slug>` — must match `SLUG_RE` (`/^[a-z0-9][a-z0-9-]{0,59}$/`) from `src/util/slug.ts`; wrapped in backticks.
- `— <note>` — optional; separator is space + em dash (U+2014) + space. The note is everything after the **first** separator to end of line, verbatim (an embedded ` — ` inside a note round-trips because the regex captures the rest of the line). Notes are single-line; empty/whitespace-only notes are treated as absent.
- Lines not matching the entry regex (the `# Roadmap` heading, blank lines) are ignored by the parser; the writer always emits the canonical heading + blank line + numbered entries + trailing newline, so writes are deterministic and reorder/add/pop failures that never reach the write leave the file byte-for-byte untouched.

Entry-line regex (parse):

```ts
const ENTRY_RE = /^\d+\.\s+`([a-z0-9][a-z0-9-]{0,59})`(?:\s+—\s+(.+))?\s*$/
```

## Parsed shape and Zod schema

```ts
import { z } from 'zod'
import { SLUG_RE } from '../util/slug.js'

export const RoadmapEntrySchema = z.object({
  slug: z.string().regex(SLUG_RE),
  note: z.string().min(1).optional(),
})

export const RoadmapSchema = z.array(RoadmapEntrySchema)

export type RoadmapEntry = z.infer<typeof RoadmapEntrySchema>
```

Validation points (constitution: Zod on every state read/write; `StateStore.readRaw`/`writeRaw` are schema-less, so the store applies the schema itself):

- **Read path:** `readRaw` → `parseRoadmap(content)` → `RoadmapSchema.parse(entries)` → return. Missing file (ENOENT) → `[]` without creating the file.
- **Write path:** `RoadmapSchema.parse(entries)` → `formatRoadmap(entries)` → `writeRaw`. Only schema-validated data is ever serialized.

## CLI JSON projection (status view)

Each entry in `metta roadmap --json` output is derived at the CLI layer by resolving the slug against `BacklogStore.show`:

```jsonc
{
  "roadmap": [
    { "position": 1, "slug": "auth-refactor", "title": "Auth refactor", "note": "after schema freeze" },
    { "position": 2, "slug": "old-idea", "title": null, "note": null, "dangling": true }
  ]
}
```

- `position` is 1-based, derived from array index, never stored.
- `title` comes from the backlog item; a failed `show` marks the entry `dangling: true` instead of crashing.
- `dangling` is only present (as `true`) on dangling entries; resolvable entries omit it.
