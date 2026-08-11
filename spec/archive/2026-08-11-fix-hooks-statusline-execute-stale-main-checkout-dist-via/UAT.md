# UAT: fix-hooks-statusline-execute-stale-main-checkout-dist-via

- **Change**: fix-hooks-statusline-execute-stale-main-checkout-dist-via
- **Generated**: 2026-08-11
- **Source**: intent + summary (reduced)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

*Reduced script — derived from intent/summary; steps are confirmation prompts.*

### Intent proposal

#### Step 1.1
- **Do**: Confirm: Rebuild main's dist during ship (root-cause fix). Add a post-merge step to the ship flow that runs `npm run build` in the main checkout after the change branch merges to main, so the globally-linked dist always tracks main HEAD. The build step MUST fail loudly: a build failure surfaces as a visible ship-flow error/warning, never a swallowed exit code. If the build cannot run (e.g. main checkout unavailable), ship reports that condition explicitly rather than skipping silently.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: `metta doctor` dist-drift detection (on-demand diagnostic). Teach `metta doctor` to compare a dist build stamp (git HEAD commit recorded at build time, falling back to mtime comparison if absent) against the main checkout's current git HEAD, and report "dist behind HEAD" drift with the offending commit range. The build process records the stamp (e.g. a `dist/.build-stamp` file emitted by the build script — an external artifact, not an inlined string literal).
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: TOKENS.md GAPS tripwire (loss detection at finalize). When finalize renders TOKENS.md with 0 automatic hook records but ≥1 completed metta-* artifact for the change, emit a loud hook-health failure entry in the GAPS section naming the likely cause (hook-to-CLI path failure) so an empty report is never mistaken for a quiet change.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Trivial workflow — verified against intent.md proposal items (3 verifiers, fan-out; coverage verdicts from the intent-coverage verifier):

#### Step 2.1
- **Do**: Confirm: [x] Ship rebuilds main's dist post-merge (root-cause fix) — COVERED. `src/ship/merge-safety.ts:39-80` `rebuildDist()` runs `npm run build` in the target checkout after post-merge gates on the success path only (never dry-run/rollback); build failure yields a loud `fail` step without undoing the merge; missing package.json yields `skip` ("not an npm project"); corrupt JSON yields `fail`. `src/cli/commands/ship.ts` prints a stderr WARNING block on rebuild failure. metta-ship SKILL.md (both copies, byte-identical) gained an anchored step 9 rebuild instruction. Tests: `tests/merge-safety.test.ts` rebuild-dist block, 16/16 (marker-file build proof, merge-not-rolled-back, skip/fail/dry-run/gate-rollback cases).
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: [x] Build stamp + `metta doctor` drift detection — COVERED. `scripts/emit-build-stamp.mjs` writes `dist/.build-stamp` ({commit, built_at}; null commit if git unavailable; never fails the build); `package.json` build chains it. `src/config/build-stamp.ts` Zod-validates the stamp; `distStampCheck` reports "dist behind HEAD" with commit range; mtime fallback when stamp missing. `src/cli/commands/doctor.ts` "Dist freshness" check. Tests: `src/config/build-stamp.test.ts` 19/19 incl. end-to-end emit-script runs. Live confirmation: doctor correctly reported real drift (`8fbc894..b9cbee3`) during parallel implementation.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: [x] TOKENS.md GAPS hook-health tripwire — COVERED. `src/finalize/tokens-report-generator.ts` `computeHookHealthFailure()`: zero `source: 'hook'` records + >=1 completed artifact timing prepends a loud Hook health failure GAPS entry; silent when hook records exist or no artifacts completed. Tests: `tests/tokens-report-generator.test.ts` 27/27 (empty usage, prose-only, uncompleted timings, ordering).
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.4
- **Do**: Confirm: [x] Out of scope respected — no changes to `.claude/hooks/metta-tokens-record.mjs`, guard hooks, or `.claude/statusline/statusline.mjs` (confirmed via `git diff main...HEAD --stat`).
- **Observe**: behaves as described
- [ ] Pass
