# Adaptive Workflow Tier Selection

**Source:** `src/complexity/scorer.ts`, `src/complexity/file-count-parser.ts`, `src/complexity/renderer.ts`
**Consumers:** `src/cli/commands/complete.ts`, `src/cli/commands/status.ts`, `src/cli/commands/instructions.ts`
**Schema:** `src/schemas/change-metadata.ts` (`ComplexityScoreSchema`, `ChangeMetadataSchema`)
**Tests:** `tests/complexity-file-count-parser.test.ts`, `tests/complexity-scorer.test.ts`, `tests/complexity-renderer.test.ts`, `tests/complexity-tracking.test.ts`
**RFC 2119 Keywords:** MUST, MUST NOT, SHOULD, MAY

---

## Purpose

Adaptive Workflow Tier Selection is the scoring and prompting capability that estimates the scope of a change immediately after intent is authored, persists that estimate in change metadata, and surfaces advisory and interactive prompts that let the user (or an `--auto` flag) adjust the chosen workflow up or down so the framework's fan-out matches the real blast radius of the change. It exists to eliminate two symmetric failure modes in fixed-fan-out workflows: wasted tokens on trivial changes that run full review fan-outs, and missing planning artifacts on changes that outgrew their chosen workflow. The capability is print-only by default (an advisory banner) and only mutates state when the user (or `--auto`) accepts a prompt.

---

## Scoring Signal (v1)

The v1 signal set contains a single input: the **file count**, derived from markdown parsing of the change's own artifacts.

**Pre-implementation (intent time).** The file count is parsed from the `## Impact` section of `intent.md`. The parser walks the mdast, locates the first H2 whose text is exactly `Impact`, collects every `inlineCode` node in the section body, filters them through an extension-anchored (`.ts`, `.yaml`, `.yml`, `.md`, `.js`, `.jsx`, `.tsx`, `.go`, `.py`, `.rs`, `.sh`, `.json`, `.toml`) or prefix-anchored (`src/`, `tests/`, `dist/`, `.metta/`, `spec/`) discriminator, deduplicates the tokens by exact string, and returns the count. When the `## Impact` heading is entirely absent the scorer MUST return `null` so callers can distinguish "intent not authored" from "intent authored but impact empty"; when the heading exists but the filtered set is empty the scorer returns a zero-file score (tier `trivial`).

**Post-implementation (implementation-complete recompute).** The file count is re-parsed from the `## Files` section of `summary.md` using the identical parser. The recomputed score is written to a parallel metadata field and MUST NOT overwrite the original intent-time score.

Logic lives in `parseFileCountFromSection` (`src/complexity/file-count-parser.ts`) and the two thin wrappers `scoreFromIntentImpact` and `scoreFromSummaryFiles` (`src/complexity/scorer.ts`).

---

## Tier Thresholds

The tier mapping is the single authoritative definition of the adaptive-workflow boundaries and is encoded in exactly one function: `tierFromFileCount` in `src/complexity/scorer.ts`. No other file in the codebase duplicates these boundaries.

| Tier     | File count   | Numeric score |
|----------|--------------|---------------|
| trivial  | <= 1 file    | 0             |
| quick    | 2-3 files    | 1             |
| standard | 4-7 files    | 2             |
| full     | 8+ files     | 3             |

Boundary cases (encoded directly by `tierFromFileCount`):

- `n == 0` -> `trivial`
- `n == 1` -> `trivial`
- `n == 2` -> `quick`
- `n == 3` -> `quick`
- `n == 4` -> `standard`
- `n == 7` -> `standard`
- `n == 8` -> `full`

The numeric `score` field on the persisted `ComplexityScore` object mirrors this 0..3 range and is validated by Zod as an integer in `[0, 3]`.

---

## Prompt Modes

Four prompt modes are defined. All four are driven from `src/cli/commands/complete.ts` and share the `askYesNo` helper (`src/cli/helpers.ts`) and the `renderBanner` / `renderStatusLine` renderers (`src/complexity/renderer.ts`).

### intent-downscale

- **Trigger**: after `metta complete intent` during a `metta propose` or `metta fix-issues` run, when `scoreFromIntentImpact` returns a `recommended_workflow` tier strictly lower than the chosen workflow tier, and the chosen workflow is not already `quick` (quick is the smallest named interactive workflow for downscale purposes).
- **Default behavior**: print `Scored as <tier> (N files) -- collapse workflow to /metta-<tier>? [y/N]` and wait for a yes/no answer. Default is No. On Yes the `.metta.yaml` `workflow` field is updated to the recommended tier and unstarted planning artifacts (stories, spec, research, design, tasks — any artifact whose status is not `complete`) are dropped from the artifact list. On No, the original workflow is preserved and an advisory banner is emitted to stderr.
- **Auto-accept interaction**: when `auto_accept_recommendation` is `true` in `.metta.yaml`, the interactive prompt is skipped, an auto-accept banner is printed to stderr, and the Yes path is taken. Non-TTY environments (no `process.stdin.isTTY`, or `--json`) without auto-accept take the No path.

### intent-upscale

- **Trigger**: after `metta complete intent`, when `scoreFromIntentImpact` returns a `recommended_workflow` tier strictly higher than the chosen workflow tier. **Hard cap**: when the recommended tier is `full`, the prompt MUST NOT fire; instead an advisory is emitted to stderr (`Advisory: scored full -- upscale to full is not yet supported; consider standard`).
- **Default behavior**: print `Scored as <tier> (N files) -- promote workflow to /metta-<tier>? [y/N]` and wait for a yes/no answer. Default is No. On Yes the `.metta.yaml` `workflow` field is updated to the recommended tier and missing planning stages present in the target workflow's `buildOrder` are inserted into the artifact list as `pending`. On No, the original workflow is preserved.
- **Auto-accept interaction**: when `auto_accept_recommendation` is `true`, the prompt is skipped and the Yes path is taken (with the same full-cap behavior). Non-TTY without auto-accept takes the No path.

### post-impl-upscale

- **Trigger**: after `metta complete implementation`, when `scoreFromSummaryFiles` computes a tier strictly higher than the current workflow tier. `actual_complexity_score` MUST be persisted in both the Yes and No paths, and also persisted silently when the recomputed tier is equal to or lower than the current workflow tier.
- **Default behavior**: print `Implementation touched N files -- promote to /metta-<tier> and retroactively author stories + spec? [y/N]`. Default is No. On Yes: update the `workflow` field, insert `stories` and `spec` as `pending` artifacts only if they are not already present and complete, and print to stdout: `Post-impl upscale accepted. Run: metta instructions stories --change <name>  then  metta instructions spec --change <name>. Verification resumes after both are complete.` On No: emit warning to stderr (`Warning: this change touched N files -- <tier> workflow was recommended; finalize will proceed on <chosen-tier>`) and leave `workflow` unchanged. Exit code MUST be 0 in all paths.
- **Auto-accept interaction**: when `auto_accept_recommendation` is `true`, the prompt is skipped and the Yes path is taken. Non-TTY without auto-accept takes the No path.

### intra-quick-downsize

- **Trigger**: inside the `/metta-quick` skill template, when `complexity_score.recommended_workflow === 'trivial'`. This gate fires regardless of whether the user accepted or declined an intent-time downscale; a user who stays on `quick` with a trivial-scored change still benefits from the reduced fan-out.
- **Default behavior**: the skill reduces review and verify fan-out to exactly 1 quality reviewer and 1 tests/tsc verifier. Non-trivial `quick` runs keep the default 3-reviewer and 3-verifier fan-out. Tests and tsc MUST run on every change regardless of tier.
- **Auto-accept interaction**: this mode has no interactive prompt. `--auto` on `metta quick` continues to cover its pre-existing discovery-loop scope and is orthogonal to this fan-out gate; the trivial fan-out applies whenever the score indicates `trivial`.

---

## Storage Fields

Three optional fields extend `ChangeMetadataSchema` in `src/schemas/change-metadata.ts`. All three MUST be optional so legacy `.metta.yaml` files written before this capability was introduced continue to validate.

### complexity_score

- **Shape**: `ComplexityScoreSchema.optional()`. The `ComplexityScoreSchema` is a `z.object({ score: z.number().int().min(0).max(3), signals: z.object({ file_count: z.number().int().min(0) }).strict(), recommended_workflow: z.enum(['trivial', 'quick', 'standard', 'full']) }).strict()`.
- **Written**: once, at intent-authoring time, by `src/cli/commands/complete.ts` after `markArtifact('intent', 'complete')`. The write is guarded by `isScorePresent(metadata)` so the field is never overwritten by a later intent edit or reinvocation.
- **Read**: by `metta status` (both human and `--json`), by `metta instructions` (for the advisory banner), and by `metta complete` itself (to decide which prompt mode to fire). All read paths tolerate absence.

### actual_complexity_score

- **Shape**: `ComplexityScoreSchema.optional()` — identical shape to `complexity_score`.
- **Written**: once, at `metta complete implementation` time, by `src/cli/commands/complete.ts` after `markArtifact('implementation', 'complete')` and after `scoreFromSummaryFiles(summaryMd)` is invoked. This field MUST NOT overwrite `complexity_score`; the two coexist as parallel fields. It is persisted in all paths (Yes, No, non-TTY, auto-accept, and silent-equal-or-lower).
- **Read**: by `metta status --json` as a top-level field on the change payload (or `null` when absent); surfaced in status human output as part of the complexity line when present.

### auto_accept_recommendation

- **Shape**: `z.boolean().optional()` (defaults conceptually to `false` when absent; the schema treats `undefined` as falsy without emitting a default on write).
- **Written**: by `ArtifactStore.createChange` when `metta propose`, `metta quick`, or `metta fix-issues` is invoked with `--auto` or its alias `--accept-recommended`. The field is persisted in `.metta.yaml` as `true` in that case, and omitted otherwise.
- **Read**: by `src/cli/commands/complete.ts` at every adaptive-routing prompt site (intent-downscale, intent-upscale, post-impl-upscale). When `true`, the interactive prompt is bypassed and the Yes path is taken; an auto-accept banner is printed to stderr so the record is visible.

A fourth field, `workflow_locked: z.boolean().optional()`, is set to `true` by `ArtifactStore.createChange` when `--workflow <tier>` is explicitly provided. It is not consumed by the prompt modes in v1 but is reserved for future policy that may suppress auto-upscale when the user has explicitly locked a workflow.

---

## Extension Points

This capability was scoped intentionally narrow for v1. The following are named here as planned-but-not-yet-implemented extension points. A future contributor adding any of these MUST extend `ComplexityScoreSchema.signals` in `src/schemas/change-metadata.ts`, extend the scoring logic in `src/complexity/scorer.ts` (and the relevant parser module), and update this rubric doc to record the new boundary rules.

### Deferred signals

- **spec-surface** — counting changes to public API or spec-surface area (e.g. capabilities added, contract changes in `spec/specs/*/spec.md`) as a complexity input alongside file count. Deferred because the intent-time signal is not yet rich enough to characterize surface impact reliably.
- **capability-count** — counting the number of `spec/specs/` capability folders touched by a change as a complexity input. Deferred because intent.md does not yet cross-reference capability folders directly and would require a new parser.
- **line-delta** — using estimated (intent-time) or actual (summary-time) line-counts as a scoring signal beyond file count. Deferred because v1 file count already provides sufficient discrimination for the trivial/quick/standard/full bands.

### Deferred retroactive artifacts

The post-impl-upscale Yes path currently retroactively inserts only `stories` and `spec` artifacts. The following are deferred and MUST NOT be produced by the retroactive path in v1:

- **research** — retroactive authoring of `research.md`. Deferred because research is a pre-implementation investigation artifact; retroactive authoring would be speculative.
- **design** — retroactive authoring of `design.md`. Deferred for the same reason as research: design is a forward-looking artifact and retroactive authoring would misrepresent the decision timeline.
- **tasks** — retroactive authoring of `tasks.md`. Deferred because tasks are a planning artifact whose value is in-flight execution; retroactive tasks would duplicate what `summary.md` already records.

### Extension mechanism

A future contributor adding a new signal or retroactive artifact MUST:

1. Extend `ComplexityScoreSchema.signals` in `src/schemas/change-metadata.ts` with the new signal field (e.g. `spec_surface_count: z.number().int().min(0)`), keeping all new fields as additive so existing metadata continues to validate.
2. Extend the scorer in `src/complexity/scorer.ts` — either by adding a new parser module alongside `src/complexity/file-count-parser.ts` and invoking it from `scoreFromIntentImpact` / `scoreFromSummaryFiles`, or by introducing a new top-level scoring function.
3. Revisit `tierFromFileCount` — if combining signals, introduce a `tierFromSignals(signals)` replacement and deprecate the single-signal function, keeping the 0..3 numeric output stable.
4. Update this rubric doc under a new `## Scoring Signal (vN)` section and add the new signal to the Extension Points section as "implemented in vN".
5. Update the renderer in `src/complexity/renderer.ts` only if the new signal should surface in the advisory banner or status line text; otherwise the renderer remains untouched and the new signal is exposed only in the `--json` status output via the schema.


## Requirement: ComplexityScoreComputation

The system MUST compute a complexity score as the final step of intent authoring, immediately after `intent.md` is written by `metta complete intent`. The scorer MUST parse the `## Impact` section of `intent.md`, count distinct file or module references, and map the count to a tier using the canonical threshold table. The computed score MUST be persisted to the change's `.metta.yaml` metadata block before `metta complete intent` returns. The scorer MUST NOT run at CLI invocation time and MUST NOT recompute when `intent.md` is subsequently edited. When `intent.md` has not been written, the scorer MUST produce no output and `complexity_score` MUST be absent from change metadata.
Fulfills: US-2, US-3, US-7, US-8, US-10

### Scenario: score_computed_from_impact_section
- GIVEN a change is running under `metta propose --workflow standard` and intent has just been written with an `## Impact` section referencing three distinct files
- WHEN `metta complete intent` reaches the scoring step
- THEN `.metta.yaml` contains a `complexity_score` object with `score: 1`, `signals.file_count: 3`, and `recommended_workflow: quick`

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


## Requirement: ComplexityScoreStorage

The `.metta.yaml` change-metadata Zod schema MUST declare `complexity_score`, `actual_complexity_score`, and `auto_accept_recommendation` as optional fields. All three fields MUST default to absent so that legacy `.metta.yaml` files that predate this feature parse without error. Every read and write path in `ArtifactStore` MUST handle the presence and absence of each field without throwing a Zod validation error. The `complexity_score` and `actual_complexity_score` objects MUST each contain the sub-fields `score` (numeric tier index 0-3), `signals.file_count` (integer), and `recommended_workflow` (string tier label). The `actual_complexity_score` field MUST never overwrite `complexity_score`; they MUST coexist as independent parallel fields.
Fulfills: US-4, US-6, US-8, US-10

### Scenario: schema_accepts_full_complexity_block
- GIVEN a `.metta.yaml` file that contains `complexity_score`, `actual_complexity_score`, and `auto_accept_recommendation: true`
- WHEN `ArtifactStore` reads the file and runs Zod validation
- THEN the parse succeeds and all three fields are available on the resulting change-metadata object

### Scenario: schema_accepts_legacy_file_without_fields
- GIVEN a `.metta.yaml` file that predates this feature and contains none of the three new fields
- WHEN `ArtifactStore` reads and validates the file
- THEN the parse succeeds, `complexity_score` is absent on the result, and no Zod error is thrown

### Scenario: actual_score_does_not_overwrite_original
- GIVEN a change that has `complexity_score` persisted with `recommended_workflow: quick`
- WHEN the post-implementation recompute writes `actual_complexity_score` with `recommended_workflow: standard`
- THEN `complexity_score.recommended_workflow` is still `quick` and both objects coexist under their respective keys in `.metta.yaml`


## Requirement: TierThresholds

The scorer MUST apply the following exclusive tier-boundary mapping to convert a file count to a workflow tier: `trivial` for counts less than or equal to 1, `quick` for counts of 2 or 3, `standard` for counts of 4 through 7 inclusive, and `full` for counts of 8 or more. These thresholds MUST be defined in a single authoritative location in the codebase and referenced by all scorer invocations. No scorer invocation MAY use hardcoded threshold values outside that authoritative definition. The scorer MUST represent the chosen tier as both a human-readable label and a numeric index (0, 1, 2, 3 respectively) in the persisted `complexity_score` object.
Fulfills: US-1, US-2, US-3, US-4, US-5, US-7, US-8

### Scenario: single_file_maps_to_trivial
- GIVEN the scorer is given a file count of 1
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `trivial` and `score` is `0`

### Scenario: two_files_maps_to_quick
- GIVEN the scorer is given a file count of 2
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `quick` and `score` is `1`

### Scenario: four_files_maps_to_standard
- GIVEN the scorer is given a file count of 4
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `standard` and `score` is `2`

### Scenario: eight_files_maps_to_full
- GIVEN the scorer is given a file count of 8
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `full` and `score` is `3`


## Requirement: StatusCommandSurface

The `metta status --change <name>` command MUST display the complexity score in both human-readable and `--json` output modes. In human-readable mode, when `complexity_score` is present, the output MUST include a `Complexity:` line in the format `Complexity: <tier> (N file[s]) -- recommended: <workflow>`. In `--json` mode, the JSON payload MUST include the full `complexity_score` object with `score`, `signals.file_count`, and `recommended_workflow` sub-fields. When `actual_complexity_score` is also present, `--json` mode MUST include both objects as distinct top-level fields in the change object. When `complexity_score` is absent, human mode MUST render an empty-state or `not yet scored` complexity line, and `--json` mode MUST include `"complexity_score": null` or omit the field without a Zod validation error. The command MUST exit 0 in all cases.
Fulfills: US-8, US-10

### Scenario: human_output_shows_complexity_line
- GIVEN a change with `complexity_score.recommended_workflow: trivial` and `signals.file_count: 1`
- WHEN `metta status --change <name>` runs in human mode
- THEN stdout contains the line `Complexity: trivial (1 file) -- recommended: trivial` and the exit code is 0

### Scenario: json_output_includes_complexity_object
- GIVEN a change with `complexity_score` persisted at `score: 2`, `signals.file_count: 5`, `recommended_workflow: standard`
- WHEN `metta status --change <name> --json` runs
- THEN the JSON payload contains `complexity_score` with `score`, `signals.file_count`, and `recommended_workflow` fields

### Scenario: json_output_includes_both_scores_when_present
- GIVEN a change that has both `complexity_score` from intent time and `actual_complexity_score` from the post-implementation recompute persisted
- WHEN `metta status --change <name> --json` runs
- THEN the JSON payload contains both `complexity_score` and `actual_complexity_score` as distinct top-level fields in the change object

### Scenario: absent_score_renders_without_error
- GIVEN a change with no `complexity_score` in `.metta.yaml`
- WHEN `metta status --change <name>` runs in both human and `--json` modes
- THEN the command exits 0, human output shows an empty-state complexity line, and the JSON payload includes `"complexity_score": null` or omits the field without a Zod error


## Requirement: InstructionsAdvisoryBanner

The `metta instructions` command MUST print a one-line advisory banner as the first line of stdout whenever `complexity_score` is present in the active change's `.metta.yaml`. The banner MUST reflect one of three states based on the relationship between `workflow` and `complexity_score.recommended_workflow`: agreement when they match (`Advisory: current workflow <tier> matches recommendation <tier>`), downscale-recommended when recommended is lower (`Advisory: current <chosen>, scored <recommended> -- downscale recommended`), or upscale-recommended when recommended is higher (`Advisory: current <chosen>, scored <recommended> -- upscale recommended`). The banner MUST be suppressed entirely when `complexity_score` is absent. When `--json` mode is active, the advisory banner MUST be written to stderr so that JSON stdout remains machine-parseable. The banner MUST NOT block execution or alter any artifact.
Fulfills: US-7, US-10

### Scenario: banner_agreement_state
- GIVEN a change with `workflow: quick` and `complexity_score.recommended_workflow: quick`
- WHEN `metta instructions` runs
- THEN the first line of stdout is `Advisory: current workflow quick matches recommendation quick` and execution continues normally

### Scenario: banner_downscale_state
- GIVEN a change with `workflow: standard` and `complexity_score.recommended_workflow: trivial`
- WHEN `metta instructions` runs
- THEN the first line of stdout is `Advisory: current standard, scored trivial -- downscale recommended`

### Scenario: banner_upscale_state
- GIVEN a change with `workflow: quick` and `complexity_score.recommended_workflow: standard`
- WHEN `metta instructions` runs
- THEN the first line of stdout is `Advisory: current quick, scored standard -- upscale recommended`

### Scenario: banner_suppressed_when_score_absent
- GIVEN a change with no `complexity_score` in `.metta.yaml`
- WHEN `metta instructions` runs
- THEN no `Advisory:` line appears in stdout and the command exits 0


## Requirement: AutoDownscalePromptAtIntent

When `metta complete intent` runs under `metta propose` or `metta fix-issues` and `recommended_workflow` is a lower tier than the chosen workflow, an interactive `[y/N]` prompt MUST be printed to stdout with the text `Scored as <tier> (N files) -- collapse workflow to /metta-<tier>? [y/N]`. The default answer MUST be No. On Yes, `metta complete intent` MUST update the `workflow` field in `.metta.yaml` to the recommended tier AND remove from the artifact list any planning artifacts (stories, spec, research, design, tasks) that have not yet been authored (status not `complete`). On No, the original workflow and artifact list MUST remain unchanged. The prompt MUST NOT appear when the chosen workflow already matches or is lower than the recommended tier. When the environment is non-TTY, the prompt MUST be skipped and No MUST be assumed; the advisory banner MUST still be emitted. When `auto_accept_recommendation: true` is set in `.metta.yaml`, the prompt MUST be skipped and Yes MUST be auto-selected. The downscale prompt MUST NOT fire for `/metta-quick` runs because quick is already the smallest named interactive workflow.
Fulfills: US-2, US-6

### Scenario: downscale_prompt_appears_on_oversized_propose
- GIVEN `metta propose --workflow standard` has just written `intent.md` and the scored tier is `trivial`
- WHEN scoring completes
- THEN the CLI prints `Scored as trivial (1 files) -- collapse workflow to /metta-trivial? [y/N]` with default No and the process waits for input

### Scenario: downscale_yes_mutates_workflow_and_drops_artifacts
- GIVEN the downscale prompt is visible for a `standard` run scored as `trivial`
- WHEN the user answers `y`
- THEN `.metta.yaml` `workflow` is updated to `trivial` and unstarted planning artifacts (stories, spec, research, design, tasks) are removed from the change's artifact list

### Scenario: downscale_prompt_suppressed_when_workflow_matches
- GIVEN `metta propose --workflow quick` has just written `intent.md` and the scored tier is `quick`
- WHEN scoring completes
- THEN no downscale prompt appears and exit code is 0

### Scenario: downscale_prompt_skipped_non_tty
- GIVEN a non-TTY execution environment and `metta fix-issues` has written `intent.md` with scored tier `trivial` under `standard` workflow
- WHEN scoring completes
- THEN no interactive prompt is printed, No is assumed, the workflow field is unchanged, and the advisory banner is still emitted


## Requirement: AutoUpscalePromptAtIntent

When `metta complete intent` runs and `recommended_workflow` is a higher tier than the chosen workflow, an interactive `[y/N]` prompt MUST be printed to stdout with the text `Scored as <tier> (N files) -- promote workflow to /metta-<tier>? [y/N]`. The default answer MUST be No. On Yes, `metta complete intent` MUST update the `workflow` field in `.metta.yaml` to the recommended tier AND insert any stages present in the target workflow YAML definition but absent from the current artifact list as pending artifacts before implementation runs. The artifact diff MUST be computed by loading both the current and target workflow YAML definitions and comparing stage lists. On No, the original workflow and artifact list MUST remain unchanged. The prompt MUST NOT appear when the chosen workflow already matches or exceeds the recommendation. When the environment is non-TTY, the prompt MUST be skipped and No MUST be assumed. When `auto_accept_recommendation: true` is set, the prompt MUST be skipped and Yes MUST be auto-selected.
Fulfills: US-3, US-6

### Scenario: upscale_prompt_appears_on_undersized_quick
- GIVEN `metta quick` has just written `intent.md` listing five files and the scored tier is `standard`
- WHEN scoring completes
- THEN the CLI prints `Scored as standard (5 files) -- promote workflow to /metta-standard? [y/N]` with default No

### Scenario: upscale_yes_mutates_workflow_and_inserts_artifacts
- GIVEN the upscale prompt is visible for a `quick` run scored as `standard`
- WHEN the user answers `y`
- THEN `.metta.yaml` `workflow` is updated to `standard` and the stages present in the standard workflow YAML definition but absent from the current artifact list (stories, spec, research, design, tasks) are inserted as pending artifacts before implementation runs

### Scenario: upscale_prompt_suppressed_when_workflow_exceeds_recommendation
- GIVEN `metta propose --workflow full` has just written `intent.md` and the scored tier is `standard`
- WHEN scoring completes
- THEN no upscale prompt appears and exit code is 0

### Scenario: upscale_auto_accept_skips_prompt
- GIVEN `auto_accept_recommendation: true` is persisted and `metta quick` has written `intent.md` scoring `standard`
- WHEN scoring completes
- THEN no prompt is printed, the `workflow` field is updated to `standard`, and missing planning artifacts are inserted into the artifact list


## Requirement: PostImplementationUpscalePromptAccept

When `metta complete implementation` writes `summary.md`, the scorer MUST recompute the file count from the `## Files` section of `summary.md` using the same tier thresholds. If the recomputed tier exceeds the currently chosen workflow tier, an interactive `[y/N]` prompt MUST be printed: `Implementation touched N files -- promote to /metta-<tier> and retroactively author stories + spec? [y/N]`. The default answer MUST be No. On Yes, the command MUST: (1) update the `workflow` field in `.metta.yaml` to the recomputed tier, (2) spawn a metta-product agent to author `stories.md` using `intent.md`, `summary.md`, and the actual code as inputs, (3) spawn a metta-specifier agent (metta-proposer subagent type) to author `spec.md` using the same inputs, (4) insert both `stories` and `spec` artifacts into the artifact list and mark them `complete`, and (5) persist `actual_complexity_score`. Subsequent review and verify spawns MUST use the fan-out appropriate for the promoted tier. Research, design, and tasks MUST NOT be retroactively authored. When `auto_accept_recommendation: true` is set, the prompt MUST be skipped and Yes MUST be auto-selected.
Fulfills: US-4, US-6

### Scenario: post_impl_prompt_appears_when_recomputed_tier_exceeds_workflow
- GIVEN a `/metta-quick` change whose `summary.md` `## Files` section lists five distinct files and the chosen workflow is `quick`
- WHEN `metta complete implementation` runs the recompute step
- THEN the CLI prints `Implementation touched 5 files -- promote to /metta-standard and retroactively author stories + spec? [y/N]` with default No

### Scenario: post_impl_yes_spawns_agents_and_updates_metadata
- GIVEN the post-implementation upscale prompt is visible and the user answers `y`
- WHEN the retroactive path runs to completion
- THEN `.metta.yaml` `workflow` equals `standard`, `stories.md` and `spec.md` exist in the change directory authored by the metta-product and metta-specifier agents, both artifacts are marked `complete` in the artifact list, and `actual_complexity_score` is persisted

### Scenario: post_impl_yes_uses_promoted_fan_out
- GIVEN the retroactive path completed and workflow was promoted from `quick` to `standard`
- WHEN the skill orchestrator spawns review and verify
- THEN the fan-out matches the standard tier (3 reviewers + 3 verifiers) rather than the quick fan-out

### Scenario: post_impl_no_research_design_tasks_authored
- GIVEN the post-implementation upscale Yes path ran
- WHEN the artifact list is inspected
- THEN `research.md`, `design.md`, and `tasks.md` were not created and no corresponding agents were spawned


## Requirement: PostImplementationUpscalePromptDecline

When the post-implementation upscale prompt trigger fires (recomputed tier exceeds chosen workflow) and the user answers No, or when the environment is non-TTY, the command MUST persist `actual_complexity_score` to `.metta.yaml`, print a warning line to stderr in the format `Warning: this change touched N files -- <tier> workflow was recommended; finalize will proceed on <chosen-tier>`, leave the `workflow` field unchanged, perform no retroactive agent spawn, and allow verification to proceed on the original workflow. The command MUST exit 0. When `auto_accept_recommendation: true` is set, this decline path is never reached because Yes is auto-selected upstream.
Fulfills: US-5

### Scenario: decline_persists_actual_score_and_prints_warning
- GIVEN the post-implementation upscale prompt is visible for a `quick` run that recomputed to `standard`
- WHEN the user answers `n`
- THEN stderr contains `Warning: this change touched 5 files -- standard workflow was recommended; finalize will proceed on quick`, `.metta.yaml` `workflow` remains `quick`, and `actual_complexity_score` is persisted with `score`, `signals.file_count`, and `recommended_workflow`

### Scenario: decline_does_not_create_stories_or_spec
- GIVEN the decline path ran
- WHEN the artifact list is inspected
- THEN `stories.md` and `spec.md` were not created and no product or specifier agent was spawned

### Scenario: decline_exits_zero_and_verification_proceeds
- GIVEN the decline path ran
- WHEN `metta complete implementation` returns
- THEN the exit code is 0 and the lifecycle continues on the original workflow without blocking verification

### Scenario: non_tty_defaults_to_decline
- GIVEN a non-TTY execution environment and the post-implementation recomputed tier exceeds the chosen workflow
- WHEN `metta complete implementation` reaches the upscale decision point
- THEN no interactive prompt is printed, the decline path is taken, `actual_complexity_score` is persisted, and the warning is printed to stderr


## Requirement: AutoAcceptRecommendationFlag

The `metta propose`, `metta quick`, and `metta fix-issues` CLI commands MUST each accept `--auto` and `--accept-recommended` as aliased flags for the same option. When either alias is passed, the command MUST persist `auto_accept_recommendation: true` in `.metta.yaml` at change creation before any scoring occurs. This flag MUST govern all three adaptive-routing prompts: intent-time downscale, intent-time upscale, and post-implementation upscale. When `auto_accept_recommendation: true` is set, each prompt MUST be skipped silently and the Yes path MUST be taken automatically. When `--workflow <tier>` and `--auto` are combined, `--workflow` MUST set the initial workflow choice and `--auto` MUST control acceptance of all subsequent recomputation-driven recommendation shifts away from that choice.
Fulfills: US-6, US-9

### Scenario: auto_flag_persists_field
- GIVEN `metta propose --auto` is invoked
- WHEN the change metadata is written
- THEN `.metta.yaml` contains `auto_accept_recommendation: true`

### Scenario: auto_flag_skips_all_three_prompts
- GIVEN `auto_accept_recommendation: true` is persisted in `.metta.yaml`
- WHEN intent-time downscale, intent-time upscale, and post-implementation upscale trigger conditions are each met in turn
- THEN no interactive prompt is printed for any of the three triggers and the Yes path is taken for each

### Scenario: accept_recommended_alias_behaves_identically
- GIVEN `metta quick --accept-recommended` is invoked
- WHEN the change metadata is written
- THEN `.metta.yaml` contains `auto_accept_recommendation: true`, identical to the `--auto` alias

### Scenario: auto_with_workflow_honours_initial_choice
- GIVEN `metta propose --workflow standard --auto` is invoked for a trivially-scored change
- WHEN intent is written and intent-time scoring runs
- THEN `workflow` remains `standard` because `--workflow` pins the initial choice, and when post-implementation recompute later recommends a different tier, `--auto` auto-accepts that shift without prompting


## Requirement: OverrideRemainsAuthoritative

The existing `--workflow <tier>` flag on `metta propose`, `metta quick`, and `metta fix-issues` MUST continue to set the initial workflow choice without any change to its existing semantics. When `--workflow` is passed alone (without `--auto`), the intent-time adaptive prompts MUST still appear normally if the scored recommendation differs from the chosen tier. When `--workflow` is passed together with `--auto`, `--workflow` MUST govern the initial choice and `--auto` MUST govern acceptance of all subsequent adaptive recommendation shifts. The `--workflow` flag MUST NOT suppress or alter the advisory banner.
Fulfills: US-9

### Scenario: workflow_flag_alone_preserves_initial_choice_with_prompt
- GIVEN `metta propose --workflow standard` is invoked for a trivially-scored change without `--auto`
- WHEN intent is written and scoring completes
- THEN the `workflow` field in `.metta.yaml` starts as `standard` and a downscale prompt appears asking whether to collapse

### Scenario: workflow_without_auto_shows_intent_prompts_normally
- GIVEN `--workflow quick` is passed without `--auto` and a higher tier is recommended at intent time
- WHEN the upscale prompt appears and the user answers `n`
- THEN the workflow field remains `quick` and no further adaptive action is taken

### Scenario: workflow_with_auto_combination_is_predictable
- GIVEN `metta propose --workflow standard --auto` runs through implementation and post-implementation recompute recommends `full`
- WHEN the post-implementation upscale decision point is reached
- THEN no prompt is printed, `--auto` auto-accepts the upscale to `full`, and the retroactive agent spawn runs


## Requirement: IntraQuickDownsizeRule

When `recommended_workflow` is `trivial` and the user is running `/metta-quick`, the skill's trivial-detection gate SHOULD reduce the review and verify fan-out to exactly 1 quality reviewer and 1 tests/tsc verifier. No correctness reviewer, no security reviewer, and no dedicated goal-check verifier SHOULD be spawned for a trivially-scored `/metta-quick` run. Non-trivial `/metta-quick` runs SHOULD keep the default 3-reviewer and 3-verifier fan-out. This downsize rule SHOULD apply even when the user declined the auto-downscale prompt and chose to remain on the quick workflow. Tests and tsc MUST run on every change regardless of tier; this is not negotiable.
Fulfills: US-1

### Scenario: trivial_quick_run_uses_reduced_fan_out
- GIVEN a change whose `intent.md` `## Impact` section enumerates one file and the chosen workflow is `quick`
- WHEN `/metta-quick` reaches the review and verify stage
- THEN the skill spawns exactly 1 quality reviewer and 1 tests/tsc verifier and logs the downsize decision

### Scenario: trivial_fan_out_excludes_correctness_security_goalcheck
- GIVEN a trivially-scored `/metta-quick` run with reduced fan-out active
- WHEN the fan-out executes
- THEN no correctness reviewer, no security reviewer, and no dedicated goal-check verifier are spawned

### Scenario: non_trivial_quick_run_keeps_standard_fan_out
- GIVEN a change whose `intent.md` `## Impact` section enumerates four files and the workflow is `quick`
- WHEN `/metta-quick` reaches the review and verify stage
- THEN the skill spawns 3 reviewers and 3 verifiers with no downsize applied

### Scenario: tests_and_tsc_run_regardless_of_tier
- GIVEN any `/metta-quick` run regardless of complexity tier
- WHEN the verify stage executes
- THEN tests and tsc run on the change as a non-negotiable baseline even under trivial fan-out


## Requirement: ScoringRubricSpec

A rubric document MUST be created under `spec/specs/adaptive-workflow-tier-selection/spec.md` that formally documents: the v1 scoring signal (file count parsed from the `## Impact` section of `intent.md`), the four tier thresholds with their exact boundary values, the four prompt modes (intent-downscale, intent-upscale, post-implementation-upscale, intra-quick-downsize) and their trigger conditions, the three storage field names (`complexity_score`, `actual_complexity_score`, `auto_accept_recommendation`) and their Zod schema shapes, and explicit extension points naming the deferred signals (spec-surface, capability-count, line-delta) and deferred retroactive artifacts (research, design, tasks) as planned-but-not-yet-implemented. The `CLAUDE.md` Active Specs table MUST be updated to include the new rubric capability entry with its requirement count.
Fulfills: US-11

### Scenario: rubric_document_exists_with_required_sections
- GIVEN the change has landed
- WHEN a maintainer browses `spec/specs/adaptive-workflow-tier-selection/`
- THEN a spec document exists that contains sections covering the file-count signal, the four tier thresholds, the four prompt modes, and the three storage field names

### Scenario: rubric_names_deferred_signals_as_extension_points
- GIVEN a maintainer reads the rubric document
- WHEN they look for guidance on extending the scorer
- THEN the document explicitly identifies spec-surface signal, capability-count signal, and line-delta signal as deferred extension points, and identifies research, design, and tasks as deferred retroactive artifacts

### Scenario: claude_md_active_specs_table_updated
- GIVEN the rubric document exists under `spec/specs/`
- WHEN `CLAUDE.md` is regenerated or manually updated
- THEN the Active Specs table lists the new adaptive-workflow-tier-selection capability with its requirement count


## Requirement: ComplexityScoreComputation

The system MUST compute a complexity score as the final step of intent authoring, immediately after `intent.md` is written by `metta complete intent`. The scorer MUST parse the `## Impact` section of `intent.md`, count distinct file or module references, and map the count to a tier using the canonical threshold table. The computed score MUST be persisted to the change's `.metta.yaml` metadata block before `metta complete intent` returns. The scorer MUST NOT run at CLI invocation time and MUST NOT recompute when `intent.md` is subsequently edited. When `intent.md` has not been written, the scorer MUST produce no output and `complexity_score` MUST be absent from change metadata.
Fulfills: US-2, US-3, US-7, US-8, US-10

### Scenario: score_computed_from_impact_section
- GIVEN a change is running under `metta propose --workflow standard` and intent has just been written with an `## Impact` section referencing three distinct files
- WHEN `metta complete intent` reaches the scoring step
- THEN `.metta.yaml` contains a `complexity_score` object with `score: 1`, `signals.file_count: 3`, and `recommended_workflow: quick`

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


## Requirement: ComplexityScoreStorage

The `.metta.yaml` change-metadata Zod schema MUST declare `complexity_score`, `actual_complexity_score`, and `auto_accept_recommendation` as optional fields. All three fields MUST default to absent so that legacy `.metta.yaml` files that predate this feature parse without error. Every read and write path in `ArtifactStore` MUST handle the presence and absence of each field without throwing a Zod validation error. The `complexity_score` and `actual_complexity_score` objects MUST each contain the sub-fields `score` (numeric tier index 0-3), `signals.file_count` (integer), and `recommended_workflow` (string tier label). The `actual_complexity_score` field MUST never overwrite `complexity_score`; they MUST coexist as independent parallel fields.
Fulfills: US-4, US-6, US-8, US-10

### Scenario: schema_accepts_full_complexity_block
- GIVEN a `.metta.yaml` file that contains `complexity_score`, `actual_complexity_score`, and `auto_accept_recommendation: true`
- WHEN `ArtifactStore` reads the file and runs Zod validation
- THEN the parse succeeds and all three fields are available on the resulting change-metadata object

### Scenario: schema_accepts_legacy_file_without_fields
- GIVEN a `.metta.yaml` file that predates this feature and contains none of the three new fields
- WHEN `ArtifactStore` reads and validates the file
- THEN the parse succeeds, `complexity_score` is absent on the result, and no Zod error is thrown

### Scenario: actual_score_does_not_overwrite_original
- GIVEN a change that has `complexity_score` persisted with `recommended_workflow: quick`
- WHEN the post-implementation recompute writes `actual_complexity_score` with `recommended_workflow: standard`
- THEN `complexity_score.recommended_workflow` is still `quick` and both objects coexist under their respective keys in `.metta.yaml`


## Requirement: TierThresholds

The scorer MUST apply the following exclusive tier-boundary mapping to convert a file count to a workflow tier: `trivial` for counts less than or equal to 1, `quick` for counts of 2 or 3, `standard` for counts of 4 through 7 inclusive, and `full` for counts of 8 or more. These thresholds MUST be defined in a single authoritative location in the codebase and referenced by all scorer invocations. No scorer invocation MAY use hardcoded threshold values outside that authoritative definition. The scorer MUST represent the chosen tier as both a human-readable label and a numeric index (0, 1, 2, 3 respectively) in the persisted `complexity_score` object.
Fulfills: US-1, US-2, US-3, US-4, US-5, US-7, US-8

### Scenario: single_file_maps_to_trivial
- GIVEN the scorer is given a file count of 1
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `trivial` and `score` is `0`

### Scenario: two_files_maps_to_quick
- GIVEN the scorer is given a file count of 2
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `quick` and `score` is `1`

### Scenario: four_files_maps_to_standard
- GIVEN the scorer is given a file count of 4
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `standard` and `score` is `2`

### Scenario: eight_files_maps_to_full
- GIVEN the scorer is given a file count of 8
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `full` and `score` is `3`


## Requirement: StatusCommandSurface

The `metta status --change <name>` command MUST display the complexity score in both human-readable and `--json` output modes. In human-readable mode, when `complexity_score` is present, the output MUST include a `Complexity:` line in the format `Complexity: <tier> (N file[s]) -- recommended: <workflow>`. In `--json` mode, the JSON payload MUST include the full `complexity_score` object with `score`, `signals.file_count`, and `recommended_workflow` sub-fields. When `actual_complexity_score` is also present, `--json` mode MUST include both objects as distinct top-level fields in the change object. When `complexity_score` is absent, human mode MUST render an empty-state or `not yet scored` complexity line, and `--json` mode MUST include `"complexity_score": null` or omit the field without a Zod validation error. The command MUST exit 0 in all cases.
Fulfills: US-8, US-10

### Scenario: human_output_shows_complexity_line
- GIVEN a change with `complexity_score.recommended_workflow: trivial` and `signals.file_count: 1`
- WHEN `metta status --change <name>` runs in human mode
- THEN stdout contains the line `Complexity: trivial (1 file) -- recommended: trivial` and the exit code is 0

### Scenario: json_output_includes_complexity_object
- GIVEN a change with `complexity_score` persisted at `score: 2`, `signals.file_count: 5`, `recommended_workflow: standard`
- WHEN `metta status --change <name> --json` runs
- THEN the JSON payload contains `complexity_score` with `score`, `signals.file_count`, and `recommended_workflow` fields

### Scenario: json_output_includes_both_scores_when_present
- GIVEN a change that has both `complexity_score` from intent time and `actual_complexity_score` from the post-implementation recompute persisted
- WHEN `metta status --change <name> --json` runs
- THEN the JSON payload contains both `complexity_score` and `actual_complexity_score` as distinct top-level fields in the change object

### Scenario: absent_score_renders_without_error
- GIVEN a change with no `complexity_score` in `.metta.yaml`
- WHEN `metta status --change <name>` runs in both human and `--json` modes
- THEN the command exits 0, human output shows an empty-state complexity line, and the JSON payload includes `"complexity_score": null` or omits the field without a Zod error


## Requirement: InstructionsAdvisoryBanner

The `metta instructions` command MUST print a one-line advisory banner as the first line of stdout whenever `complexity_score` is present in the active change's `.metta.yaml`. The banner MUST reflect one of three states based on the relationship between `workflow` and `complexity_score.recommended_workflow`: agreement when they match (`Advisory: current workflow <tier> matches recommendation <tier>`), downscale-recommended when recommended is lower (`Advisory: current <chosen>, scored <recommended> -- downscale recommended`), or upscale-recommended when recommended is higher (`Advisory: current <chosen>, scored <recommended> -- upscale recommended`). The banner MUST be suppressed entirely when `complexity_score` is absent. When `--json` mode is active, the advisory banner MUST be written to stderr so that JSON stdout remains machine-parseable. The banner MUST NOT block execution or alter any artifact.
Fulfills: US-7, US-10

### Scenario: banner_agreement_state
- GIVEN a change with `workflow: quick` and `complexity_score.recommended_workflow: quick`
- WHEN `metta instructions` runs
- THEN the first line of stdout is `Advisory: current workflow quick matches recommendation quick` and execution continues normally

### Scenario: banner_downscale_state
- GIVEN a change with `workflow: standard` and `complexity_score.recommended_workflow: trivial`
- WHEN `metta instructions` runs
- THEN the first line of stdout is `Advisory: current standard, scored trivial -- downscale recommended`

### Scenario: banner_upscale_state
- GIVEN a change with `workflow: quick` and `complexity_score.recommended_workflow: standard`
- WHEN `metta instructions` runs
- THEN the first line of stdout is `Advisory: current quick, scored standard -- upscale recommended`

### Scenario: banner_suppressed_when_score_absent
- GIVEN a change with no `complexity_score` in `.metta.yaml`
- WHEN `metta instructions` runs
- THEN no `Advisory:` line appears in stdout and the command exits 0


## Requirement: AutoDownscalePromptAtIntent

When `metta complete intent` runs under `metta propose` or `metta fix-issues` and `recommended_workflow` is a lower tier than the chosen workflow, an interactive `[y/N]` prompt MUST be printed to stdout with the text `Scored as <tier> (N files) -- collapse workflow to /metta-<tier>? [y/N]`. The default answer MUST be No. On Yes, `metta complete intent` MUST update the `workflow` field in `.metta.yaml` to the recommended tier AND remove from the artifact list any planning artifacts (stories, spec, research, design, tasks) that have not yet been authored (status not `complete`). On No, the original workflow and artifact list MUST remain unchanged. The prompt MUST NOT appear when the chosen workflow already matches or is lower than the recommended tier. When the environment is non-TTY, the prompt MUST be skipped and No MUST be assumed; the advisory banner MUST still be emitted. When `auto_accept_recommendation: true` is set in `.metta.yaml`, the prompt MUST be skipped and Yes MUST be auto-selected. The downscale prompt MUST NOT fire for `/metta-quick` runs because quick is already the smallest named interactive workflow.
Fulfills: US-2, US-6

### Scenario: downscale_prompt_appears_on_oversized_propose
- GIVEN `metta propose --workflow standard` has just written `intent.md` and the scored tier is `trivial`
- WHEN scoring completes
- THEN the CLI prints `Scored as trivial (1 files) -- collapse workflow to /metta-trivial? [y/N]` with default No and the process waits for input

### Scenario: downscale_yes_mutates_workflow_and_drops_artifacts
- GIVEN the downscale prompt is visible for a `standard` run scored as `trivial`
- WHEN the user answers `y`
- THEN `.metta.yaml` `workflow` is updated to `trivial` and unstarted planning artifacts (stories, spec, research, design, tasks) are removed from the change's artifact list

### Scenario: downscale_prompt_suppressed_when_workflow_matches
- GIVEN `metta propose --workflow quick` has just written `intent.md` and the scored tier is `quick`
- WHEN scoring completes
- THEN no downscale prompt appears and exit code is 0

### Scenario: downscale_prompt_skipped_non_tty
- GIVEN a non-TTY execution environment and `metta fix-issues` has written `intent.md` with scored tier `trivial` under `standard` workflow
- WHEN scoring completes
- THEN no interactive prompt is printed, No is assumed, the workflow field is unchanged, and the advisory banner is still emitted


## Requirement: AutoUpscalePromptAtIntent

When `metta complete intent` runs and `recommended_workflow` is a higher tier than the chosen workflow, an interactive `[y/N]` prompt MUST be printed to stdout with the text `Scored as <tier> (N files) -- promote workflow to /metta-<tier>? [y/N]`. The default answer MUST be No. On Yes, `metta complete intent` MUST update the `workflow` field in `.metta.yaml` to the recommended tier AND insert any stages present in the target workflow YAML definition but absent from the current artifact list as pending artifacts before implementation runs. The artifact diff MUST be computed by loading both the current and target workflow YAML definitions and comparing stage lists. On No, the original workflow and artifact list MUST remain unchanged. The prompt MUST NOT appear when the chosen workflow already matches or exceeds the recommendation. When the environment is non-TTY, the prompt MUST be skipped and No MUST be assumed. When `auto_accept_recommendation: true` is set, the prompt MUST be skipped and Yes MUST be auto-selected.
Fulfills: US-3, US-6

### Scenario: upscale_prompt_appears_on_undersized_quick
- GIVEN `metta quick` has just written `intent.md` listing five files and the scored tier is `standard`
- WHEN scoring completes
- THEN the CLI prints `Scored as standard (5 files) -- promote workflow to /metta-standard? [y/N]` with default No

### Scenario: upscale_yes_mutates_workflow_and_inserts_artifacts
- GIVEN the upscale prompt is visible for a `quick` run scored as `standard`
- WHEN the user answers `y`
- THEN `.metta.yaml` `workflow` is updated to `standard` and the stages present in the standard workflow YAML definition but absent from the current artifact list (stories, spec, research, design, tasks) are inserted as pending artifacts before implementation runs

### Scenario: upscale_prompt_suppressed_when_workflow_exceeds_recommendation
- GIVEN `metta propose --workflow full` has just written `intent.md` and the scored tier is `standard`
- WHEN scoring completes
- THEN no upscale prompt appears and exit code is 0

### Scenario: upscale_auto_accept_skips_prompt
- GIVEN `auto_accept_recommendation: true` is persisted and `metta quick` has written `intent.md` scoring `standard`
- WHEN scoring completes
- THEN no prompt is printed, the `workflow` field is updated to `standard`, and missing planning artifacts are inserted into the artifact list


## Requirement: PostImplementationUpscalePromptAccept

When `metta complete implementation` writes `summary.md`, the scorer MUST recompute the file count from the `## Files` section of `summary.md` using the same tier thresholds. If the recomputed tier exceeds the currently chosen workflow tier, an interactive `[y/N]` prompt MUST be printed: `Implementation touched N files -- promote to /metta-<tier> and retroactively author stories + spec? [y/N]`. The default answer MUST be No. On Yes, the command MUST: (1) update the `workflow` field in `.metta.yaml` to the recomputed tier, (2) spawn a metta-product agent to author `stories.md` using `intent.md`, `summary.md`, and the actual code as inputs, (3) spawn a metta-specifier agent (metta-proposer subagent type) to author `spec.md` using the same inputs, (4) insert both `stories` and `spec` artifacts into the artifact list and mark them `complete`, and (5) persist `actual_complexity_score`. Subsequent review and verify spawns MUST use the fan-out appropriate for the promoted tier. Research, design, and tasks MUST NOT be retroactively authored. When `auto_accept_recommendation: true` is set, the prompt MUST be skipped and Yes MUST be auto-selected.
Fulfills: US-4, US-6

### Scenario: post_impl_prompt_appears_when_recomputed_tier_exceeds_workflow
- GIVEN a `/metta-quick` change whose `summary.md` `## Files` section lists five distinct files and the chosen workflow is `quick`
- WHEN `metta complete implementation` runs the recompute step
- THEN the CLI prints `Implementation touched 5 files -- promote to /metta-standard and retroactively author stories + spec? [y/N]` with default No

### Scenario: post_impl_yes_spawns_agents_and_updates_metadata
- GIVEN the post-implementation upscale prompt is visible and the user answers `y`
- WHEN the retroactive path runs to completion
- THEN `.metta.yaml` `workflow` equals `standard`, `stories.md` and `spec.md` exist in the change directory authored by the metta-product and metta-specifier agents, both artifacts are marked `complete` in the artifact list, and `actual_complexity_score` is persisted

### Scenario: post_impl_yes_uses_promoted_fan_out
- GIVEN the retroactive path completed and workflow was promoted from `quick` to `standard`
- WHEN the skill orchestrator spawns review and verify
- THEN the fan-out matches the standard tier (3 reviewers + 3 verifiers) rather than the quick fan-out

### Scenario: post_impl_no_research_design_tasks_authored
- GIVEN the post-implementation upscale Yes path ran
- WHEN the artifact list is inspected
- THEN `research.md`, `design.md`, and `tasks.md` were not created and no corresponding agents were spawned


## Requirement: PostImplementationUpscalePromptDecline

When the post-implementation upscale prompt trigger fires (recomputed tier exceeds chosen workflow) and the user answers No, or when the environment is non-TTY, the command MUST persist `actual_complexity_score` to `.metta.yaml`, print a warning line to stderr in the format `Warning: this change touched N files -- <tier> workflow was recommended; finalize will proceed on <chosen-tier>`, leave the `workflow` field unchanged, perform no retroactive agent spawn, and allow verification to proceed on the original workflow. The command MUST exit 0. When `auto_accept_recommendation: true` is set, this decline path is never reached because Yes is auto-selected upstream.
Fulfills: US-5

### Scenario: decline_persists_actual_score_and_prints_warning
- GIVEN the post-implementation upscale prompt is visible for a `quick` run that recomputed to `standard`
- WHEN the user answers `n`
- THEN stderr contains `Warning: this change touched 5 files -- standard workflow was recommended; finalize will proceed on quick`, `.metta.yaml` `workflow` remains `quick`, and `actual_complexity_score` is persisted with `score`, `signals.file_count`, and `recommended_workflow`

### Scenario: decline_does_not_create_stories_or_spec
- GIVEN the decline path ran
- WHEN the artifact list is inspected
- THEN `stories.md` and `spec.md` were not created and no product or specifier agent was spawned

### Scenario: decline_exits_zero_and_verification_proceeds
- GIVEN the decline path ran
- WHEN `metta complete implementation` returns
- THEN the exit code is 0 and the lifecycle continues on the original workflow without blocking verification

### Scenario: non_tty_defaults_to_decline
- GIVEN a non-TTY execution environment and the post-implementation recomputed tier exceeds the chosen workflow
- WHEN `metta complete implementation` reaches the upscale decision point
- THEN no interactive prompt is printed, the decline path is taken, `actual_complexity_score` is persisted, and the warning is printed to stderr


## Requirement: AutoAcceptRecommendationFlag

The `metta propose`, `metta quick`, and `metta fix-issues` CLI commands MUST each accept `--auto` and `--accept-recommended` as aliased flags for the same option. When either alias is passed, the command MUST persist `auto_accept_recommendation: true` in `.metta.yaml` at change creation before any scoring occurs. This flag MUST govern all three adaptive-routing prompts: intent-time downscale, intent-time upscale, and post-implementation upscale. When `auto_accept_recommendation: true` is set, each prompt MUST be skipped silently and the Yes path MUST be taken automatically. When `--workflow <tier>` and `--auto` are combined, `--workflow` MUST set the initial workflow choice and `--auto` MUST control acceptance of all subsequent recomputation-driven recommendation shifts away from that choice.
Fulfills: US-6, US-9

### Scenario: auto_flag_persists_field
- GIVEN `metta propose --auto` is invoked
- WHEN the change metadata is written
- THEN `.metta.yaml` contains `auto_accept_recommendation: true`

### Scenario: auto_flag_skips_all_three_prompts
- GIVEN `auto_accept_recommendation: true` is persisted in `.metta.yaml`
- WHEN intent-time downscale, intent-time upscale, and post-implementation upscale trigger conditions are each met in turn
- THEN no interactive prompt is printed for any of the three triggers and the Yes path is taken for each

### Scenario: accept_recommended_alias_behaves_identically
- GIVEN `metta quick --accept-recommended` is invoked
- WHEN the change metadata is written
- THEN `.metta.yaml` contains `auto_accept_recommendation: true`, identical to the `--auto` alias

### Scenario: auto_with_workflow_honours_initial_choice
- GIVEN `metta propose --workflow standard --auto` is invoked for a trivially-scored change
- WHEN intent is written and intent-time scoring runs
- THEN `workflow` remains `standard` because `--workflow` pins the initial choice, and when post-implementation recompute later recommends a different tier, `--auto` auto-accepts that shift without prompting


## Requirement: OverrideRemainsAuthoritative

The existing `--workflow <tier>` flag on `metta propose`, `metta quick`, and `metta fix-issues` MUST continue to set the initial workflow choice without any change to its existing semantics. When `--workflow` is passed alone (without `--auto`), the intent-time adaptive prompts MUST still appear normally if the scored recommendation differs from the chosen tier. When `--workflow` is passed together with `--auto`, `--workflow` MUST govern the initial choice and `--auto` MUST govern acceptance of all subsequent adaptive recommendation shifts. The `--workflow` flag MUST NOT suppress or alter the advisory banner.
Fulfills: US-9

### Scenario: workflow_flag_alone_preserves_initial_choice_with_prompt
- GIVEN `metta propose --workflow standard` is invoked for a trivially-scored change without `--auto`
- WHEN intent is written and scoring completes
- THEN the `workflow` field in `.metta.yaml` starts as `standard` and a downscale prompt appears asking whether to collapse

### Scenario: workflow_without_auto_shows_intent_prompts_normally
- GIVEN `--workflow quick` is passed without `--auto` and a higher tier is recommended at intent time
- WHEN the upscale prompt appears and the user answers `n`
- THEN the workflow field remains `quick` and no further adaptive action is taken

### Scenario: workflow_with_auto_combination_is_predictable
- GIVEN `metta propose --workflow standard --auto` runs through implementation and post-implementation recompute recommends `full`
- WHEN the post-implementation upscale decision point is reached
- THEN no prompt is printed, `--auto` auto-accepts the upscale to `full`, and the retroactive agent spawn runs


## Requirement: IntraQuickDownsizeRule

When `recommended_workflow` is `trivial` and the user is running `/metta-quick`, the skill's trivial-detection gate SHOULD reduce the review and verify fan-out to exactly 1 quality reviewer and 1 tests/tsc verifier. No correctness reviewer, no security reviewer, and no dedicated goal-check verifier SHOULD be spawned for a trivially-scored `/metta-quick` run. Non-trivial `/metta-quick` runs SHOULD keep the default 3-reviewer and 3-verifier fan-out. This downsize rule SHOULD apply even when the user declined the auto-downscale prompt and chose to remain on the quick workflow. Tests and tsc MUST run on every change regardless of tier; this is not negotiable.
Fulfills: US-1

### Scenario: trivial_quick_run_uses_reduced_fan_out
- GIVEN a change whose `intent.md` `## Impact` section enumerates one file and the chosen workflow is `quick`
- WHEN `/metta-quick` reaches the review and verify stage
- THEN the skill spawns exactly 1 quality reviewer and 1 tests/tsc verifier and logs the downsize decision

### Scenario: trivial_fan_out_excludes_correctness_security_goalcheck
- GIVEN a trivially-scored `/metta-quick` run with reduced fan-out active
- WHEN the fan-out executes
- THEN no correctness reviewer, no security reviewer, and no dedicated goal-check verifier are spawned

### Scenario: non_trivial_quick_run_keeps_standard_fan_out
- GIVEN a change whose `intent.md` `## Impact` section enumerates four files and the workflow is `quick`
- WHEN `/metta-quick` reaches the review and verify stage
- THEN the skill spawns 3 reviewers and 3 verifiers with no downsize applied

### Scenario: tests_and_tsc_run_regardless_of_tier
- GIVEN any `/metta-quick` run regardless of complexity tier
- WHEN the verify stage executes
- THEN tests and tsc run on the change as a non-negotiable baseline even under trivial fan-out


## Requirement: ScoringRubricSpec

A rubric document MUST be created under `spec/specs/adaptive-workflow-tier-selection/spec.md` that formally documents: the v1 scoring signal (file count parsed from the `## Impact` section of `intent.md`), the four tier thresholds with their exact boundary values, the four prompt modes (intent-downscale, intent-upscale, post-implementation-upscale, intra-quick-downsize) and their trigger conditions, the three storage field names (`complexity_score`, `actual_complexity_score`, `auto_accept_recommendation`) and their Zod schema shapes, and explicit extension points naming the deferred signals (spec-surface, capability-count, line-delta) and deferred retroactive artifacts (research, design, tasks) as planned-but-not-yet-implemented. The `CLAUDE.md` Active Specs table MUST be updated to include the new rubric capability entry with its requirement count.
Fulfills: US-11

### Scenario: rubric_document_exists_with_required_sections
- GIVEN the change has landed
- WHEN a maintainer browses `spec/specs/adaptive-workflow-tier-selection/`
- THEN a spec document exists that contains sections covering the file-count signal, the four tier thresholds, the four prompt modes, and the three storage field names

### Scenario: rubric_names_deferred_signals_as_extension_points
- GIVEN a maintainer reads the rubric document
- WHEN they look for guidance on extending the scorer
- THEN the document explicitly identifies spec-surface signal, capability-count signal, and line-delta signal as deferred extension points, and identifies research, design, and tasks as deferred retroactive artifacts

### Scenario: claude_md_active_specs_table_updated
- GIVEN the rubric document exists under `spec/specs/`
- WHEN `CLAUDE.md` is regenerated or manually updated
- THEN the Active Specs table lists the new adaptive-workflow-tier-selection capability with its requirement count


## Requirement: ComplexityScoreComputation

The system MUST compute a complexity score as the final step of intent authoring, immediately after `intent.md` is written by `metta complete intent`. The scorer MUST parse the `## Impact` section of `intent.md`, count distinct file or module references, and map the count to a tier using the canonical threshold table. The computed score MUST be persisted to the change's `.metta.yaml` metadata block before `metta complete intent` returns. The scorer MUST NOT run at CLI invocation time and MUST NOT recompute when `intent.md` is subsequently edited. When `intent.md` has not been written, the scorer MUST produce no output and `complexity_score` MUST be absent from change metadata.
Fulfills: US-2, US-3, US-7, US-8, US-10

### Scenario: score_computed_from_impact_section
- GIVEN a change is running under `metta propose --workflow standard` and intent has just been written with an `## Impact` section referencing three distinct files
- WHEN `metta complete intent` reaches the scoring step
- THEN `.metta.yaml` contains a `complexity_score` object with `score: 1`, `signals.file_count: 3`, and `recommended_workflow: quick`

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


## Requirement: ComplexityScoreStorage

The `.metta.yaml` change-metadata Zod schema MUST declare `complexity_score`, `actual_complexity_score`, and `auto_accept_recommendation` as optional fields. All three fields MUST default to absent so that legacy `.metta.yaml` files that predate this feature parse without error. Every read and write path in `ArtifactStore` MUST handle the presence and absence of each field without throwing a Zod validation error. The `complexity_score` and `actual_complexity_score` objects MUST each contain the sub-fields `score` (numeric tier index 0-3), `signals.file_count` (integer), and `recommended_workflow` (string tier label). The `actual_complexity_score` field MUST never overwrite `complexity_score`; they MUST coexist as independent parallel fields.
Fulfills: US-4, US-6, US-8, US-10

### Scenario: schema_accepts_full_complexity_block
- GIVEN a `.metta.yaml` file that contains `complexity_score`, `actual_complexity_score`, and `auto_accept_recommendation: true`
- WHEN `ArtifactStore` reads the file and runs Zod validation
- THEN the parse succeeds and all three fields are available on the resulting change-metadata object

### Scenario: schema_accepts_legacy_file_without_fields
- GIVEN a `.metta.yaml` file that predates this feature and contains none of the three new fields
- WHEN `ArtifactStore` reads and validates the file
- THEN the parse succeeds, `complexity_score` is absent on the result, and no Zod error is thrown

### Scenario: actual_score_does_not_overwrite_original
- GIVEN a change that has `complexity_score` persisted with `recommended_workflow: quick`
- WHEN the post-implementation recompute writes `actual_complexity_score` with `recommended_workflow: standard`
- THEN `complexity_score.recommended_workflow` is still `quick` and both objects coexist under their respective keys in `.metta.yaml`


## Requirement: TierThresholds

The scorer MUST apply the following exclusive tier-boundary mapping to convert a file count to a workflow tier: `trivial` for counts less than or equal to 1, `quick` for counts of 2 or 3, `standard` for counts of 4 through 7 inclusive, and `full` for counts of 8 or more. These thresholds MUST be defined in a single authoritative location in the codebase and referenced by all scorer invocations. No scorer invocation MAY use hardcoded threshold values outside that authoritative definition. The scorer MUST represent the chosen tier as both a human-readable label and a numeric index (0, 1, 2, 3 respectively) in the persisted `complexity_score` object.
Fulfills: US-1, US-2, US-3, US-4, US-5, US-7, US-8

### Scenario: single_file_maps_to_trivial
- GIVEN the scorer is given a file count of 1
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `trivial` and `score` is `0`

### Scenario: two_files_maps_to_quick
- GIVEN the scorer is given a file count of 2
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `quick` and `score` is `1`

### Scenario: four_files_maps_to_standard
- GIVEN the scorer is given a file count of 4
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `standard` and `score` is `2`

### Scenario: eight_files_maps_to_full
- GIVEN the scorer is given a file count of 8
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `full` and `score` is `3`


## Requirement: StatusCommandSurface

The `metta status --change <name>` command MUST display the complexity score in both human-readable and `--json` output modes. In human-readable mode, when `complexity_score` is present, the output MUST include a `Complexity:` line in the format `Complexity: <tier> (N file[s]) -- recommended: <workflow>`. In `--json` mode, the JSON payload MUST include the full `complexity_score` object with `score`, `signals.file_count`, and `recommended_workflow` sub-fields. When `actual_complexity_score` is also present, `--json` mode MUST include both objects as distinct top-level fields in the change object. When `complexity_score` is absent, human mode MUST render an empty-state or `not yet scored` complexity line, and `--json` mode MUST include `"complexity_score": null` or omit the field without a Zod validation error. The command MUST exit 0 in all cases.
Fulfills: US-8, US-10

### Scenario: human_output_shows_complexity_line
- GIVEN a change with `complexity_score.recommended_workflow: trivial` and `signals.file_count: 1`
- WHEN `metta status --change <name>` runs in human mode
- THEN stdout contains the line `Complexity: trivial (1 file) -- recommended: trivial` and the exit code is 0

### Scenario: json_output_includes_complexity_object
- GIVEN a change with `complexity_score` persisted at `score: 2`, `signals.file_count: 5`, `recommended_workflow: standard`
- WHEN `metta status --change <name> --json` runs
- THEN the JSON payload contains `complexity_score` with `score`, `signals.file_count`, and `recommended_workflow` fields

### Scenario: json_output_includes_both_scores_when_present
- GIVEN a change that has both `complexity_score` from intent time and `actual_complexity_score` from the post-implementation recompute persisted
- WHEN `metta status --change <name> --json` runs
- THEN the JSON payload contains both `complexity_score` and `actual_complexity_score` as distinct top-level fields in the change object

### Scenario: absent_score_renders_without_error
- GIVEN a change with no `complexity_score` in `.metta.yaml`
- WHEN `metta status --change <name>` runs in both human and `--json` modes
- THEN the command exits 0, human output shows an empty-state complexity line, and the JSON payload includes `"complexity_score": null` or omits the field without a Zod error


## Requirement: InstructionsAdvisoryBanner

The `metta instructions` command MUST print a one-line advisory banner as the first line of stdout whenever `complexity_score` is present in the active change's `.metta.yaml`. The banner MUST reflect one of three states based on the relationship between `workflow` and `complexity_score.recommended_workflow`: agreement when they match (`Advisory: current workflow <tier> matches recommendation <tier>`), downscale-recommended when recommended is lower (`Advisory: current <chosen>, scored <recommended> -- downscale recommended`), or upscale-recommended when recommended is higher (`Advisory: current <chosen>, scored <recommended> -- upscale recommended`). The banner MUST be suppressed entirely when `complexity_score` is absent. When `--json` mode is active, the advisory banner MUST be written to stderr so that JSON stdout remains machine-parseable. The banner MUST NOT block execution or alter any artifact.
Fulfills: US-7, US-10

### Scenario: banner_agreement_state
- GIVEN a change with `workflow: quick` and `complexity_score.recommended_workflow: quick`
- WHEN `metta instructions` runs
- THEN the first line of stdout is `Advisory: current workflow quick matches recommendation quick` and execution continues normally

### Scenario: banner_downscale_state
- GIVEN a change with `workflow: standard` and `complexity_score.recommended_workflow: trivial`
- WHEN `metta instructions` runs
- THEN the first line of stdout is `Advisory: current standard, scored trivial -- downscale recommended`

### Scenario: banner_upscale_state
- GIVEN a change with `workflow: quick` and `complexity_score.recommended_workflow: standard`
- WHEN `metta instructions` runs
- THEN the first line of stdout is `Advisory: current quick, scored standard -- upscale recommended`

### Scenario: banner_suppressed_when_score_absent
- GIVEN a change with no `complexity_score` in `.metta.yaml`
- WHEN `metta instructions` runs
- THEN no `Advisory:` line appears in stdout and the command exits 0


## Requirement: AutoDownscalePromptAtIntent

When `metta complete intent` runs under `metta propose` or `metta fix-issues` and `recommended_workflow` is a lower tier than the chosen workflow, an interactive `[y/N]` prompt MUST be printed to stdout with the text `Scored as <tier> (N files) -- collapse workflow to /metta-<tier>? [y/N]`. The default answer MUST be No. On Yes, `metta complete intent` MUST update the `workflow` field in `.metta.yaml` to the recommended tier AND remove from the artifact list any planning artifacts (stories, spec, research, design, tasks) that have not yet been authored (status not `complete`). On No, the original workflow and artifact list MUST remain unchanged. The prompt MUST NOT appear when the chosen workflow already matches or is lower than the recommended tier. When the environment is non-TTY, the prompt MUST be skipped and No MUST be assumed; the advisory banner MUST still be emitted. When `auto_accept_recommendation: true` is set in `.metta.yaml`, the prompt MUST be skipped and Yes MUST be auto-selected. The downscale prompt MUST NOT fire for `/metta-quick` runs because quick is already the smallest named interactive workflow.
Fulfills: US-2, US-6

### Scenario: downscale_prompt_appears_on_oversized_propose
- GIVEN `metta propose --workflow standard` has just written `intent.md` and the scored tier is `trivial`
- WHEN scoring completes
- THEN the CLI prints `Scored as trivial (1 files) -- collapse workflow to /metta-trivial? [y/N]` with default No and the process waits for input

### Scenario: downscale_yes_mutates_workflow_and_drops_artifacts
- GIVEN the downscale prompt is visible for a `standard` run scored as `trivial`
- WHEN the user answers `y`
- THEN `.metta.yaml` `workflow` is updated to `trivial` and unstarted planning artifacts (stories, spec, research, design, tasks) are removed from the change's artifact list

### Scenario: downscale_prompt_suppressed_when_workflow_matches
- GIVEN `metta propose --workflow quick` has just written `intent.md` and the scored tier is `quick`
- WHEN scoring completes
- THEN no downscale prompt appears and exit code is 0

### Scenario: downscale_prompt_skipped_non_tty
- GIVEN a non-TTY execution environment and `metta fix-issues` has written `intent.md` with scored tier `trivial` under `standard` workflow
- WHEN scoring completes
- THEN no interactive prompt is printed, No is assumed, the workflow field is unchanged, and the advisory banner is still emitted


## Requirement: AutoUpscalePromptAtIntent

When `metta complete intent` runs and `recommended_workflow` is a higher tier than the chosen workflow, an interactive `[y/N]` prompt MUST be printed to stdout with the text `Scored as <tier> (N files) -- promote workflow to /metta-<tier>? [y/N]`. The default answer MUST be No. On Yes, `metta complete intent` MUST update the `workflow` field in `.metta.yaml` to the recommended tier AND insert any stages present in the target workflow YAML definition but absent from the current artifact list as pending artifacts before implementation runs. The artifact diff MUST be computed by loading both the current and target workflow YAML definitions and comparing stage lists. On No, the original workflow and artifact list MUST remain unchanged. The prompt MUST NOT appear when the chosen workflow already matches or exceeds the recommendation. When the environment is non-TTY, the prompt MUST be skipped and No MUST be assumed. When `auto_accept_recommendation: true` is set, the prompt MUST be skipped and Yes MUST be auto-selected.
Fulfills: US-3, US-6

### Scenario: upscale_prompt_appears_on_undersized_quick
- GIVEN `metta quick` has just written `intent.md` listing five files and the scored tier is `standard`
- WHEN scoring completes
- THEN the CLI prints `Scored as standard (5 files) -- promote workflow to /metta-standard? [y/N]` with default No

### Scenario: upscale_yes_mutates_workflow_and_inserts_artifacts
- GIVEN the upscale prompt is visible for a `quick` run scored as `standard`
- WHEN the user answers `y`
- THEN `.metta.yaml` `workflow` is updated to `standard` and the stages present in the standard workflow YAML definition but absent from the current artifact list (stories, spec, research, design, tasks) are inserted as pending artifacts before implementation runs

### Scenario: upscale_prompt_suppressed_when_workflow_exceeds_recommendation
- GIVEN `metta propose --workflow full` has just written `intent.md` and the scored tier is `standard`
- WHEN scoring completes
- THEN no upscale prompt appears and exit code is 0

### Scenario: upscale_auto_accept_skips_prompt
- GIVEN `auto_accept_recommendation: true` is persisted and `metta quick` has written `intent.md` scoring `standard`
- WHEN scoring completes
- THEN no prompt is printed, the `workflow` field is updated to `standard`, and missing planning artifacts are inserted into the artifact list


## Requirement: PostImplementationUpscalePromptAccept

When `metta complete implementation` writes `summary.md`, the scorer MUST recompute the file count from the `## Files` section of `summary.md` using the same tier thresholds. If the recomputed tier exceeds the currently chosen workflow tier, an interactive `[y/N]` prompt MUST be printed: `Implementation touched N files -- promote to /metta-<tier> and retroactively author stories + spec? [y/N]`. The default answer MUST be No. On Yes, the command MUST: (1) update the `workflow` field in `.metta.yaml` to the recomputed tier, (2) spawn a metta-product agent to author `stories.md` using `intent.md`, `summary.md`, and the actual code as inputs, (3) spawn a metta-specifier agent (metta-proposer subagent type) to author `spec.md` using the same inputs, (4) insert both `stories` and `spec` artifacts into the artifact list and mark them `complete`, and (5) persist `actual_complexity_score`. Subsequent review and verify spawns MUST use the fan-out appropriate for the promoted tier. Research, design, and tasks MUST NOT be retroactively authored. When `auto_accept_recommendation: true` is set, the prompt MUST be skipped and Yes MUST be auto-selected.
Fulfills: US-4, US-6

### Scenario: post_impl_prompt_appears_when_recomputed_tier_exceeds_workflow
- GIVEN a `/metta-quick` change whose `summary.md` `## Files` section lists five distinct files and the chosen workflow is `quick`
- WHEN `metta complete implementation` runs the recompute step
- THEN the CLI prints `Implementation touched 5 files -- promote to /metta-standard and retroactively author stories + spec? [y/N]` with default No

### Scenario: post_impl_yes_spawns_agents_and_updates_metadata
- GIVEN the post-implementation upscale prompt is visible and the user answers `y`
- WHEN the retroactive path runs to completion
- THEN `.metta.yaml` `workflow` equals `standard`, `stories.md` and `spec.md` exist in the change directory authored by the metta-product and metta-specifier agents, both artifacts are marked `complete` in the artifact list, and `actual_complexity_score` is persisted

### Scenario: post_impl_yes_uses_promoted_fan_out
- GIVEN the retroactive path completed and workflow was promoted from `quick` to `standard`
- WHEN the skill orchestrator spawns review and verify
- THEN the fan-out matches the standard tier (3 reviewers + 3 verifiers) rather than the quick fan-out

### Scenario: post_impl_no_research_design_tasks_authored
- GIVEN the post-implementation upscale Yes path ran
- WHEN the artifact list is inspected
- THEN `research.md`, `design.md`, and `tasks.md` were not created and no corresponding agents were spawned


## Requirement: PostImplementationUpscalePromptDecline

When the post-implementation upscale prompt trigger fires (recomputed tier exceeds chosen workflow) and the user answers No, or when the environment is non-TTY, the command MUST persist `actual_complexity_score` to `.metta.yaml`, print a warning line to stderr in the format `Warning: this change touched N files -- <tier> workflow was recommended; finalize will proceed on <chosen-tier>`, leave the `workflow` field unchanged, perform no retroactive agent spawn, and allow verification to proceed on the original workflow. The command MUST exit 0. When `auto_accept_recommendation: true` is set, this decline path is never reached because Yes is auto-selected upstream.
Fulfills: US-5

### Scenario: decline_persists_actual_score_and_prints_warning
- GIVEN the post-implementation upscale prompt is visible for a `quick` run that recomputed to `standard`
- WHEN the user answers `n`
- THEN stderr contains `Warning: this change touched 5 files -- standard workflow was recommended; finalize will proceed on quick`, `.metta.yaml` `workflow` remains `quick`, and `actual_complexity_score` is persisted with `score`, `signals.file_count`, and `recommended_workflow`

### Scenario: decline_does_not_create_stories_or_spec
- GIVEN the decline path ran
- WHEN the artifact list is inspected
- THEN `stories.md` and `spec.md` were not created and no product or specifier agent was spawned

### Scenario: decline_exits_zero_and_verification_proceeds
- GIVEN the decline path ran
- WHEN `metta complete implementation` returns
- THEN the exit code is 0 and the lifecycle continues on the original workflow without blocking verification

### Scenario: non_tty_defaults_to_decline
- GIVEN a non-TTY execution environment and the post-implementation recomputed tier exceeds the chosen workflow
- WHEN `metta complete implementation` reaches the upscale decision point
- THEN no interactive prompt is printed, the decline path is taken, `actual_complexity_score` is persisted, and the warning is printed to stderr


## Requirement: AutoAcceptRecommendationFlag

The `metta propose`, `metta quick`, and `metta fix-issues` CLI commands MUST each accept `--auto` and `--accept-recommended` as aliased flags for the same option. When either alias is passed, the command MUST persist `auto_accept_recommendation: true` in `.metta.yaml` at change creation before any scoring occurs. This flag MUST govern all three adaptive-routing prompts: intent-time downscale, intent-time upscale, and post-implementation upscale. When `auto_accept_recommendation: true` is set, each prompt MUST be skipped silently and the Yes path MUST be taken automatically. When `--workflow <tier>` and `--auto` are combined, `--workflow` MUST set the initial workflow choice and `--auto` MUST control acceptance of all subsequent recomputation-driven recommendation shifts away from that choice.
Fulfills: US-6, US-9

### Scenario: auto_flag_persists_field
- GIVEN `metta propose --auto` is invoked
- WHEN the change metadata is written
- THEN `.metta.yaml` contains `auto_accept_recommendation: true`

### Scenario: auto_flag_skips_all_three_prompts
- GIVEN `auto_accept_recommendation: true` is persisted in `.metta.yaml`
- WHEN intent-time downscale, intent-time upscale, and post-implementation upscale trigger conditions are each met in turn
- THEN no interactive prompt is printed for any of the three triggers and the Yes path is taken for each

### Scenario: accept_recommended_alias_behaves_identically
- GIVEN `metta quick --accept-recommended` is invoked
- WHEN the change metadata is written
- THEN `.metta.yaml` contains `auto_accept_recommendation: true`, identical to the `--auto` alias

### Scenario: auto_with_workflow_honours_initial_choice
- GIVEN `metta propose --workflow standard --auto` is invoked for a trivially-scored change
- WHEN intent is written and intent-time scoring runs
- THEN `workflow` remains `standard` because `--workflow` pins the initial choice, and when post-implementation recompute later recommends a different tier, `--auto` auto-accepts that shift without prompting


## Requirement: OverrideRemainsAuthoritative

The existing `--workflow <tier>` flag on `metta propose`, `metta quick`, and `metta fix-issues` MUST continue to set the initial workflow choice without any change to its existing semantics. When `--workflow` is passed alone (without `--auto`), the intent-time adaptive prompts MUST still appear normally if the scored recommendation differs from the chosen tier. When `--workflow` is passed together with `--auto`, `--workflow` MUST govern the initial choice and `--auto` MUST govern acceptance of all subsequent adaptive recommendation shifts. The `--workflow` flag MUST NOT suppress or alter the advisory banner.
Fulfills: US-9

### Scenario: workflow_flag_alone_preserves_initial_choice_with_prompt
- GIVEN `metta propose --workflow standard` is invoked for a trivially-scored change without `--auto`
- WHEN intent is written and scoring completes
- THEN the `workflow` field in `.metta.yaml` starts as `standard` and a downscale prompt appears asking whether to collapse

### Scenario: workflow_without_auto_shows_intent_prompts_normally
- GIVEN `--workflow quick` is passed without `--auto` and a higher tier is recommended at intent time
- WHEN the upscale prompt appears and the user answers `n`
- THEN the workflow field remains `quick` and no further adaptive action is taken

### Scenario: workflow_with_auto_combination_is_predictable
- GIVEN `metta propose --workflow standard --auto` runs through implementation and post-implementation recompute recommends `full`
- WHEN the post-implementation upscale decision point is reached
- THEN no prompt is printed, `--auto` auto-accepts the upscale to `full`, and the retroactive agent spawn runs


## Requirement: IntraQuickDownsizeRule

When `recommended_workflow` is `trivial` and the user is running `/metta-quick`, the skill's trivial-detection gate SHOULD reduce the review and verify fan-out to exactly 1 quality reviewer and 1 tests/tsc verifier. No correctness reviewer, no security reviewer, and no dedicated goal-check verifier SHOULD be spawned for a trivially-scored `/metta-quick` run. Non-trivial `/metta-quick` runs SHOULD keep the default 3-reviewer and 3-verifier fan-out. This downsize rule SHOULD apply even when the user declined the auto-downscale prompt and chose to remain on the quick workflow. Tests and tsc MUST run on every change regardless of tier; this is not negotiable.
Fulfills: US-1

### Scenario: trivial_quick_run_uses_reduced_fan_out
- GIVEN a change whose `intent.md` `## Impact` section enumerates one file and the chosen workflow is `quick`
- WHEN `/metta-quick` reaches the review and verify stage
- THEN the skill spawns exactly 1 quality reviewer and 1 tests/tsc verifier and logs the downsize decision

### Scenario: trivial_fan_out_excludes_correctness_security_goalcheck
- GIVEN a trivially-scored `/metta-quick` run with reduced fan-out active
- WHEN the fan-out executes
- THEN no correctness reviewer, no security reviewer, and no dedicated goal-check verifier are spawned

### Scenario: non_trivial_quick_run_keeps_standard_fan_out
- GIVEN a change whose `intent.md` `## Impact` section enumerates four files and the workflow is `quick`
- WHEN `/metta-quick` reaches the review and verify stage
- THEN the skill spawns 3 reviewers and 3 verifiers with no downsize applied

### Scenario: tests_and_tsc_run_regardless_of_tier
- GIVEN any `/metta-quick` run regardless of complexity tier
- WHEN the verify stage executes
- THEN tests and tsc run on the change as a non-negotiable baseline even under trivial fan-out


## Requirement: ScoringRubricSpec

A rubric document MUST be created under `spec/specs/adaptive-workflow-tier-selection/spec.md` that formally documents: the v1 scoring signal (file count parsed from the `## Impact` section of `intent.md`), the four tier thresholds with their exact boundary values, the four prompt modes (intent-downscale, intent-upscale, post-implementation-upscale, intra-quick-downsize) and their trigger conditions, the three storage field names (`complexity_score`, `actual_complexity_score`, `auto_accept_recommendation`) and their Zod schema shapes, and explicit extension points naming the deferred signals (spec-surface, capability-count, line-delta) and deferred retroactive artifacts (research, design, tasks) as planned-but-not-yet-implemented. The `CLAUDE.md` Active Specs table MUST be updated to include the new rubric capability entry with its requirement count.
Fulfills: US-11

### Scenario: rubric_document_exists_with_required_sections
- GIVEN the change has landed
- WHEN a maintainer browses `spec/specs/adaptive-workflow-tier-selection/`
- THEN a spec document exists that contains sections covering the file-count signal, the four tier thresholds, the four prompt modes, and the three storage field names

### Scenario: rubric_names_deferred_signals_as_extension_points
- GIVEN a maintainer reads the rubric document
- WHEN they look for guidance on extending the scorer
- THEN the document explicitly identifies spec-surface signal, capability-count signal, and line-delta signal as deferred extension points, and identifies research, design, and tasks as deferred retroactive artifacts

### Scenario: claude_md_active_specs_table_updated
- GIVEN the rubric document exists under `spec/specs/`
- WHEN `CLAUDE.md` is regenerated or manually updated
- THEN the Active Specs table lists the new adaptive-workflow-tier-selection capability with its requirement count


## Requirement: ComplexityScoreComputation

The system MUST compute a complexity score as the final step of intent authoring, immediately after `intent.md` is written by `metta complete intent`. The scorer MUST parse the `## Impact` section of `intent.md`, count distinct file or module references, and map the count to a tier using the canonical threshold table. The computed score MUST be persisted to the change's `.metta.yaml` metadata block before `metta complete intent` returns. The scorer MUST NOT run at CLI invocation time and MUST NOT recompute when `intent.md` is subsequently edited. When `intent.md` has not been written, the scorer MUST produce no output and `complexity_score` MUST be absent from change metadata.
Fulfills: US-2, US-3, US-7, US-8, US-10

### Scenario: score_computed_from_impact_section
- GIVEN a change is running under `metta propose --workflow standard` and intent has just been written with an `## Impact` section referencing three distinct files
- WHEN `metta complete intent` reaches the scoring step
- THEN `.metta.yaml` contains a `complexity_score` object with `score: 1`, `signals.file_count: 3`, and `recommended_workflow: quick`

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


## Requirement: ComplexityScoreStorage

The `.metta.yaml` change-metadata Zod schema MUST declare `complexity_score`, `actual_complexity_score`, and `auto_accept_recommendation` as optional fields. All three fields MUST default to absent so that legacy `.metta.yaml` files that predate this feature parse without error. Every read and write path in `ArtifactStore` MUST handle the presence and absence of each field without throwing a Zod validation error. The `complexity_score` and `actual_complexity_score` objects MUST each contain the sub-fields `score` (numeric tier index 0-3), `signals.file_count` (integer), and `recommended_workflow` (string tier label). The `actual_complexity_score` field MUST never overwrite `complexity_score`; they MUST coexist as independent parallel fields.
Fulfills: US-4, US-6, US-8, US-10

### Scenario: schema_accepts_full_complexity_block
- GIVEN a `.metta.yaml` file that contains `complexity_score`, `actual_complexity_score`, and `auto_accept_recommendation: true`
- WHEN `ArtifactStore` reads the file and runs Zod validation
- THEN the parse succeeds and all three fields are available on the resulting change-metadata object

### Scenario: schema_accepts_legacy_file_without_fields
- GIVEN a `.metta.yaml` file that predates this feature and contains none of the three new fields
- WHEN `ArtifactStore` reads and validates the file
- THEN the parse succeeds, `complexity_score` is absent on the result, and no Zod error is thrown

### Scenario: actual_score_does_not_overwrite_original
- GIVEN a change that has `complexity_score` persisted with `recommended_workflow: quick`
- WHEN the post-implementation recompute writes `actual_complexity_score` with `recommended_workflow: standard`
- THEN `complexity_score.recommended_workflow` is still `quick` and both objects coexist under their respective keys in `.metta.yaml`


## Requirement: TierThresholds

The scorer MUST apply the following exclusive tier-boundary mapping to convert a file count to a workflow tier: `trivial` for counts less than or equal to 1, `quick` for counts of 2 or 3, `standard` for counts of 4 through 7 inclusive, and `full` for counts of 8 or more. These thresholds MUST be defined in a single authoritative location in the codebase and referenced by all scorer invocations. No scorer invocation MAY use hardcoded threshold values outside that authoritative definition. The scorer MUST represent the chosen tier as both a human-readable label and a numeric index (0, 1, 2, 3 respectively) in the persisted `complexity_score` object.
Fulfills: US-1, US-2, US-3, US-4, US-5, US-7, US-8

### Scenario: single_file_maps_to_trivial
- GIVEN the scorer is given a file count of 1
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `trivial` and `score` is `0`

### Scenario: two_files_maps_to_quick
- GIVEN the scorer is given a file count of 2
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `quick` and `score` is `1`

### Scenario: four_files_maps_to_standard
- GIVEN the scorer is given a file count of 4
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `standard` and `score` is `2`

### Scenario: eight_files_maps_to_full
- GIVEN the scorer is given a file count of 8
- WHEN the tier mapping runs
- THEN `recommended_workflow` is `full` and `score` is `3`


## Requirement: StatusCommandSurface

The `metta status --change <name>` command MUST display the complexity score in both human-readable and `--json` output modes. In human-readable mode, when `complexity_score` is present, the output MUST include a `Complexity:` line in the format `Complexity: <tier> (N file[s]) -- recommended: <workflow>`. In `--json` mode, the JSON payload MUST include the full `complexity_score` object with `score`, `signals.file_count`, and `recommended_workflow` sub-fields. When `actual_complexity_score` is also present, `--json` mode MUST include both objects as distinct top-level fields in the change object. When `complexity_score` is absent, human mode MUST render an empty-state or `not yet scored` complexity line, and `--json` mode MUST include `"complexity_score": null` or omit the field without a Zod validation error. The command MUST exit 0 in all cases.
Fulfills: US-8, US-10

### Scenario: human_output_shows_complexity_line
- GIVEN a change with `complexity_score.recommended_workflow: trivial` and `signals.file_count: 1`
- WHEN `metta status --change <name>` runs in human mode
- THEN stdout contains the line `Complexity: trivial (1 file) -- recommended: trivial` and the exit code is 0

### Scenario: json_output_includes_complexity_object
- GIVEN a change with `complexity_score` persisted at `score: 2`, `signals.file_count: 5`, `recommended_workflow: standard`
- WHEN `metta status --change <name> --json` runs
- THEN the JSON payload contains `complexity_score` with `score`, `signals.file_count`, and `recommended_workflow` fields

### Scenario: json_output_includes_both_scores_when_present
- GIVEN a change that has both `complexity_score` from intent time and `actual_complexity_score` from the post-implementation recompute persisted
- WHEN `metta status --change <name> --json` runs
- THEN the JSON payload contains both `complexity_score` and `actual_complexity_score` as distinct top-level fields in the change object

### Scenario: absent_score_renders_without_error
- GIVEN a change with no `complexity_score` in `.metta.yaml`
- WHEN `metta status --change <name>` runs in both human and `--json` modes
- THEN the command exits 0, human output shows an empty-state complexity line, and the JSON payload includes `"complexity_score": null` or omits the field without a Zod error


## Requirement: InstructionsAdvisoryBanner

The `metta instructions` command MUST print a one-line advisory banner as the first line of stdout whenever `complexity_score` is present in the active change's `.metta.yaml`. The banner MUST reflect one of three states based on the relationship between `workflow` and `complexity_score.recommended_workflow`: agreement when they match (`Advisory: current workflow <tier> matches recommendation <tier>`), downscale-recommended when recommended is lower (`Advisory: current <chosen>, scored <recommended> -- downscale recommended`), or upscale-recommended when recommended is higher (`Advisory: current <chosen>, scored <recommended> -- upscale recommended`). The banner MUST be suppressed entirely when `complexity_score` is absent. When `--json` mode is active, the advisory banner MUST be written to stderr so that JSON stdout remains machine-parseable. The banner MUST NOT block execution or alter any artifact.
Fulfills: US-7, US-10

### Scenario: banner_agreement_state
- GIVEN a change with `workflow: quick` and `complexity_score.recommended_workflow: quick`
- WHEN `metta instructions` runs
- THEN the first line of stdout is `Advisory: current workflow quick matches recommendation quick` and execution continues normally

### Scenario: banner_downscale_state
- GIVEN a change with `workflow: standard` and `complexity_score.recommended_workflow: trivial`
- WHEN `metta instructions` runs
- THEN the first line of stdout is `Advisory: current standard, scored trivial -- downscale recommended`

### Scenario: banner_upscale_state
- GIVEN a change with `workflow: quick` and `complexity_score.recommended_workflow: standard`
- WHEN `metta instructions` runs
- THEN the first line of stdout is `Advisory: current quick, scored standard -- upscale recommended`

### Scenario: banner_suppressed_when_score_absent
- GIVEN a change with no `complexity_score` in `.metta.yaml`
- WHEN `metta instructions` runs
- THEN no `Advisory:` line appears in stdout and the command exits 0


## Requirement: AutoDownscalePromptAtIntent

When `metta complete intent` runs under `metta propose` or `metta fix-issues` and `recommended_workflow` is a lower tier than the chosen workflow, an interactive `[y/N]` prompt MUST be printed to stdout with the text `Scored as <tier> (N files) -- collapse workflow to /metta-<tier>? [y/N]`. The default answer MUST be No. On Yes, `metta complete intent` MUST update the `workflow` field in `.metta.yaml` to the recommended tier AND remove from the artifact list any planning artifacts (stories, spec, research, design, tasks) that have not yet been authored (status not `complete`). On No, the original workflow and artifact list MUST remain unchanged. The prompt MUST NOT appear when the chosen workflow already matches or is lower than the recommended tier. When the environment is non-TTY, the prompt MUST be skipped and No MUST be assumed; the advisory banner MUST still be emitted. When `auto_accept_recommendation: true` is set in `.metta.yaml`, the prompt MUST be skipped and Yes MUST be auto-selected. The downscale prompt MUST NOT fire for `/metta-quick` runs because quick is already the smallest named interactive workflow.
Fulfills: US-2, US-6

### Scenario: downscale_prompt_appears_on_oversized_propose
- GIVEN `metta propose --workflow standard` has just written `intent.md` and the scored tier is `trivial`
- WHEN scoring completes
- THEN the CLI prints `Scored as trivial (1 files) -- collapse workflow to /metta-trivial? [y/N]` with default No and the process waits for input

### Scenario: downscale_yes_mutates_workflow_and_drops_artifacts
- GIVEN the downscale prompt is visible for a `standard` run scored as `trivial`
- WHEN the user answers `y`
- THEN `.metta.yaml` `workflow` is updated to `trivial` and unstarted planning artifacts (stories, spec, research, design, tasks) are removed from the change's artifact list

### Scenario: downscale_prompt_suppressed_when_workflow_matches
- GIVEN `metta propose --workflow quick` has just written `intent.md` and the scored tier is `quick`
- WHEN scoring completes
- THEN no downscale prompt appears and exit code is 0

### Scenario: downscale_prompt_skipped_non_tty
- GIVEN a non-TTY execution environment and `metta fix-issues` has written `intent.md` with scored tier `trivial` under `standard` workflow
- WHEN scoring completes
- THEN no interactive prompt is printed, No is assumed, the workflow field is unchanged, and the advisory banner is still emitted


## Requirement: AutoUpscalePromptAtIntent

When `metta complete intent` runs and `recommended_workflow` is a higher tier than the chosen workflow, an interactive `[y/N]` prompt MUST be printed to stdout with the text `Scored as <tier> (N files) -- promote workflow to /metta-<tier>? [y/N]`. The default answer MUST be No. On Yes, `metta complete intent` MUST update the `workflow` field in `.metta.yaml` to the recommended tier AND insert any stages present in the target workflow YAML definition but absent from the current artifact list as pending artifacts before implementation runs. The artifact diff MUST be computed by loading both the current and target workflow YAML definitions and comparing stage lists. On No, the original workflow and artifact list MUST remain unchanged. The prompt MUST NOT appear when the chosen workflow already matches or exceeds the recommendation. When the environment is non-TTY, the prompt MUST be skipped and No MUST be assumed. When `auto_accept_recommendation: true` is set, the prompt MUST be skipped and Yes MUST be auto-selected.
Fulfills: US-3, US-6

### Scenario: upscale_prompt_appears_on_undersized_quick
- GIVEN `metta quick` has just written `intent.md` listing five files and the scored tier is `standard`
- WHEN scoring completes
- THEN the CLI prints `Scored as standard (5 files) -- promote workflow to /metta-standard? [y/N]` with default No

### Scenario: upscale_yes_mutates_workflow_and_inserts_artifacts
- GIVEN the upscale prompt is visible for a `quick` run scored as `standard`
- WHEN the user answers `y`
- THEN `.metta.yaml` `workflow` is updated to `standard` and the stages present in the standard workflow YAML definition but absent from the current artifact list (stories, spec, research, design, tasks) are inserted as pending artifacts before implementation runs

### Scenario: upscale_prompt_suppressed_when_workflow_exceeds_recommendation
- GIVEN `metta propose --workflow full` has just written `intent.md` and the scored tier is `standard`
- WHEN scoring completes
- THEN no upscale prompt appears and exit code is 0

### Scenario: upscale_auto_accept_skips_prompt
- GIVEN `auto_accept_recommendation: true` is persisted and `metta quick` has written `intent.md` scoring `standard`
- WHEN scoring completes
- THEN no prompt is printed, the `workflow` field is updated to `standard`, and missing planning artifacts are inserted into the artifact list


## Requirement: PostImplementationUpscalePromptAccept

When `metta complete implementation` writes `summary.md`, the scorer MUST recompute the file count from the `## Files` section of `summary.md` using the same tier thresholds. If the recomputed tier exceeds the currently chosen workflow tier, an interactive `[y/N]` prompt MUST be printed: `Implementation touched N files -- promote to /metta-<tier> and retroactively author stories + spec? [y/N]`. The default answer MUST be No. On Yes, the command MUST: (1) update the `workflow` field in `.metta.yaml` to the recomputed tier, (2) spawn a metta-product agent to author `stories.md` using `intent.md`, `summary.md`, and the actual code as inputs, (3) spawn a metta-specifier agent (metta-proposer subagent type) to author `spec.md` using the same inputs, (4) insert both `stories` and `spec` artifacts into the artifact list and mark them `complete`, and (5) persist `actual_complexity_score`. Subsequent review and verify spawns MUST use the fan-out appropriate for the promoted tier. Research, design, and tasks MUST NOT be retroactively authored. When `auto_accept_recommendation: true` is set, the prompt MUST be skipped and Yes MUST be auto-selected.
Fulfills: US-4, US-6

### Scenario: post_impl_prompt_appears_when_recomputed_tier_exceeds_workflow
- GIVEN a `/metta-quick` change whose `summary.md` `## Files` section lists five distinct files and the chosen workflow is `quick`
- WHEN `metta complete implementation` runs the recompute step
- THEN the CLI prints `Implementation touched 5 files -- promote to /metta-standard and retroactively author stories + spec? [y/N]` with default No

### Scenario: post_impl_yes_spawns_agents_and_updates_metadata
- GIVEN the post-implementation upscale prompt is visible and the user answers `y`
- WHEN the retroactive path runs to completion
- THEN `.metta.yaml` `workflow` equals `standard`, `stories.md` and `spec.md` exist in the change directory authored by the metta-product and metta-specifier agents, both artifacts are marked `complete` in the artifact list, and `actual_complexity_score` is persisted

### Scenario: post_impl_yes_uses_promoted_fan_out
- GIVEN the retroactive path completed and workflow was promoted from `quick` to `standard`
- WHEN the skill orchestrator spawns review and verify
- THEN the fan-out matches the standard tier (3 reviewers + 3 verifiers) rather than the quick fan-out

### Scenario: post_impl_no_research_design_tasks_authored
- GIVEN the post-implementation upscale Yes path ran
- WHEN the artifact list is inspected
- THEN `research.md`, `design.md`, and `tasks.md` were not created and no corresponding agents were spawned


## Requirement: PostImplementationUpscalePromptDecline

When the post-implementation upscale prompt trigger fires (recomputed tier exceeds chosen workflow) and the user answers No, or when the environment is non-TTY, the command MUST persist `actual_complexity_score` to `.metta.yaml`, print a warning line to stderr in the format `Warning: this change touched N files -- <tier> workflow was recommended; finalize will proceed on <chosen-tier>`, leave the `workflow` field unchanged, perform no retroactive agent spawn, and allow verification to proceed on the original workflow. The command MUST exit 0. When `auto_accept_recommendation: true` is set, this decline path is never reached because Yes is auto-selected upstream.
Fulfills: US-5

### Scenario: decline_persists_actual_score_and_prints_warning
- GIVEN the post-implementation upscale prompt is visible for a `quick` run that recomputed to `standard`
- WHEN the user answers `n`
- THEN stderr contains `Warning: this change touched 5 files -- standard workflow was recommended; finalize will proceed on quick`, `.metta.yaml` `workflow` remains `quick`, and `actual_complexity_score` is persisted with `score`, `signals.file_count`, and `recommended_workflow`

### Scenario: decline_does_not_create_stories_or_spec
- GIVEN the decline path ran
- WHEN the artifact list is inspected
- THEN `stories.md` and `spec.md` were not created and no product or specifier agent was spawned

### Scenario: decline_exits_zero_and_verification_proceeds
- GIVEN the decline path ran
- WHEN `metta complete implementation` returns
- THEN the exit code is 0 and the lifecycle continues on the original workflow without blocking verification

### Scenario: non_tty_defaults_to_decline
- GIVEN a non-TTY execution environment and the post-implementation recomputed tier exceeds the chosen workflow
- WHEN `metta complete implementation` reaches the upscale decision point
- THEN no interactive prompt is printed, the decline path is taken, `actual_complexity_score` is persisted, and the warning is printed to stderr


## Requirement: AutoAcceptRecommendationFlag

The `metta propose`, `metta quick`, and `metta fix-issues` CLI commands MUST each accept `--auto` and `--accept-recommended` as aliased flags for the same option. When either alias is passed, the command MUST persist `auto_accept_recommendation: true` in `.metta.yaml` at change creation before any scoring occurs. This flag MUST govern all three adaptive-routing prompts: intent-time downscale, intent-time upscale, and post-implementation upscale. When `auto_accept_recommendation: true` is set, each prompt MUST be skipped silently and the Yes path MUST be taken automatically. When `--workflow <tier>` and `--auto` are combined, `--workflow` MUST set the initial workflow choice and `--auto` MUST control acceptance of all subsequent recomputation-driven recommendation shifts away from that choice.
Fulfills: US-6, US-9

### Scenario: auto_flag_persists_field
- GIVEN `metta propose --auto` is invoked
- WHEN the change metadata is written
- THEN `.metta.yaml` contains `auto_accept_recommendation: true`

### Scenario: auto_flag_skips_all_three_prompts
- GIVEN `auto_accept_recommendation: true` is persisted in `.metta.yaml`
- WHEN intent-time downscale, intent-time upscale, and post-implementation upscale trigger conditions are each met in turn
- THEN no interactive prompt is printed for any of the three triggers and the Yes path is taken for each

### Scenario: accept_recommended_alias_behaves_identically
- GIVEN `metta quick --accept-recommended` is invoked
- WHEN the change metadata is written
- THEN `.metta.yaml` contains `auto_accept_recommendation: true`, identical to the `--auto` alias

### Scenario: auto_with_workflow_honours_initial_choice
- GIVEN `metta propose --workflow standard --auto` is invoked for a trivially-scored change
- WHEN intent is written and intent-time scoring runs
- THEN `workflow` remains `standard` because `--workflow` pins the initial choice, and when post-implementation recompute later recommends a different tier, `--auto` auto-accepts that shift without prompting


## Requirement: OverrideRemainsAuthoritative

The existing `--workflow <tier>` flag on `metta propose`, `metta quick`, and `metta fix-issues` MUST continue to set the initial workflow choice without any change to its existing semantics. When `--workflow` is passed alone (without `--auto`), the intent-time adaptive prompts MUST still appear normally if the scored recommendation differs from the chosen tier. When `--workflow` is passed together with `--auto`, `--workflow` MUST govern the initial choice and `--auto` MUST govern acceptance of all subsequent adaptive recommendation shifts. The `--workflow` flag MUST NOT suppress or alter the advisory banner.
Fulfills: US-9

### Scenario: workflow_flag_alone_preserves_initial_choice_with_prompt
- GIVEN `metta propose --workflow standard` is invoked for a trivially-scored change without `--auto`
- WHEN intent is written and scoring completes
- THEN the `workflow` field in `.metta.yaml` starts as `standard` and a downscale prompt appears asking whether to collapse

### Scenario: workflow_without_auto_shows_intent_prompts_normally
- GIVEN `--workflow quick` is passed without `--auto` and a higher tier is recommended at intent time
- WHEN the upscale prompt appears and the user answers `n`
- THEN the workflow field remains `quick` and no further adaptive action is taken

### Scenario: workflow_with_auto_combination_is_predictable
- GIVEN `metta propose --workflow standard --auto` runs through implementation and post-implementation recompute recommends `full`
- WHEN the post-implementation upscale decision point is reached
- THEN no prompt is printed, `--auto` auto-accepts the upscale to `full`, and the retroactive agent spawn runs


## Requirement: IntraQuickDownsizeRule

When `recommended_workflow` is `trivial` and the user is running `/metta-quick`, the skill's trivial-detection gate SHOULD reduce the review and verify fan-out to exactly 1 quality reviewer and 1 tests/tsc verifier. No correctness reviewer, no security reviewer, and no dedicated goal-check verifier SHOULD be spawned for a trivially-scored `/metta-quick` run. Non-trivial `/metta-quick` runs SHOULD keep the default 3-reviewer and 3-verifier fan-out. This downsize rule SHOULD apply even when the user declined the auto-downscale prompt and chose to remain on the quick workflow. Tests and tsc MUST run on every change regardless of tier; this is not negotiable.
Fulfills: US-1

### Scenario: trivial_quick_run_uses_reduced_fan_out
- GIVEN a change whose `intent.md` `## Impact` section enumerates one file and the chosen workflow is `quick`
- WHEN `/metta-quick` reaches the review and verify stage
- THEN the skill spawns exactly 1 quality reviewer and 1 tests/tsc verifier and logs the downsize decision

### Scenario: trivial_fan_out_excludes_correctness_security_goalcheck
- GIVEN a trivially-scored `/metta-quick` run with reduced fan-out active
- WHEN the fan-out executes
- THEN no correctness reviewer, no security reviewer, and no dedicated goal-check verifier are spawned

### Scenario: non_trivial_quick_run_keeps_standard_fan_out
- GIVEN a change whose `intent.md` `## Impact` section enumerates four files and the workflow is `quick`
- WHEN `/metta-quick` reaches the review and verify stage
- THEN the skill spawns 3 reviewers and 3 verifiers with no downsize applied

### Scenario: tests_and_tsc_run_regardless_of_tier
- GIVEN any `/metta-quick` run regardless of complexity tier
- WHEN the verify stage executes
- THEN tests and tsc run on the change as a non-negotiable baseline even under trivial fan-out


## Requirement: ScoringRubricSpec

A rubric document MUST be created under `spec/specs/adaptive-workflow-tier-selection/spec.md` that formally documents: the v1 scoring signal (file count parsed from the `## Impact` section of `intent.md`), the four tier thresholds with their exact boundary values, the four prompt modes (intent-downscale, intent-upscale, post-implementation-upscale, intra-quick-downsize) and their trigger conditions, the three storage field names (`complexity_score`, `actual_complexity_score`, `auto_accept_recommendation`) and their Zod schema shapes, and explicit extension points naming the deferred signals (spec-surface, capability-count, line-delta) and deferred retroactive artifacts (research, design, tasks) as planned-but-not-yet-implemented. The `CLAUDE.md` Active Specs table MUST be updated to include the new rubric capability entry with its requirement count.
Fulfills: US-11

### Scenario: rubric_document_exists_with_required_sections
- GIVEN the change has landed
- WHEN a maintainer browses `spec/specs/adaptive-workflow-tier-selection/`
- THEN a spec document exists that contains sections covering the file-count signal, the four tier thresholds, the four prompt modes, and the three storage field names

### Scenario: rubric_names_deferred_signals_as_extension_points
- GIVEN a maintainer reads the rubric document
- WHEN they look for guidance on extending the scorer
- THEN the document explicitly identifies spec-surface signal, capability-count signal, and line-delta signal as deferred extension points, and identifies research, design, and tasks as deferred retroactive artifacts

### Scenario: claude_md_active_specs_table_updated
- GIVEN the rubric document exists under `spec/specs/`
- WHEN `CLAUDE.md` is regenerated or manually updated
- THEN the Active Specs table lists the new adaptive-workflow-tier-selection capability with its requirement count
