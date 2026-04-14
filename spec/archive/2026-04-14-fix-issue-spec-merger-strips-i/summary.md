# Summary: fix-issue-spec-merger-strips-i

Resolves issue `spec-merger-strips-inline-backticks-and-duplicates-requireme` (severity: high).

## Root causes (per intent → research → design)
1. `src/specs/spec-parser.ts:extractText` had no branch for the `inlineCode` mdast node — it fell through to the children-walker which returned `''`, dropping every backtick-wrapped span.
2. `src/finalize/spec-merger.ts:applyDelta` MODIFIED + RENAMED branches used a fragile `RegExp` strip + unconditional `content +=` append. When the regex failed to match (trailing newline, whitespace variation), the old block stayed AND the new block was appended → duplication.

## Fixes
- Spec parser: added `if (node.type === 'inlineCode') return \`\\\`\${node.value}\\\`\`` branch (one line). Imported `InlineCode` from `mdast`.
- Spec merger: rewrote MODIFIED + RENAMED with section-keyed split-and-replace using ordered `Map<string, string>`. Missing-target now emits `MergeConflict { reason: 'requirement not found' }` instead of silently appending. ADDED + REMOVED branches untouched.
- `applyDelta` signature changed to return `MergeConflict | null`; `merge()` collects conflicts and skips the `merged.push` when one is produced.

## Tests
- `tests/spec-parser.test.ts` — 1 new `it`: 3-scenario inline-code round-trip (mid-paragraph, in scenario step, paragraph-leading).
- `tests/spec-merger.test.ts` — 3 new `it` blocks: no-duplicate on 3-requirement MODIFIED; idempotency (apply same delta twice → byte-identical); MODIFIED on missing target → conflict + on-disk file unchanged.

## Gates
- `npm run build` — PASS
- `npx vitest run` — 356/356 PASS (was 352, +4 new)

## Out of scope
- Repairing previously corrupted `spec/specs/<change>/spec.md` files in this repo (e.g. `split-metta-install-metta-init`). Those need manual remediation; this change only fixes future merges.
- Capability-folder-naming concern from the issue (separate, deferred).

All 5 task checkboxes flipped to `[x]` as work happened.
