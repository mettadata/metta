# Correctness Review: adaptive-workflow-tier-selection-emit-complexity-score-after

## Verdict

**FAIL**

Two clear spec violations in the prompt wording and one missing structural guard. Each of the issues flagged below is a concrete scenario-miss that would fail an exact-substring integration test, or allow a prompt that the spec says must be suppressed.

## Findings

### Critical

- **src/cli/commands/complete.ts:185-248** (severity: high) — The downscale prompt is NOT guarded against `/metta-quick` runs. Requirement `AutoDownscalePromptAtIntent` (spec.md:140) states: "The downscale prompt MUST NOT fire for `/metta-quick` runs because quick is already the smallest named interactive workflow." The current implementation only compares `recRank < chosenRank`. When a user runs `/metta-quick` with an impact section listing 1 file, `chosenRank=1, recRank=0`, and the prompt fires in contradiction to the spec. A structural guard `if (currentWorkflow === 'quick') skip-downscale` is missing. The intra-quick fan-out reduction (handled at the skill layer) is a separate concern and does not cover this case.

- **src/cli/commands/complete.ts:375** (severity: high) — Post-implementation upscale prompt uses an em-dash (`—`) where the spec requires double-dash (`--`). Spec scenario `post_impl_prompt_appears_when_recomputed_tier_exceeds_workflow` (spec.md:201-203) requires the exact literal substring `Implementation touched 5 files -- promote to /metta-standard and retroactively author stories + spec? [y/N]`. Code emits `Implementation touched ${fileCount} files — promote to /metta-${recommendedTier} and retroactively author stories + spec?`. This will fail any exact-text assertion and is also a spec-literal mismatch.

- **src/cli/commands/complete.ts:201, 277, 375** (severity: high) — None of the three interactive prompts append `[y/N]` to the question text. Every spec scenario that quotes the prompt text ends with `[y/N]` (spec.md:147, 175, 203). `askYesNo` does NOT auto-append any suffix — it prints the question string verbatim followed by a single space. Exact-text scenario assertions for prompt strings will fail.

- **src/cli/commands/complete.ts:413** (severity: high) — The post-impl decline warning uses an em-dash (`—`) where the spec requires double-dash (`--`). Spec scenario `decline_persists_actual_score_and_prints_warning` (spec.md:231) requires the exact stderr text `Warning: this change touched 5 files -- standard workflow was recommended; finalize will proceed on quick`. Code emits `... ${fileCount} files — ${recommendedTier} workflow was recommended ...`.

### Warnings

- **src/cli/commands/complete.ts:319, 422** (severity: medium) — Both scoring blocks are wrapped in `try { ... } catch {}` with an empty catch. Any genuine failure inside the block (Zod write failure, workflow YAML load failure, artifact write failure) is silently swallowed with no logging. For an advisory-only feature this is defensible; however, it will hide real bugs (e.g. bad workflow YAML path, Zod validation failure on the newly written metadata) and make failures in integration tests silent. Consider at minimum writing a single diagnostic line to stderr (guarded by `--json` to protect JSON callers).

- **src/cli/commands/complete.ts:257, 356** (severity: medium) — The two full-tier hard-cap advisory lines use em-dash (`—`). The spec does not specify the exact wording of these two advisories (they are not bound by any Given/When/Then scenario), so this is not a strict violation, but it is inconsistent with the `--` convention used in every other user-visible spec string in this feature.

- **src/cli/commands/complete.ts:381-408** (severity: low/medium) — Spec `PostImplementationUpscalePromptAccept` scenario `post_impl_yes_spawns_agents_and_updates_metadata` (spec.md:205-208) says retroactive `stories.md` and `spec.md` must be "marked `complete`" after the yes path. The code instead marks them `pending` (line 390), expecting the skill orchestrator to author them and subsequently call `metta complete stories` and `metta complete spec`. This is a reasonable split (CLI queues, skill authors), the `summary.md` explicitly documents this deferral, and the stdout directive at line 407 tells automation to run the next `metta instructions` steps. Nevertheless, the spec's Given/When/Then literally reads "marked `complete`" — a reader running the automated scenario check will see pending, not complete. Either tighten the spec to "queued as pending for skill authoring" or move the completion into the skill orchestrator and document the boundary clearly.

- **src/cli/commands/complete.ts:164-322** (severity: low) — The banner-emission bookkeeping (`bannerEmitted`) is only checked in the upscale branch. The downscale branch at line 240 always emits its banner unconditionally on the No path, and the downscale and upscale branches are mutually exclusive. The dead-guard comment at line 307 acknowledges this. No bug — just redundant complexity that could confuse future readers.

- **src/cli/commands/complete.ts:209-238** (severity: low) — In the downscale rebuild, stages in the target graph that do NOT yet exist in `existingArtifacts` are inserted at `pending`. If a downstream step expects an automatic `ready` handoff, that new pending artifact may never get picked up until an explicit ready-promotion occurs. This is consistent with how `getNext` works later in the file, so no concrete bug, but worth verifying in the integration test that the next promoted artifact is correctly marked `ready` for a downscaled change.

- **src/cli/commands/complete.ts:175-318** (severity: low) — When the user declines a downscale or upscale prompt, the downscale/upscale else branch emits the advisory banner. On agreement (score matches workflow), no banner is printed from `complete`. The `InstructionsAdvisoryBanner` requirement guarantees the agreement banner via `metta instructions`, but if a user only ever interacts via `metta complete`, they never see the agreement banner. Spec-compliant (banner-on-complete is only required for the decline/non-tty paths), but worth noting as a UX gap.

### Suggestions (nice to have)

- **src/complexity/scorer.ts:100-107** — `isScorePresent` duplicates validation the schema already guarantees. If the metadata was loaded via Zod, `score` is always an integer in [0,3] when present. The check is defensive (good) but also admissible-to-simplify.

- **src/cli/commands/complete.ts:15-24** — `TIER_RANK` is locally redefined in `complete.ts` AND `renderer.ts` (same map under slightly different names). The spec `TierThresholds` requirement (spec.md:56) says thresholds must be in "a single authoritative location". Rank ordering is not the same as thresholds, but keeping a single `TIER_ORDER` export from `src/complexity/scorer.ts` would remove duplication. Low risk, minor refactor.

- **src/cli/commands/complete.ts:429-431** — The `updatedMetadata` re-read is fine, but consider using `metadata` from closure when no upscale/downscale occurred to avoid a second disk read. Micro-optimization.

## Scenarios checked

Below I walked every scenario in spec.md and noted pass/fail/partial status.

### ComplexityScoreComputation (4 scenarios)
- `score_computed_from_impact_section` — PASS (scoreFromIntentImpact + isScorePresent guard works).
- `score_absent_before_intent_written` — PASS (schema optional; scoreFromIntentImpact returns null with no `## Impact`).
- `score_not_recomputed_on_intent_edit` — PASS (isScorePresent guard at line 171 prevents overwrite; scoring only runs on `metta complete intent`).
- `score_uses_actual_files_from_summary_for_post_impl_recompute` — PASS (scoreFromSummaryFiles writes `actual_complexity_score` at line 339; original `complexity_score` is not touched).

### ComplexityScoreStorage (3 scenarios)
- `schema_accepts_full_complexity_block` — PASS (Zod schema declares all three fields optional).
- `schema_accepts_legacy_file_without_fields` — PASS (all three fields optional, defaults to absent).
- `actual_score_does_not_overwrite_original` — PASS (only `actual_complexity_score` key is written at line 339; no code path writes `complexity_score` a second time once present).

### TierThresholds (4 scenarios)
- `single_file_maps_to_trivial` — PASS (`tierFromFileCount(1)` returns `trivial`, score 0).
- `two_files_maps_to_quick` — PASS (n<=3 branch).
- `four_files_maps_to_standard` — PASS (n<=7 branch).
- `eight_files_maps_to_full` — PASS (default branch).

### StatusCommandSurface (4 scenarios)
- `human_output_shows_complexity_line` — PASS (renderStatusLine produces exact format).
- `json_output_includes_complexity_object` — PASS (status.ts line 89 emits the score object).
- `json_output_includes_both_scores_when_present` — PASS (status.ts includes both).
- `absent_score_renders_without_error` — PASS (renderStatusLine returns "" for null; JSON emits null).

### InstructionsAdvisoryBanner (4 scenarios)
- `banner_agreement_state` — PASS.
- `banner_downscale_state` — PASS.
- `banner_upscale_state` — PASS.
- `banner_suppressed_when_score_absent` — PASS (renderBanner returns "" for null).

### AutoDownscalePromptAtIntent (4 scenarios)
- `downscale_prompt_appears_on_oversized_propose` — FAIL: prompt text missing `[y/N]` suffix (see critical finding above). Tier comparison logic is correct.
- `downscale_yes_mutates_workflow_and_drops_artifacts` — PASS (rebuild logic at 209-238 correctly drops droppable planning artifacts in pending/ready).
- `downscale_prompt_suppressed_when_workflow_matches` — PASS (guard `recRank < chosenRank` prevents same-tier prompt).
- `downscale_prompt_skipped_non_tty` — PASS (askYesNo returns false; banner emitted via renderBanner in else branch).
- IMPLICIT: `downscale_prompt_suppressed_for_metta_quick` — FAIL: per spec line 140, `/metta-quick → trivial` must not prompt, but no guard exists (see critical finding above).

### AutoUpscalePromptAtIntent (4 scenarios)
- `upscale_prompt_appears_on_undersized_quick` — FAIL: prompt text missing `[y/N]` suffix.
- `upscale_yes_mutates_workflow_and_inserts_artifacts` — PASS (rebuild logic at 288-298 adds missing target stages as pending, preserves existing statuses).
- `upscale_prompt_suppressed_when_workflow_exceeds_recommendation` — PASS (guard `recRank > chosenRank` prevents).
- `upscale_auto_accept_skips_prompt` — PASS (autoAccept branch skips askYesNo).

### PostImplementationUpscalePromptAccept (4 scenarios)
- `post_impl_prompt_appears_when_recomputed_tier_exceeds_workflow` — FAIL: uses em-dash `—` and missing `[y/N]`. The exact spec substring will not match.
- `post_impl_yes_spawns_agents_and_updates_metadata` — PARTIAL: workflow update happens (line 393), actual_complexity_score persists (line 339), but the CLI marks stories/spec `pending` rather than `complete`. Authoring is delegated to the skill orchestrator per summary.md. This is a spec/implementation boundary ambiguity (see warnings).
- `post_impl_yes_uses_promoted_fan_out` — OUT-OF-SCOPE-FOR-CLI: delegated to skill fan-out layer; CLI correctly updates workflow field which is what the skill reads.
- `post_impl_no_research_design_tasks_authored` — PASS (only `stories` and `spec` are touched at line 387).

### PostImplementationUpscalePromptDecline (4 scenarios)
- `decline_persists_actual_score_and_prints_warning` — FAIL: warning uses em-dash `—` where spec requires `--`. Exact-substring assertion will fail. Persistence itself is correct.
- `decline_does_not_create_stories_or_spec` — PASS (decline path does not touch artifacts).
- `decline_exits_zero_and_verification_proceeds` — PASS (no process.exit; flow continues to getNext).
- `non_tty_defaults_to_decline` — PASS (askYesNo returns false; decline-path warning emitted; actual_complexity_score already persisted at line 339 before comparison).

### AutoAcceptRecommendationFlag (4 scenarios)
- `auto_flag_persists_field` — PASS (verified in commands/propose.ts/quick.ts plumbing per summary.md).
- `auto_flag_skips_all_three_prompts` — PASS (all three sites check `autoAccept` and short-circuit).
- `accept_recommended_alias_behaves_identically` — PASS (aliased at Commander layer).
- `auto_with_workflow_honours_initial_choice` — PASS (`--workflow` sets initial; `--auto` only governs later recommendation shifts).

### OverrideRemainsAuthoritative (3 scenarios)
- `workflow_flag_alone_preserves_initial_choice_with_prompt` — PASS (no auto-accept => prompt fires when recRank<chosenRank).
- `workflow_without_auto_shows_intent_prompts_normally` — PASS (upscale prompt fires; No path leaves workflow unchanged).
- `workflow_with_auto_combination_is_predictable` — PASS (`--auto` auto-accepts post-impl upscale; full-tier hard cap applies).

### IntraQuickDownsizeRule (4 scenarios)
- OUT-OF-SCOPE for this review (skill-layer fan-out); CLI correctness is not affected.

### ScoringRubricSpec (3 scenarios)
- OUT-OF-SCOPE for this review (rubric authoring); code is not affected.

## Structural concerns verified

- **Tier comparison correctness**: PASS — `trivial=0, quick=1, standard=2, full=3` in both `TIER_RANK` (complete.ts) and `TIER_ORDER` (renderer.ts) and `TIER_SCORE` (scorer.ts). All three agree.
- **Full-tier hard cap is structural**: PASS — the `if (recommendedTier === 'full')` check at lines 254 and 353 comes BEFORE the `autoAccept` check, so `--auto` cannot bypass the cap.
- **Auto-accept short-circuit takes yes in all three sites**: PASS — lines 189, 265, 364 set `takeYes=true` when `autoAccept`.
- **Non-TTY defaults to No**: PASS — `askYesNo` returns `defaultYes ?? false` when `!process.stdin.isTTY`.
- **Downscale workflow rebuild**: PASS — unstarted planning artifacts dropped, statuses on target stages preserved.
- **Upscale workflow rebuild**: PASS — missing target stages inserted as pending; existing statuses preserved.
- **actual_complexity_score persisted on ALL post-impl paths with a non-null score**: PASS — line 339 writes before the tier comparison; same-tier and lower-tier cases both persist.
- **Stories/spec skip-if-complete**: PASS — lines 388-390 skip when `prev === 'complete'`.

## What must be fixed to reach PASS

1. Append `[y/N]` to all three prompt question strings (complete.ts:201, 277, 375).
2. Replace em-dash `—` with double-dash `--` in the three user-visible message strings at lines 375, 413, and optionally 257/356 for consistency (complete.ts).
3. Add a structural guard in the intent-time downscale branch to skip the prompt when `currentWorkflow === 'quick'`, per spec.md:140 (complete.ts:185).

Secondary (warnings): reconcile the `stories`/`spec` "complete" vs "pending" ambiguity with the spec or the summary document; consider removing the silent `catch {}` blocks or replacing with a single-line diagnostic.
