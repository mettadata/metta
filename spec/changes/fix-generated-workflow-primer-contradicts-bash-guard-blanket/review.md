# Review: fix-generated-workflow-primer-contradicts-bash-guard-blanket

Three parallel reviews (correctness, security, quality) of commits c2e28796a, 58e07d015,
e5243acf3, 833aefa43, 8778db66b vs main.

## Verdicts

| Reviewer | Verdict |
|----------|---------|
| Correctness | PASS_WITH_WARNINGS |
| Security | PASS |
| Quality | PASS |

No critical or major issues. All spec scenarios verified satisfied; enumerations
cross-checked in both directions against the hook's five lists (exact match); hook diff
confirmed comment-only with byte-identical copies (sha256 match); CLAUDE.md region verified
byte-exact against buildWorkflowSection(); lint/typecheck clean; full suite 2812 passed /
2 skipped / 0 failed.

## Findings (all minor/trivial — none blocking)

1. **minor** (correctness, quality — convergent) `tests/delivery.test.ts` — sanity floors
   exist only for the three allowed-list extractions; `blockedSingle`/`blockedTwoWord` have
   no floor, so a hook declaration-shape change could make the blocked-entry mirror test
   pass vacuously. Suggested floors: >= 13 singles, >= 5 groups.
2. **minor** (correctness) `tests/delivery.test.ts` — seam test asserts hook ⊆ primer only;
   a future primer entry with no hook counterpart (false "allowed" claim) would pass CI.
   Design §5 intended the wording pins to cover the reverse direction but they pin only the
   mandate and pointer literals.
3. **suggestion** (correctness, quality) `tests/delivery.test.ts` — `sliceBlock` runs before
   comment stripping; a future inline comment containing `]);` inside a list declaration
   would silently truncate extraction. Strip comments before slicing.
4. **minor** (security) `workflow-primer.ts` read-only subsection — "an attempt is always
   safe and never mutates state" is strictly true only for plain literal invocations with
   the hook active; "always" is a slight overclaim. Hook authority is stated; acceptable.
5. **minor** (security) — `install` sits under a "Read-only queries" heading; inline caveat
   covers it ("guard-allowed, though not strictly read-only").
6. **minor** (quality) `workflow-primer.ts` Tier-2 trust-model bullet — pre-existing drift
   (not introduced here): omits `backlog migrate`, `milestone create/close/update`,
   `verify`, `release cut` from the scoped two-word forms. Candidate follow-up issue.
7. **trivial** (quality) `tests/delivery.test.ts` — "Strip // line comments FIRST" comment
   is ambiguous (means before quoted-string extraction, not before slicing).
8. **trivial** (quality) hook copies — blanket SYNC comment on BLOCKED lists mentions the
   read-only subsection; blocked lists map only to the Forbidden bullet. Harmless.

## Outcome

Exit review loop after iteration 1: no critical issues; all three reviewers PASS or
PASS_WITH_WARNINGS. Findings 1-3 are test-hardening improvements against future drift;
finding 6 is pre-existing and a candidate follow-up issue.
