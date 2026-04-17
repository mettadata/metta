# Summary: fix-two-complete-ts-issues-pre

## What changed

`metta complete` now validates artifact content before marking complete:
1. **Content sanity** — rejects artifacts containing stub markers (`"intent stub"`, etc.), under-length content (< 200 bytes, < 100 for `summary.md`), or an unfilled `{change_name}` H1 placeholder.
2. **Stories gate** — when completing the `stories` artifact, runs the same parser + fulfills-refs validation that the `stories-valid` finalize gate uses, so broken stories fail at complete-time instead of dozens of commits later at finalize.

## Files modified

- `src/cli/commands/complete.ts` — new pre-complete validation block
- `tests/cli.test.ts` — 5 new test cases under `describe('metta complete pre-complete validation')`

## Resolves

- `metta-complete-accepts-stub-placeholder-artifacts-on-intent-` (major)
- `stories-valid-gate-catches-missing-us-fields-only-at-finaliz` (major)

## Verification

- `npx tsc --noEmit`: clean
- `npm test`: 544/544 pass
- 3-reviewer pass: PASS / PASS_WITH_WARNINGS (DRY suggestion noted, non-blocking)

## Non-goals / deferred

- Extracting a shared `validateStoriesFile` helper (DRY suggestion from quality reviewer — follow-up refactor)
- Validation of wildcard-generates artifacts (implementation stage)
- Retroactive validation of archived changes
