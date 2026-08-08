# finalize-ship

## ADDED: Requirement: Token Tracking Delta Scope Note

This delta specifies the end-to-end token-usage observability feature (record, report, aggregate) under the `finalize-ship` capability as its single merge target, because the change's center of gravity is the finalize-time `TOKENS.md` report. Because a spec delta targets exactly one capability, the adjacent surfaces this change touches — the `token_usage` record schema (schemas), the `metta tokens record` CLI registration (CLI surface), the guard-hook allowlist entries (orchestration-guard), the lifecycle-skill recording instruction (instruction-contracts), the tokens config toggle (config-loader/schemas), and the `metta progress` aggregate — are specified here under finalize-ship, following the established single-target limitation pattern. Requirements in this delta that name those surfaces MUST be read as binding on those surfaces' implementations even though they merge into the finalize-ship spec. A future reconciliation MAY relocate individual requirements to their home capabilities; until then this spec is the authoritative source for them.

### Scenario: Delta merges into finalize-ship despite spanning adjacent surfaces
- GIVEN this delta's H1 names the existing capability `finalize-ship`
- WHEN `metta finalize` merges the delta
- THEN all requirements in this delta, including those governing schemas, CLI, guard hooks, skills, config, and progress, land in the finalize-ship capability spec
- AND no new capability is created for the adjacent surfaces

## ADDED: Requirement: Token Usage Record Schema

`ChangeMetadataSchema` in `src/schemas/change-metadata.ts` MUST gain an optional `token_usage` array field. Each entry MUST validate against a new strict Zod object schema (`TokenUsageRecordSchema`) with exactly these fields: `task` (non-empty string — the artifact or task id the usage applies to), `agent` (non-empty string — the subagent role spawned), `model` (`ModelAliasEnum` — the alias the subagent ran at, `inherit` when no explicit model was passed), `tokens` (positive integer), and `timestamp` (ISO 8601 datetime string). The schema MUST reject unknown keys, non-integer or non-positive `tokens` values, and model values outside `ModelAliasEnum`. The field MUST be additive: existing `.metta.yaml` files without `token_usage` MUST remain valid. `token_usage` is a new field distinct from the existing `artifact_tokens` record (context-engine context/budget figures); this delta MUST NOT change `artifact_tokens` in any way, and schema documentation MUST keep the two unambiguous.
Fulfills: US-1

### Scenario: Valid record passes strict validation
- GIVEN a candidate record `{ task: "spec-writer-spec.md", agent: "spec-writer", model: "haiku", tokens: 42000, timestamp: "2026-08-08T12:00:00.000Z" }`
- WHEN `TokenUsageRecordSchema.parse` is called on it
- THEN parsing succeeds and the record round-trips through `ChangeMetadataSchema` inside a `token_usage` array

### Scenario: Invalid records are rejected strictly
- GIVEN candidate records with, respectively, a `tokens` value of `0`, a `tokens` value of `12.5`, a `model` value not in `ModelAliasEnum`, and an extra unknown key
- WHEN each is parsed against `TokenUsageRecordSchema`
- THEN every one fails with a Zod validation error rather than being coerced or silently accepted

### Scenario: Metadata without token_usage remains valid and artifact_tokens is untouched
- GIVEN an existing `.metta.yaml` that has an `artifact_tokens` record but no `token_usage` field
- WHEN the file is parsed with the updated `ChangeMetadataSchema`
- THEN parsing succeeds with `token_usage` absent
- AND the `artifact_tokens` field's schema and parsed value are byte-for-byte unchanged from before this delta

## ADDED: Requirement: Tokens Record CLI Command

The CLI MUST gain a `metta tokens record` subcommand, registered alongside `iteration` and `model-escalation` and mirroring `src/cli/commands/model-escalation.ts` in structure: it MUST use `createCliContext`, and it MUST accept required options `--task <artifact-or-task-id>`, `--agent <role>`, `--model <alias>`, `--tokens <n>`, plus optional `--change <name>`. When `--change` is omitted the command MUST auto-select the change when exactly one active change exists and MUST fail with a typed error when zero or multiple active changes exist (naming the candidates in the multiple case). The command MUST construct the record with a current ISO timestamp, validate it via `TokenUsageRecordSchema.parse` before any write, append it to the change's `token_usage` array, and persist via `ctx.artifactStore.updateChange` so the full metadata is re-validated on write. On success with `--json` it MUST emit a JSON payload containing the change name and the recorded fields; without `--json` it MUST print a human confirmation line. On any failure it MUST emit a typed error payload (`error: { code: 4, type, message }`) under `--json` or a human error line otherwise, exit via `process.exit(4)`, and MUST NOT leave partial state written.
Fulfills: US-1

### Scenario: Record appended against the single active change
- GIVEN exactly one active change exists
- WHEN `metta tokens record --task spec-writer-spec.md --agent spec-writer --model haiku --tokens 42000` runs
- THEN the change's `.metta.yaml` gains one validated `token_usage` entry with task, agent, model, tokens, and an ISO timestamp
- AND the command exits zero with a confirmation

### Scenario: Explicit change targeting with --change
- GIVEN two active changes `alpha` and `beta`
- WHEN `metta tokens record --task impl --agent executor --model inherit --tokens 90000 --change beta` runs
- THEN the record is appended to `beta`'s `token_usage` and `alpha` is untouched

### Scenario: Ambiguous or missing change fails typed with exit 4
- GIVEN zero active changes, or two active changes with no `--change` supplied
- WHEN `metta tokens record --json` runs with otherwise valid options
- THEN the output is `error: { code: 4, ... }` with a message naming the problem (no changes, or the candidate names)
- AND the process exits 4 and no `.metta.yaml` is modified

### Scenario: Invalid tokens value writes nothing
- GIVEN an active change
- WHEN `metta tokens record --task impl --agent executor --model haiku --tokens -5` runs
- THEN Zod validation fails before any write, the command exits 4, and the change's `token_usage` array is unchanged

## ADDED: Requirement: Tokens Guard Hook Allowlist Entry

The `metta-guard-bash` hook MUST classify `tokens` as an allowed instrumentation subcommand by adding `'tokens'` to `ALLOWED_SUBCOMMANDS`, exactly as `iteration` and `model-escalation` are classified, with an inline comment describing it as append-only usage instrumentation. The entry MUST be added to both copies — `.claude/hooks/metta-guard-bash.mjs` and `src/templates/hooks/metta-guard-bash.mjs` — and after the edit the two files MUST be byte-identical and each MUST pass `node --check`. No other tier classification in the hook may change.
Fulfills: US-1

### Scenario: Skill-issued tokens record passes the guard
- GIVEN the guard hook is active in an AI session
- WHEN an authorized skill flow issues `metta tokens record --task impl --agent executor --model haiku --tokens 1000`
- THEN the hook resolves the subcommand `tokens` from `ALLOWED_SUBCOMMANDS` and returns `allow`

### Scenario: Hook copies stay byte-identical and syntactically valid
- GIVEN the allowlist edit has been applied
- WHEN `.claude/hooks/metta-guard-bash.mjs` and `src/templates/hooks/metta-guard-bash.mjs` are compared and each is run through `node --check`
- THEN the two files are byte-identical and both checks pass

### Scenario: Other guard classifications are unchanged
- GIVEN the edited hook
- WHEN a session-tier command such as `metta finalize` is issued without a valid session credential, or a fork-tier command is issued outside a fork
- THEN the guard's decision for those commands is identical to its decision before this delta

## ADDED: Requirement: Lifecycle Skill Token Recording Instruction

The subagent pass-through pattern in each lifecycle skill that spawns subagents — metta-plan, metta-execute, metta-verify, and metta-next, wherever the established pass-through wording appears — MUST gain one instruction directing the orchestrator, after each subagent returns, to record that subagent's reported token usage via `metta tokens record`, with `--task` set to the artifact or task id the subagent worked, `--agent` set to the agent type spawned, `--model` set to the model alias passed to the subagent (or `inherit` when none was passed), and `--tokens` set to the token count from the subagent's completion report. The instruction applies to executor, reviewer, verifier, and planning roles alike. Every edit MUST land in both the template copy (`src/templates/skills/**`) and the deployed copy (`.claude/skills/**`), and each template/deployed pair MUST remain byte-identical. The skills MUST NOT change model routing, agent selection, or any other behavior — recording is observability only, and no other skill wording changes.
Fulfills: US-2

### Scenario: Each spawning skill carries the recording instruction
- GIVEN the four lifecycle skills metta-plan, metta-execute, metta-verify, and metta-next
- WHEN each skill file's subagent pass-through section is inspected
- THEN each contains an instruction to run `metta tokens record` after every returning subagent, specifying role, model (or `inherit`), and the completion-report token count

### Scenario: Template and deployed skill pairs are byte-identical
- GIVEN the skill edits are complete
- WHEN each edited file under `src/templates/skills/**` is compared to its counterpart under `.claude/skills/**`
- THEN every pair is byte-identical

### Scenario: Recording instruction changes nothing about routing
- GIVEN the edited skills
- WHEN their model-resolution and agent-spawning wording is diffed against the pre-delta versions
- THEN the only difference is the added recording instruction — no model, tier, or routing wording changed

## ADDED: Requirement: Tokens Report Generation At Finalize

`Finalizer.finalize` MUST assemble a `TOKENS.md` report for the change being finalized, positioned identically to the `UAT.md` step: after the gate-execution step has passed and the real (non-dry-run) spec merge has been written, and immediately before the archive step moves the change directory. The file MUST be written to `spec/changes/<name>/TOKENS.md` so the existing archive move sweeps it into `spec/archive/<date>-<name>/`. Assembly MUST be deterministic: rendered from a new external template file (delivered to `dist/` by the existing copy-templates step, never inlined as a TypeScript string literal), reading only the change's persisted `token_usage` and `artifact_timings` data, with no AI provider invocation; two runs over identical inputs (holding the generation date fixed) MUST produce byte-identical output. A change with no `token_usage` entries MUST still produce a report (with empty rollups and a fully-populated GAPS section) rather than skipping generation while enabled.
Fulfills: US-3

### Scenario: Successful finalize writes TOKENS.md before archive
- GIVEN a change with recorded `token_usage` entries, all artifacts complete, a clean delta, and passing gates
- WHEN `metta finalize` runs to completion
- THEN `TOKENS.md` is written into `spec/changes/<name>/` after the spec merge and before `artifactStore.archive` runs
- AND the archived directory `spec/archive/<date>-<name>/` contains `TOKENS.md` alongside `UAT.md` and the other artifacts

### Scenario: Assembly is deterministic, template-driven, and AI-free
- GIVEN a fixed set of `token_usage` and `artifact_timings` inputs and a fixed generation date
- WHEN the tokens assembler runs twice
- THEN both runs produce byte-identical `TOKENS.md` content rendered from the external template file
- AND no AI provider is called and no TypeScript source contains the template body as a string literal

### Scenario: No token records still yields a report
- GIVEN a change with subagent run evidence but an empty or absent `token_usage` array, and tokens reporting enabled
- WHEN finalize completes
- THEN a `TOKENS.md` exists with zero-entry rollups and every expected-run artifact listed in the GAPS section

## ADDED: Requirement: Tokens Report Content

The generated `TOKENS.md` MUST contain, in order: (1) a header stating the change name, the generation date, and that all figures are approximate orchestrator-reported counts, not billing-grade accounting; (2) a total token count across all `token_usage` entries; (3) a per-artifact table with columns for artifact/task, agent role, model, and tokens; (4) a per-role rollup summing tokens by `agent`; (5) a per-model rollup summing tokens by `model` alias; (6) a cheap/pinned (non-inherit) vs inherit split contrasting tokens recorded at any concrete alias (`model !== 'inherit'`) against tokens recorded at `inherit`; and (7) a GAPS section listing every artifact that has run evidence — an entry in the change's `artifact_timings` keys — but no matching `token_usage` record for that task, so silent non-compliance with the skill recording contract is visible. When every expected-run artifact has a matching record the GAPS section MUST state explicitly that no gaps were found.
Fulfills: US-3

### Scenario: Full report sections render from recorded data
- GIVEN a change with `token_usage` entries spanning two roles and both `haiku` and `inherit` models
- WHEN `TOKENS.md` is generated
- THEN the report contains the approximate-figures header, the correct total, a per-artifact row per entry, per-role and per-model rollups whose sums match the entries, and a cheap/pinned (non-inherit) vs inherit split whose two figures sum to the total of non-inherit-plus-inherit usage

### Scenario: Missing records surface in GAPS
- GIVEN `artifact_timings` contains keys `plan` and `implementation` but `token_usage` only contains a record with `task: "plan"`
- WHEN the report is assembled
- THEN the GAPS section lists `implementation` as an artifact that ran without a token record
- AND `plan` does not appear in GAPS

### Scenario: Complete coverage reports no gaps
- GIVEN every `artifact_timings` key has at least one matching `token_usage` record
- WHEN the report is assembled
- THEN the GAPS section states that no gaps were found rather than being omitted

## ADDED: Requirement: Tokens Report Configuration Toggle

The project config MUST gain a `tokens` section validated by a strict Zod `TokensConfigSchema`, added in `src/schemas/project-config.ts` as a sibling of `UatConfigSchema` and mirroring its shape: a single field `enabled` of type boolean defaulting to `true`, with unknown keys within the block and non-boolean `enabled` values rejected with a validation error. `ConfigLoader` MUST supply the parsed `tokens` config to the finalizer the same way `config.uat` is supplied. When `tokens.enabled` is `false`, finalize MUST skip tokens-report generation entirely — no `TOKENS.md` is written and no tokens path is reported — while all other finalize behavior, including UAT generation, proceeds unchanged. Existing `.metta/config.yaml` files that omit the `tokens` key MUST remain valid with generation defaulting to enabled.
Fulfills: US-3

### Scenario: Disabled toggle skips the report cleanly
- GIVEN `.metta/config.yaml` sets `tokens.enabled: false`
- WHEN `metta finalize` runs to completion on a complete change with recorded `token_usage`
- THEN finalize succeeds, no `TOKENS.md` is written to the change directory or archive, and UAT generation and all other finalize behavior are unchanged

### Scenario: Omitted tokens key defaults to enabled
- GIVEN `.metta/config.yaml` with no `tokens` section
- WHEN config is loaded and `metta finalize` runs to completion
- THEN config validation passes and a `TOKENS.md` is generated

### Scenario: Invalid tokens config is rejected strictly
- GIVEN a `tokens` config block containing an unknown key or a non-boolean `enabled` value
- WHEN config is loaded
- THEN `TokensConfigSchema` rejects it with a Zod validation error rather than coercing or ignoring the value

## ADDED: Requirement: No Stray Tokens Report On Failed Finalize Paths

A finalize run that exits on any failure or non-writing path — incomplete artifacts, spec-merge conflict, gate failure, or dry-run mode — MUST NOT create a `TOKENS.md` in the change directory. Tokens-report generation MUST be unreachable before the artifact-completeness check, conflict detection, and gate execution have all passed, and MUST be skipped entirely in dry-run mode, matching the No Stray UAT On Failed Finalize Paths requirement exactly.
Fulfills: US-3

### Scenario: Gate failure leaves no TOKENS.md behind
- GIVEN a change with recorded `token_usage` and a configured gate that will fail
- WHEN `metta finalize` runs and reports the gate failure
- THEN no `TOKENS.md` exists in `spec/changes/<name>/` after the run

### Scenario: Dry-run finalize writes no TOKENS.md
- GIVEN a fully complete change with `token_usage` data that would finalize cleanly
- WHEN `metta finalize` runs in dry-run mode
- THEN no `TOKENS.md` is written and the change remains in the active changes list unchanged

### Scenario: Incomplete artifacts and merge conflicts abort before report generation
- GIVEN, in turn, a change with a workflow-required artifact not `complete`, and a change whose delta conflicts with the current capability spec lock
- WHEN `metta finalize` runs against each
- THEN each run exits on its failure path and no `TOKENS.md` exists in either change directory afterward

## ADDED: Requirement: Tokens Report Failure Degradation

A failure inside tokens-report assembly or rendering (for example unreadable metadata, a rollup computation error, or a missing template file) MUST NOT abort an otherwise-successful finalize: the spec merge, gate results, UAT generation, and archive MUST complete exactly as they would have without the failure. On such a failure the finalizer MUST degrade by continuing without a `TOKENS.md`, MUST record the failure as a warning — a warning line in human-readable mode and, in `--json` mode, `tokensPath: null` accompanied by a warning field describing the tokens-report failure — and MUST NOT convert the run's exit status to failure or surface the error as any of the existing error JSON shapes.
Fulfills: US-3

### Scenario: Assembly error degrades to a warning, finalize still succeeds
- GIVEN a change that finalizes cleanly except that tokens-report assembly throws (for example the tokens template file is missing from the resolved templates directory)
- WHEN `metta finalize` runs
- THEN the spec merge is written, `UAT.md` is generated, the change is archived, and the command exits zero
- AND no `TOKENS.md` is present in the archive

### Scenario: Degraded run reports the failure in both output modes
- GIVEN a finalize run whose tokens-report generation failed and degraded
- WHEN output is rendered
- THEN human mode prints a warning that the tokens report failed with the reason
- AND `--json` mode reports `tokensPath: null` alongside a warning describing the failure, while the payload remains the success shape

## ADDED: Requirement: Tokens Path In Finalize Output

The finalize success output MUST surface the generated tokens-report path in both output modes, additively and exactly parallel to `uatPath`. In `--json` mode the success payload MUST gain an additive `tokensPath` field: the generated `TOKENS.md` path when generation succeeded, and `null` when generation was disabled via `tokens.enabled: false` or degraded per the Tokens Report Failure Degradation requirement. All pre-existing success-payload fields, including `uatPath`, MUST be unchanged, and the error JSON shapes (`incomplete_artifacts`, `conflict`, `gates_failed`, `finalize_locked`, `finalize_error`) MUST NOT be modified. In human-readable mode, a successful finalize with generation enabled MUST print a line reporting the path where `TOKENS.md` was written; when generation is disabled no tokens line is printed. `FinalizeResult` MUST gain the corresponding additive field carrying the path.
Fulfills: US-3

### Scenario: JSON success payload carries the tokens path additively
- GIVEN a successful finalize with tokens reporting enabled
- WHEN `metta finalize --json` output is rendered
- THEN the success JSON includes `tokensPath` set to the generated `TOKENS.md` path
- AND `uatPath` and all previously existing success fields are present and unchanged

### Scenario: Human output reports the tokens path
- GIVEN a successful finalize with tokens reporting enabled
- WHEN output is rendered in human-readable mode
- THEN a line reports the path where `TOKENS.md` was written

### Scenario: Disabled generation yields null path, no human line, and untouched error shapes
- GIVEN a successful finalize with `tokens.enabled: false`, and separately a finalize that fails with gates_failed
- WHEN `--json` and human output are rendered for each
- THEN the success JSON `tokensPath` is `null` with no tokens line in human output
- AND the `gates_failed` error payload matches its pre-existing shape with no `tokensPath` field added

## ADDED: Requirement: Progress Average Tokens Per Change By Tier

`metta progress` MUST report average tokens per change grouped by workflow tier, computed by summing each change's `token_usage` entries to a per-change total and averaging those totals within each tier, across both active changes and archived changes. Changes with no `token_usage` field (including archives recorded before this feature) MUST be excluded from the average — not counted as zero — and processed without error or retrofitting. Following the existing ceremony-metric conventions: a tier with no contributing data MUST be presented as explicit no-data in human output (never rendered as `0`), and in `--json` mode the metric for such a tier MUST be `null`, passed through verbatim and never coerced to `0`. All pre-existing progress metrics MUST be unchanged.
Fulfills: US-4

### Scenario: Tier-grouped averages render from recorded data
- GIVEN two quick-tier changes with per-change token totals of 10000 and 30000, and one standard-tier change with 50000, spread across active and archived changes
- WHEN `metta progress` runs
- THEN the dashboard shows average tokens per change of 20000 for the quick tier and 50000 for the standard tier

### Scenario: No-data tier is distinct from zero and null in JSON
- GIVEN no change of the full tier has any `token_usage` data
- WHEN `metta progress` runs in human mode and in `--json` mode
- THEN human output presents the full tier as explicit no-data rather than `0`
- AND the `--json` payload carries `null` for that tier, not `0`

### Scenario: Pre-feature archives aggregate gracefully
- GIVEN archived changes whose metadata predates this feature and has no `token_usage` field
- WHEN the aggregate is computed
- THEN those changes are skipped without error, are not counted as zero-token changes, and are not modified
