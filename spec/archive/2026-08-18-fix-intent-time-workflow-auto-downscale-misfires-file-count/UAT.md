# UAT: fix-intent-time-workflow-auto-downscale-misfires-file-count

- **Change**: fix-intent-time-workflow-auto-downscale-misfires-file-count
- **Generated**: 2026-08-18
- **Source**: user stories (stories.md)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

### US-1: Greenfield intents no longer misread as trivial

*Independent test:* Completing an intent whose `## Impact` section parses to 0 files produces no workflow recommendation and fires no downscale prompt, while summary-time scoring of 0 files still recommends `trivial`.

#### Step 1.1
- **Setup**: an intent whose `## Impact` section parses to 0 files
- **Do**: intent-time complexity scoring runs
- **Observe**: no workflow recommendation is produced (no `trivial` recommendation is persisted) and no downscale prompt fires
- [ ] Pass

#### Step 1.2
- **Setup**: an intent whose `## Impact` section parses to 1 or more files
- **Do**: intent-time complexity scoring runs
- **Observe**: the file count is scored and a tier recommendation is produced exactly as before
- [ ] Pass

#### Step 1.3
- **Setup**: a change with 0 changed files at summary time
- **Do**: summary-time complexity scoring runs
- **Observe**: 0 is treated as a real signal and the `trivial` recommendation still fires, so genuinely trivial changes are caught at that later scoring point
- [ ] Pass

### US-2: Non-interactive intent completion never silently collapses my workflow

*Independent test:* A non-interactive `metta complete intent` run that triggers a downscale recommendation exits with the workflow tier unchanged and an advisory banner printed, unless `auto_accept_recommendation: true` is set.

#### Step 2.1
- **Setup**: a change at `standard` or `full` whose intent scoring recommends a lower tier
- **Do**: `metta complete intent` runs with stdin not a TTY or with `--json` and `auto_accept_recommendation` is not set (Run: `metta complete intent`)
- **Observe**: the chosen workflow is kept, planning artifacts are untouched, and the advisory banner reports the declined recommendation
- [ ] Pass

#### Step 2.2
- **Setup**: the same downscale recommendation
- **Do**: the change has `auto_accept_recommendation: true`
- **Observe**: the downscale is auto-accepted as the sanctioned opt-in path
- [ ] Pass

#### Step 2.3
- **Setup**: the same downscale recommendation
- **Do**: the run is an interactive TTY session
- **Observe**: the user is prompted and default-Yes behavior applies subject to `workflow_locked`, preserving today's interactive experience
- [ ] Pass

### US-3: Every accepted downscale leaves an audit record

*Independent test:* After any accepted downscale, the change's `.metta.yaml` contains a Zod-validated decision record with `from_tier`, `to_tier`, a cause-keyed justification, and a timestamp.

#### Step 3.1
- **Setup**: a downscale recommendation is accepted by any path (`auto_accept_recommendation`, interactive explicit yes, or TTY default-Yes)
- **Do**: the workflow is rewritten to the lower tier
- **Observe**: a decision record with `from_tier`, `to_tier`, a justification keyed to the accepting cause, and a timestamp is written to the change's `.metta.yaml`
- [ ] Pass

#### Step 3.2
- **Setup**: the decision record write
- **Do**: the metadata is persisted
- **Observe**: it validates against the existing `EscalationSchema` or a parallel downscale-record schema, and any new schema field is optional so existing `.metta.yaml` files continue to validate
- [ ] Pass

#### Step 3.3
- **Setup**: a downscale recommendation is declined
- **Do**: the decline path runs
- **Observe**: the existing escalation record behavior is unchanged
- [ ] Pass

## Additional scenarios

#### Step 4.1: score_computed_from_impact_section
- **Setup**: a change is running under `metta propose --workflow standard` and intent has just been written with an `## Impact` section referencing three distinct files
- **Do**: `metta complete intent` reaches the scoring step (Run: `metta propose --workflow standard`, `metta complete intent`)
- **Observe**: `.metta.yaml` contains a `complexity_score` object with `score: 1`, `signals.file_count: 3`, and `recommended_workflow: quick`
- **Machine-verified** — summary.md references "ComplexityScoreComputation"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.2: zero_file_intent_is_no_signal
- **Setup**: a greenfield change on the `standard` workflow whose `intent.md` `## Impact` section parses to 0 file references
- **Do**: `metta complete intent` reaches the scoring step (Run: `metta complete intent`)
- **Observe**: no `complexity_score` object is persisted to `.metta.yaml`, no `trivial` recommendation exists anywhere in change metadata, and no downscale prompt fires
- **Machine-verified** — summary.md references "ComplexityScoreComputation"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.3: single_file_intent_still_scores
- **Setup**: an intent whose `## Impact` section parses to exactly 1 file reference
- **Do**: `metta complete intent` reaches the scoring step (Run: `metta complete intent`)
- **Observe**: a `complexity_score` object is persisted with `signals.file_count: 1` and `recommended_workflow: trivial`, exactly as the canonical threshold table dictates
- **Machine-verified** — summary.md references "ComplexityScoreComputation"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.4: zero_files_at_summary_time_remains_real_signal
- **Setup**: a change whose `summary.md` `## Files` section lists 0 distinct files
- **Do**: `metta complete implementation` runs the post-implementation recompute step (Run: `metta complete implementation`)
- **Observe**: `actual_complexity_score` is written with `signals.file_count: 0` and `recommended_workflow: trivial`, so genuinely trivial changes are still caught at the summary-time scoring point
- **Machine-verified** — summary.md references "ComplexityScoreComputation"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.5: score_absent_before_intent_written
- **Setup**: a newly scaffolded change with no `intent.md`
- **Do**: any command reads change metadata from `.metta.yaml`
- **Observe**: `complexity_score` is absent from the metadata and no scoring error is raised
- **Machine-verified** — summary.md references "ComplexityScoreComputation"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.6: score_not_recomputed_on_intent_edit
- **Setup**: a change whose `intent.md` was already scored and `complexity_score` is persisted with `signals.file_count: 2`
- **Do**: `intent.md` is edited by the user to add three more file references
- **Observe**: `complexity_score` remains unchanged at `signals.file_count: 2` and no rescore fires
- **Machine-verified** — summary.md references "ComplexityScoreComputation"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.7: score_uses_actual_files_from_summary_for_post_impl_recompute
- **Setup**: a `/metta-quick` change that was originally scored at `signals.file_count: 2` and `metta complete implementation` has just written `summary.md` with a `## Files` section listing five distinct files
- **Do**: the post-implementation recompute step runs (Run: `metta complete implementation`)
- **Observe**: `actual_complexity_score` is written with `signals.file_count: 5` and `recommended_workflow: standard`, and the original `complexity_score` field is unchanged
- **Machine-verified** — summary.md references "ComplexityScoreComputation"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.8: non_tty_downscale_fails_closed
- **Setup**: a change on the `standard` workflow whose intent scores `quick`, whose metadata has `workflow_locked !== true` and no `auto_accept_recommendation`
- **Do**: `metta complete intent` reaches the downscale decision with stdin not a TTY (Run: `workflow_locked !== true`, `metta complete intent`)
- **Observe**: no interactive prompt is printed, the decision resolves to No, `.metta.yaml` `workflow` remains `standard`, the artifact list is untouched, and an advisory line reporting the declined `quick` recommendation is printed
- **Machine-verified** — summary.md references "AutoDownscalePromptAtIntent"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.9: json_mode_downscale_fails_closed
- **Setup**: the same scored-below-current change with `workflow_locked !== true`
- **Do**: `metta complete intent --json` reaches the downscale decision (Run: `workflow_locked !== true`, `metta complete intent --json`)
- **Observe**: the decision resolves to No, the workflow tier and artifact list are unchanged, and the advisory is emitted without corrupting the JSON output contract
- **Machine-verified** — summary.md references "AutoDownscalePromptAtIntent"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.10: auto_accept_opt_in_still_collapses_non_interactively
- **Setup**: a change on the `standard` workflow whose intent scores `quick` and whose metadata has `auto_accept_recommendation: true`
- **Do**: `metta complete intent` reaches the downscale decision in a non-TTY environment (Run: `metta complete intent`)
- **Observe**: no prompt is printed, Yes is auto-selected, `.metta.yaml` `workflow` collapses to `quick`, unauthored planning artifacts are removed from the artifact list, and a downscale decision record is persisted
- **Machine-verified** — summary.md references "AutoDownscalePromptAtIntent"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.11: interactive_unlocked_shows_yes_default
- **Setup**: the same scored-below-current change with `workflow_locked !== true`, running interactively in a TTY
- **Do**: the downscale prompt is displayed (Run: `workflow_locked !== true`)
- **Observe**: it shows `[Y/n]` as the default rather than `[y/N]`, preserving the interactive experience
- **Machine-verified** — summary.md references "AutoDownscalePromptAtIntent"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.12: locked_change_defaults_to_no
- **Setup**: a change whose metadata has `workflow_locked === true` and whose intent scores below the chosen tier
- **Do**: `metta complete intent` reaches the downscale decision in either an interactive or a non-interactive environment (Run: `workflow_locked === true`, `metta complete intent`)
- **Observe**: the effective default is No and `.metta.yaml` `workflow` remains at the explicitly chosen tier
- **Machine-verified** — summary.md references "AutoDownscalePromptAtIntent"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.13: schema_accepts_populated_downscale_decision
- **Setup**: a `.metta.yaml` file containing a `downscale_decision` object with `from_tier: standard`, `to_tier: quick`, a non-empty `justification` identifying the accepting cause, and a `timestamp`
- **Do**: `ArtifactStore` reads the file and runs Zod validation
- **Observe**: the parse succeeds and the `downscale_decision` object is available on the resulting change-metadata object
- **Machine-verified** — summary.md references "DownscaleDecisionSchema"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.14: schema_accepts_legacy_file_without_downscale_decision
- **Setup**: a `.metta.yaml` file that predates this change and omits the `downscale_decision` field entirely
- **Do**: `ArtifactStore` reads and validates the file
- **Observe**: the parse succeeds, `downscale_decision` is absent on the result, and no Zod error is thrown
- **Machine-verified** — summary.md references "DownscaleDecisionSchema"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.15: downscale_decision_coexists_with_escalation_semantics
- **Setup**: a `.metta.yaml` file carrying a `downscale_decision` object and no `escalation` object
- **Do**: `ArtifactStore` reads and validates the file
- **Observe**: the parse succeeds and the absence of `escalation` raises no error, confirming the two records are independent parallel fields
- **Machine-verified** — summary.md references "DownscaleDecisionSchema"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.16: auto_accept_collapse_writes_decision_record
- **Setup**: a change on the `standard` workflow with `auto_accept_recommendation: true` whose intent scores `quick`
- **Do**: the downscale is auto-accepted and `workflow` is rewritten to `quick`
- **Observe**: `.metta.yaml` contains a `downscale_decision` object with `from_tier: standard`, `to_tier: quick`, a `justification` identifying `auto_accept_recommendation` as the cause, and a `timestamp`
- **Machine-verified** — summary.md references "DownscaleDecisionRecording"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.17: interactive_yes_collapse_writes_decision_record
- **Setup**: an interactive TTY session where the downscale prompt is displayed for a `standard` change scored `quick`
- **Do**: the user explicitly answers yes and the workflow collapses
- **Observe**: a `downscale_decision` object is persisted with `from_tier: standard`, `to_tier: quick`, a `justification` identifying the interactive acceptance, and a `timestamp`, validated against the schema before the write
- **Machine-verified** — summary.md references "DownscaleDecisionRecording"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.18: decline_path_unchanged_writes_escalation_not_decision
- **Setup**: a `standard` change scored `quick` whose downscale decision resolves to No (interactive decline or non-interactive fail-closed keep)
- **Do**: `metta complete intent` completes the decision (Run: `metta complete intent`)
- **Observe**: no `downscale_decision` object is written and the existing `escalation` record is persisted with `from_tier: quick` and `to_tier: standard` per `EscalationRecording`, unchanged from current behavior
- **Machine-verified** — summary.md references "DownscaleDecisionRecording"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass
