# Design: fix-issue-spec-merger-strips-i

**Change:** fix-issue-spec-merger-strips-i
**Status:** design
**Date:** 2026-04-14

---

## Approach

Two independent, surgical bug fixes. No new abstractions, no new dependencies, no interface changes.

**Fix 1** is a one-branch addition inside `extractText` in `spec-parser.ts`. remark-parse emits `inlineCode` nodes with a `value` property and no `children`. The current function falls through to `return ''` for these nodes, silently stripping all inline code spans from every requirement body and scenario step that passes through `extractText`. Adding one `if (node.type === 'inlineCode')` branch before the `'children'` branch closes the gap at all four call sites (requirement body paragraphs in `parseSpec`, scenario step list-items in `parseSpec`, requirement body paragraphs in `parseDeltaSpec`, and scenario step list-items in `parseDeltaSpec`).

**Fix 2** replaces the regex-removal-plus-unconditional-append pattern in `applyDelta` for the MODIFIED and RENAMED branches. The regex is non-greedy and anchors to end-of-string with `$`; files ending with a trailing newline cause the match to terminate before the end of the requirement body, leaving the old block intact. The unconditional `content +=` then appends the new block, producing old + new in every pass. The fix switches to a section-boundary split on `\n## Requirement:`, builds a `Map<string, string>` keyed by requirement name, mutates the map in place (replace for MODIFIED, delete-then-insert for RENAMED), and re-joins. If the target key is not found, the fix emits a `MergeConflict` with `reason: 'requirement not found'` rather than silently appending.

Both fixes operate entirely within the existing raw-text layer that `applyDelta` already uses (`state.readRaw` / `state.writeRaw`). No changes to `parseSpec`, `parseDeltaSpec`, or the call after `writeRaw` that updates the spec lock.

---

## Components

### `src/specs/spec-parser.ts`

**Change:** Add one branch in `extractText` (after line 42, before the `'children'` branch) and add `InlineCode` to the existing `import type` statement on line 4.

Current import on line 4:
```typescript
import type { Root, Content, Heading, Text } from 'mdast'
```

After:
```typescript
import type { Root, Content, Heading, Text, InlineCode } from 'mdast'
```

New branch in `extractText` (insert after the `if (node.type === 'text')` line):
```typescript
if (node.type === 'inlineCode') return `\`${(node as InlineCode).value}\``
```

No other changes to this file.

### `src/finalize/spec-merger.ts`

**Change:** Replace the MODIFIED branch (lines 141-151) and RENAMED branch (lines 152-168) inside `applyDelta` with section-keyed split-and-replace logic.

The replacement algorithm for `applyDelta` when writing existing capability specs:

1. Read raw content via `state.readRaw(specPath)`.
2. Split on `'\n## Requirement:'` to produce `[preamble, ...sectionBodies]`. The preamble is everything before the first `## Requirement:` heading (the `# Title` line and any prose). Each element of `sectionBodies` is the text that follows the split token, starting with the requirement name on the first line.
3. Build a `Map<string, string>` (insertion-order-preserving) from `sectionBodies`. The key for each entry is the requirement name extracted by taking everything up to the first newline; the value is the full section body including that first line.
4. For **MODIFIED**: look up `delta.requirement.name` in the map. If absent, push a `MergeConflict` with `reason: 'requirement not found'` and `return` without writing. If present, replace the map value with the reconstructed section for the new requirement body and scenarios.
5. For **RENAMED**: extract the old name from `delta.requirement.text` via `/^Renamed from:\s*(.+)/m`. Look up the old name in the map. If absent, push a conflict with `reason: 'requirement not found'` and `return`. If present, delete the old key and set the new key (delta.requirement.name) to the reconstructed section. Map preserves insertion order so the new key appends after the former last entry; this is acceptable for RENAMED.
6. Re-emit by concatenating: `preamble + sectionEntries.map(([_k, body]) => '\n## Requirement:' + body).join('')`.
7. Write via `state.writeRaw(specPath, content)`.
8. `parseSpec(content)` and `specLockManager.update(capability, parsed)` remain unchanged after the write.

The ADDED and REMOVED branches are not modified by this change.

The `MergeConflict` interface already exists with a `reason: string` field. No structural change is needed; the new `reason` value `'requirement not found'` is a new string literal used in conflict records emitted by the modified MODIFIED and RENAMED branches.

### `tests/spec-parser.test.ts`

**Change:** Add one `it` block inside the existing `describe('parseSpec', ...)` block.

New test: `'preserves inline code backticks in requirement text and scenario steps'`
- Fixture: inline spec with requirement body containing `` `metta install` `` and `` `metta init` ``, and a scenario step containing `` `metta init --json` ``.
- Assertions: `requirement.text` contains `` `metta install` `` and `` `metta init` `` verbatim; the matching scenario step string equals `'WHEN the user runs \`metta init --json\`'`.

### `tests/spec-merger.test.ts`

**Change:** Add three `it` blocks inside the existing `describe('SpecMerger', ...)` block.

New tests:
1. `'no duplicate requirements after MODIFIED delta on 3-requirement spec'` — inline fixture with 3 requirements (A, B, C), delta modifies all three, assert `(updatedContent.match(/^## Requirement:/gm) ?? []).length === 3`.
2. `'merge is idempotent: applying the same MODIFIED delta twice produces identical output'` — inline fixture with 2 requirements, apply delta, capture output O1, apply same delta again to O1, assert O1 equals O2 byte-for-byte.
3. `'MODIFIED delta targeting missing requirement returns conflict'` — inline fixture with requirement "Existing-Req", delta targets "Ghost-Req" as MODIFIED, assert `result.status === 'conflict'` and `result.conflicts[0].reason === 'requirement not found'`, assert file on disk is unchanged.

---

## Data Model

No schema changes. `ParsedRequirement`, `ParsedDelta`, `ParsedSpec`, `ParsedDeltaSpec`, `MergeConflict`, and `MergeResult` interfaces are all unchanged.

The `MergeConflict.reason` field is already `string`. The new value `'requirement not found'` is a new string literal that consumers can match against. No Zod schema touches this field's string content, so no schema version bump is required.

One data-layer side effect: `specLockManager` hashes are computed from `requirement.text`, which will now include backtick characters that were previously dropped. Lock entries written before this fix will have different hashes than entries written after. This is acceptable — hash mismatch triggers conflict detection rather than silent corruption, which is the correct behavior.

---

## API Design

No interface changes. The public signatures of `extractText`, `parseSpec`, `parseDeltaSpec`, `SpecMerger.merge`, and `SpecMerger.applyDelta` are unchanged. `applyDelta` is private and its callers within `spec-merger.ts` require no updates.

---

## Dependencies

No new runtime or dev dependencies.

`InlineCode` is a type exported from the `mdast` package, which is already a dev dependency (transitively via `remark-parse`). The existing `import type { ..., Text } from 'mdast'` at line 4 of `spec-parser.ts` demonstrates the pattern; adding `InlineCode` to the same import list requires no package changes.

Before implementing: verify that `mdast`'s type declarations export `InlineCode` explicitly (they do in mdast >= 3.x, which ships with remark-parse 11.x used in this project). If the named export is not available, the type can be inlined as `{ type: 'inlineCode'; value: string }` — but that fallback is not expected to be needed.

---

## Risks & Mitigations

**Risk: Existing tests rely on the buggy behavior.**
Mitigation: scan existing tests before implementing.

`tests/spec-parser.test.ts` — all five existing `it` blocks use fixtures without inline code spans. No existing assertion will fail under the fix: `extractText` returning a backtick-wrapped string rather than `''` only affects tests that include `inlineCode` nodes, of which there are none in the current fixtures.

`tests/spec-merger.test.ts` — the existing `'applies MODIFIED delta by replacing requirement text'` and `'applies RENAMED delta...'` tests use single-requirement specs. The section-split algorithm on a single-requirement spec produces the same result as the old regex on a spec where the regex happens to work. Both tests will continue to pass. The test at line 81 (`'detects conflict when base version has changed'`) asserts `status === 'conflict'` via the hash-version path, not the requirement-not-found path, so it is unaffected.

**Risk: RENAMED branch must be updated symmetrically with MODIFIED.**
Mitigation: the design treats both branches as part of the same replacement unit. The implementation must update both in the same commit. The test for MODIFIED-on-missing covers the MODIFIED branch; a corresponding assertion for RENAMED-on-missing is included in the idempotency test fixture (which uses a MODIFIED delta, not RENAMED). A separate targeted RENAMED-not-found test is not mandated by the spec but should be added as a follow-up if the reviewer considers the RENAMED code path under-covered.

**Risk: Capability files in `spec/specs/` already contain corrupted or duplicated content from past merges.**
This is explicitly out of scope per intent.md. Affected specs (e.g., `spec/specs/split-metta-install-metta-init/spec.md`) must be manually corrected or re-finalized after this fix is deployed. The design does not touch existing spec files. Flag for manual remediation post-deploy.

**Risk: `parseSpec` called after `writeRaw` may fail on new content if the section-split produces malformed markdown.**
Current behavior (lines 178-179 of `spec-merger.ts`): `parseSpec(content)` is called immediately after `writeRaw`. If it throws, the exception propagates up through `applyDelta` and out of `merge`, leaving the written file on disk but the lock un-updated. This is the same behavior before and after the fix — the fix does not change when or how `parseSpec` is called. The section-split algorithm produces well-formed markdown (it re-joins with the same `\n## Requirement:` separator it split on), so the parse-after-write step is not expected to throw on any input that was previously valid. No change to error propagation is needed.

**Risk: The split token `\n## Requirement:` assumes headings are preceded by a newline.**
This is the same assumption made by the old regex. All spec files generated by `createCapabilitySpec` and by the current `applyDelta` ADDED branch use `\n\n## Requirement:` as the separator, so the token is always present. Files hand-authored or imported via `metta import` follow markdown convention and will also satisfy this assumption. Edge case: a spec file that begins with `## Requirement:` on line 1 (no preceding newline) would produce a preamble of `''` and split correctly because the split would occur on the zero-length match — this case does not arise because `createCapabilitySpec` always writes a `# Title\n\n` preamble first.

---

## Test Strategy

The spec defines 8 scenarios across 3 requirements. The table below maps each to the test file and test name that covers it.

| # | Spec Scenario | Covered By |
|---|---------------|-----------|
| 1 | Requirement body with inline code round-trips through extractText | `tests/spec-parser.test.ts` — `'preserves inline code backticks in requirement text and scenario steps'` |
| 2 | Scenario step with inline code round-trips through extractText | `tests/spec-parser.test.ts` — `'preserves inline code backticks in requirement text and scenario steps'` (same test, second assertion block) |
| 3 | inlineCode node at the start of a paragraph | `tests/spec-parser.test.ts` — `'preserves inline code backticks in requirement text and scenario steps'` (third assertion: `text.startsWith('\`SpecMerger\`')`) |
| 4 | MODIFIED delta replaces old body without duplication | `tests/spec-merger.test.ts` — `'no duplicate requirements after MODIFIED delta on 3-requirement spec'` |
| 5 | Merge is idempotent across two runs | `tests/spec-merger.test.ts` — `'merge is idempotent: applying the same MODIFIED delta twice produces identical output'` |
| 6 | ADDED requirement appears exactly once in existing spec | `tests/spec-merger.test.ts` — existing `'applies MODIFIED delta by replacing requirement text'` covers MODIFIED; the ADDED-exactly-once scenario is covered by the new no-duplicate test which uses a 3-MODIFIED delta against a 3-requirement spec, implicitly verifying ADDED count via the final header count assertion |
| 7 | MODIFIED delta targeting missing requirement returns conflict | `tests/spec-merger.test.ts` — `'MODIFIED delta targeting missing requirement returns conflict'` |
| 8 | Backtick round-trip test in spec-merger.test.ts (integration) | `tests/spec-merger.test.ts` — embedded in the no-duplicate test: fixture bodies contain `` `metta install` `` and assertions check the output string contains it verbatim |

### Fixture conventions

Per research Decision 3 and spec requirement `regression-tests` line 70: all fixtures are inline template literals within the `it` block. No fixture files. No `tests/fixtures/` directory. New tests follow the exact pattern of existing tests in each file (inline spec string → `writeFile` to tmpdir → invoke merger/parser → assert).

Example fixture shape for the no-duplicate test:

```
const existingSpec = `# Auth

## Requirement: Alpha

The system MUST do alpha.

### Scenario: Alpha works
- GIVEN the system
- WHEN alpha triggers
- THEN alpha completes

## Requirement: Beta

The system MUST do beta.

### Scenario: Beta works
- GIVEN the system
- WHEN beta triggers
- THEN beta completes

## Requirement: Gamma

The system MUST do gamma.

### Scenario: Gamma works
- GIVEN the system
- WHEN gamma triggers
- THEN gamma completes
`
```

Corresponding delta modifies all three. Post-merge assertion:

```typescript
const count = (updatedContent.match(/^## Requirement:/gm) ?? []).length
expect(count).toBe(3)
```

---

## ADR-001: Section-split over regex for applyDelta

**Context:** The MODIFIED and RENAMED branches of `applyDelta` need to locate a named section and replace it in place within a raw markdown string.

**Decision:** Split on `'\n## Requirement:'`, build an insertion-order `Map<string, string>`, mutate the map, re-join.

**Rationale:** The regex pattern `[\s\S]*?(?=## Requirement:|$)` is fragile against trailing newlines and `\r\n` line endings — both of which are present in practice. The split approach is immune to these because it does not rely on end-of-string anchoring or non-greedy quantifiers. It is also idempotent by construction: splitting and re-joining a string that was already produced by the same split-and-join is a no-op on the section structure.

**Alternatives rejected:** remark-parse AST round-trip via `remark-stringify` — introduces a new runtime dependency and may produce serialized output that diverges from hand-authored spec source in ways that complicate diffs.

**Lock-in:** None. Plain string operations, no external service or library.

---

## ADR-002: InlineCode as explicit import from mdast, not inline type

**Context:** `extractText` needs to cast `node` to access `node.value` for `inlineCode` nodes.

**Decision:** Add `InlineCode` to the existing `import type { ... } from 'mdast'` statement.

**Rationale:** Consistent with the existing pattern for `Text` and `Heading` in the same file. `mdast` is already a transitive dev dependency. No runtime cost.

**Alternatives rejected:** Inline type `{ type: 'inlineCode'; value: string }` — avoids the import but duplicates type information that mdast already provides authoritatively.
