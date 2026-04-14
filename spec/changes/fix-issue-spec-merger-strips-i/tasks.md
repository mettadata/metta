# Tasks: fix-issue-spec-merger-strips-i

## Batch 1 — Source fixes (parallel-safe, different files)

### Task 1.1 — Fix `extractText` inline-code branch in spec-parser.ts [x]

**Files**
- `src/specs/spec-parser.ts` (write)

**Action**
Add `InlineCode` to the existing `import type { Root, Content, Heading, Text } from 'mdast'` statement on line 4. Insert one branch inside `extractText` immediately after the `if (node.type === 'text')` line (line 42): `if (node.type === 'inlineCode') return \`\${(node as InlineCode).value}\``. No other changes to the file.

**Verify**
`grep 'InlineCode' src/specs/spec-parser.ts` returns the import line and the new branch. `grep "node.type === 'inlineCode'" src/specs/spec-parser.ts` returns exactly one hit.

**Done**
`extractText` has three branches in order: `'text'`, `'inlineCode'`, `'children'`. The `InlineCode` type is imported from `mdast` in the same `import type` statement as `Text`.

---

### Task 1.2 — Replace regex-removal-plus-append with section-split in spec-merger.ts [x]

**Files**
- `src/finalize/spec-merger.ts` (write)

**Action**
Replace the MODIFIED branch (lines 141-151) and RENAMED branch (lines 152-168) inside `applyDelta` with section-boundary split logic. Split raw content on `'\n## Requirement:'` to get `[preamble, ...sectionBodies]`. Build a `Map<string, string>` keyed by requirement name (everything before the first newline of each section body). For MODIFIED: look up `delta.requirement.name`; if absent push a `MergeConflict` with `reason: 'requirement not found'` and return without writing; if present replace the map value with the reconstructed section. For RENAMED: extract the old name via `/^Renamed from:\s*(.+)/m`, look up the old key; if absent push a conflict with `reason: 'requirement not found'` and return; if present delete the old key and set the new key. Re-join as `preamble + [...map.values()].map(body => '\n## Requirement:' + body).join('')`. Write via `state.writeRaw`. The ADDED and REMOVED branches are unchanged.

**Verify**
`grep -n 'requirement not found' src/finalize/spec-merger.ts` returns two hits (MODIFIED and RENAMED paths). `grep -n 'content +=' src/finalize/spec-merger.ts` returns only the ADDED branch hit. The MODIFIED and RENAMED branches no longer contain `content +=` or `RegExp`.

**Done**
`applyDelta` uses `Map<string, string>` for MODIFIED and RENAMED, emits `MergeConflict` with `reason: 'requirement not found'` when the target key is absent, and does not use regex on section bodies.

---

## Batch 2 — Tests (depends on 1.1 and 1.2)

### Task 2.1 — Add inline-code round-trip test to spec-parser.test.ts [x]

**Files**
- `tests/spec-parser.test.ts` (write)

**Action**
Add one `it` block inside the existing `describe('parseSpec', ...)` block: `'preserves inline code backticks in requirement text and scenario steps'`. The fixture is an inline spec string whose requirement body contains `` `metta install` `` and `` `metta init` `` and whose scenario step reads `` WHEN the user runs `metta init --json` ``. A second fixture whose requirement body begins with `` `SpecMerger` MUST validate the lock hash `` covers the start-of-paragraph case. Assertions: `requirement.text` contains `` `metta install` `` and `` `metta init` `` verbatim; the matching step string equals `` WHEN the user runs `metta init --json` ``; and `requirement.text` starts with `` `SpecMerger` `` for the second fixture.

**Verify**
`grep -c "preserves inline code" tests/spec-parser.test.ts` returns 1. Running `npx vitest run tests/spec-parser.test.ts` exits 0.

**Done**
One new `it` block present in `describe('parseSpec', ...)`. All assertions cover spec scenarios 1, 2, and 3 (REQ-1 scenarios). No external fixture files added.

---

### Task 2.2 — Add three merger regression tests to spec-merger.test.ts

**Files**
- `tests/spec-merger.test.ts` (write)

**Action**
Add three `it` blocks inside the existing `describe('SpecMerger', ...)` block, each using inline template literal fixtures and following the existing `beforeEach`/`afterEach` setup (tmpdir with `specs/auth` and `changes/add-mfa` directories already created).

Block 1 — `'no duplicate requirements after MODIFIED delta on 3-requirement spec'`: inline 3-requirement spec (Alpha, Beta, Gamma) with bodies containing `` `metta install` ``; inline delta that modifies all three; assert `(updatedContent.match(/^## Requirement:/gm) ?? []).length === 3` and that `` `metta install` `` appears verbatim in the output (covers scenarios 4 and 8).

Block 2 — `'merge is idempotent: applying same MODIFIED delta twice produces identical output'`: inline 2-requirement spec; inline delta modifying one requirement; apply merger once to get O1; apply the same delta to O1 by writing it back as the spec file and merging again to get O2; assert `O1 === O2` and header count unchanged (covers scenario 5).

Block 3 — `'MODIFIED delta targeting missing requirement returns conflict'`: inline spec containing only `'Existing-Req'`; inline delta targeting `'Ghost-Req'` as MODIFIED; assert `result.status === 'conflict'`, `result.conflicts[0].reason === 'requirement not found'`, and the spec file on disk is byte-identical to what was written before the merge (covers scenario 7).

**Verify**
`grep -c "no duplicate\|idempotent\|missing requirement returns conflict" tests/spec-merger.test.ts` returns 3. Running `npx vitest run tests/spec-merger.test.ts` exits 0.

**Done**
Three new `it` blocks present, each self-contained with inline fixtures. No fixture files added. Scenarios 4, 5, 7, and 8 are covered.

---

## Batch 3 — Full build and smoke (depends on all of Batch 2)

### Task 3.1 — Full build, test suite, and smoke run

**Files**
- None written (verification only)

**Action**
Run `npm run build` to confirm TypeScript compilation passes with no errors. Run `npx vitest run` to confirm the full test suite passes. Then run the merger against the change's own spec file as a smoke test: write a small Node script (or use `node --input-type=module`) that calls `parseSpec` on `spec/changes/fix-issue-spec-merger-strips-i/spec.md` and logs the first requirement's `text` field — confirm the output contains backtick-delimited tokens (e.g., `` `extractText()` ``, `` `inlineCode` ``).

**Verify**
`npm run build` exits 0 with no TypeScript errors. `npx vitest run` exits 0 with all tests passing (including the new ones from tasks 2.1 and 2.2). The smoke log output contains at least one backtick-delimited token from the spec file's requirement bodies.

**Done**
Build clean. Test suite green. Smoke confirms backticks are preserved end-to-end.

---

## Scenario Coverage

| # | Spec Scenario | Requirement | Covered By |
|---|---------------|-------------|------------|
| 1 | Requirement body with inline code round-trips through extractText | spec-parser-preserves-inline-code | Task 2.1 — `'preserves inline code backticks in requirement text and scenario steps'` (first assertion block) |
| 2 | Scenario step with inline code round-trips through extractText | spec-parser-preserves-inline-code | Task 2.1 — same `it` block, step-string assertion |
| 3 | inlineCode node at the start of a paragraph | spec-parser-preserves-inline-code | Task 2.1 — same `it` block, `startsWith` assertion on second fixture |
| 4 | MODIFIED delta replaces old body without duplication | spec-merger-applies-delta-idempotent | Task 2.2 — `'no duplicate requirements after MODIFIED delta on 3-requirement spec'` |
| 5 | Merge is idempotent across two runs | spec-merger-applies-delta-idempotent | Task 2.2 — `'merge is idempotent: applying same MODIFIED delta twice produces identical output'` |
| 6 | ADDED requirement appears exactly once in existing spec | spec-merger-applies-delta-idempotent | Task 2.2 — `'no duplicate requirements after MODIFIED delta on 3-requirement spec'` (final header count assertion verifies ADDED count indirectly; existing `'applies MODIFIED delta...'` test covers ADDED path) |
| 7 | MODIFIED delta targeting missing requirement returns conflict | spec-merger-applies-delta-idempotent | Task 2.2 — `'MODIFIED delta targeting missing requirement returns conflict'` |
| 8 | Backtick round-trip test in spec-merger.test.ts (integration) | regression-tests | Task 2.2 — Block 1 fixture bodies contain `` `metta install` `` and output assertion checks verbatim presence |
