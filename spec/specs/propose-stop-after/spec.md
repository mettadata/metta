# propose-stop-after

## Requirement: `metta propose` MUST accept a `--stop-after <artifact>` option

The CLI command registered by `src/cli/commands/propose.ts` MUST add a `--stop-after <artifact>` option alongside the existing `--workflow`, `--from-gap`, `--from-idea`, `--from-issue`, `--discovery`, and `--auto/--accept-recommended` options. The option takes a single string value naming either an artifact id from the resolved workflow's `buildOrder` or the special value `ship`. The `--help` description for the option MUST name `ship` alongside the planning-phase artifact ids as a valid value.
When the option is omitted, the CLI's persistence behavior MUST be identical to the pre-change implementation: the change is created and `.metta.yaml` MUST NOT include a `stop_after` field. The stop-at-PR-open default introduced by this change is a skill-level default — it MUST NOT be persisted as a `stop_after` value on the change record, and the absent-flag YAML output MUST NOT change.
When the option is supplied, the value MUST be persisted on the change record so that the propose skill orchestrator and downstream tools can read it without re-parsing the original CLI invocation.
(Traces: US-2, US-3; intent proposal items 2–3.)

### Scenario: option appears in CLI help
- GIVEN the metta CLI is built
- WHEN the user runs `metta propose --help`
- THEN the help output MUST include a line documenting `--stop-after <artifact>` with a one-line description naming planning-phase artifact ids AND `ship` as the valid values

### Scenario: option is accepted with a valid value
- GIVEN a clean repository on `main`
- WHEN the user runs `metta propose "<desc>" --stop-after tasks --json`
- THEN the command MUST exit with code 0 AND the JSON output MUST include `"stop_after": "tasks"` AND a change directory at `spec/changes/<name>/` MUST exist with `.metta.yaml` containing `stop_after: tasks`

### Scenario: option is accepted with the `ship` value and persisted
- GIVEN a clean repository on `main`
- WHEN the user runs `metta propose "<desc>" --stop-after ship --json`
- THEN the command MUST exit with code 0 AND the JSON output MUST include `"stop_after": "ship"` AND `.metta.yaml` MUST contain `stop_after: ship` validating against the existing `ChangeMetadataSchema` without schema changes

### Scenario: option is omitted, no `stop_after` field is persisted
- GIVEN a clean repository on `main`
- WHEN the user runs `metta propose "<desc>" --json` with no `--stop-after` flag
- THEN the JSON output MUST NOT include a `stop_after` field (or MUST set it to `null`) AND `.metta.yaml` MUST NOT include a `stop_after` field — the PR-open default is applied by the skill, not by persisted state

## Requirement: `--stop-after` MUST be validated against the resolved workflow

The CLI command MUST validate the `--stop-after` value against the loaded workflow's `buildOrder` after the workflow has been loaded but BEFORE the change record is created, with one addition: the special value `ship` MUST be accepted for every workflow without consulting `buildOrder` — it is a lifecycle sentinel meaning "run to merge", not an artifact id. All other validation is unchanged: execution-phase ids (`implementation`, `verification`) MUST be rejected, and any value that is neither `ship` nor a member of `buildOrder` MUST be rejected. Error messages listing valid values MUST include `ship`.
When validation fails, the CLI MUST exit with code 4 (matching the existing propose error contract), MUST print an error message that names the invalid value AND lists the valid values for the resolved workflow, and MUST NOT write any state — no change directory, no `.metta.yaml`, no git branch.
No existing accepted value is removed or renamed by this change; only `ship` is added.
(Traces: US-2, US-3.)

### Scenario: `ship` is accepted for any workflow
- GIVEN any resolved workflow (e.g. `standard` or `full`) whose `buildOrder` does not contain a `ship` artifact
- WHEN the user runs `metta propose "<desc>" --stop-after ship --json`
- THEN the CLI MUST exit with code 0 AND persist `stop_after: ship` on the change record

### Scenario: unknown artifact id is still rejected and the valid list names `ship`
- GIVEN the resolved workflow `standard` whose `buildOrder` does not contain `spex`
- WHEN the user runs `metta propose "<desc>" --stop-after spex`
- THEN the CLI MUST exit with code 4 AND the error message MUST cite `spex` as unknown AND MUST list the valid values (`intent, stories, spec, research, design, tasks, ship`) AND `spec/changes/` MUST NOT contain a directory for this change

### Scenario: execution-phase artifact id is still rejected
- GIVEN any resolved workflow whose `buildOrder` includes `implementation`
- WHEN the user runs `metta propose "<desc>" --stop-after implementation`
- THEN the CLI MUST exit with code 4 AND the error message MUST explain that execution-phase ids are not valid stop points AND `spec/changes/` MUST NOT contain a directory for this change

### Scenario: existing planning-phase values keep their semantics
- GIVEN the user passes any previously accepted stop-after value (`intent`, `stories`, `spec`, `research`, `design`, `tasks`, or a non-default-workflow planning id such as `domain-research`)
- WHEN `metta propose` runs with that value
- THEN the value MUST validate and persist exactly as it did before this change, with no change in boundary semantics

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

`.claude/skills/metta-propose/SKILL.md` MUST retain the existing boundary behavior for planning-phase `stop_after` values, unchanged: the handoff line's `<resume-command>` MUST be `/metta-execute` when `stop_after = tasks`; for earlier stop points (`intent`, `stories`, `spec`, `research`, `design`) the resume command MUST be `/metta-plan` with `/metta-status` mentioned as an inspection alternative; and the orchestrator MUST NOT spawn implementation, review, or verification subagents when a planning-phase boundary has been reached.
This change adds two behaviors:

### Scenario: skill parses and forwards `--ship` from `$ARGUMENTS`
- GIVEN a propose skill invocation whose `$ARGUMENTS` is `add cool feature --ship`
- WHEN the orchestrator runs Step 1 (CLI invocation)
- THEN it MUST execute `METTA_SKILL=1 metta propose "add cool feature" --stop-after ship --json` AND the description MUST NOT contain the `--ship` token

### Scenario: `stop_after: ship` restores run-to-merge
- GIVEN a change record with `stop_after: ship` and the orchestrator has reached `all_complete: true`, run `metta finalize`, pushed the branch, and created the PR
- WHEN the orchestrator continues past PR creation
- THEN it MUST run `gh pr checks <pr-number> --watch --fail-fast` AND, when all checks pass, `gh pr merge <pr-number> --merge` AND perform post-merge cleanup exactly as the pre-change step 8 did

### Scenario: planning-phase boundary for `tasks` is unchanged
- GIVEN a change record with `stop_after: tasks` and the orchestrator has just received `all_complete: false` with `next: ["implementation"]` from `metta complete tasks`
- WHEN the orchestrator inspects the change record
- THEN it MUST stop the workflow AND print `Stopped after `tasks`. Run `/metta-execute` to begin implementation.` AND MUST NOT spawn any metta-executor, metta-reviewer, or metta-verifier agent

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


## Requirement: propose skill default path MUST stop at PR-open

When the change record has no `stop_after` field, the propose skill orchestrator MUST run the full pipeline — discovery, planning, implementation, verification, `metta finalize`, `git push` of the change branch, and `gh pr create` — and then MUST stop. The final default-path actions are creating the PR and reporting the PR URL to the user; the report MUST name `/metta-ship` (or an explicit merge) as the way to land the change. On this default path the orchestrator MUST NOT run `gh pr merge`, MUST NOT run `gh pr checks --watch` as a precursor to merging, and MUST NOT perform post-merge cleanup (main pull, branch/worktree removal tied to a merge).
This default is skill-level behavior only: it MUST NOT depend on any persisted `stop_after` value, and no configuration surface is added to alter it.
(Traces: US-1; intent problem statement — "propose" must not autonomously merge to main.)

### Scenario: default propose run ends at an open PR
- GIVEN `/metta-propose <description>` is invoked with no stop-after flag and no `--ship`
- WHEN the change completes verification and `metta finalize` succeeds
- THEN the orchestrator MUST push the branch, run `gh pr create`, report the PR URL, and stop AND the captured session MUST NOT contain a `gh pr merge` invocation

### Scenario: main does not contain the change after a default run
- GIVEN a completed default propose run that reported a PR URL
- WHEN the user inspects the repository
- THEN the change branch's PR MUST be open AND `main` MUST NOT contain the change's merge commit

### Scenario: the user can land the PR without rework
- GIVEN a default propose run has stopped at PR-open
- WHEN the user runs `/metta-ship` (or merges the PR explicitly)
- THEN the change MUST complete — merge, archive, and cleanup — without re-running planning, implementation, or verification


## Requirement: both propose SKILL.md copies MUST carry the PR-open default and stay in sync

Both the installed skill at `.claude/skills/metta-propose/SKILL.md` and the template at `src/templates/skills/metta-propose/SKILL.md` MUST be updated so that:

### Scenario: default-path instructions end at PR creation in both copies
- GIVEN the updated `.claude/skills/metta-propose/SKILL.md` and `src/templates/skills/metta-propose/SKILL.md`
- WHEN their default-path (no `stop_after`) instructions are read
- THEN the terminal actions MUST be `gh pr create` and reporting the PR URL AND every `gh pr merge` mention MUST be inside a condition requiring `stop_after = ship` AND no section commands an unconditional ship on the default path

### Scenario: the two copies agree
- GIVEN both SKILL.md copies after this change
- WHEN their step-8 / ship-path content is compared
- THEN both MUST describe the same default (stop at PR-open) and the same ship opt-in behavior


## Requirement: grep-assert tests MUST guard the propose skill against unconditional merge

The test suite MUST include grep-assert tests over BOTH `.claude/skills/metta-propose/SKILL.md` and `src/templates/skills/metta-propose/SKILL.md` that fail when either file contains an unconditional merge instruction on the default path. At minimum the tests MUST assert:

### Scenario: tests pass on the updated skill files
- GIVEN the updated SKILL.md copies with merge conditioned on the ship opt-in
- WHEN the grep-assert tests run via `npm test`
- THEN they MUST pass

### Scenario: tests fail when unconditional merge is reintroduced
- GIVEN either SKILL.md copy is edited to add an unconditioned default-path `gh pr merge <pr-number> --merge` instruction
- WHEN the grep-assert tests run
- THEN at least one test MUST fail, naming the offending file


## Requirement: `/metta-auto` and `/metta-fix-issues` MUST retain run-to-merge behavior

This change MUST NOT alter the lifecycle end state of `/metta-auto` or `/metta-fix-issues`: both skills MUST continue to run through CI watch and `gh pr merge` exactly as before this change. No edit made for the propose PR-open default may touch the merge instructions of `.claude/skills/metta-auto/SKILL.md`, `.claude/skills/metta-fix-issues/SKILL.md`, or their `src/templates/skills/` counterparts.
(Traces: US-3; intent "Unchanged" section.)

### Scenario: `/metta-auto` still runs to merge
- GIVEN `/metta-auto <description>` is invoked and the change passes verification and finalize
- WHEN the lifecycle completes
- THEN the auto skill MUST still push, create the PR, watch CI, and merge exactly as it did before this change

### Scenario: `/metta-fix-issues` still runs to merge
- GIVEN `/metta-fix-issues <slug>` is invoked and the fix passes verification and finalize
- WHEN the lifecycle completes
- THEN the fix-issues skill MUST still push, create the PR, watch CI, and merge exactly as it did before this change


## Requirement: CLAUDE.md workflow wording MUST state the PR-open default

The `## Metta Workflow` section of `CLAUDE.md` MUST describe `/metta-propose` as running the full pipeline and ending at an open PR by default, with merge requiring the explicit ship opt-in (`--ship` / `stop-after=ship`) or a subsequent `/metta-ship`. The wording MUST NOT describe or imply that `/metta-propose` merges to main by default.
(Traces: US-4; intent proposal item 5.)

### Scenario: workflow section describes the PR-open default
- GIVEN the updated `CLAUDE.md`
- WHEN a reader checks the `/metta-propose` entries in the Metta Workflow section
- THEN the text MUST state that a default propose run ends at an open PR AND that merging requires the explicit ship opt-in or `/metta-ship`
