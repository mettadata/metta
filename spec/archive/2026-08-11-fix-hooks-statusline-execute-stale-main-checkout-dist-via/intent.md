# fix-hooks-statusline-execute-stale-main-checkout-dist-via

## Problem

Every hook and statusline integration that shells out to the `metta` CLI resolves it through the global npm link (`/home/utx0/.npm-global/bin/metta` -> the MAIN checkout's `dist/cli/index.js`). That `dist/` is only rebuilt when someone manually runs `npm run build` in the main checkout — but all change-lifecycle builds happen inside per-change worktrees, so main's `dist/` silently drifts behind main HEAD after every merge.

The concrete damage: main's dist predated PR#58/#61, so the linked CLI was worktree-blind. The SubagentStop hook `metta-tokens-record.mjs` fired on every metta-* subagent completion, shelled out to `metta tokens record`, and hit the "No active changes." failure path (`src/cli/commands/tokens.ts:79`) every single time. Because the hook is contractually fail-open (catch block at `.claude/hooks/metta-tokens-record.mjs:165` logs to stderr only and exits 0), the failure was completely invisible. Result: every TOKENS.md finalized on 2026-08-11 (mint-clobbering, tsx, versioning, and later changes) shows 0 automatic token records despite real subagent spawns — data permanently lost, discovered only after the fact.

Who is affected:
- **Token accounting** — automatic `token_usage` records are zeroed whenever main's dist lags a change-resolution fix; TOKENS.md reports become silently empty.
- **Statusline** — `.claude/statusline/statusline.mjs:214` execs `metta status --json` through the same stale link and can render wrong/failed status.
- **Guard hooks** — both guard hooks' `metta status` probes inherit the identical hazard, meaning enforcement decisions can be made against stale CLI behavior.
- **Any future hook** that shells out to the global `metta` — the hazard is structural, not specific to tokens.

## Proposal

Fix the root cause and add two layers of defense so this class of silent failure cannot recur unnoticed (defense in depth, per the project's merge-safety posture):

1. **Rebuild main's dist during ship (root-cause fix).** Add a post-merge step to the ship flow that runs `npm run build` in the main checkout after the change branch merges to main, so the globally-linked dist always tracks main HEAD. The build step MUST fail loudly: a build failure surfaces as a visible ship-flow error/warning, never a swallowed exit code. If the build cannot run (e.g. main checkout unavailable), ship reports that condition explicitly rather than skipping silently.

2. **`metta doctor` dist-drift detection (on-demand diagnostic).** Teach `metta doctor` to compare a dist build stamp (git HEAD commit recorded at build time, falling back to mtime comparison if absent) against the main checkout's current git HEAD, and report "dist behind HEAD" drift with the offending commit range. The build process records the stamp (e.g. a `dist/.build-stamp` file emitted by the build script — an external artifact, not an inlined string literal).

3. **TOKENS.md GAPS tripwire (loss detection at finalize).** When finalize renders TOKENS.md with 0 automatic hook records but ≥1 completed metta-* artifact for the change, emit a loud hook-health failure entry in the GAPS section naming the likely cause (hook-to-CLI path failure) so an empty report is never mistaken for a quiet change.

Scope of code touched: ship/finalize flow (post-merge build step + GAPS rendering), build script (stamp emission), `metta doctor` (drift check). No changes to the hooks' fail-open contract itself — hooks remain non-fatal to the session, but the losses they can cause become visible at ship, doctor, and finalize checkpoints.

## Impact

- **Ship flow (`finalize-ship` capability):** gains a post-merge `npm run build` step on main with explicit failure surfacing; ship duration increases by one build (~seconds). Existing merge/finalize semantics are unchanged.
- **Build output:** dist gains a build stamp artifact recording the git HEAD at build time; consumers of dist are otherwise unaffected.
- **`metta doctor`:** gains a new drift check; existing checks unchanged.
- **TOKENS.md rendering (finalize):** GAPS section gains a zero-record anomaly rule; changes with genuinely zero subagent spawns are unaffected (the tripwire requires ≥1 completed metta-* artifact).
- **Hooks/statusline:** no code changes to `.claude/hooks/metta-tokens-record.mjs`, guard hooks, or `statusline.mjs`; they benefit indirectly because the dist they exec now tracks main HEAD.
- **Risk:** if the post-merge build fails on main, main's dist could be left in a partially-built state — the ship step must report this loudly so the user rebuilds before relying on hooks.

## Out of Scope

- **Recovering the lost token data** from the 2026-08-11 changes — those records were never written and cannot be reconstructed.
- **Changing the hooks' fail-open contract** — hooks stay non-fatal (exit 0 on CLI failure); we are making losses detectable, not making hooks blocking.
- **Making hooks resolve the CLI differently** (e.g. per-worktree `metta` resolution, tsx-from-source execution, or bundling the CLI into hooks) — the global-link execution model stays as-is.
- **A git `post-merge` hook installed into the repo** — the rebuild lives in the ship flow where failures are surfaced in-session, not in a git hook that can itself fail silently.
- **Continuous/background drift monitoring** — drift detection is on-demand (`metta doctor`) and checkpoint-based (ship, finalize GAPS), not a daemon or per-hook self-check.
- **npm publish / global reinstall workflows** — keeping the zeus machine's global install fresh (noted in project memory) is a separate operational task.
