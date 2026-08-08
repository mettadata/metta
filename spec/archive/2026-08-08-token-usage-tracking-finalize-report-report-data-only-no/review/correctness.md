VERDICT: PASS_WITH_WARNINGS

# Correctness Review: token-usage-tracking-finalize-report-report-data-only-no

Reviewer scope: logic errors, off-by-one, edge cases, spec Given/When/Then compliance.
All 10 relevant test files were run in the worktree: 450/450 pass.

## Spec compliance matrix (every scenario checked against implemented behavior)

| Requirement | Scenarios | Status |
|---|---|---|
| Token Usage Record Schema | valid record round-trip; 0 / 12.5 / bad-model / unknown-key rejected; metadata without `token_usage` valid, `artifact_tokens` untouched | Implemented (`src/schemas/change-metadata.ts:71-78,102,111-113`) and tested (`tests/schemas.test.ts`) |
| Tokens Record CLI Command | single-change append; `--change beta` targeting; ambiguous/missing change exit 4; invalid tokens writes nothing | Implemented (`src/cli/commands/tokens.ts`), structural clone of `model-escalation.ts` confirmed; validation (`TokenUsageRecordSchema.parse`) strictly precedes the single `updateChange` write, so exit-4 paths leave no partial state — verified by tests asserting `token_usage` stays `undefined` after each rejection |
| Guard Hook Allowlist | allow `tokens`; byte-identical copies; `node --check`; other classifications unchanged | Verified directly: `diff` of both hook copies is empty, `node --check` passes on both, diff shows exactly one added `ALLOWED_SUBCOMMANDS` line per copy |
| Skill Recording Instruction | four skills carry the instruction; template/deployed pairs byte-identical; no routing wording changed | Verified: all four pairs byte-identical (`diff -q`); diffs show only the added verbatim instruction plus mechanical renumbering (plan 2d->2e, verify 3/4->4/5); `tests/skill-tokens-record.test.ts` + auto-discovering `tests/template-deploy-sync.test.ts` enforce it |
| Report Generation At Finalize | pre-archive write swept into archive; deterministic/template-driven/AI-free; empty usage still yields report | Step 5c (`src/finalize/finalizer.ts:207-233`) sits after the real merge and before `archive`; generator (`src/finalize/tokens-report-generator.ts`) is clock-free with caller-injected `generatedAt`; determinism byte-identity tested |
| Report Content | full sections; GAPS exact-match; no-gaps wording | All seven sections in order in `src/templates/artifacts/tokens.md`; GAPS is exact string match per ADR-2 (`computeGaps`, lines 88-93), fine-grained `T1` counts in totals but does not clear the `tasks` gap — tested; split figures sum to total by construction (every record goes to exactly one of the two accumulators, `renderSplit` lines 63-74) — tested |
| Config Toggle | disabled skips cleanly; omitted key defaults enabled; strict rejection | `TokensConfigSchema` (`src/schemas/project-config.ts:51-53`) mirrors `UatConfigSchema`; `tokens: TokensConfigSchema.default({})` wired; all three scenarios tested |
| No Stray TOKENS.md | gate failure, dry-run, incomplete artifacts, merge conflict | Structurally unreachable: all four early returns precede Step 5c and each carries `tokensPath: null` (finalizer.ts:94,113,139,156,173); dry-run returns at Step 5 before generation; each path has a dedicated no-stray finalizer test |
| Failure Degradation | assembly error degrades to warning; both output modes report it | Independent try/catch per step; Step 5c failure sets `tokensError`, best-effort `rm` of partial file, finalize proceeds; independence verified BOTH directions (UAT fails -> tokens still generated, and vice versa) in `tests/finalizer.test.ts` |
| Tokens Path In Output | JSON additive `tokensPath`; human line; disabled -> null + no line; error shapes untouched | `src/cli/commands/finalize.ts:148-149,176-177`; `tests/cli-finalize.test.ts` asserts exact key-set equality on `incomplete_artifacts` and `gates_failed` payloads (byte-for-byte shape), success payload carries `tokensPath` string, disabled -> `null` |
| Progress Avg By Tier | tier averages (20000/50000 datum reproduced exactly); no-data null vs 0; pre-feature archives skipped | `getAvgTokensPerChangeByTier` (`src/util/ceremony-metrics.ts:212-272`): absent field AND empty array both excluded (ADR-3), unknown tiers ignored, all four keys always emitted, per-tier `null` passed through verbatim in JSON; the spec's exact 10000+30000->20000 / 50000 datum is reproduced in `tests/progress-ceremony-metrics.test.ts` |

Also verified: `formatThousandsK` exists (local to `progress.ts:269`); `copy-templates` already covers `src/templates/artifacts/` so `tokens.md` ships with zero build changes; `TemplateEngine.substitute` is single-pass `String.replace` with a callback, so injected table content can neither re-trigger substitution nor suffer `$`-pattern corruption; an unloadable config correctly degrades 5b and 5c independently (each re-runs `load()` under its own try/catch).

## Issues Found

### Critical (must fix)

None.

### Major (should fix)

None.

### Minor

1. **Untested spec datum: zero-active-changes error path.** Spec scenario "Ambiguous or missing change fails typed with exit 4" covers GIVEN *zero* active changes OR two; `tests/tokens-command.test.ts` tests the two-change and nonexistent-`--change` cases but never the zero-change case (`'No active changes.'`, `src/cli/commands/tokens.ts:41`). The code path is correct by inspection (clone of model-escalation), but the scenario datum is unverified. Fix: add one test with no changes created asserting exit 4 and message `No active changes.`

2. **`Number(options.tokens)` is permissive** (`src/cli/commands/tokens.ts:52`): `--tokens 1e3` -> 1000 and `--tokens 0x20` -> 32 pass validation. Zod correctly rejects `NaN`, `Infinity`, floats, zero, and negatives, so no partial-state risk exists — but non-decimal notations are silently accepted. Suggestion: pre-check `/^\d+$/.test(options.tokens)` for a crisper contract (matches the trigger pre-check pattern in `model-escalation.ts:36-43`).

3. **Markdown table cells are not pipe-escaped** (`src/finalize/tokens-report-generator.ts:41-47,55-59`): a `task` or `agent` value containing `|` would corrupt the per-artifact/rollup table rendering (output stays deterministic, only cosmetically broken). Practically unreachable via the skill contract; suggestion only — escape `|` as `\|` in cell values.

4. **Human tiers-with-data under 500 tokens render as `0k`** (`progress.ts:236,269-270` — `Math.round(mean/1000)`). The spec's no-data-never-rendered-as-`0` constraint applies only to *no-data* tiers (which correctly render `no data`), so this complies, but a tier whose real mean is e.g. 400 displays `0k`, which a reader could confuse with no data. Cosmetic; consistent with the existing `formatThousandsK` convention.

5. **Human confirmation line of `tokens record` untested** ("exits zero with a confirmation" datum in the first CLI scenario). All success-path tests use `--json`. The line exists (`tokens.ts:66-68`); one non-JSON assertion would close the datum.

## Verdict

PASS_WITH_WARNINGS — no correctness defects found; every spec Given/When/Then scenario has matching implemented behavior; 5 minor findings (2 small test-coverage gaps against explicit spec datums, 3 hardening/cosmetic suggestions).
