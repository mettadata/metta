# Review: fix-issue-spec-merger-strips-i

Three reviewers ran in parallel.

## Correctness — PASS
- inlineCode branch returns `` `value` `` form correctly.
- MODIFIED + RENAMED both fixed via Map-based split.
- ADDED untouched.
- Missing-target → conflict with `reason: 'requirement not found'`, no append.
- Idempotency proven by O1 === O2 test.
- Conflict shape complete (capability, requirementId, reason, baseHash, currentHash).
- Two scope-out observations: REMOVED branch was still using brittle regex; `applyDelta` return contract undocumented. **Both addressed in follow-up commit.**

## Security — PASS
- `Map<string, string>` not vulnerable to prototype pollution via crafted requirement names.
- inlineCode just reads `node.value` as string — no eval, no template injection.
- No new filesystem writes; existing safe-path machinery unchanged.

## Quality — PASS_WITH_WARNINGS → applied
- Warning 1: REMOVED still using regex pattern (same bug class). **Applied** — REMOVED now routes through Map-based split with same conflict semantics.
- Warning 2: `applyDelta` return contract undocumented. **Applied** — added JSDoc explaining `null = applied, MergeConflict = caller must skip merge record`.
- Suggestion: explicit orphan-line assertion. **Applied** — added `expect(updatedContent).not.toMatch(/^WHEN\s*$/m)` to lock in original symptom.

## Verdict
All 3 reviewers PASS after fixes. Targeted suite (parser + merger): 18/18. Full suite (pre-quality-fix): 356/356.
