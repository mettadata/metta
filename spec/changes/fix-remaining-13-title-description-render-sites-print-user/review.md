# Review — fix-remaining-13-title-description-render-sites-print-user

Iteration 1 — commit `269e6f1`. Three parallel reviewers.

## Verdicts

| Reviewer | Verdict |
|----------|---------|
| Correctness | PASS_WITH_WARNINGS |
| Security | PASS_WITH_WARNINGS |
| Quality | PASS_WITH_WARNINGS |

No critical findings. All 16 intent sites verified wrapped; JSON paths byte-faithful; sanitizer fuzzed (20k adversarial strings, zero control-byte leaks, no ReDoS, idempotent); typecheck/lint/tests green.

## Findings

### Major (flagged by security + quality; correctness rated minor)
1. `src/cli/commands/gaps.ts:42` — `gap.action` (free text from gap markdown `## Action`) printed unsanitized in `gaps show`, same screen as newly wrapped fields. Can be multi-line → wants `stripControlSequencesMultiline`.
2. `src/cli/commands/validate-stories.ts:109` — `stories.justification` (free text from stories.md) printed unsanitized in the sentinel branch, sibling of the wrapped title loop.

### Minor
3. `src/cli/commands/roadmap.ts:174` — `roadmap next` prints promote handoff embedding raw backlog item title (`src/cli/promote-handoff.ts`).
4. `src/cli/commands/validate-stories.ts:139` — `StoriesParseError` messages can echo raw user heading text to stderr.
5. Command-level render tests cover only issue.ts sites (meets intent minimum; other wrappings untested behaviorally).
6. gaps.ts/fix-gap.ts five-field render block duplicated verbatim — shared helper suggested (pre-existing pattern).
7. Informational: Unicode bidi/zero-width spoofing out of scope per intent (regex coverage frozen at PR #86 scope).

## Disposition

Findings 1-3 are the identical vulnerability class this change exists to close, inside files it touched; fixed in a fixup commit within this change (review iteration 2 confirms). Findings 4-7 accepted as-is (error path / test-scope / pre-existing duplication / explicitly out of scope).

## Round 2 — fixup `b156eba4d`

| Reviewer | Verdict |
|----------|---------|
| Correctness | PASS |
| Security | PASS |
| Quality | PASS |

All three residual sites confirmed sanitized with the correct variant; JSON branches verified byte-faithful (hostile bytes round-trip in tests); `??` → `!== undefined` rewrite confirmed semantics-preserving; new tests (cli-gaps 3/3, cli-roadmap, cli-status) pass. No critical, major, or warning findings. Review loop clean — exit.
