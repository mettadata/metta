# Hooks and statusline execute stale main-checkout dist via global npm link, zeroing automatic token recording

**Captured**: 2026-08-11
**Status**: logged
**Severity**: major

## Symptom
Every TOKENS.md finalized on 2026-08-11 (mint-clobbering, tsx, versioning, and later changes) shows 0 automatic token records despite real metta-* subagent spawns during those changes. The SubagentStop hook fired each time but no `token_usage` records landed, and the failure was completely silent — no visible error, empty reports only discovered after the fact. By contrast, enforce-pr-based-shipping's TOKENS.md (2026-08-08, prose-recorded) has 3 records and renders correctly, so the report pipeline itself is fine.

## Root Cause Analysis
The SubagentStop hook `metta-tokens-record.mjs` shells out to `metta tokens record`, and `metta` resolves through the global npm link to `/home/utx0/.npm-global/bin/metta -> ../lib/node_modules/@mettadata/metta/dist/cli/index.js` — i.e. the MAIN checkout's `dist/`. But `dist/` in main is only rebuilt when someone runs `npm run build` in the main checkout, while change-lifecycle builds happen inside per-change worktrees. Main's `dist/` was pre-PR#58/#61 (verified: `metta release` was missing until a manual rebuild on 2026-08-11), so the linked CLI's change resolution was worktree-blind and every hook-invoked `tokens record` failed with "No active changes." The hook is contractually fail-open: it catches the non-zero exit, logs to stderr only, and exits 0 — so every failure vanished silently. A synthetic test confirmed the hook pipeline itself (payload parse, usage sum, CLI call, stderr diagnostics) is correct; only the hook-to-CLI-to-resolution path was starved. The same stale-dist hazard applies to the statusline (execs `metta status --json`) and both guard hooks' `metta status` probes — everything that shells out to the global `metta` tracks dist, not source or main HEAD.

### Evidence
- `.claude/hooks/metta-tokens-record.mjs:146` — the hook execs the globally-linked `metta tokens record` and its catch block (line 165) swallows every failure as non-fatal, exiting 0 silently.
- `src/cli/commands/tokens.ts:79` — the "No active changes." failure path the stale (worktree-blind) dist hit on every hook invocation.
- `.claude/statusline/statusline.mjs:214` — statusline execs `metta status --json` through the same global link, inheriting the identical stale-dist hazard (as do both guard hooks' status probes).

## Candidate Solutions
1. **Refresh main's dist during ship** — Add a step to the ship flow (or a lightweight git postmerge hook) that runs `npm run build` on main after the merge/pull, so the globally-linked dist always tracks main HEAD. Tradeoff: adds build time to every ship and a postmerge hook can fail silently itself if the build breaks, trading one invisible staleness for another unless the ship step surfaces build failures loudly.
2. **`metta doctor` reports dist-behind-HEAD drift** — Teach doctor to compare a dist build stamp (or dist mtime) against git HEAD in the main checkout and report drift, making staleness observable on demand. Tradeoff: purely diagnostic — it only helps if someone runs doctor; the hooks still fail silently between checks.
3. **TOKENS.md GAPS section flags zero-record anomalies** — When finalize renders TOKENS.md with 0 hook records but N artifact completions, emit a loud hook-health failure in the GAPS section instead of an empty report, so starved recording is caught at finalize time. Tradeoff: detects the damage after the tokens are already lost for that change; it is a tripwire, not a fix for the stale-dist root cause.
