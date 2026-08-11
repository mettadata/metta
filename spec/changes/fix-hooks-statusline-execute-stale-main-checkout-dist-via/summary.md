# Verification: fix-hooks-statusline-execute-stale-main-checkout-dist-via

## Spec Scenarios

Trivial workflow — verified against intent.md proposal items (3 verifiers, fan-out; coverage verdicts from the intent-coverage verifier):

- [x] **Ship rebuilds main's dist post-merge (root-cause fix)** — COVERED. `src/ship/merge-safety.ts:39-80` `rebuildDist()` runs `npm run build` in the target checkout after post-merge gates on the success path only (never dry-run/rollback); build failure yields a loud `fail` step without undoing the merge; missing package.json yields `skip` ("not an npm project"); corrupt JSON yields `fail`. `src/cli/commands/ship.ts` prints a stderr WARNING block on rebuild failure. metta-ship SKILL.md (both copies, byte-identical) gained an anchored step 9 rebuild instruction. Tests: `tests/merge-safety.test.ts` rebuild-dist block, 16/16 (marker-file build proof, merge-not-rolled-back, skip/fail/dry-run/gate-rollback cases).
- [x] **Build stamp + `metta doctor` drift detection** — COVERED. `scripts/emit-build-stamp.mjs` writes `dist/.build-stamp` ({commit, built_at}; null commit if git unavailable; never fails the build); `package.json` build chains it. `src/config/build-stamp.ts` Zod-validates the stamp; `distStampCheck` reports "dist behind HEAD" with commit range; mtime fallback when stamp missing. `src/cli/commands/doctor.ts` "Dist freshness" check. Tests: `src/config/build-stamp.test.ts` 19/19 incl. end-to-end emit-script runs. Live confirmation: doctor correctly reported real drift (`8fbc894..b9cbee3`) during parallel implementation.
- [x] **TOKENS.md GAPS hook-health tripwire** — COVERED. `src/finalize/tokens-report-generator.ts` `computeHookHealthFailure()`: zero `source: 'hook'` records + >=1 completed artifact timing prepends a loud **Hook health failure** GAPS entry; silent when hook records exist or no artifacts completed. Tests: `tests/tokens-report-generator.test.ts` 27/27 (empty usage, prose-only, uncompleted timings, ordering).
- [x] **Out of scope respected** — no changes to `.claude/hooks/metta-tokens-record.mjs`, guard hooks, or `.claude/statusline/statusline.mjs` (confirmed via `git diff main...HEAD --stat`).

## Gate Results

| Gate | Result |
|------|--------|
| tests (`npm test`) | PASS — 2116/2116, 119 files (re-run after anchoring fix bb8743e30) |
| typecheck (`npx tsc --noEmit`) | PASS |
| lint (`npm run lint`) | PASS |
| build (`npm run build`) | PASS — emits `dist/.build-stamp`; commit field matched `git rev-parse HEAD` exactly |

Verify iteration 1 found one regression: the new SKILL.md step 9 wording tripped `tests/skill-template-anchoring.test.ts` (unanchored `npm` command pattern). Fixed in verify iteration 2 by rewording to an anchored `cd "<main checkout root>" && npm run build` form in both SKILL.md copies (commit bb8743e30); full suite then clean.

## Summary

Fixes issue `hooks-and-statusline-execute-stale-main-checkout-dist-via`: hooks and the statusline exec the globally-linked `metta` CLI (main checkout's `dist/`), which silently drifted behind main HEAD after every ship, starving the SubagentStop token-recording hook (fail-open → zero TOKENS.md records, invisible loss). Three defense-in-depth layers:

1. **Ship rebuilds main's dist post-merge** — `src/ship/merge-safety.ts` `rebuild-dist` step + `src/cli/commands/ship.ts` loud WARNING + metta-ship SKILL.md step 9 (PR-based skill flow) (commits ae0f1e6d4, b9cbee3f0, 8f34a2618, bb8743e30).
2. **Build stamp + doctor drift check** — `scripts/emit-build-stamp.mjs`, `src/config/build-stamp.ts`, doctor "Dist freshness" check (commit bbcb97cee).
3. **TOKENS.md GAPS tripwire** — `computeHookHealthFailure()` in `src/finalize/tokens-report-generator.ts` (commit 8fbc89472).

Review: 3 parallel reviewers, all PASS_WITH_WARNINGS, zero critical; cross-confirmed findings (missing-package.json skip-not-fail, exec maxBuffer, `!` assertion) fixed in 8f34a2618; remaining minors logged in review.md as accepted/deferred (incl. pre-existing `git()` shell-interpolation follow-up recommendation).

Risks / assumptions:
- Rebuild step is npm-hardcoded; non-npm projects get an explicit `skip`, ship still succeeds.
- CLI ship may build twice if a post-merge `build` gate is configured — accepted so the rebuild can fail loudly without rolling back.
- Dist drift reports as `warn`, not `fail` — visibility, not blocking.
- Hook fail-open contract intentionally unchanged (per intent out-of-scope).
