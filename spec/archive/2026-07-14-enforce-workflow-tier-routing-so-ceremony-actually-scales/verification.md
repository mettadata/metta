# Verification: enforce-workflow-tier-routing-so-ceremony-actually-scales

Verified 2026-07-14 on branch `metta/enforce-workflow-tier-routing-so-ceremony-actually-scales`.
Strategy: `cli_exit_codes` + tests. Live behavior was exercised end-to-end in a throwaway git
sandbox (metta install → propose → complete intent) against the freshly built `dist/`, in
addition to the automated test suite.

## Per-requirement verdicts

| Requirement | Scenario coverage | Verdict | Evidence |
|---|---|---|---|
| AutoDownscalePromptAtIntent (MODIFIED) | non_tty_unlocked_auto_downscales, interactive_unlocked_shows_yes_default, locked_change_defaults_to_no | PASS | Tests: `tests/cli-complete.test.ts` — "non-TTY, workflow unlocked: downscale resolves Yes silently, workflow collapses, no escalation", "interactive decline (answer n): [Y/n] prompt…" (asserts `[Y/n]` default at line 456), "workflow_locked, non-TTY: workflow kept…" (line 364), plus json-mode, auto_accept, quick-is-floor, and same-tier no-prompt cases — all pass. Live: unlocked propose (no `--workflow`) + 1-file `## Impact` → `metta complete intent` collapsed `.metta.yaml` `workflow: standard` → recommended tier non-interactively, removed unauthored planning artifacts (artifact list reduced to intent/implementation/verification), no prompt printed; locked propose (`--workflow standard`, `workflow_locked: true` persisted) kept `workflow: standard`. |
| EscalationSchema (ADDED) | schema_accepts_populated_escalation, schema_accepts_legacy_file_without_escalation | PASS | Tests: `tests/schemas.test.ts:318` "accepts metadata with a populated escalation block and round-trips it", `:343` "accepts legacy metadata omitting escalation (field undefined)", `:359` "rejects escalation with an empty justification" — all pass. Live: pre-change sandbox `.metta.yaml` files without `escalation` read/wrote cleanly through propose/complete/status. |
| EscalationRecording (ADDED) | escalation_recorded_on_locked_keep, escalation_recorded_on_interactive_decline, no_escalation_on_downscale_accept | PASS | Live locked run persisted `escalation: {from_tier: trivial, to_tier: standard, justification: "kept standard: workflow_locked", timestamp: 2026-07-14T04:10:39.042Z}`; live unlocked downscale wrote no `escalation` key. Tests: `tests/cli-complete.test.ts` — locked-keep escalation with `workflow_locked` justification (asserted at line 399), "interactive decline… declined-downscale escalation", "interactive empty answer: Yes default collapses workflow, no escalation" — all pass. |
| StatusEscalationSurface (ADDED) | human_output_shows_escalation, json_output_includes_escalation, status_renders_without_escalation | PASS | Live: `metta status --change test-locked-keep` printed `Escalation: trivial -> standard (kept standard: workflow_locked)`; `--json` payload carried the `escalation` object verbatim (all four fields, exact timestamp); change without escalation rendered with 0 escalation mentions in human mode and no `escalation` key in JSON, exit 0. Tests: `tests/cli-status.test.ts:390` "metta status escalation surface" (3 cases) — all pass. |
| SkillRoutingPreStep (ADDED, prose) | small_description_routes_to_quick, explicit_workflow_flag_deferred | PASS | `src/templates/skills/metta-propose/SKILL.md:14` "## Routing pre-step (run before Step 1)" lists the four small/bounded criteria, directs to `metta quick` when matched with no explicit `--workflow` flag, and defers to any explicit `--workflow` value. `diff` confirms `src/templates/skills/metta-propose/SKILL.md` and `.claude/skills/metta-propose/SKILL.md` are byte-identical; `tests/skill-discovery-loop.test.ts:70` byte-identity suite also passes. |
| EscalationJustificationGuidance (ADDED, prose) | claude_md_states_default_routing, skill_documents_justification_requirement | PASS | `CLAUDE.md:44` states quick mode is the default routing decision for small, bounded changes and that keeping `--workflow standard`/`full` above the scored recommendation requires a recorded justification (the escalation record). The statement is generated from `src/delivery/workflow-primer.ts:43`, so `/metta-refresh` regenerations preserve it. `src/templates/skills/metta-propose/SKILL.md:29` "**Escalation justification:**" documents the same requirement for orchestrators, referencing the `EscalationRecording` contract. |
| ProgressCeremonyRatioMetric (ADDED) | human_output_reports_ceremony_ratio, json_output_includes_ceremony_ratio | PASS | Live in the real repo: `metta progress` prints `Ceremony commits: 70% (1116/1599 chore/docs)`; `metta progress --json` includes `ceremony_commit_ratio: {"ceremony":1116,"total":1599,"ratio":0.6979…}` — consistent and sane against repo history. Tests: `tests/ceremony-metrics.test.ts:66` `getCeremonyCommitRatio` (mixed classification, merge-commit handling, non-repo/no-commit null) and `tests/progress-ceremony-metrics.test.ts` CLI cases — all pass. No new CLI command introduced. |
| ProgressArtifactsPerSmallChangeMetric (ADDED) | reports_mean_artifact_count, no_data_renders_without_misleading_zero | PASS | Live in the real repo: human output `Artifacts per small change: 3.0 (avg over 42 quick/trivial changes)`; JSON `artifacts_per_small_change: {"mean":3,"sample_size":42}`. Live no-data case (sandbox with empty archive): human output renders `Artifacts per small change: no data`, JSON renders `null` — explicit no-data indicator, not a zero. Tests: `tests/ceremony-metrics.test.ts:110` `getArtifactsPerSmallChange` incl. `:133` "returns null (not 0) when no archived change is quick/trivial" — all pass. |

## Live end-to-end transcript (summary)

Sandbox: fresh git repo + `metta install` under the session scratchpad (deleted after verification).

1. `propose` without `--workflow` (standard default, no `workflow_locked` key) + intent with 1-file
   `## Impact` (`` `src/errors.ts` ``) → `complete intent` non-interactively: `.metta.yaml`
   `workflow` collapsed to the recommended tier, planning artifacts (stories/spec/research/design/tasks)
   removed from the artifact list, **no** `escalation` object, exit 0.
2. `propose --workflow standard` (persists `workflow_locked: true`) + same 1-file intent →
   `complete intent`: workflow **kept** at `standard`, advisory printed
   (`Advisory: current standard, scored trivial -- downscale recommended`), `escalation` object
   persisted with `justification: "kept standard: workflow_locked"` and timestamp.
3. `status --change test-locked-keep` (human) showed the Escalation line; `--json` carried the
   object verbatim; the unlocked change showed no escalation section in either mode.
4. `progress` / `progress --json` verified in both the sandbox (no-data path) and the real repo
   (populated path).

Note: the scorer counts only inline-code (backtick) file tokens in `## Impact`
(`src/complexity/file-count-parser.ts`); a 1-file impact scores `trivial`, so the live downscale
landed on `trivial` rather than `quick`. The `quick`-tier scenarios from the spec are covered
exactly by the cli-complete tests (e.g. "three-file impact under standard: downscale to quick
fires by default"). Not a defect — tier thresholds are owned by `src/complexity/scorer.ts`.

## Gate results

| Gate | Command | Result |
|---|---|---|
| Tests (full suite) | `npx vitest run` | PASS — 80 files, 1038 tests, 0 failures |
| Targeted change tests | `npx vitest run tests/schemas.test.ts tests/cli-complete.test.ts tests/cli-status.test.ts tests/ceremony-metrics.test.ts tests/progress-ceremony-metrics.test.ts tests/grounding.test.ts tests/skill-discovery-loop.test.ts tests/refresh.test.ts` | PASS — 8 files, 257 tests |
| Typecheck | `npx tsc --noEmit` | PASS |
| Build | `npm run build` (tsc + copy-templates) | PASS |
| Lint | `npm run lint` (script is `tsc --noEmit`) | PASS (same check as typecheck gate) |

## Gaps / concerns

- No automated test asserts the routing pre-step or escalation-justification prose content of
  `metta-propose/SKILL.md` (only byte-identity between template and deployed copy is tested).
  Prose was verified by direct inspection; acceptable for prose requirements, but a
  content-assertion test would guard against future regressions.
- Minor observability note (not a spec violation): the live tier for a 1-file impact is
  `trivial`, so downscale offers from `standard` skip past `quick`. Spec scenarios name `quick`
  illustratively; the contract ("collapse to the recommended tier") is what the implementation
  and tests enforce.

## Overall verdict

**PASS** — all 8 requirements verified with passing tests and/or live CLI behavior; all gates green.
