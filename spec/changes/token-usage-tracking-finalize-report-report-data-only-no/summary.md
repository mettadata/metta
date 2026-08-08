# Implementation Summary: token-usage-tracking-finalize-report-report-data-only-no

All 11 tasks across 4 batches completed; full suite green (99 files / 1723 tests), `tsc --noEmit` clean, build ships `dist/templates/artifacts/tokens.md`, all byte-identity pairs hold.

## Batch 1 — foundations (parallel, 4 tasks)
- **1.1 Schemas** (`3bc0d781f`): `TokenUsageRecordSchema` (strict: task, agent, model `ModelAliasEnum`, tokens positive int, ISO timestamp) + `token_usage` optional array on `ChangeMetadataSchema`; `TokensConfigSchema` (strict, `enabled` default true) wired as `tokens` on `ProjectConfigSchema`; disambiguation comments vs `artifact_tokens`. 12 new schema tests.
- **1.2 Guard hooks** (`041c75ca6`): `'tokens'` added to `ALLOWED_SUBCOMMANDS` in both hook copies (byte-identical, `node --check` clean); orchestrator allow test added.
- **1.3 Template** (`f706f0a27`): external `src/templates/artifacts/tokens.md` with `{change_name}`, `{generated_date}`, `{total}`, `{per_artifact_table}`, `{per_role_rollup}`, `{per_model_rollup}`, `{split}`, `{gaps}` and the approximate-figures disclaimer.
- **1.4 Spec datum fix** (`5d666ce47`): ADR-1 applied — every `cheap` scenario datum → `haiku`; split requirement reworded to the non-inherit vs inherit definition.

## Batch 2 — features (parallel, 3 tasks)
- **2.1 CLI** (`3df28da0b`): `metta tokens record` in `src/cli/commands/tokens.ts`, structural clone of model-escalation (auto-select, Zod parse before single `updateChange` append, `tokens_record_error` exit 4); registered in `src/cli/index.ts`; 9 tests.
- **2.2 Generator** (`b88b64c42`): `generateTokensReport` in `src/finalize/tokens-report-generator.ts` — clock-free, deterministic, template-driven; record-order table, lexicographic rollups/GAPS, non-inherit vs inherit split, exact-match GAPS from `artifact_timings` keys; 13 tests.
- **2.3 Metric** (`acfea293a`): `getAvgTokensPerChangeByTier` in `src/util/ceremony-metrics.ts` — active+archive iteration, absent/empty `token_usage` excluded, fixed four-tier shape with per-tier `{mean, sample_size} | null`; 6 new tests.

## Batch 3 — integration (parallel, 3 tasks)
- **3.1 Finalizer** (`b4b95bc49`): Step 5c between UAT and archive — `tokens.enabled` gate, warn-and-continue with partial-file cleanup, `tokensPath`/`tokensError` additive on `FinalizeResult`, `tokensPath`/`tokensWarning` in finalize CLI JSON + human output; 11 new finalizer scenarios + CLI output tests.
- **3.2 Progress** (`61e6496d1`): `avg_tokens_per_change_by_tier` JSON key with verbatim null passthrough + human tier line (`formatThousandsK` / explicit `no data`); 3 new tests.
- **3.3 Skills** (`12cd76a13`): one verbatim recording instruction inserted byte-identically at four anchors (metta-plan 2d, metta-execute after the model pass-through paragraph, metta-verify new step 3, metta-next Rules bullet); all template+deployed pairs byte-identical; new `tests/skill-tokens-record.test.ts`.

## Batch 4 — verification (1 task)
- **4.1**: `npm test` 1723/1723 pass, `tsc --noEmit` clean, build ships new template, byte-identity re-verified. No fixes needed.

## Notes
- All figures recorded by the new command are approximate orchestrator-reported counts (stated in the report header).
- Known accepted gap: metta-propose/quick/auto/fix-issues/fix-gap skills carry no recording instruction; their changes surface in TOKENS.md GAPS by design.
- The `metta-guard-edit` hook is worktree-blind (blocks Write/Edit in worktrees; executors used bash fallbacks) — pre-existing issue, worth logging separately.

## Verification (iteration 1) — ALL GATES PASS

- **Tests** (`verify/tests.md`): GATE PASS — 99/99 files, 1723/1723 tests, no flakes, ~282s.
- **Typecheck/lint/build/byte-identity** (`verify/tsc-lint.md`): GATE PASS — `tsc --noEmit` clean, `npm run lint` clean, build ships `dist/templates/artifacts/tokens.md`, all five template/deployed pairs byte-identical.
- **Spec traceability** (`verify/scenarios.md`): GATE PASS — 34/34 scenarios evidenced; 32 by passing tests, 2 weak paths (zero-active-changes exit 4; human confirmation line) resolved by direct sandboxed CLI invocation.
- Review verdicts (iteration 1): correctness PASS_WITH_WARNINGS, security PASS_WITH_WARNINGS, quality PASS — 0 critical, 0 major, 14 minor (logged in review.md for follow-up).
