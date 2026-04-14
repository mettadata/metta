# Intent: fix-issue-spec-merger-strips-i

## Problem

Two bugs in the spec-merger corrupt every merged spec that contains inline code.

### Bug 1 — Inline backticks stripped from requirement and scenario text

During `metta finalize --change split-metta-install-metta-init`, the merged output at `spec/specs/split-metta-install-metta-init/spec.md` had all inline backtick spans removed. Sentences such as `WHEN the user runs \`metta install\`` became `WHEN the user runs` — grammatically broken and semantically wrong.

The root cause is in `src/specs/spec-parser.ts`, function `extractText` (lines 41-47). The function handles `'text'` nodes and any node with `'children'`, but remark-parse represents inline code as `inlineCode` node type — which carries a `value` property and has no `children`. The function's `'children'` branch returns `''` for `inlineCode`, silently discarding the content. Both `parseSpec` and `parseDeltaSpec` call `extractText` when collecting paragraph text and list-item step text, so every inline code span in a requirement body or scenario bullet is lost before the merger ever sees it. The reconstructed `delta.requirement.text` and `step` strings written to the merged spec are plain text with gaps where code was.

### Bug 2 — Each requirement appears twice in merged output

The same finalize run produced the 3-requirement spec with all 3 requirements duplicated (6 total, each header and scenario block appearing twice).

The root cause is in `src/finalize/spec-merger.ts`, method `applyDelta` (lines 141-151). For a `MODIFIED` delta, the method applies a regex to strip the old requirement section and then appends the replacement with `content +=`. The removal regex is:

```
/## Requirement: <name>[\s\S]*?(?=## Requirement:|$)/
```

The pattern is non-greedy (`*?`) and anchors to the next `## Requirement:` heading or end-of-string. When the requirement being replaced is not the last section in the file, the pattern terminates at the next heading correctly. But when `\r\n` line endings or extra blank lines are present, or when the requirement name contains characters that shift the escaped pattern, the regex can fail to match — leaving the old block untouched. The method then appends the new text unconditionally, producing old + new in the output. Because the loop iterates all three deltas sequentially, reading and writing the file on each pass, a single failed removal compounds: the file grows with each pass and the next pass's regex again fails to match the duplicated content.

These two bugs block spec finalization for any change whose spec contains inline code — which is effectively every spec in the project.

## Proposal

### 1. Fix inline backtick preservation in spec-parser.ts

Extend `extractText` to handle `inlineCode` nodes. When `node.type === 'inlineCode'`, return the value wrapped in backticks so the reconstructed string preserves the original markdown formatting. The fix is a one-line addition before the `'children'` branch:

```typescript
if (node.type === 'inlineCode') return `\`${(node as InlineCode).value}\``
```

Import `InlineCode` from `mdast`. This fix applies to all call sites — requirement body paragraphs, scenario list-item steps, and heading text extraction — without any further changes to the parser structure.

### 2. Fix requirement duplication in spec-merger.ts

Replace the regex-based removal-plus-append pattern for `MODIFIED` (and `RENAMED`) with a section-replacement approach that is robust to whitespace variation:

- Parse the existing spec content into sections by splitting on `## Requirement:` boundaries.
- Locate the section whose heading matches `delta.requirement.name`.
- Replace that section in place; do not append anything.
- If the section is not found, treat it as a conflict rather than silently appending.

This eliminates the failure mode where a non-matching regex leaves the old block and the unconditional `+=` adds a second copy. It also makes the operation idempotent: running the merger twice on the same file produces the same output.

### 3. Add targeted regression tests

Add the following test cases to `tests/spec-merger.test.ts` and `tests/spec-parser.test.ts`:

- **Backtick round-trip**: parse a spec whose requirement text and scenario steps contain inline code spans; assert that `extractText` returns the backtick-wrapped form and that the merged output file contains the original inline code verbatim.
- **No duplication on MODIFIED**: given a 3-requirement capability spec and a delta that modifies all three, assert that the merged output contains exactly 3 `## Requirement:` headers.
- **No duplication on ADDED to existing capability**: given a 1-requirement capability and a delta that adds a second, assert exactly 2 headers in the output.
- **Section-not-found conflict**: given a MODIFIED delta targeting a requirement name that does not exist in the capability spec, assert `status === 'conflict'` rather than silent append.

## Impact

- All future `metta finalize` runs will produce merged specs with inline code preserved and no duplicate requirements.
- Existing `spec/specs/` files that were already merged with these bugs will not be retroactively repaired. Affected specs (notably `spec/specs/split-metta-install-metta-init/spec.md`) must be manually deleted and re-finalized, or corrected by hand. This is a one-time remediation step, not part of this change.
- Existing tests in `tests/spec-merger.test.ts` use fixtures without inline code and with single-requirement specs, so they will continue to pass. New fixtures will be additive.
- `SpecLockManager` hashes are computed from `requirement.text`, which will now include backtick characters. Any lock entries written before this fix will have different hashes than entries written after. This is acceptable: lock mismatches trigger conflict detection rather than silent corruption.

## Out of Scope

- Retroactively repairing already-corrupted merged specs in `spec/specs/`. That is a one-time manual remediation.
- Archiving or quarantining previously broken merged specs.
- Changing the `spec.md` schema or the `ParsedRequirement` / `ParsedDelta` interfaces.
- Normalizing capability output directory names to match an existing capability rather than the change slug. The issue notes this as a separate concern (item 3 in the symptoms list); it is tracked independently.
- Supporting additional inline markdown formatting (bold, italic, links) in `extractText`. Only `inlineCode` is in scope because it is the formatting type present in all RFC 2119 requirement bodies.
