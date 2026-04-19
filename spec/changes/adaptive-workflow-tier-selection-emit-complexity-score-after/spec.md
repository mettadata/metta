# Adaptive Workflow Tier Selection

## ADDED: Requirement: ComplexityScoreComputation

After `intent.md` is written during any `metta propose`, `metta fix-issues`, or `/metta-quick` flow, the framework MUST parse the `## Impact` section of `intent.md`, count distinct file and module references in that section, and map the count to a tier using the canonical thresholds. The resulting score MUST be persisted to the change's `.metta.yaml` under the `complexity_score` field. The computation MUST occur exactly once at intent-authoring time and MUST NOT be re-triggered by subsequent edits to `intent.md`. If `intent.md` has not been written, the scorer MUST produce no output and `complexity_score` MUST remain absent from change metadata.

**Fulfills:** US-1, US-2, US-4, US-5, US-7

### Scenario: single-file impact section scores trivial
- GIVEN a change whose `intent.md` `## Impact` section references exactly one file
- WHEN intent authoring completes and the scorer runs
- THEN `complexity_score.score` is `0`, `complexity_score.signals.file_count` is `1`, and `complexity_score.recommended_workflow` is `trivial` in `.metta.yaml`

### Scenario: five-file impact section scores standard
- GIVEN a change whose `intent.md` `## Impact` section enumerates five distinct files
- WHEN intent authoring completes and the scorer runs
- THEN `complexity_score.score` is `2`, `complexity_score.signals.file_count` is `5`, and `complexity_score.recommended_workflow` is `standard` in `.metta.yaml`

### Scenario: missing intent.md produces no score
- GIVEN a change that has been scaffolded but whose `intent.md` has not yet been written
- WHEN any `ArtifactStore` read path loads the change metadata
- THEN `complexity_score` is absent from `.metta.yaml` and no validation error is raised

---

## ADDED: Requirement: ComplexityScoreStorage

The `.metta.yaml` change-metadata Zod schema MUST include two new optional fields: `complexity_score` and `actual_complexity_score`. Each field, when present, MUST conform to the shape `{ score: number, signals: { file_count: number }, recommended_workflow: 'trivial' | 'quick' | 'standard' | 'full' }`. Both fields MUST be optional — their absence MUST validate without error. All `ArtifactStore` read and write paths MUST handle presence and absence of each field without throwing. The `actual_complexity_score` field MUST never overwrite `complexity_score`; they are independent and parallel.

**Fulfills:** US-5, US-7

### Scenario: write then read round-trip preserves score
- GIVEN the scorer computes `{ score: 1, signals: { file_count: 3 }, recommended_workflow: 'quick' }`
- WHEN the value is written to `.metta.yaml` and then read back via `ArtifactStore`
- THEN the deserialized object exactly matches the written value and Zod reports no validation error

### Scenario: absent field validates as null
- GIVEN a `.metta.yaml` file that contains no `complexity_score` key
- WHEN `ArtifactStore` reads and validates the file against the Zod schema
- THEN validation succeeds, the field is `undefined` or `null` in the parsed result, and no error is thrown

### Scenario: actual score stored without overwriting original
- GIVEN a change with an existing `complexity_score` of `{ score: 0, signals: { file_count: 1 }, recommended_workflow: 'trivial' }`
- WHEN the auto-upscale path computes `actual_complexity_score` of `{ score: 2, signals: { file_count: 5 }, recommended_workflow: 'standard' }` and writes it
- THEN `.metta.yaml` contains both fields with distinct values and `complexity_score` is unchanged

---

## ADDED: Requirement: StatusCommandSurface

`metta status --change <name>` MUST display the complexity score in both human-readable and `--json` output modes. In human mode, when `complexity_score` is present, the output MUST include a line of the form `Complexity: <tier> (N file[s]) -- recommended: <workflow>`. In `--json` mode, the serialized change object MUST include a `complexity_score` key containing either the full score object or `null`. When `actual_complexity_score` is present, `--json` mode MUST also include that field. When `complexity_score` is absent, human mode MUST render an empty or `not yet scored` complexity state and the command MUST exit 0.

**Fulfills:** US-5, US-7

### Scenario: human output with score present
- GIVEN a change with `complexity_score: { score: 0, signals: { file_count: 1 }, recommended_workflow: 'trivial' }`
- WHEN `metta status --change <name>` runs in human mode
- THEN stdout contains a line matching `Complexity: trivial (1 file) -- recommended: trivial`

### Scenario: JSON output includes full score object
- GIVEN a change with `complexity_score: { score: 2, signals: { file_count: 5 }, recommended_workflow: 'standard' }` and `actual_complexity_score: { score: 2, signals: { file_count: 5 }, recommended_workflow: 'standard' }`
- WHEN `metta status --change <name> --json` runs
- THEN the JSON payload contains both `complexity_score` and `actual_complexity_score` keys with their full objects

### Scenario: absent score exits cleanly
- GIVEN a change with no `complexity_score` in `.metta.yaml`
- WHEN `metta status --change <name>` runs in either human or `--json` mode
- THEN the command exits 0, human output shows `not yet scored` or an equivalent empty state, and the JSON payload contains `"complexity_score": null` or omits the field without a Zod error

---

## ADDED: Requirement: InstructionsAdvisoryBanner

`metta instructions` MUST print a one-line advisory banner as the very first line of stdout when `complexity_score` is present in the active change's `.metta.yaml`. The banner MUST use the exact format: `Advisory: complexity scored as <tier> (N files) -- recommended workflow: <workflow>`. The banner MUST be suppressed entirely when `complexity_score` is absent. The banner is informational only — it MUST NOT alter routing, block execution, or modify any artifact. The remainder of the instructions output MUST be identical whether or not the banner is printed.

**Fulfills:** US-4, US-7

### Scenario: banner printed when score present
- GIVEN a change with `complexity_score: { score: 1, signals: { file_count: 3 }, recommended_workflow: 'quick' }`
- WHEN `metta instructions` runs
- THEN the first line of stdout is exactly `Advisory: complexity scored as quick (3 files) -- recommended workflow: quick`

### Scenario: banner suppressed when score absent
- GIVEN a change with no `complexity_score` in `.metta.yaml`
- WHEN `metta instructions` runs
- THEN no line beginning with `Advisory:` appears in stdout and all other output is unchanged

### Scenario: banner does not block execution
- GIVEN the advisory banner is printed for a trivially-scored change
- WHEN the invoking orchestrator reads the instructions output
- THEN execution continues normally, no error code is set, and no artifact is modified

---

## ADDED: Requirement: AutoDownscalePrompt

After `metta complete intent` runs during a `metta propose` or `metta fix-issues` flow, if `recommended_workflow` from the computed score is a lower tier than the change's chosen workflow, the CLI MUST print an interactive prompt: `Scored as <tier> (N files) -- collapse workflow to /metta-quick? [y/N]`. The default answer MUST be No. On Yes, the `workflow` field in `.metta.yaml` MUST be updated to `quick` AND planning artifacts (stories, spec, research, design, tasks) MUST be removed from the artifact list in `.metta.yaml`. On No or Enter, the original workflow and artifact list MUST be preserved without modification. The prompt MUST be suppressed when the chosen workflow already equals or is smaller than the recommendation. When the runtime environment is non-TTY or `--json` mode is active, the prompt MUST be skipped, No MUST be assumed, and the advisory banner MUST still appear in output. The auto-downscale prompt MUST NOT fire during `/metta-quick` runs.

**Fulfills:** US-2

### Scenario: user accepts downscale from standard to quick
- GIVEN `metta propose` has written `intent.md` for a single-file change under a `standard` workflow
- WHEN the scorer fires and the user answers `y` to the downscale prompt
- THEN `.metta.yaml` `workflow` is `quick` and `artifacts` no longer includes stories, spec, research, design, or tasks entries

### Scenario: user declines downscale
- GIVEN `metta propose` has written `intent.md` for a single-file change under a `standard` workflow
- WHEN the scorer fires and the user presses Enter or types `n`
- THEN `.metta.yaml` `workflow` remains `standard` and the artifact list is unchanged

### Scenario: already-quick workflow produces no prompt
- GIVEN a `/metta-quick` run whose intent scores as `trivial`
- WHEN `metta complete intent` runs
- THEN no downscale prompt is printed and `.metta.yaml` is not modified by the prompt logic

### Scenario: non-TTY skips prompt and defaults to No
- GIVEN `metta propose` runs in a CI environment where stdin is not a TTY
- WHEN the scorer fires and recommends a lower tier
- THEN no interactive prompt is printed, the workflow is preserved as if No were chosen, and the advisory banner appears in stdout

---

## ADDED: Requirement: AutoUpscaleWarning

After `metta complete implementation` writes `summary.md`, the scorer MUST recompute the file count by parsing distinct file paths from the `## Files` section of `summary.md`. The recomputed score MUST be persisted to `actual_complexity_score` in `.metta.yaml` regardless of whether a tier jump occurred. If the recomputed tier is strictly higher than the chosen workflow's tier, the command MUST print a warning as the first line of its output: `Warning: this change touched N files -- <recomputed_tier> workflow was recommended; finalize will proceed on <chosen_tier>`. If the recomputed tier is equal to or lower than the chosen workflow's tier, no warning MUST be printed and `actual_complexity_score` MUST still be written silently. Finalize MUST NOT be blocked under any circumstance by this check.

**Fulfills:** US-3

### Scenario: quick run that touched standard-tier file count warns
- GIVEN a `/metta-quick` change whose `summary.md` `## Files` section lists 5 distinct files
- WHEN `metta complete implementation` runs
- THEN the first line of stdout is `Warning: this change touched 5 files -- standard workflow was recommended; finalize will proceed on quick` and `actual_complexity_score.recommended_workflow` is `standard` in `.metta.yaml`

### Scenario: quick run within trivial tier produces no warning
- GIVEN a `/metta-quick` change whose `summary.md` `## Files` section lists 1 file
- WHEN `metta complete implementation` runs
- THEN no warning line appears in stdout, `actual_complexity_score` is written silently with `recommended_workflow: trivial`, and the command exits 0

### Scenario: propose run that stays within standard tier produces no warning
- GIVEN a `standard` workflow change whose `summary.md` `## Files` section lists 4 files
- WHEN `metta complete implementation` runs
- THEN no warning is printed because the recomputed tier does not exceed the chosen workflow tier

### Scenario: finalize not blocked after warning
- GIVEN the auto-upscale recompute fires and a warning is printed
- WHEN `metta complete implementation` finishes
- THEN the command exits 0 and the subsequent finalize step is not gated or blocked by the warning

---

## ADDED: Requirement: OverrideRemainsAuthoritative

The existing `--workflow <tier>` flag on `metta propose` MUST continue to set the chosen workflow with full authority. When `--workflow` is present, the auto-downscale prompt MUST be suppressed regardless of what tier the scorer recommends. The advisory score MUST still be computed and persisted, and the advisory banner MUST still appear via `metta instructions`. No behavior of the `--workflow` flag MUST change from its pre-feature semantics except that the advisory is now computed alongside it. If `--workflow` is absent, the auto-downscale prompt logic MUST apply as defined in the AutoDownscalePrompt requirement.

**Fulfills:** US-6

### Scenario: explicit workflow flag wins over trivial recommendation
- GIVEN `metta propose --workflow standard` is invoked for a change that scores as `trivial`
- WHEN intent.md is written and scoring completes
- THEN the auto-downscale prompt is not shown, `.metta.yaml` `workflow` remains `standard`, and the artifact list is unchanged

### Scenario: advisory still persists alongside explicit override
- GIVEN `metta propose --workflow standard` is invoked for a trivially-scored change
- WHEN scoring completes
- THEN `complexity_score` is persisted to `.metta.yaml` with `recommended_workflow: trivial` and the advisory banner appears in subsequent `metta instructions` output

### Scenario: absent flag allows downscale prompt
- GIVEN `metta propose` is invoked without `--workflow` for a change that scores lower than the default workflow
- WHEN intent.md is written and scoring completes
- THEN the downscale prompt appears as specified in the AutoDownscalePrompt requirement

---

## ADDED: Requirement: IntraQuickDownsizeRule

When a `/metta-quick` change has `complexity_score.recommended_workflow` equal to `trivial`, the skill's trivial-detection gate SHOULD reduce the reviewer and verifier fan-out to exactly 1 quality reviewer and 1 tests/tsc verifier. No correctness reviewer, no security reviewer, and no dedicated goal-check verifier SHOULD be spawned in the trivial path. Non-trivial `/metta-quick` runs SHOULD retain the standard fan-out of 3 reviewers and 3 verifiers. Tests and tsc MUST run on every change regardless of tier; this requirement is non-negotiable and applies to both trivial and non-trivial fan-outs. The skill MUST log the downsize decision when it applies.

**Fulfills:** US-1

### Scenario: trivial score uses 1-plus-1 fan-out
- GIVEN a `/metta-quick` change with `complexity_score.recommended_workflow: trivial` (1 file in Impact)
- WHEN the skill reaches the review and verify stage
- THEN exactly 1 quality reviewer and 1 tests/tsc verifier are spawned and the skill logs a downsize decision message

### Scenario: non-trivial quick run keeps 3-plus-3 fan-out
- GIVEN a `/metta-quick` change with `complexity_score.recommended_workflow: standard` (4 files in Impact)
- WHEN the skill reaches the review and verify stage
- THEN 3 reviewers and 3 verifiers are spawned with no downsize applied

### Scenario: tests always run regardless of tier
- GIVEN a trivially-scored `/metta-quick` change using the 1-plus-1 fan-out
- WHEN the verifier subagent executes
- THEN the tests/tsc verifier runs and its exit code is checked; a non-zero exit code MUST fail the change

---

## ADDED: Requirement: TierThresholds

The mapping from file count to workflow tier MUST be: file count <= 1 maps to `trivial` (score index 0); file count 2 or 3 maps to `quick` (score index 1); file count 4 through 7 inclusive maps to `standard` (score index 2); file count >= 8 maps to `full` (score index 3). These thresholds MUST be defined in a single authoritative location in the codebase and referenced by all scorer invocations. No scorer invocation MAY use hardcoded threshold values outside that authoritative definition. The boundary values (1, 2, 3, 4, 7, 8) MUST each be covered by automated tests.

**Fulfills:** US-1, US-2, US-3

### Scenario: boundary at 1 maps to trivial
- GIVEN the scorer is given a file count of 1
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `trivial` and `score` is `0`

### Scenario: boundary at 2 maps to quick
- GIVEN the scorer is given a file count of 2
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `quick` and `score` is `1`

### Scenario: boundary at 4 maps to standard
- GIVEN the scorer is given a file count of 4
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `standard` and `score` is `2`

### Scenario: boundary at 8 maps to full
- GIVEN the scorer is given a file count of 8
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `full` and `score` is `3`

---

## ADDED: Requirement: ScoringRubricSpec

A rubric specification document MUST be created under `spec/specs/<capability>/spec.md` (where `<capability>` is the slug derived from the H1 title of this document). The rubric MUST document: the v1 signal definition (file count parsed from `## Impact` section of `intent.md`), the four tier thresholds with their exact boundary values, the `complexity_score` and `actual_complexity_score` storage field names and shapes, the computation trigger timing (once at intent-authoring time), and explicit named extension points for the deferred signals (spec-surface, capability-count, line-delta). The `CLAUDE.md` Active Specs table MUST be updated to list the new capability with its requirement count. The rubric document MUST NOT document the deferred signals as implemented features; it MUST identify them as future extension points.

**Fulfills:** US-8

### Scenario: rubric document exists with required sections
- GIVEN the change has been merged
- WHEN a maintainer lists files under `spec/specs/`
- THEN a spec file for this capability exists containing the file-count signal definition, the four tier thresholds with boundary values, and the storage field names `complexity_score` and `actual_complexity_score`

### Scenario: extension points explicitly named
- GIVEN a maintainer reads the rubric document
- WHEN they search for guidance on adding new signals
- THEN the document explicitly names spec-surface, capability-count, and line-delta as deferred extension points and does not describe them as implemented behavior

### Scenario: CLAUDE.md Active Specs table updated
- GIVEN the rubric capability spec is authored
- WHEN `CLAUDE.md` is regenerated or updated
- THEN the Active Specs table contains a row for the new capability and its requirement count is non-zero
