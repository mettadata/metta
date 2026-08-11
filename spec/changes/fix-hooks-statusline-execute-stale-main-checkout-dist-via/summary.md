# Summary: fix-hooks-statusline-execute-stale-main-checkout-dist-via

## What changed

Fixes the logged issue `hooks-and-statusline-execute-stale-main-checkout-dist-via`: hooks and the statusline exec the globally-linked `metta` CLI, which resolves to the main checkout's `dist/`; that dist silently drifted behind main HEAD after every ship, starving the SubagentStop token-recording hook (fail-open, so zero TOKENS.md records and invisible loss). Three defense-in-depth layers were implemented:

### 1. Ship rebuilds main's dist post-merge (root-cause fix)

- `src/ship/merge-safety.ts` — new `rebuild-dist` step after every successful real merge (post-gates): runs `npm run build` in the target checkout. Build failure or missing/invalid `package.json` produces an explicit `fail` step ("dist is stale, run npm run build") but never undoes the merge; no build script yields an explicit `skip`; dry-run and gate-rollback paths never rebuild. (commit `ae0f1e6d4`)
- `src/cli/commands/ship.ts` — loud `WARNING` block to stderr when the rebuild-dist step failed; JSON mode carries the step in the result.
- `src/templates/skills/metta-ship/SKILL.md` + `.claude/skills/metta-ship/SKILL.md` — step added: `npm run build` from the main checkout root after `git pull --ff-only`, with loud failure reporting. Logged deviation: AI-session ships are PR-based through this skill and never touch `MergeSafetyPipeline`, so the skill flow needed the same step or the observed root cause would remain unfixed. (commit `b9cbee3f0`)

### 2. Build stamp + `metta doctor` drift detection

- `scripts/emit-build-stamp.mjs` (new) — build now writes `dist/.build-stamp` (`{commit, built_at}` JSON); `commit` is `null` if git is unavailable; never fails the build. `package.json` build script chains it.
- `src/config/build-stamp.ts` (new) — Zod-validated stamp reader; pure `distStampCheck` / `distMtimeFallbackCheck`; imperative `distFreshnessCheck(packageRoot)` shell.
- `src/cli/commands/doctor.ts` — "Dist freshness" check comparing the stamp commit to the checkout's HEAD; drift reports as `warn` with the commit range (e.g. `8fbc894..b9cbee3`); missing stamp falls back to `dist/cli/index.js` mtime; non-git or no-dist cases pass with a skip detail. (commit `bbcb97cee`)

### 3. TOKENS.md GAPS zero-record tripwire

- `src/finalize/tokens-report-generator.ts` — `computeHookHealthFailure()`: zero `source: 'hook'` records with >= 1 completed artifact timing prepends a `**Hook health failure**` GAPS entry naming the likely cause (stale globally-linked dist / hook-to-CLI path failure). Changes with no completed artifacts stay silent. (commit `8fbc89472`)

## Verification evidence

- `npx tsc --noEmit` — clean (verified by all three executors)
- Full test suite: 2115/2115 across 119 files
- Targeted: `tests/merge-safety.test.ts` 15/15; `tests/tokens-report-generator.test.ts` 27/27; `src/config/build-stamp.test.ts` 19/19
- Live confirmation: `metta doctor` in the worktree correctly reported `dist behind HEAD — built at 8fbc894, HEAD is b9cbee3` when a parallel commit advanced HEAD

## Risks / assumptions

- Rebuild step is npm-hardcoded; non-npm projects get an explicit skip/fail step and ship still succeeds.
- If a post-merge `build` gate is configured, CLI ship may build twice (gate + rebuild step) — accepted so the rebuild step can fail loudly without rolling back.
- Dist drift is a `warn`, not `fail` — stale dist still runs; visibility, not blocking.
- Hook fail-open contract unchanged by design (per intent's out-of-scope).
