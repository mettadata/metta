# finalize-ship

<!-- Merge target: finalize-ship is the existing capability that owns the end-to-end token-usage observability feature (see its Token Tracking Delta Scope Note). Requirements below that name adjacent surfaces (hooks, CLI, schemas, skills) bind those surfaces' implementations while merging here, following the established single-target pattern. -->

<!-- Amended 2026-08-08 after payload research (Claude Code 2.1.226): PostToolUse on the Agent tool fires at launch time with an async launch receipt and never carries token usage (408/408 dispatches async). Exact harness-measured counts are reachable via the SubagentStop event's `agent_transcript_path`; the recording hook requirement and all event references below are restated accordingly. -->

## ADDED: Requirement: Token Recording SubagentStop Hook

A new standalone hook at `.claude/hooks/metta-tokens-record.mjs`, with a template source at `src/templates/hooks/metta-tokens-record.mjs` (delivered by the existing template copy step, never inlined as a TypeScript string literal), MUST be registered in `.claude/settings.json` under the `SubagentStop` event. `SubagentStop` registrations take no tool matcher, so scoping MUST be performed inside the hook by filtering on the payload's `agent_type` field. On each firing the hook MUST read the hook payload JSON from stdin, locate the subagent's transcript via the payload's `agent_transcript_path` field, and sum the token components of the assistant records' `message.usage` entries (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) in that transcript to an exact total — the totals definition (which components count toward the recorded total) is delegated to design, but the recorded count MUST derive solely from harness-written transcript usage values and the hook MUST NOT estimate, derive from prose, or fabricate a count. The hook MUST then invoke `metta tokens record` as a child process with `--tokens` set to that exact total, `--agent` derived from the payload's `agent_type`, `--model` derived from the transcript's `message.model` mapped to a model alias (`inherit` when the model is unmapped or absent), `--task` derived from transcript attribution/context (e.g. `attributionSkill`/`attributionAgent` fields) toward the artifact-or-task-id vocabulary, and `--source hook`. When the transcript is missing, unreadable, or contains no usage records, the hook MUST NOT invoke `metta tokens record` at all. The installed copy and the template copy MUST be byte-identical and each MUST pass `node --check`. Existing `PreToolUse` registrations for `metta-guard-edit.mjs` and `metta-guard-bash.mjs` in `.claude/settings.json` MUST be unchanged by the new registration.
Fulfills: US-1, US-2

### Scenario: Subagent stop is recorded automatically with the exact transcript-summed count
- GIVEN the hook is registered and an active change exists, and a SubagentStop payload for a `metta-executor` subagent whose `agent_transcript_path` points at a transcript whose assistant records' `message.usage` components sum to exactly 42000 tokens under the designed totals definition
- WHEN the hook is executed with that payload on stdin
- THEN it invokes `metta tokens record` with `--tokens 42000`, `--source hook`, `--agent` derived from `agent_type`, `--model` derived from the transcript's `message.model`, and `--task` derived from transcript attribution/context, with no orchestrator action involved
- AND the change's `.metta.yaml` gains one validated `token_usage` entry whose `tokens` value is exactly 42000

### Scenario: Missing or usage-free transcript records nothing rather than fabricating a count
- GIVEN a SubagentStop payload whose `agent_transcript_path` names a file that is missing, unreadable, or contains no assistant records with `message.usage`
- WHEN the hook is executed with that payload on stdin
- THEN it exits 0 without invoking `metta tokens record`
- AND no `token_usage` entry is written anywhere

### Scenario: Registration targets the SubagentStop event and leaves existing hooks untouched
- GIVEN the updated `.claude/settings.json`
- WHEN its `hooks` block is inspected
- THEN `SubagentStop` contains an entry (with no tool matcher) wired to `.claude/hooks/metta-tokens-record.mjs`, and the hook itself performs any agent scoping by filtering on the payload's `agent_type`
- AND the pre-existing `PreToolUse` entries for `metta-guard-edit.mjs` and `metta-guard-bash.mjs` are byte-for-byte unchanged

### Scenario: Hook copies stay byte-identical and syntactically valid
- GIVEN the hook has been added
- WHEN `.claude/hooks/metta-tokens-record.mjs` and `src/templates/hooks/metta-tokens-record.mjs` are compared and each is run through `node --check`
- THEN the two files are byte-identical and both checks pass


## ADDED: Requirement: Worktree-Aware Change Resolution For Token Recording

The token-recording path MUST resolve the target change from the invocation cwd before falling back to active-change counting. When the cwd is at or below `.metta/worktrees/<change>/` (relative to the repository root), the recording MUST be attributed to `<change>`, taking precedence over the how-many-active-changes rule — a worktree cwd resolves unambiguously even when multiple changes are active. When the cwd is not inside a worktree, resolution MUST behave as before: an explicit `--change` wins, otherwise auto-select when exactly one active change exists. When no change can be resolved (cwd not in a worktree, no `--change`, and zero or multiple active changes), the recording MUST fail with the existing typed error and MUST NOT write a record to any change — records are never misattributed as a fallback. This resolution MUST apply both when the SubagentStop recording hook invokes `metta tokens record` (the hook runs with, or passes through, the session cwd) and when the command is invoked directly.
Fulfills: US-3

### Scenario: Recording from inside a change worktree attributes to that change
- GIVEN active changes `alpha` and `beta`, with a worktree at `.metta/worktrees/beta/`
- WHEN `metta tokens record --task impl --agent executor --model haiku --tokens 1000 --source hook` runs with cwd `.metta/worktrees/beta/`
- THEN the record is appended to `beta`'s `token_usage`
- AND `alpha`'s metadata is unchanged

### Scenario: Repo-root recording keeps the existing single-active-change behavior
- GIVEN exactly one active change and a cwd at the repository root
- WHEN `metta tokens record --task impl --agent executor --model haiku --tokens 1000` runs without `--change`
- THEN the record is appended to that single active change, exactly as before this delta

### Scenario: Unresolvable change fails safely without misattribution
- GIVEN two active changes, a cwd at the repository root, and no `--change` option
- WHEN `metta tokens record --json` runs with otherwise valid options
- THEN the output is `error: { code: 4, ... }` naming the candidate changes, the process exits 4, and no change's `token_usage` array is modified


## ADDED: Requirement: Non-Blocking Token Recording Hook Failure

The `metta-tokens-record.mjs` hook MUST be non-blocking: it MUST exit 0 and MUST NOT emit a blocking decision (`decision: "block"`) in its output regardless of internal failure — on the `SubagentStop` event a blocking decision would force the subagent to continue, so the hook MUST never emit one. Swallowed failure modes include an unparseable payload, a missing, unreadable, or usage-free subagent transcript at `agent_transcript_path`, a missing or unbuilt `metta` CLI, a non-zero `metta tokens record` exit (such as unresolvable change), and a filesystem error. A recording failure MUST never fail, retry, or alter the outcome of the subagent run it observed. Failure detail MAY be written to stderr for diagnostics, but the hook MUST NOT write error state into `.metta/` or any change metadata. The hook MUST NOT change the behavior of any other registered hook: guard and mint hook decisions on their events remain identical with the recording hook installed.
Fulfills: US-5

### Scenario: CLI unavailable leaves the subagent run unaffected
- GIVEN a valid SubagentStop payload with a readable transcript and an environment where the `metta` CLI is not on PATH
- WHEN the hook is executed with that payload on stdin
- THEN it exits 0 with no blocking decision in its output
- AND no change metadata is modified

### Scenario: Recording command failure is swallowed
- GIVEN a valid SubagentStop payload and a cwd from which no change can be resolved
- WHEN the hook runs and its `metta tokens record` child process exits non-zero
- THEN the hook still exits 0 with no blocking decision, optionally noting the failure on stderr only

### Scenario: Missing transcript is swallowed without blocking the subagent
- GIVEN a SubagentStop payload whose `agent_transcript_path` does not exist or cannot be read
- WHEN the hook is executed with that payload on stdin
- THEN it exits 0 with no blocking decision in its output, so the subagent stop proceeds normally
- AND no change metadata is modified

### Scenario: Guard hook behavior is unchanged with the recording hook installed
- GIVEN the recording hook is registered alongside the existing guard hooks
- WHEN `metta-guard-bash.mjs` and `metta-guard-edit.mjs` are exercised on their PreToolUse events with inputs from their existing test suites
- THEN every guard decision is identical to its decision before this delta


## ADDED: Requirement: Token Record Provenance Deduplication In Tokens Report

The tokens report generator (`src/finalize/tokens-report-generator.ts`) MUST deduplicate `token_usage` records before computing the total, the per-artifact table, and the per-role, per-model, and inherit-split rollups. Two records are duplicates of the same run when they share the same `task` and `agent` and differ in provenance (`source: hook` versus prose-sourced, where a record with no `source` field counts as prose-sourced). For each such duplicate set the report MUST count the run exactly once, using the hook-sourced record's exact token value and excluding the prose-sourced duplicates from every total and rollup. Records with no hook-sourced counterpart — prose-only records, including all pre-delta historical records — MUST be retained and counted as before, never discarded. Deduplication is a report-time concern only: the persisted `token_usage` array MUST NOT be rewritten or pruned.
Fulfills: US-4

### Scenario: Duplicate hook and prose records count once, preferring the hook value
- GIVEN a change whose `token_usage` contains `{ task: "impl", agent: "executor", tokens: 41250, source: "hook", ... }` and `{ task: "impl", agent: "executor", tokens: 40000, ... }` with no `source` field
- WHEN `TOKENS.md` is generated
- THEN the `impl`/`executor` run appears once with 41250 tokens
- AND the report total and every rollup include 41250 and exclude the 40000 estimate

### Scenario: Prose-only records are retained
- GIVEN a change whose `token_usage` contains a single record for `task: "plan"` with no `source` field and no hook-sourced record for that task and agent
- WHEN `TOKENS.md` is generated
- THEN the `plan` record appears in the per-artifact table and is included in all totals

### Scenario: Dedupe never mutates persisted state
- GIVEN a change with duplicate hook- and prose-sourced records
- WHEN finalize generates `TOKENS.md`
- THEN the change's persisted `token_usage` array still contains every original record, byte-for-byte unchanged


## MODIFIED: Requirement: Token Usage Record Schema

`ChangeMetadataSchema` in `src/schemas/change-metadata.ts` MUST gain an optional `token_usage` array field. Each entry MUST validate against a strict Zod object schema (`TokenUsageRecordSchema`) with exactly these fields: `task` (non-empty string — the artifact or task id the usage applies to), `agent` (non-empty string — the subagent role spawned), `model` (`ModelAliasEnum` — the alias the subagent ran at, `inherit` when no explicit model was passed), `tokens` (positive integer), `timestamp` (ISO 8601 datetime string), and an optional `source` provenance field constrained to the enum `hook | prose` — `hook` marking a harness-measured count recorded by the SubagentStop recording hook, `prose` marking an orchestrator-reported estimate. A record with `source` absent MUST validate and MUST be treated by consumers as prose-sourced, so all pre-delta historical records remain valid without migration. The schema MUST reject unknown keys, non-integer or non-positive `tokens` values, model values outside `ModelAliasEnum`, and `source` values outside the enum. The field MUST remain additive: existing `.metta.yaml` files without `token_usage` MUST remain valid. `token_usage` stays distinct from the existing `artifact_tokens` record (context-engine context/budget figures); this delta MUST NOT change `artifact_tokens` in any way.
Fulfills: US-2, US-4

### Scenario: Hook-sourced record passes strict validation
- GIVEN a candidate record `{ task: "impl", agent: "executor", model: "haiku", tokens: 41250, timestamp: "2026-08-08T12:00:00.000Z", source: "hook" }`
- WHEN `TokenUsageRecordSchema.parse` is called on it
- THEN parsing succeeds and the record round-trips through `ChangeMetadataSchema` inside a `token_usage` array

### Scenario: Invalid source values are rejected strictly
- GIVEN candidate records with, respectively, `source: "manual"`, `source: 1`, and an extra unknown key alongside a valid `source`
- WHEN each is parsed against `TokenUsageRecordSchema`
- THEN every one fails with a Zod validation error rather than being coerced or silently accepted

### Scenario: Legacy record without source remains valid and reads as prose-sourced
- GIVEN a pre-delta record `{ task: "plan", agent: "planner", model: "inherit", tokens: 9000, timestamp: "2026-08-01T09:00:00.000Z" }`
- WHEN it is parsed with the updated schema and consumed by the report generator
- THEN parsing succeeds with `source` absent
- AND the report generator classifies it as prose-sourced for deduplication and provenance display


## MODIFIED: Requirement: Tokens Record CLI Command

The CLI MUST provide a `metta tokens record` subcommand, registered alongside `iteration` and `model-escalation`, using `createCliContext`, accepting required options `--task <artifact-or-task-id>`, `--agent <role>`, `--model <alias>`, `--tokens <n>`, plus optional `--change <name>` and optional `--source <hook|prose>`. When `--source` is omitted the record MUST be persisted as prose-sourced, so every pre-delta invocation shape remains valid and behaves compatibly. Change targeting MUST follow the Worktree-Aware Change Resolution For Token Recording requirement: explicit `--change` wins; otherwise a cwd inside `.metta/worktrees/<change>/` resolves to that change; otherwise auto-select when exactly one active change exists; otherwise fail typed with exit 4 naming the candidates and write nothing. The command MUST construct the record with a current ISO timestamp, validate it via `TokenUsageRecordSchema.parse` before any write, append it to the change's `token_usage` array, and persist via `ctx.artifactStore.updateChange` so the full metadata is re-validated on write. On success with `--json` it MUST emit a JSON payload containing the change name and the recorded fields including the effective source; without `--json` it MUST print a human confirmation line. On any failure it MUST emit a typed error payload (`error: { code: 4, type, message }`) under `--json` or a human error line otherwise, exit via `process.exit(4)`, and MUST NOT leave partial state written.
Fulfills: US-1, US-2, US-3

### Scenario: Source flag persists provenance
- GIVEN an active change resolvable from the cwd
- WHEN `metta tokens record --task impl --agent executor --model haiku --tokens 41250 --source hook` runs
- THEN the appended `token_usage` entry carries `source: hook`
- AND the `--json` success payload includes the source

### Scenario: Legacy invocation without source stays backward compatible
- GIVEN exactly one active change and a repo-root cwd
- WHEN `metta tokens record --task spec-writer-spec.md --agent spec-writer --model haiku --tokens 42000` runs exactly as prose callers invoked it before this delta
- THEN the command succeeds, exits zero, and the appended record validates with no `source` field or an explicit prose source, classified as prose-sourced by the report

### Scenario: Invalid source value writes nothing
- GIVEN an active change
- WHEN `metta tokens record --task impl --agent executor --model haiku --tokens 1000 --source guessed` runs
- THEN validation fails before any write, the command exits 4, and the change's `token_usage` array is unchanged


## MODIFIED: Requirement: Lifecycle Skill Token Recording Instruction

With hook-driven recording in place, the subagent pass-through sections of the four lifecycle skills that spawn subagents — metta-plan, metta-execute, metta-verify, and metta-next — MUST NOT mandate that the orchestrator run `metta tokens record` after each returning subagent. The mandatory per-subagent recording instruction MUST be removed from all four skills; each skill MAY retain at most a single short fallback note stating that token recording is automatic via the SubagentStop recording hook and that `metta tokens record --source prose` exists as a manual fallback if the hook is unavailable. Every edit MUST land in both the template copy (`src/templates/skills/**`) and the deployed copy (`.claude/skills/**`), and each template/deployed pair MUST remain byte-identical. The skills MUST NOT change model routing, agent selection, or any other behavior — the only diff versus the pre-delta skills is the removal or demotion of the recording instruction. The `tokens` entry in the `metta-guard-bash` `ALLOWED_SUBCOMMANDS` allowlist MUST be retained so the fallback path still passes the guard.
Fulfills: US-6

### Scenario: No skill mandates per-subagent recording
- GIVEN the four lifecycle skills metta-plan, metta-execute, metta-verify, and metta-next
- WHEN each skill file (installed and template copy) is searched for the per-subagent recording mandate
- THEN none instructs the orchestrator to run `metta tokens record` after every returning subagent
- AND any remaining mention of `metta tokens record` is a fallback note describing hook-driven recording as the default

### Scenario: Template and deployed skill pairs are byte-identical
- GIVEN the skill edits are complete
- WHEN each edited file under `src/templates/skills/**` is compared to its counterpart under `.claude/skills/**`
- THEN every pair is byte-identical

### Scenario: Demotion changes nothing about routing or the guard allowlist
- GIVEN the edited skills and the guard hook
- WHEN the skills' model-resolution and agent-spawning wording is diffed against the pre-delta versions and `metta tokens record` is issued through an authorized flow
- THEN the only skill difference is the removed/demoted recording instruction
- AND the guard still resolves `tokens` from `ALLOWED_SUBCOMMANDS` and allows the command


## MODIFIED: Requirement: Tokens Report Content

The generated `TOKENS.md` MUST contain, in order: (1) a header stating the change name, the generation date, and that hook-sourced figures are harness-measured while prose-sourced figures are approximate orchestrator-reported estimates; (2) a total token count across all deduplicated `token_usage` entries; (3) a per-artifact table with columns for artifact/task, agent role, model, tokens, and provenance, so hook-sourced (exact) and prose-sourced (estimated) records are distinguishable per row; (4) a per-role rollup summing deduplicated tokens by `agent`; (5) a per-model rollup summing deduplicated tokens by `model` alias; (6) a cheap/pinned (non-inherit) vs inherit split over the deduplicated records; and (7) a GAPS section that is a hook-health indicator: it MUST list every artifact with run evidence — an entry in the change's `artifact_timings` keys — but no matching `token_usage` record for that task, and its wording MUST describe each gap as a run the recording hook missed (hook coverage miss), not as orchestrator non-compliance. When every expected-run artifact has a matching record the GAPS section MUST state explicitly that no gaps were found. Apart from the provenance column, the header wording, the GAPS wording, and dedupe-aware totals, the report's section structure MUST be unchanged from the pre-delta format.
Fulfills: US-2, US-4, US-6

### Scenario: Provenance is distinguishable per record
- GIVEN a change with one `source: hook` record and one legacy record without `source`
- WHEN `TOKENS.md` is generated
- THEN the per-artifact table marks the first row as hook-sourced/exact and the second as prose-sourced/estimated
- AND the header explains the exact-versus-estimate distinction

### Scenario: A gap reads as a hook coverage miss
- GIVEN `artifact_timings` contains keys `plan` and `implementation` but `token_usage` only contains a record with `task: "plan"`
- WHEN the report is assembled
- THEN the GAPS section lists `implementation` with wording that attributes the missing record to the recording hook missing the run
- AND the GAPS wording contains no attribution to orchestrator or model non-compliance

### Scenario: Report structure is otherwise unchanged
- GIVEN a change with complete, duplicate-free token records
- WHEN the pre-delta and post-delta reports for it are compared section by section
- THEN both contain the same seven sections in the same order, with differences confined to the provenance column, header wording, GAPS wording, and dedupe-aware totals

### Scenario: Complete coverage reports no gaps
- GIVEN every `artifact_timings` key has at least one matching `token_usage` record
- WHEN the report is assembled
- THEN the GAPS section states that no gaps were found rather than being omitted
