# adaptive-workflow-tier-selection

## MODIFIED: Requirement: ComplexityScoreComputation

The system MUST compute a complexity score as the final step of intent authoring, immediately after `intent.md` is written by `metta complete intent`. The scorer MUST parse the `## Impact` section of `intent.md` and count distinct file or module references. When the count is 1 or more, the scorer MUST map the count to a tier using the canonical threshold table and persist the computed score to the change's `.metta.yaml` metadata block before `metta complete intent` returns. When the `## Impact` section parses to 0 file references, the scorer MUST treat the result as no-signal rather than as evidence of triviality: it MUST NOT produce a workflow recommendation, MUST NOT persist a `complexity_score` object, and consequently no downscale or upscale prompt and no advisory banner MAY fire from intent-time scoring for that change. The zero-file no-signal rule applies only to intent-time scoring; the post-implementation recompute from the `## Files` section of `summary.md` MUST continue to treat a file count of 0 as a real signal that maps through the canonical thresholds (to `trivial`), because at summary time the change's files exist and an empty list is evidence, not absence of evidence. The scorer MUST NOT run at CLI invocation time and MUST NOT recompute when `intent.md` is subsequently edited. When `intent.md` has not been written, the scorer MUST produce no output and `complexity_score` MUST be absent from change metadata.
Fulfills: US-1

### Scenario: score_computed_from_impact_section
- GIVEN a change is running under `metta propose --workflow standard` and intent has just been written with an `## Impact` section referencing three distinct files
- WHEN `metta complete intent` reaches the scoring step
- THEN `.metta.yaml` contains a `complexity_score` object with `score: 1`, `signals.file_count: 3`, and `recommended_workflow: quick`

### Scenario: zero_file_intent_is_no_signal
- GIVEN a greenfield change on the `standard` workflow whose `intent.md` `## Impact` section parses to 0 file references
- WHEN `metta complete intent` reaches the scoring step
- THEN no `complexity_score` object is persisted to `.metta.yaml`, no `trivial` recommendation exists anywhere in change metadata, and no downscale prompt fires

### Scenario: single_file_intent_still_scores
- GIVEN an intent whose `## Impact` section parses to exactly 1 file reference
- WHEN `metta complete intent` reaches the scoring step
- THEN a `complexity_score` object is persisted with `signals.file_count: 1` and `recommended_workflow: trivial`, exactly as the canonical threshold table dictates

### Scenario: zero_files_at_summary_time_remains_real_signal
- GIVEN a change whose `summary.md` `## Files` section lists 0 distinct files
- WHEN `metta complete implementation` runs the post-implementation recompute step
- THEN `actual_complexity_score` is written with `signals.file_count: 0` and `recommended_workflow: trivial`, so genuinely trivial changes are still caught at the summary-time scoring point

### Scenario: score_absent_before_intent_written
- GIVEN a newly scaffolded change with no `intent.md`
- WHEN any command reads change metadata from `.metta.yaml`
- THEN `complexity_score` is absent from the metadata and no scoring error is raised

### Scenario: score_not_recomputed_on_intent_edit
- GIVEN a change whose `intent.md` was already scored and `complexity_score` is persisted with `signals.file_count: 2`
- WHEN `intent.md` is edited by the user to add three more file references
- THEN `complexity_score` remains unchanged at `signals.file_count: 2` and no rescore fires

### Scenario: score_uses_actual_files_from_summary_for_post_impl_recompute
- GIVEN a `/metta-quick` change that was originally scored at `signals.file_count: 2` and `metta complete implementation` has just written `summary.md` with a `## Files` section listing five distinct files
- WHEN the post-implementation recompute step runs
- THEN `actual_complexity_score` is written with `signals.file_count: 5` and `recommended_workflow: standard`, and the original `complexity_score` field is unchanged


## MODIFIED: Requirement: AutoDownscalePromptAtIntent

When `metta complete intent` runs under `metta propose` or `metta fix-issues` and `recommended_workflow` is a lower tier than the chosen workflow, an interactive prompt MUST be printed to stdout in interactive TTY sessions with the text `Scored as <tier> (N files) -- collapse workflow to /metta-<tier>?` followed by `[Y/n]` or `[y/N]` depending on the effective default. In an interactive TTY session, the prompt's default answer MUST be Yes when the change's persisted metadata has `workflow_locked !== true` (including when `workflow_locked` is absent), and MUST remain No when `workflow_locked === true`. In a non-interactive environment — stdin is not a TTY (`process.stdin.isTTY` falsy), `--json` mode is active, or auto mode is off — the downscale decision MUST fail closed: no interactive prompt is printed, the decision MUST resolve to No regardless of `workflow_locked`, the chosen `workflow` and the artifact list MUST remain unchanged, and an advisory line reporting the declined recommendation MUST be printed. A non-interactive run MUST NOT resolve the downscale decision via a default-Yes under any combination of `workflow_locked` and environment flags. The sole sanctioned non-interactive auto-accept path is `auto_accept_recommendation: true` in `.metta.yaml`: when set, the prompt MUST be skipped and Yes MUST be auto-selected regardless of `workflow_locked` or TTY state. On Yes (by any path), `metta complete intent` MUST update the `workflow` field in `.metta.yaml` to the recommended tier, remove from the artifact list any planning artifacts (stories, spec, research, design, tasks) that have not yet been authored (status not `complete`), and persist the downscale decision record required by `DownscaleDecisionRecording`. On No, the original workflow and artifact list MUST remain unchanged and escalation recording proceeds per `EscalationRecording`. The prompt MUST NOT appear when the chosen workflow already matches or is lower than the recommended tier, or for `/metta-quick` runs, since quick is already the smallest named interactive workflow.
Fulfills: US-2

### Scenario: non_tty_downscale_fails_closed
- GIVEN a change on the `standard` workflow whose intent scores `quick`, whose metadata has `workflow_locked !== true` and no `auto_accept_recommendation`
- WHEN `metta complete intent` reaches the downscale decision with stdin not a TTY
- THEN no interactive prompt is printed, the decision resolves to No, `.metta.yaml` `workflow` remains `standard`, the artifact list is untouched, and an advisory line reporting the declined `quick` recommendation is printed

### Scenario: json_mode_downscale_fails_closed
- GIVEN the same scored-below-current change with `workflow_locked !== true`
- WHEN `metta complete intent --json` reaches the downscale decision
- THEN the decision resolves to No, the workflow tier and artifact list are unchanged, and the advisory is emitted without corrupting the JSON output contract

### Scenario: auto_accept_opt_in_still_collapses_non_interactively
- GIVEN a change on the `standard` workflow whose intent scores `quick` and whose metadata has `auto_accept_recommendation: true`
- WHEN `metta complete intent` reaches the downscale decision in a non-TTY environment
- THEN no prompt is printed, Yes is auto-selected, `.metta.yaml` `workflow` collapses to `quick`, unauthored planning artifacts are removed from the artifact list, and a downscale decision record is persisted

### Scenario: interactive_unlocked_shows_yes_default
- GIVEN the same scored-below-current change with `workflow_locked !== true`, running interactively in a TTY
- WHEN the downscale prompt is displayed
- THEN it shows `[Y/n]` as the default rather than `[y/N]`, preserving the interactive experience

### Scenario: locked_change_defaults_to_no
- GIVEN a change whose metadata has `workflow_locked === true` and whose intent scores below the chosen tier
- WHEN `metta complete intent` reaches the downscale decision in either an interactive or a non-interactive environment
- THEN the effective default is No and `.metta.yaml` `workflow` remains at the explicitly chosen tier


## ADDED: Requirement: DownscaleDecisionSchema

`ChangeMetadataSchema` MUST declare an optional `downscale_decision` field, parallel to (not reusing) the `escalation` field, shaped as an object with `from_tier` (workflow tier enum — the tier the change was on before the collapse), `to_tier` (workflow tier enum — the recommended tier that was accepted), `justification` (non-empty string that identifies which accepting cause fired: `auto_accept_recommendation`, an interactive explicit yes, or an interactive TTY default-Yes), and `timestamp` (string). The field MUST default to absent so that `.metta.yaml` files written before this change continue to validate without migration. Every read and write path in `ArtifactStore` MUST handle both presence and absence of `downscale_decision` without throwing a Zod validation error. The `downscale_decision` field MUST NOT reuse or overwrite the `escalation` field, whose decline-path semantics are unchanged.
Fulfills: US-3

### Scenario: schema_accepts_populated_downscale_decision
- GIVEN a `.metta.yaml` file containing a `downscale_decision` object with `from_tier: standard`, `to_tier: quick`, a non-empty `justification` identifying the accepting cause, and a `timestamp`
- WHEN `ArtifactStore` reads the file and runs Zod validation
- THEN the parse succeeds and the `downscale_decision` object is available on the resulting change-metadata object

### Scenario: schema_accepts_legacy_file_without_downscale_decision
- GIVEN a `.metta.yaml` file that predates this change and omits the `downscale_decision` field entirely
- WHEN `ArtifactStore` reads and validates the file
- THEN the parse succeeds, `downscale_decision` is absent on the result, and no Zod error is thrown

### Scenario: downscale_decision_coexists_with_escalation_semantics
- GIVEN a `.metta.yaml` file carrying a `downscale_decision` object and no `escalation` object
- WHEN `ArtifactStore` reads and validates the file
- THEN the parse succeeds and the absence of `escalation` raises no error, confirming the two records are independent parallel fields


## ADDED: Requirement: DownscaleDecisionRecording

Whenever the intent-time downscale decision resolves to Yes by any accepting path — `auto_accept_recommendation: true`, an interactive explicit yes, or an interactive TTY default-Yes — `metta complete intent` MUST persist a `downscale_decision` object to the change's `.metta.yaml` as part of the same metadata update that rewrites the `workflow` field. The persisted object MUST set `from_tier` to the tier the change was on before the collapse, `to_tier` to the accepted lower tier, `justification` to a non-empty string identifying which accepting cause fired, and `timestamp` to the time the decision was recorded. The write MUST pass Zod validation against `DownscaleDecisionSchema` before persisting; a workflow collapse without a validated decision record MUST NOT occur. When the downscale decision resolves to No by any path (interactive decline, `workflow_locked` keep, or non-interactive fail-closed keep), `metta complete intent` MUST NOT write a `downscale_decision` object, and the existing decline-path `escalation` recording behavior defined by `EscalationRecording` MUST remain unchanged.
Fulfills: US-3

### Scenario: auto_accept_collapse_writes_decision_record
- GIVEN a change on the `standard` workflow with `auto_accept_recommendation: true` whose intent scores `quick`
- WHEN the downscale is auto-accepted and `workflow` is rewritten to `quick`
- THEN `.metta.yaml` contains a `downscale_decision` object with `from_tier: standard`, `to_tier: quick`, a `justification` identifying `auto_accept_recommendation` as the cause, and a `timestamp`

### Scenario: interactive_yes_collapse_writes_decision_record
- GIVEN an interactive TTY session where the downscale prompt is displayed for a `standard` change scored `quick`
- WHEN the user explicitly answers yes and the workflow collapses
- THEN a `downscale_decision` object is persisted with `from_tier: standard`, `to_tier: quick`, a `justification` identifying the interactive acceptance, and a `timestamp`, validated against the schema before the write

### Scenario: decline_path_unchanged_writes_escalation_not_decision
- GIVEN a `standard` change scored `quick` whose downscale decision resolves to No (interactive decline or non-interactive fail-closed keep)
- WHEN `metta complete intent` completes the decision
- THEN no `downscale_decision` object is written and the existing `escalation` record is persisted with `from_tier: quick` and `to_tier: standard` per `EscalationRecording`, unchanged from current behavior
