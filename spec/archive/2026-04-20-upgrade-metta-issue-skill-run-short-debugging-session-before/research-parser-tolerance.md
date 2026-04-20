# Research: Parser Tolerance for Structured Issue Bodies

**Change:** upgrade-metta-issue-skill-run-short-debugging-session-before
**Date:** 2026-04-20
**Author:** technical-researcher

---

## Problem Summary

`parseIssue` in `src/issues/issues-store.ts` extracts `description` as everything
after the `**Severity**:` metadata line. Today that block is always a freeform
paragraph. After this upgrade, new issues will contain H2 sections
(`## Symptom`, `## Root Cause Analysis`, `### Evidence`, `## Candidate Solutions`).
The parser must survive both shapes without migration and without breaking
`metta issues show --json` — the single interface `/metta-fix-issues` reads at step 1.

---

## Existing Code Baseline

`parseIssue` (lines 34–46 of `src/issues/issues-store.ts`):

```ts
const descStart = lines.findIndex((l, i) => i > 0 && l.startsWith('**Severity**:'))
const description = lines.slice(descStart + 1).join('\n').trim()
```

This already passes the remainder verbatim as a string — it has no H2 awareness
whatsoever. `formatIssue` writes `description` verbatim after `**Severity**:`.
No structural change exists today.

There is no `src/issues/issues-store.test.ts`. Test surface is currently zero.

Legacy issue format (both files under `spec/issues/`) places the metadata block
*before* the body, contrary to the canonical `formatIssue` output which writes
metadata *after* the H1 title. Both real issue files have metadata inline at top
and the description duplicated in the body. This is a pre-existing format
inconsistency; it does not affect parsing because `parseIssue` anchors on
`**Severity**:` regardless of position.

---

## Downstream Consumer Constraint

The spec requires `/metta-fix-issues` step 1 to **display** the structured
sections read from `metta issues show <slug> --json`. It must display them to
the orchestrator — it does not need to programmatically split them. The JSON
payload already contains the full `description` string. The skill can locate and
print the H2 sections using simple markdown rendering or substring detection at
the skill layer, with no parser-level field splitting required.

---

## Options Evaluated

### Option 1 — Pass-through (keep `parseIssue` unchanged)

`parseIssue` already slices everything after `**Severity**:` and joins it as a
string. H2 headings are just more text. No code change to `issues-store.ts` is
required; `description` in the JSON output contains the full structured body
intact.

- **Backward compat:** Perfect. Freeform bodies continue to parse. No file
  writes needed.
- **Extensibility:** Adding new sections later (e.g., `## Workaround`) costs
  nothing — the parser ignores section structure entirely.
- **Consistency:** `stories-parser.ts` uses remark-parse with full AST walking.
  Pass-through is not consistent with that pattern, but `stories-parser` must
  validate structured content. Issue bodies do not require structural validation
  at parse time.
- **Test surface:** 2–3 new test cases: freeform body round-trips, structured
  body round-trips, empty body edge case. All minimal.
- **Performance:** Irrelevant — issue files are under 2 KB.

The one gap: `metta issues show --json` returns `description` as a flat string.
`/metta-fix-issues` must locate H2 sections in that string at the skill layer.
This is trivial — the skill is already reading markdown; it can render the
description field as-is. The spec explicitly states "the orchestrator reads the
sections directly from the JSON returned by `metta issues show --json`."

### Option 2 — Structured split (expose optional typed fields)

Extend `Issue` interface with `symptom?: string`, `rootCauseAnalysis?: string`,
`evidence?: string`, `candidateSolutions?: string`. Extend `parseIssue` to
additionally split on `## Symptom`, `## Root Cause Analysis`,
`## Candidate Solutions` via string scanning.

- **Backward compat:** Good — legacy issues with no H2 sections would produce
  `undefined` for the new fields; `description` still holds the full body.
- **Extensibility:** Adding `## Workaround` later requires updating `Issue`,
  `parseIssue`, any Zod schema wrapping `Issue`, and downstream consumers. Four
  touch points per new section.
- **Consistency:** Closer to how `stories-parser` exposes discrete typed fields.
  But stories is a strict schema where every field is required. Issue sections
  are optional and editorial — the analogy is weak.
- **Test surface:** 6–8 new cases: each new field present/absent, overlap
  between `description` and split fields.
- **Performance:** Irrelevant.

The critical gap: the spec says `/metta-fix-issues` only **displays** the
sections — it does not pass them to separate code paths. Typed split fields
would exist on the interface but be consumed nowhere in the fix flow. This is
speculative generality that the spec explicitly calls out of scope.

### Option 3 — remark-parse AST

Parse the body markdown into an AST via `unified().use(remarkParse)`. Walk
heading nodes to extract section content by label.

- **Backward compat:** Good — freeform bodies parse fine; sections simply will
  not be found.
- **Extensibility:** Adding a section requires adding a heading label constant.
  Low friction.
- **Consistency:** Matches `stories-parser.ts` exactly. `remark-parse` is
  already a dependency.
- **Test surface:** Same 2–3 cases as option 1, but AST path has more setup.
- **Performance:** Irrelevant.

The gap: remark-parse is the right tool when the caller needs structured AST
semantics — node types, children, inline markup. For extracting raw markdown
text between two headings (which is all the display case needs), it is
significant machinery for zero marginal benefit over pass-through. `stories-parser`
justified the AST because it validates story fields, parses acceptance-criterion
triples, and enforces ordering. None of that applies here.

### Option 4 — Regex-based sectioner

Same semantics as option 3 but uses a regex split on `^## ` boundaries to
produce a `Map<string, string>` of section label to raw content.

```ts
function splitSections(body: string): Map<string, string> {
  const sections = new Map<string, string>()
  const parts = body.split(/\n(?=## )/)
  for (const part of parts) {
    const nl = part.indexOf('\n')
    if (nl === -1) continue
    const heading = part.slice(0, nl).replace(/^## /, '').trim()
    sections.set(heading, part.slice(nl + 1).trim())
  }
  return sections
}
```

- **Backward compat:** Good — bodies without `## ` boundaries produce an empty
  map; full `description` string is still available.
- **Extensibility:** Adding a section: no code change to the splitter. It
  discovers sections dynamically.
- **Consistency:** Does not match the remark-parse idiom used in `stories-parser`.
- **Test surface:** 4–5 cases: no sections, all three sections, partial sections,
  nested `###` inside a section.
- **Performance:** Irrelevant.

The gap: same as option 3 — the downstream consumer only needs the flat string
for display. A generic section map is over-engineering relative to the spec
requirement.

---

## Recommendation: Option 1 (Pass-through)

`parseIssue` already returns the full body verbatim as `description`. No code
change to `issues-store.ts` is required to satisfy the spec requirement that
"parseIssue MUST continue to split on `**Severity**:` and return the remainder
as description regardless of whether that body contains H2 headings."

The only code work for this file is:

1. Confirm (via a targeted test) that the existing slice handles H2 lines without
   accidentally treating them as metadata fields. The answer is yes: no metadata
   predicate (`l.startsWith('**Captured**:')`, etc.) matches an H2 line.

2. Add the minimal test cases to make that guarantee explicit.

The spec's downstream requirement for `/metta-fix-issues` is display, not field
extraction. The orchestrator receives a JSON object with a `description` string
containing the full markdown body and renders it. No typed split is needed.
Options 2–4 all add complexity that the spec has explicitly ruled out of scope.

---

## Diff Sketch

### `src/issues/issues-store.ts` — no functional change required

The current `parseIssue` is already correct. The only change is a defensive
comment for future readers:

```diff
   const descStart = lines.findIndex((l, i) => i > 0 && l.startsWith('**Severity**:'))
-  const description = lines.slice(descStart + 1).join('\n').trim()
+  // Body is returned verbatim — may be a freeform paragraph or structured H2 sections.
+  // Callers must not attempt to parse H2 headings out of this field; use the raw string.
+  const description = lines.slice(descStart + 1).join('\n').trim()
```

No change to `Issue` interface, `formatIssue`, or `IssuesStore` methods.

### New test file: `src/issues/issues-store.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { IssuesStore } from './issues-store.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('IssuesStore.show — parser tolerance', () => {
  let dir: string
  let store: IssuesStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'metta-issues-test-'))
    store = new IssuesStore(dir)
  })

  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('round-trips a freeform (legacy) body', async () => {
    const slug = await store.create('title', 'plain paragraph body', 'minor')
    const issue = await store.show(slug)
    expect(issue.description).toBe('plain paragraph body')
  })

  it('round-trips a structured body with H2 sections', async () => {
    const body = '## Symptom\nfoo hangs\n## Root Cause Analysis\nbar\n### Evidence\nsrc/foo.ts:42\n## Candidate Solutions\n1. fix bar — tradeoff: touches hot path'
    const slug = await store.create('foo hangs on startup', body, 'major')
    const issue = await store.show(slug)
    expect(issue.description).toContain('## Symptom')
    expect(issue.description).toContain('## Root Cause Analysis')
    expect(issue.description).toContain('## Candidate Solutions')
    expect(issue.title).toBe('foo hangs on startup')
  })

  it('does not misattribute H2 lines as metadata fields', async () => {
    const body = '## Symptom\nsome symptom'
    const slug = await store.create('test issue', body, 'minor')
    const issue = await store.show(slug)
    expect(issue.captured).toBeTruthy()
    expect(issue.severity).toBe('minor')
    expect(issue.description).toMatch(/^## Symptom/)
  })
})
```

Three test cases. No mocks required beyond a tmp directory.

---

## Summary Table

| Criterion            | Pass-through | Structured split | remark-parse AST | Regex sectioner |
|----------------------|:---:|:---:|:---:|:---:|
| Backward compat      | + | + | + | + |
| Code delta           | minimal | medium | medium | small |
| Spec requirement fit | exact | over-specified | over-specified | over-specified |
| Consistency w/ codebase | n/a | partial | high | low |
| New test cases       | 3 | 6-8 | 3-4 | 4-5 |
| Risk                 | none | interface churn | dependency risk | regex edge cases |

Option 1 is the minimum correct implementation. The spec is explicit: the parser
requirement is tolerance (no throws, no empty description), not field extraction.
Everything else is deferred until a downstream consumer actually needs split
fields — at which point option 4 (regex sectioner) is the fastest upgrade path
that avoids pulling remark-parse into a non-spec-validation context.
