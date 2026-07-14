# adaptive-workflow-tier-selection

## MODIFIED: Requirement: AutoDownscalePromptAtIntent

When `metta complete intent` runs under `metta propose` or `metta fix-issues` and `recommended_workflow` is a lower tier than the chosen workflow, an interactive prompt MUST be printed to stdout with the text `Scored as <tier> (N files) -- collapse workflow to /metta-<tier>?` followed by `[Y/n]` or `[y/N]` depending on the effective default. The prompt's default answer MUST be Yes when the change's persisted metadata has `workflow_locked !== true` (including when `workflow_locked` is absent), and MUST remain No when `workflow_locked === true`. In a non-TTY environment (no `process.stdin.isTTY`), in `--json` mode, or when auto mode is off, the prompt MUST resolve to its effective default without printing an interactive prompt: Yes when `workflow_locked !== true`, No when `workflow_locked === true`. On Yes, `metta complete intent` MUST update the `workflow` field in `.metta.yaml` to the recommended tier AND remove from the artifact list any planning artifacts (stories, spec, research, design, tasks) that have not yet been authored (status not `complete`). On No, the original workflow and artifact list MUST remain unchanged. The prompt MUST NOT appear when the chosen workflow already matches or is lower than the recommended tier, or for `/metta-quick` runs, since quick is already the smallest named interactive workflow. When `auto_accept_recommendation: true` is set in `.metta.yaml`, the prompt MUST be skipped and Yes MUST be auto-selected regardless of `workflow_locked`.
Fulfills: US-1

### Scenario: non_tty_unlocked_auto_downscales
- GIVEN a change on the `standard` workflow whose intent scores `quick` and whose metadata has `workflow_locked !== true`
- WHEN `metta complete intent` reaches the downscale decision in a non-TTY environment (no TTY, `--json`, or auto mode off)
- THEN no interactive prompt is printed, the effective default resolves to Yes, and `.metta.yaml` `workflow` collapses to `quick`

### Scenario: interactive_unlocked_shows_yes_default
- GIVEN the same scored-below-current change with `workflow_locked !== true`, running interactively
- WHEN the downscale prompt is displayed
- THEN it shows `[Y/n]` as the default rather than `[y/N]`

### Scenario: locked_change_defaults_to_no
- GIVEN a change whose metadata has `workflow_locked === true` and whose intent scores below the chosen tier
- WHEN `metta complete intent` reaches the downscale decision non-interactively
- THEN the effective default resolves to No and `.metta.yaml` `workflow` remains at the explicitly chosen tier

## ADDED: Requirement: EscalationSchema

`ChangeMetadataSchema` MUST declare an optional `escalation` field shaped as an object with `from_tier` (workflow tier enum), `to_tier` (workflow tier enum), `justification` (non-empty string), and `timestamp` (string). The field MUST default to absent so that `.metta.yaml` files written before this capability was introduced continue to validate without migration. Every read and write path in `ArtifactStore` MUST handle both presence and absence of `escalation` without throwing a Zod validation error.

### Scenario: schema_accepts_populated_escalation
- GIVEN a `.metta.yaml` file containing an `escalation` object with `from_tier: quick`, `to_tier: standard`, a non-empty `justification`, and a `timestamp`
- WHEN `ArtifactStore` reads the file and runs Zod validation
- THEN the parse succeeds and the `escalation` object is available on the resulting change-metadata object

### Scenario: schema_accepts_legacy_file_without_escalation
- GIVEN a `.metta.yaml` file that predates this capability and omits the `escalation` field entirely
- WHEN `ArtifactStore` reads and validates the file
- THEN the parse succeeds, `escalation` is absent on the result, and no Zod error is thrown

## ADDED: Requirement: EscalationRecording

`metta complete intent` MUST persist an `escalation` object to the change's `.metta.yaml` whenever the intent-time downscale decision results in the change remaining on a workflow tier strictly above `complexity_score.recommended_workflow` — whether because `workflow_locked === true` suppressed the prompt's Yes default or because an interactive or auto-mode answer declined the offered downscale. The persisted object MUST set `from_tier` to the scored recommendation, `to_tier` to the tier the change remains on, `justification` to a non-empty string describing why the tier was kept or chosen, and `timestamp` to the time the decision was recorded. `metta complete intent` MUST NOT write an `escalation` object when the change downscales to the recommended tier.

### Scenario: escalation_recorded_on_locked_keep
- GIVEN a change with `workflow_locked === true`, chosen workflow `standard`, and an intent scored at `quick`
- WHEN `metta complete intent` completes the downscale decision
- THEN `.metta.yaml` contains an `escalation` object with `from_tier: quick`, `to_tier: standard`, a non-empty `justification`, and a `timestamp`

### Scenario: escalation_recorded_on_interactive_decline
- GIVEN a change with `workflow_locked !== true`, chosen workflow `standard`, an intent scored at `quick`, and an interactive downscale prompt defaulting to Yes
- WHEN the user answers No, keeping the workflow at `standard`
- THEN `.metta.yaml` contains an `escalation` object with `from_tier: quick` and `to_tier: standard`

### Scenario: no_escalation_on_downscale_accept
- GIVEN the same scored-below-current change
- WHEN the downscale decision resolves to Yes and the workflow collapses to the scored recommendation
- THEN `metta complete intent` finishes without writing an `escalation` object

## ADDED: Requirement: StatusEscalationSurface

`metta status` MUST surface a persisted `escalation` object when present on a change's metadata, in both human-readable and `--json` output. In human mode, the output MUST include a line showing the escalation's `from_tier`, `to_tier`, and `justification`. In `--json` mode, the payload MUST include the `escalation` object verbatim as a top-level field on the change. When no `escalation` field is present, `metta status` MUST render normally in both modes with no escalation section and MUST NOT error.

### Scenario: human_output_shows_escalation
- GIVEN a change whose metadata carries an `escalation` object with `from_tier: quick`, `to_tier: standard`, and a `justification`
- WHEN `metta status --change <name>` runs in human mode
- THEN stdout displays the escalation's from/to tiers and justification

### Scenario: json_output_includes_escalation
- GIVEN the same change
- WHEN `metta status --change <name> --json` runs
- THEN the JSON payload includes the `escalation` field with its recorded values

### Scenario: status_renders_without_escalation
- GIVEN a change with no `escalation` field in `.metta.yaml`
- WHEN `metta status` runs in either human or `--json` mode
- THEN output renders normally with no escalation section and no error

## ADDED: Requirement: SkillRoutingPreStep

The `metta-propose` skill template MUST run a routing pre-step before its existing Step 1 (parsing `--workflow`/`--auto`/`--stop-after`). The pre-step MUST classify the incoming change description against small/bounded criteria (single-file edits, typo/text fixes, small self-contained utilities, bug fixes with an obvious localized cause). When the description matches those criteria AND the caller did not pass an explicit `--workflow` flag, the pre-step MUST direct the orchestrator to `metta quick` instead of proceeding into the standard proposal pipeline. When the caller passed an explicit `--workflow` flag, the pre-step MUST defer to that choice without overriding it.

### Scenario: small_description_routes_to_quick
- GIVEN a change description matching small/bounded criteria (e.g. a typo fix in an error message string) and no explicit `--workflow` flag from the caller
- WHEN the metta-propose skill runs its routing pre-step
- THEN the orchestrator is directed to `metta quick` instead of the standard proposal pipeline

### Scenario: explicit_workflow_flag_deferred
- GIVEN a caller who passes an explicit `--workflow standard` flag alongside a small-sounding description
- WHEN the skill runs its routing pre-step
- THEN the pre-step defers to the caller's explicit choice and does not redirect to `metta quick`

## ADDED: Requirement: EscalationJustificationGuidance

`CLAUDE.md`'s Metta Workflow section MUST state that quick mode is the default routing decision for small, bounded changes and that choosing or keeping `--workflow standard` or `--workflow full` above the scored recommendation requires a recorded justification. The `metta-propose` skill template MUST document this same justification requirement for orchestrators choosing `--workflow standard`/`--workflow full` explicitly.

### Scenario: claude_md_states_default_routing
- GIVEN `CLAUDE.md` has been regenerated after this change ships
- WHEN a maintainer reads the Metta Workflow section
- THEN it states that quick mode is the default routing decision for small/bounded changes and that escalation above it requires justification

### Scenario: skill_documents_justification_requirement
- GIVEN an orchestrator following the metta-propose skill chooses `--workflow standard` or `--workflow full` explicitly
- WHEN it reads the skill's routing guidance
- THEN it is instructed that this choice requires a recorded justification consistent with the escalation contract

## ADDED: Requirement: ProgressCeremonyRatioMetric

`metta progress` MUST compute and report a ceremony-commit ratio: the proportion of commits in the project's git history whose conventional-commit type is `chore` or `docs` relative to the total commit count. The metric MUST be included in both the default human-readable output and the `--json` output. The computation MUST reuse the project's existing `git log` access conventions and MUST NOT introduce a new CLI command.

### Scenario: human_output_reports_ceremony_ratio
- GIVEN a repository whose git history contains a mix of `chore`/`docs` commits and functional (`feat`/`fix`/`refactor`) commits
- WHEN `metta progress` runs
- THEN the human output reports the ceremony commit ratio computed from `git log`

### Scenario: json_output_includes_ceremony_ratio
- GIVEN the same repository
- WHEN `metta progress --json` runs
- THEN the JSON output includes the ceremony-commit-ratio metric

## ADDED: Requirement: ProgressArtifactsPerSmallChangeMetric

`metta progress` MUST compute and report an artifacts-per-small-change metric: the mean artifact count across archived changes in `spec/archive/` whose final workflow tier was `quick` or `trivial`. The metric MUST be included in both human-readable and `--json` output. When no archived change finished on the `quick` or `trivial` tier, the metric MUST render as an explicit no-data indicator rather than a numeric value that could be mistaken for a computed zero.

### Scenario: reports_mean_artifact_count
- GIVEN `spec/archive/` contains changes that finished on the `quick` or `trivial` tier with varying artifact counts
- WHEN `metta progress` runs
- THEN both human and `--json` output report the mean artifact count for those changes

### Scenario: no_data_renders_without_misleading_zero
- GIVEN `spec/archive/` contains no changes that finished on the `quick` or `trivial` tier
- WHEN `metta progress` runs
- THEN the metric renders an explicit no-data indicator without error and without a misleading numeric value
