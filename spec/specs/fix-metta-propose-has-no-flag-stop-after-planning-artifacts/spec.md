# fix-metta-propose-has-no-flag-stop-after-planning-artifacts

## Requirement: `metta propose` MUST accept a `--stop-after <artifact>` option

The CLI command registered by `src/cli/commands/propose.ts` MUST add a `--stop-after <artifact>` option alongside the existing `--workflow`, `--from-gap`, `--from-idea`, `--from-issue`, `--discovery`, and `--auto/--accept-recommended` options. The option takes a single string value naming an artifact id from the resolved workflow's `buildOrder`.
When the option is omitted, behavior MUST be identical to the pre-change implementation — the change is created and the orchestrator proceeds through the full lifecycle.
When the option is supplied, the value MUST be persisted on the change record so that the propose skill orchestrator and downstream tools can read it without re-parsing the original CLI invocation.

### Scenario: option appears in CLI help
- GIVEN the metta CLI is built
- WHEN the user runs `metta propose --help`
- THEN the help output MUST include a line documenting `--stop-after <artifact>` with a one-line description naming planning-phase artifact ids as the valid values

### Scenario: option is accepted with a valid value
- GIVEN a clean repository on `main`
- WHEN the user runs `metta propose "<desc>" --stop-after tasks --json`
- THEN the command MUST exit with code 0 AND the JSON output MUST include `"stop_after": "tasks"` AND a change directory at `spec/changes/<name>/` MUST exist with `.metta.yaml` containing `stop_after: tasks`

### Scenario: option is omitted, full-lifecycle behavior preserved
- GIVEN a clean repository on `main`
- WHEN the user runs `metta propose "<desc>" --json` with no `--stop-after` flag
- THEN the JSON output MUST NOT include a `stop_after` field (or MUST set it to `null`) AND `.metta.yaml` MUST NOT include a `stop_after` field


## Requirement: `--stop-after` MUST be validated against the resolved workflow

The CLI command MUST validate the `--stop-after` value against the loaded workflow's `buildOrder` after the workflow has been loaded but BEFORE the change record is created. The validation MUST reject:
When validation fails, the CLI MUST exit with code 4 (matching the existing propose error contract), MUST print an error message that names the invalid value AND lists the valid artifact ids for the resolved workflow (excluding the forbidden execution-phase ids), and MUST NOT write any state — no change directory, no `.metta.yaml`, no git branch.

### Scenario: unknown artifact id is rejected before any side effects
- GIVEN the resolved workflow `standard` whose `buildOrder` does not contain `spex`
- WHEN the user runs `metta propose "<desc>" --stop-after spex`
- THEN the CLI MUST exit with code 4 AND the error message MUST cite `spex` as unknown AND MUST list the valid ids (`intent, stories, spec, research, design, tasks`) AND `spec/changes/` MUST NOT contain a directory for this change

### Scenario: execution-phase artifact id is rejected
- GIVEN any resolved workflow whose `buildOrder` includes `implementation`
- WHEN the user runs `metta propose "<desc>" --stop-after implementation`
- THEN the CLI MUST exit with code 4 AND the error message MUST explain that execution-phase ids are not valid stop points AND `spec/changes/` MUST NOT contain a directory for this change

### Scenario: planning-phase id from a non-default workflow is accepted
- GIVEN the user passes `--workflow full` and the `full` workflow includes `domain-research` in its `buildOrder`
- WHEN the user runs `metta propose "<desc>" --workflow full --stop-after domain-research`
- THEN the CLI MUST accept the value and persist `stop_after: domain-research` on the change record


## Requirement: change-record schema MUST persist `stop_after` as an optional field

`src/schemas/change-metadata.ts` MUST extend `ChangeMetadataSchema` with an optional `stop_after: z.string().optional()` field. The field MUST sit alongside the existing optional fields (`workflow_locked`, `auto_accept_recommendation`, etc.) and MUST be written by `ArtifactStore.createChange` when the caller supplies a stop-after value.
The schema MUST NOT validate the artifact-id membership at the schema layer — that validation lives in the CLI command where the workflow graph is in scope. The schema's job is to accept any string and reject non-string values.

### Scenario: schema accepts records with `stop_after`
- GIVEN a `.metta.yaml` containing `stop_after: tasks`
- WHEN `ChangeMetadataSchema.parse(...)` runs over it
- THEN parsing MUST succeed AND `result.stop_after` MUST equal `"tasks"`

### Scenario: schema accepts records without `stop_after`
- GIVEN a `.metta.yaml` with no `stop_after` field
- WHEN `ChangeMetadataSchema.parse(...)` runs over it
- THEN parsing MUST succeed AND `result.stop_after` MUST be `undefined`

### Scenario: schema rejects non-string `stop_after`
- GIVEN a `.metta.yaml` containing `stop_after: 42`
- WHEN `ChangeMetadataSchema.parse(...)` runs over it
- THEN parsing MUST fail with a Zod validation error


## Requirement: `ArtifactStore.createChange` MUST accept and persist a `stopAfter` argument

The signature of `ArtifactStore.createChange` in `src/artifacts/artifact-store.ts` MUST accept an optional `stopAfter?: string` argument (placed after the existing optional `workflowLocked` argument to preserve positional compatibility, OR refactored to take an options object — implementer's choice during design). When supplied, the value MUST be set on the constructed `ChangeMetadata` as `stop_after` BEFORE the call to `state.write(...)` so the schema-validated write captures it.
When `stopAfter` is not supplied, the constructed `ChangeMetadata` MUST NOT include a `stop_after` field — preserving the current YAML output for callers that do not opt in.

### Scenario: `createChange` writes `stop_after` when supplied
- GIVEN a fresh `ArtifactStore` instance with a temporary `specDir`
- WHEN the caller invokes `createChange("desc", "standard", ["intent","stories","spec","research","design","tasks","implementation","verification"], {}, false, false, "tasks")`
- THEN the resulting `.metta.yaml` MUST contain a top-level `stop_after: tasks` field

### Scenario: `createChange` omits `stop_after` when not supplied
- GIVEN a fresh `ArtifactStore` instance with a temporary `specDir`
- WHEN the caller invokes `createChange("desc", "standard", [...], {}, false, false)` with no `stopAfter` argument
- THEN the resulting `.metta.yaml` MUST NOT contain a `stop_after` field


## Requirement: propose skill MUST honor the `stop_after` boundary

`.claude/skills/metta-propose/SKILL.md` MUST be updated so the orchestrator:
The handoff line's `<resume-command>` MUST be `/metta-execute` when `stop_after = tasks`. For earlier stop points (`intent`, `stories`, `spec`, `research`, `design`), the resume command MUST be `/metta-plan` (to continue planning) with `/metta-status` mentioned as an inspection alternative.
The orchestrator MUST NOT spawn implementation, review, or verification subagents when the stop-after boundary has been reached.

### Scenario: skill parses and forwards `--stop-after` from `$ARGUMENTS`
- GIVEN a propose skill invocation whose `$ARGUMENTS` is `add cool feature --stop-after tasks`
- WHEN the orchestrator runs Step 1 (CLI invocation)
- THEN it MUST execute `METTA_SKILL=1 metta propose "add cool feature" --stop-after tasks --json` AND the description MUST NOT contain the `--stop-after tasks` tokens

### Scenario: skill exits cleanly at the stop-after boundary for `tasks`
- GIVEN a change record with `stop_after: tasks` and the orchestrator has just received `all_complete: false` with `next: ["implementation"]` from `metta complete tasks`
- WHEN the orchestrator inspects the change record
- THEN it MUST stop the workflow AND print `Stopped after \`tasks`. Run `/metta-execute` to begin implementation.` AND MUST NOT spawn any metta-executor, metta-reviewer, or metta-verifier agent

### Scenario: skill exits cleanly at the stop-after boundary for `spec`
- GIVEN a change record with `stop_after: spec` and the orchestrator has just completed `metta complete spec`
- WHEN the orchestrator inspects the change record
- THEN it MUST stop the workflow AND print a handoff line naming `/metta-plan` (to continue planning) or `/metta-status` (to inspect)

### Scenario: skill behaves identically when no `stop_after` is set
- GIVEN a change record with no `stop_after` field
- WHEN the orchestrator runs Step 3 through Step 8
- THEN the orchestrator MUST proceed through implementation, review, verification, finalize, and merge exactly as it does today


## Requirement: `metta status` MUST surface `stop_after` in JSON output

The `metta status --json [--change <name>]` command MUST include a `stop_after` field in its output when the change record has a `stop_after` value. When the field is absent on the record, the command MUST either omit the key from JSON or set it to `null` — implementations MUST NOT print `"stop_after": ""` because the empty string is ambiguous.
This requirement enables future tooling (skills, dashboards, audit scripts) to discover the stop point without parsing `.metta.yaml` directly.

### Scenario: `metta status --json` reflects `stop_after` when set
- GIVEN a change with `stop_after: tasks` persisted in its `.metta.yaml`
- WHEN the user runs `metta status --json --change <name>`
- THEN the JSON output MUST include `"stop_after": "tasks"`

### Scenario: `metta status --json` omits or nulls `stop_after` when not set
- GIVEN a change with no `stop_after` field
- WHEN the user runs `metta status --json --change <name>`
- THEN the JSON output MUST either omit the `stop_after` key OR set it to `null`


## Requirement: `--stop-after` MUST compose with all existing propose flags

The CLI command MUST treat `--stop-after` as orthogonal to `--workflow`, `--from-gap`, `--from-idea`, `--from-issue`, `--discovery`, and `--auto/--accept-recommended`. No flag combination MUST cause the CLI to ignore `--stop-after`, and the validation rules from the second requirement above MUST apply uniformly across all combinations.

### Scenario: `--stop-after` composes with `--workflow` and `--auto`
- GIVEN a clean repository
- WHEN the user runs `metta propose "<desc>" --workflow standard --stop-after spec --auto --json`
- THEN the CLI MUST exit with code 0, persist `stop_after: spec`, set `auto_accept_recommendation: true`, and use the `standard` workflow

### Scenario: `--stop-after` composes with `--from-issue`
- GIVEN an open issue with slug `my-issue`
- WHEN the user runs `metta propose "<desc>" --from-issue my-issue --stop-after tasks --json`
- THEN the change MUST be created with the issue context AND `stop_after: tasks` MUST be persisted


## Requirement: handoff message MUST be deterministic and matchable

When the propose skill exits at the stop-after boundary, the final user-visible line MUST follow this exact pattern (case-sensitive, with backticks around the artifact id and resume command):
This determinism enables:
The orchestrator MUST NOT prepend or append additional lines that imply implementation, review, or verification ran. It MAY print neutral status lines BEFORE the handoff line (e.g. `Resolved: all questions. Proceeding to proposer subagent.` or per-artifact completion notices), but the handoff line MUST be the final user-facing line in the propose-stop-after exit path.

### Scenario: tests can assert the handoff line shape
- GIVEN a propose run with `--stop-after tasks`
- WHEN the orchestrator exits at the boundary
- THEN the captured stdout MUST contain the exact substring "Stopped after `tasks`. Run `/metta-execute` to begin implementation."

### Scenario: no implementation-implying lines appear
- GIVEN any propose run with a `stop_after` value
- WHEN the orchestrator exits at the boundary
- THEN the captured stdout MUST NOT contain the substrings "metta complete implementation", "metta-executor", "metta-reviewer", or "metta-verifier" emitted by the orchestrator after the stop point
