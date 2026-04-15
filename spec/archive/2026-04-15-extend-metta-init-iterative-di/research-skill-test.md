# Research: skill-structure.test.ts for metta-init SKILL.md

## Q1 — Existing test helpers for reading template files

No shared helper module exists. The pattern used throughout the repo is ad-hoc inline
`readFile` at the top of each test file. The canonical example is
`tests/skill-discovery-loop.test.ts`, which does:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const repoRoot = join(import.meta.dirname, '..')
const path = join(repoRoot, 'src', 'templates', 'skills', 'metta-propose', 'SKILL.md')
const contents = await readFile(path, 'utf8')
```

`import.meta.dirname` is the correct ESM idiom used by every existing test. No
abstraction layer, no fixture loader, no beforeAll setup — just a module-level const
that resolves the path at import time and per-test `readFile` calls inside each `it`.

---

## Q2 — Correct test file location

`vitest.config.ts` sets `include: ['tests/**/*.test.ts']` — this is the only glob
Vitest scans. A file placed at
`src/templates/skills/metta-init/__tests__/skill-structure.test.ts` will NOT be
discovered automatically.

**Decision: place the test at `tests/skill-structure-metta-init.test.ts`.**

This matches every existing test in the project and requires zero config changes
(satisfying REQ-40). The spec's path (`src/templates/…/__tests__/…`) is aspirational
but contradicts the actual discovery config — the executor must use `tests/`.

---

## Q3 — Parser approach

Three options were evaluated:

**Option A — string `includes` / `split` (recommended)**
- Already used in `tests/skill-discovery-loop.test.ts` for identical structural checks
  (exit phrase, round headings, status line phrases).
- Zero new dependencies.
- Sufficient for all four REQs: heading count, phrase occurrences, per-section
  WebSearch presence, per-section AskUserQuestion count.
- Section slicing: `content.split(/^## Round/im)` yields per-round text chunks; no AST
  needed.

**Option B — remark-parse / unified**
- Used in `src/specs/spec-parser.ts` and `src/constitution/constitution-parser.ts` as
  production code, not test helpers.
- Tests in `tests/spec-parser.test.ts` and `tests/constitution-parser.test.ts` still
  rely on string assertions, not the parser's AST, for their own content checks.
- Adds unnecessary complexity and an async pipeline for assertions that are trivially
  expressible as regex matches on raw text.

**Option C — regex only**
- Viable but marginally less readable than `split`-then-`includes` for the section
  isolation step.

**Recommendation: Option A.** Consistent with existing skill tests, no new imports,
directly expresses the spec's intent.

---

## Q4 — Copy-ready test code

File path: `tests/skill-structure-metta-init.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const SKILL_PATH = join(
  import.meta.dirname,
  '..',
  'src', 'templates', 'skills', 'metta-init', 'SKILL.md'
)
const EXIT_PHRASE = "I'm done \u2014 proceed with these answers"

async function sections(): Promise<{ r1: string; r2: string; r3: string; full: string }> {
  const full = await readFile(SKILL_PATH, 'utf8')
  // Split on lines that start a Round heading (## Round N or ## Round N —)
  const parts = full.split(/(?=^## Round \d)/im)
  const r1 = parts.find(p => /^## Round 1/im.test(p)) ?? ''
  const r2 = parts.find(p => /^## Round 2/im.test(p)) ?? ''
  const r3 = parts.find(p => /^## Round 3/im.test(p)) ?? ''
  return { r1, r2, r3, full }
}

function countOccurrences(text: string, needle: string): number {
  let count = 0
  let pos = 0
  while ((pos = text.indexOf(needle, pos)) !== -1) { count++; pos++ }
  return count
}

describe('metta-init SKILL.md — structural assertions', () => {
  it('REQ-35: contains exactly 3 Round headings', async () => {
    const { full } = await sections()
    const matches = full.match(/^## Round \d/gim) ?? []
    expect(matches).toHaveLength(3)
  })

  it('REQ-36: early-exit phrase appears at least once per round (≥3 total)', async () => {
    const { r1, r2, r3 } = await sections()
    expect(r1).toContain(EXIT_PHRASE)
    expect(r2).toContain(EXIT_PHRASE)
    expect(r3).toContain(EXIT_PHRASE)
  })

  it('REQ-37: WebSearch does NOT appear in the Round 1 section', async () => {
    const { r1 } = await sections()
    expect(r1).not.toContain('WebSearch')
  })

  it('REQ-38: WebSearch DOES appear in Round 2 and Round 3 sections', async () => {
    const { r2, r3 } = await sections()
    expect(r2).toContain('WebSearch')
    expect(r3).toContain('WebSearch')
  })

  it('REQ-39: no round has more than 4 AskUserQuestion references', async () => {
    const { r1, r2, r3 } = await sections()
    expect(countOccurrences(r1, 'AskUserQuestion')).toBeLessThanOrEqual(4)
    expect(countOccurrences(r2, 'AskUserQuestion')).toBeLessThanOrEqual(4)
    expect(countOccurrences(r3, 'AskUserQuestion')).toBeLessThanOrEqual(4)
  })
})
```

**Notes for the executor:**

- The `sections()` helper splits on `## Round N` lookahead so each chunk contains the
  heading plus everything up to the next round heading. This cleanly isolates R1, R2,
  R3 text without needing an AST.
- `EXIT_PHRASE` uses a Unicode em-dash (`\u2014`) to match the literal text in the
  spec. The executor should confirm the actual character in the written SKILL.md and
  adjust if needed.
- The test exports nothing (satisfies REQ-40).
- No `vitest.config.ts` changes required — file lives in `tests/`.
