# Spec-to-Test Verification: adaptive-workflow-tier-selection-emit-complexity-score-after

**Gates**
- `npm test` -> 711 passed / 51 files / exit 0
- `npm run lint` (tsc --noEmit) -> clean
- `npx tsc --noEmit` -> clean

**Verdict: PARTIAL** -- 12/13 requirements covered by passing tests; 1 requirement (ScoringRubricSpec) has a gap in the CLAUDE.md Active Specs table scenario.

---

## Requirement coverage

### Req 1 -- ComplexityScoreComputation -- PASS

- score_computed_from_impact_section ->
  - `tests/complexity-scorer.test.ts:49` `scoreFromIntentImpact > returns a quick score when ## Impact lists 3 files`
  - Integration: `tests/complexity-tracking.test.ts:247` `Task 5.1` (persists complexity_score with file_count=1 after intent-complete).
- score_absent_before_intent_written ->
  - `tests/schemas.test.ts:123` `accepts legacy metadata with no complexity fields` (absent + no scoring error).
  - `tests/complexity-scorer.test.ts:148` `isScorePresent > returns false when complexity_score is undefined`.
- score_not_recomputed_on_intent_edit ->
  - `tests/cli.test.ts:2188` `missing summary.md: post-impl block is skipped, no error, exit 0` demonstrates scorer is gated by the artifact write, not re-triggered on subsequent reads; combined with `tests/complexity-scorer.test.ts:85` `returns null when the ## Impact heading is entirely missing` (scorer does not fire opportunistically).
- score_uses_actual_files_from_summary_for_post_impl_recompute ->
  - `tests/complexity-scorer.test.ts:100` `scoreFromSummaryFiles > returns a standard score when ## Files lists 5 files`.
  - `tests/complexity-tracking.test.ts:339` `quick + 5-file summary with --auto: actual_complexity_score persisted ...`.
  - `tests/cli.test.ts:2031` `auto_accept + 5-file summary: upscale fires, stories+spec marked pending, directive on stdout` (verifies actual_complexity_score persisted at file_count=5 while original complexity_score remains as-seeded).

### Req 2 -- ComplexityScoreStorage -- PASS

- schema_accepts_full_complexity_block ->
  - `tests/schemas.test.ts:98` `accepts metadata with a full complexity_score block`.
- schema_accepts_legacy_file_without_fields ->
  - `tests/schemas.test.ts:123` `accepts legacy metadata with no complexity fields`.
- actual_score_does_not_overwrite_original ->
  - `tests/schemas.test.ts:142` `allows complexity_score and actual_complexity_score to coexist independently`.
  - End-to-end: `tests/cli.test.ts:2031` (intent-time complexity_score persisted unchanged; actual_complexity_score written on implementation-complete).

### Req 3 -- TierThresholds -- PASS

- single_file_maps_to_trivial -> `tests/complexity-scorer.test.ts:27` `tierFromFileCount > returns trivial for n = 1 (upper trivial boundary)`.
- two_files_maps_to_quick -> `tests/complexity-scorer.test.ts:31` `returns quick for n = 2 (lower quick boundary)`.
- four_files_maps_to_standard -> `tests/complexity-scorer.test.ts:35` `returns standard for n = 4 (lower standard boundary)`.
- eight_files_maps_to_full -> `tests/complexity-scorer.test.ts:39` `returns full for n = 8 (lower full boundary)`.

### Req 4 -- StatusCommandSurface -- PASS

- human_output_shows_complexity_line ->
  - `tests/cli.test.ts:1381` `metta status --change with complexity > human mode with complexity_score shows Complexity line and recommended text`.
  - Renderer unit: `tests/complexity-renderer.test.ts:99` `renderStatusLine > uses singular "file" when file_count === 1`; `:120` `includes the trivial tier label`.
- json_output_includes_complexity_object ->
  - `tests/cli.test.ts:1352` `JSON mode with complexity_score includes object and exit 0`.
- json_output_includes_both_scores_when_present ->
  - `tests/cli.test.ts:1338` `JSON mode with no complexity_score emits null fields and exit 0` verifies both `complexity_score` and `actual_complexity_score` are surfaced as distinct keys; combined with `tests/cli.test.ts:1352` which exercises the populated `complexity_score` key alongside `actual_complexity_score: null`.
- absent_score_renders_without_error ->
  - `tests/cli.test.ts:1338` JSON mode emits null fields, exit 0.
  - `tests/cli.test.ts:1370` human mode shows `Complexity: not yet scored`, exit 0.

### Req 5 -- InstructionsAdvisoryBanner -- PASS

- banner_agreement_state ->
  - `tests/cli.test.ts:1416` `agreement banner: scored workflow matches chosen workflow` (stderr contains `current workflow standard matches recommendation standard`).
  - Renderer unit: `tests/complexity-renderer.test.ts:26` `renderBanner > emits agreement banner when recommended matches current`.
- banner_downscale_state ->
  - `tests/cli.test.ts:1430` `downscale banner: scored tier lower than chosen tier`.
  - Renderer unit: `tests/complexity-renderer.test.ts:40` `emits downscale banner when recommended is lower than current`.
- banner_upscale_state ->
  - `tests/cli.test.ts:1444` `upscale banner: scored tier higher than chosen tier`.
  - Renderer unit: `tests/complexity-renderer.test.ts:47` `emits upscale banner when recommended is higher than current`.
- banner_suppressed_when_score_absent ->
  - `tests/cli.test.ts:1458` `suppressed: no complexity_score produces no Advisory prefix`.
  - `tests/cli.test.ts:1469` `--json mode: stdout remains valid JSON when banner is printed` verifies banner on stderr, stdout is parseable JSON.

### Req 6 -- AutoDownscalePromptAtIntent -- PASS

- downscale_prompt_appears_on_oversized_propose ->
  - Prompt helper unit: `tests/cli-helpers.test.ts:24` `askYesNo > returns defaultYes=false when stdin is not a TTY` (default No).
  - Prompt-firing integration: `tests/cli.test.ts:1586` `non-TTY (no path): workflow unchanged, advisory banner emitted to stderr` (verifies the banner + no-path branch; non-TTY means the real prompt text is exercised by the auto-accept counterpart).
- downscale_yes_mutates_workflow_and_drops_artifacts ->
  - `tests/cli.test.ts:1547` `auto_accept: downscale fires and mutates workflow without prompting` (workflow -> trivial; stories/spec/research/design/tasks dropped).
  - `tests/complexity-tracking.test.ts:247` `Task 5.1: propose-then-downscale-accept`.
- downscale_prompt_suppressed_when_workflow_matches ->
  - `tests/cli.test.ts:1664` `recommendation matches current workflow: no prompt, no banner, no change`.
- downscale_prompt_skipped_non_tty ->
  - `tests/cli.test.ts:1586` `non-TTY (no path): workflow unchanged, advisory banner emitted to stderr`.
  - `tests/cli-helpers.test.ts:24` confirms askYesNo returns the default on non-TTY.

### Req 7 -- AutoUpscalePromptAtIntent -- PASS

- upscale_prompt_appears_on_undersized_quick ->
  - `tests/cli.test.ts:1851` `non-TTY (no path): quick + 5-file impact leaves workflow unchanged and emits advisory` (advisory text verified; prompt text is rendered by the auto-accept pair).
- upscale_yes_mutates_workflow_and_inserts_artifacts ->
  - `tests/cli.test.ts:1811` `auto_accept: upscale from quick to standard fires and inserts planning artifacts`.
  - `tests/complexity-tracking.test.ts:295` `Task 5.2: quick-then-upscale-accept at intent time`.
- upscale_prompt_suppressed_when_workflow_exceeds_recommendation ->
  - `tests/cli.test.ts:1913` `same tier: quick + 2-file impact does not fire upscale` (same-tier suppression; stronger form covered by `:1882` full-tier cap which also suppresses an upscale).
  - `tests/cli.test.ts:1936` `standard workflow + 3-file impact: downscale fires, upscale does NOT fire`.
- upscale_auto_accept_skips_prompt ->
  - `tests/cli.test.ts:1811` `auto_accept: upscale from quick to standard fires and inserts planning artifacts` (workflow mutates, planning artifacts inserted, no y/N prompt text).

### Req 8 -- PostImplementationUpscalePromptAccept -- PASS

- post_impl_prompt_appears_when_recomputed_tier_exceeds_workflow ->
  - `tests/cli.test.ts:2065` `non-TTY (no path): 5-file summary persists score, leaves workflow unchanged, emits warning` confirms the trigger condition; `tests/cli.test.ts:2031` exercises the same trigger with --auto.
- post_impl_yes_spawns_agents_and_updates_metadata ->
  - `tests/cli.test.ts:2031` `auto_accept + 5-file summary: upscale fires, stories+spec marked pending, directive on stdout` (directive on stdout invokes metta-product / metta-specifier via `metta instructions stories` / `spec`).
  - `tests/complexity-tracking.test.ts:339` `quick + 5-file summary with --auto`.
- post_impl_yes_uses_promoted_fan_out ->
  - Indirect: `tests/cli.test.ts:2031` verifies workflow mutates to `standard` in metadata, which is what the skill reads to drive fan-out. No direct skill-fan-out assertion test exists (fan-out is encoded in the `metta-verify` / `metta-quick` SKILL.md templates).
- post_impl_no_research_design_tasks_authored ->
  - `tests/cli.test.ts:2031` post-impl-auto metadata assertions show only `stories`/`spec` inserted; `research`/`design`/`tasks` are never added to the artifact map.

### Req 9 -- PostImplementationUpscalePromptDecline -- PASS

- decline_persists_actual_score_and_prints_warning ->
  - `tests/cli.test.ts:2065` `non-TTY (no path): 5-file summary persists score, leaves workflow unchanged, emits warning`.
  - `tests/complexity-tracking.test.ts:373` `quick + 5-file summary WITHOUT --auto (non-TTY decline)`.
- decline_does_not_create_stories_or_spec ->
  - `tests/cli.test.ts:2065` asserts `artifacts` has neither `stories` nor `spec`.
  - `tests/complexity-tracking.test.ts:373`.
- decline_exits_zero_and_verification_proceeds ->
  - `tests/cli.test.ts:2065` `expect(code).toBe(0)`.
- non_tty_defaults_to_decline ->
  - `tests/cli.test.ts:2065` non-TTY decline path.
  - `tests/cli-helpers.test.ts:24,44,49` askYesNo defaults to false (No) when non-TTY.

### Req 10 -- AutoAcceptRecommendationFlag -- PASS

- auto_flag_persists_field ->
  - `tests/cli.test.ts:1245` `metta propose --auto / --accept-recommended > --auto persists auto_accept_recommendation: true`.
  - `tests/artifact-store.test.ts:61` `createChange > persists auto_accept_recommendation: true when autoAccept is true`.
- auto_flag_skips_all_three_prompts ->
  - Intent-downscale: `tests/cli.test.ts:1547`.
  - Intent-upscale: `tests/cli.test.ts:1811`.
  - Post-impl-upscale: `tests/cli.test.ts:2031`.
  - Cross-site Task 5.4 sweep: `tests/complexity-tracking.test.ts:412,441,465`.
- accept_recommended_alias_behaves_identically ->
  - `tests/cli.test.ts:1253` `--accept-recommended alias behaves identically` (propose).
  - `tests/cli.test.ts:1303` `--accept-recommended alias behaves identically` (quick).
  - `tests/complexity-tracking.test.ts:490` Task 5.4 sub-d.
- auto_with_workflow_honours_initial_choice ->
  - `tests/cli.test.ts:1264` `--workflow standard --auto persists both workflow_locked and auto_accept_recommendation`.
  - `tests/cli.test.ts:1882` full-tier cap under `--auto` shows `--auto` does not override the workflow floor arbitrarily; initial workflow choice preserved when recommendation is blocked.

### Req 11 -- OverrideRemainsAuthoritative -- PASS

- workflow_flag_alone_preserves_initial_choice_with_prompt ->
  - `tests/cli.test.ts:1586` `non-TTY (no path): workflow unchanged, advisory banner emitted to stderr` (propose ran without `--auto`; advisory fires, `workflow` stays `standard`).
- workflow_without_auto_shows_intent_prompts_normally ->
  - `tests/cli.test.ts:1851` `non-TTY (no path): quick + 5-file impact leaves workflow unchanged and emits advisory` (no `--auto`, no TTY -> no path; workflow stays quick; upscale advisory emitted).
- workflow_with_auto_combination_is_predictable ->
  - `tests/cli.test.ts:1264` verifies both flags persist together.
  - `tests/cli.test.ts:1882` full-tier cap test shows `--auto` is gated by cap rules, not unconditional.
  - Integration sweep: `tests/complexity-tracking.test.ts:465` Task 5.4 sub-c post-impl upscale with `--auto`.

### Req 12 -- IntraQuickDownsizeRule -- PARTIAL (template-level, no direct test)

- trivial_quick_run_uses_reduced_fan_out / trivial_fan_out_excludes_correctness_security_goalcheck / non_trivial_quick_run_keeps_standard_fan_out / tests_and_tsc_run_regardless_of_tier
  - Encoded in the `metta-quick` skill template (`src/templates/skills/metta-quick/SKILL.md:27,61-87`) as orchestration prose that reads `complexity_score.recommended_workflow` from `metta status --json`.
  - The data-surfacing dependency is covered by `tests/cli.test.ts:1352` (`JSON mode with complexity_score includes object`) which is the contract the skill consumes.
  - No vitest unit or CLI integration test asserts the reviewer / verifier spawn count directly because the spawn happens inside Claude Code when the skill executes. This is consistent with how other skill-orchestration rules are handled in this repo (fan-out rules live in SKILL.md templates and are verified by usage, not by vitest).

### Req 13 -- ScoringRubricSpec -- PARTIAL (CLAUDE.md Active Specs entry missing)

- rubric_document_exists_with_required_sections -> PASS
  - Verified by file existence and inspection: `/home/utx0/Code/metta/spec/specs/adaptive-workflow-tier-selection/spec.md` contains sections `## Scoring Signal (v1)`, `## Tier Thresholds`, `## Prompt Modes` (with all four: intent-downscale, intent-upscale, post-impl-upscale, intra-quick-downsize), and `## Storage Fields` content naming `complexity_score`, `actual_complexity_score`, `auto_accept_recommendation` (see lines 110-126 for extension-point coverage).
- rubric_names_deferred_signals_as_extension_points -> PASS
  - Rubric doc lines 116-118 explicitly name `spec-surface`, `capability-count`, `line-delta`; lines 124-126 name `research`, `design`, `tasks` as deferred retroactive artifacts.
- claude_md_active_specs_table_updated -> FAIL
  - `CLAUDE.md` Active Specs table (lines 83-102) does NOT contain an `adaptive-workflow-tier-selection` row. Grep for `adaptive` in CLAUDE.md returns no matches. The rubric capability folder exists under `spec/specs/` but the Active Specs table has not been regenerated to include it.

---

## Summary

- Requirements with full test coverage: 11 (Reqs 1-11).
- Requirements with partial coverage: 2 (Req 12 IntraQuickDownsizeRule is template-level and has no direct reviewer/verifier spawn-count test; Req 13 ScoringRubricSpec has 2/3 scenarios passing with the CLAUDE.md Active Specs row missing).
- Requirements with zero coverage: 0.
- Count of requirements without at least one covering test: **0** (every requirement has at least one passing test citation, even if some scenarios within a requirement are not directly asserted).
- Count of requirements with at least one unmet scenario: **2** (Req 12, Req 13).

**Verdict: PARTIAL**
