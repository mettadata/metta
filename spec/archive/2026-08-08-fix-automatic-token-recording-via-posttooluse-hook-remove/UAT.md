# UAT: fix-automatic-token-recording-via-posttooluse-hook-remove

- **Change**: fix-automatic-token-recording-via-posttooluse-hook-remove
- **Generated**: 2026-08-08
- **Source**: user stories (stories.md)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

### US-1: Complete token reports without orchestrator diligence

*Independent test:* After a build in which the orchestrator never runs `metta tokens record` manually, TOKENS.md contains a record for every subagent (Task tool) completion.

#### Step 1.1
- **Setup**: the PostToolUse hook is installed and registered
- **Do**: a Task/Agent tool call completes (Run: `metta tokens record`)
- **Observe**: the hook invokes `metta tokens record` with usage extracted from the hook payload, with no orchestrator action required
- [ ] Pass

#### Step 1.2
- **Setup**: a build spawns multiple subagents
- **Do**: the change is finalized
- **Observe**: TOKENS.md shows one entry per subagent run with no runs missing due to skipped prose instructions
- [ ] Pass

#### Step 1.3
- **Setup**: the hook payload identifies the subagent (type, model, prompt/description)
- **Do**: a record is written
- **Observe**: the record's task/agent/model fields reflect those payload values
- [ ] Pass

### US-2: Exact harness-measured counts instead of self-reported estimates

*Independent test:* For a hook-recorded run, the token count in TOKENS.md matches the usage value from the PostToolUse payload, and the record is distinguishable by provenance from a prose-recorded estimate.

#### Step 2.1
- **Setup**: the research spike confirms the PostToolUse payload exposes subagent token usage
- **Do**: the hook records a run
- **Observe**: the recorded count is the exact payload value, not a model-authored estimate
- [ ] Pass

#### Step 2.2
- **Setup**: the research spike finds usage is NOT exposed in the payload
- **Do**: the design decision point is reached
- **Observe**: the change stops after logging the finding — no hook that records fabricated counts is shipped
- [ ] Pass

#### Step 2.3
- **Setup**: records exist from both eras
- **Do**: TOKENS.md is generated
- **Observe**: hook-sourced (exact) and prose-sourced (estimated) records are distinguishable via a provenance marker
- [ ] Pass

### US-3: Correct recording from inside change worktrees

*Independent test:* A recording invoked with cwd inside `.metta/worktrees/<change>/` writes its record to that change's metadata, verified against both worktree and repo-root cwds.

#### Step 3.1
- **Setup**: the hook fires with cwd inside `.metta/worktrees/<change>/`
- **Do**: it invokes `metta tokens record` (Run: `metta tokens record`)
- **Observe**: the record is attributed to that change, not lost or misfiled
- [ ] Pass

#### Step 3.2
- **Setup**: the hook fires with cwd at the repo root with an active change
- **Do**: it records
- **Observe**: the record is attributed to the active change as before
- [ ] Pass

#### Step 3.3
- **Setup**: no active change can be resolved from the cwd
- **Do**: the hook runs
- **Observe**: it fails safely without misattributing the record
- [ ] Pass

### US-4: No double-counting during the transition

*Independent test:* When a run has both a hook-sourced and a prose-sourced record, the generated TOKENS.md counts it once, preferring the hook-sourced exact value.

#### Step 4.1
- **Setup**: a run recorded by both the hook and the prose contract
- **Do**: TOKENS.md is generated
- **Observe**: the run appears once and totals include only the hook-sourced count
- [ ] Pass

#### Step 4.2
- **Setup**: token usage records are written with a provenance/source marker
- **Do**: any record is persisted
- **Observe**: the write is validated by the extended Zod schema
- [ ] Pass

#### Step 4.3
- **Setup**: a run recorded only via prose (e.g. hook missed it)
- **Do**: the report is generated
- **Observe**: the prose record is retained rather than discarded
- [ ] Pass

### US-5: Recording failures never break my build

*Independent test:* A forced hook error (e.g. CLI unavailable or unresolvable change) leaves the Task tool completion successful and the session uninterrupted.

#### Step 5.1
- **Setup**: `metta tokens record` fails or is unavailable
- **Do**: the PostToolUse hook runs (Run: `metta tokens record`)
- **Observe**: the Task tool call still completes successfully
- [ ] Pass

#### Step 5.2
- **Setup**: the new hook is registered in `.claude/settings.json`
- **Do**: other hooks on the same events fire
- **Observe**: existing guard/mint hook behavior is unaffected
- [ ] Pass

### US-6: Leaner skills and meaningful gap reporting

*Independent test:* After the hook is recording reliably, the lifecycle skills (installed copies and template sources, kept in sync) no longer mandate per-subagent `metta tokens record` calls, and the GAPS section wording describes hook coverage.

#### Step 6.1
- **Setup**: the hook records reliably
- **Do**: the lifecycle skills are updated (Run: `metta tokens record`)
- **Observe**: the "run `metta tokens record` after each subagent returns" instruction is removed or reduced to a fallback note in both installed skills and `src/templates/skills/` sources
- [ ] Pass

#### Step 6.2
- **Setup**: a run is missing from the records
- **Do**: TOKENS.md is generated
- **Observe**: the GAPS section describes it as a hook coverage miss rather than orchestrator non-compliance
- [ ] Pass

#### Step 6.3
- **Setup**: existing TOKENS.md consumers
- **Do**: the report is regenerated
- **Observe**: the overall report structure is unchanged apart from GAPS wording and dedupe-aware totals
- [ ] Pass

## Additional scenarios

#### Step 7.1: Subagent stop is recorded automatically with the exact transcript-summed count
- **Setup**: the hook is registered and an active change exists, and a SubagentStop payload for a `metta-executor` subagent whose `agent_transcript_path` points at a transcript whose assistant records' `message.usage` components sum to exactly 42000 tokens under the designed totals definition
- **Do**: the hook is executed with that payload on stdin (Run: `metta tokens record`)
- **Observe**: it invokes `metta tokens record` with `--tokens 42000`, `--source hook`, `--agent` derived from `agent_type`, `--model` derived from the transcript's `message.model`, and `--task` derived from transcript attribution/context, with no orchestrator action involved; the change's `.metta.yaml` gains one validated `token_usage` entry whose `tokens` value is exactly 42000
- [ ] Pass

#### Step 7.2: Missing or usage-free transcript records nothing rather than fabricating a count
- **Setup**: a SubagentStop payload whose `agent_transcript_path` names a file that is missing, unreadable, or contains no assistant records with `message.usage`
- **Do**: the hook is executed with that payload on stdin (Run: `metta tokens record`)
- **Observe**: it exits 0 without invoking `metta tokens record`; no `token_usage` entry is written anywhere
- [ ] Pass

#### Step 7.3: Registration targets the SubagentStop event and leaves existing hooks untouched
- **Setup**: the updated `.claude/settings.json`
- **Do**: its `hooks` block is inspected
- **Observe**: `SubagentStop` contains an entry (with no tool matcher) wired to `.claude/hooks/metta-tokens-record.mjs`, and the hook itself performs any agent scoping by filtering on the payload's `agent_type`; the pre-existing `PreToolUse` entries for `metta-guard-edit.mjs` and `metta-guard-bash.mjs` are byte-for-byte unchanged
- [ ] Pass

#### Step 7.4: Hook copies stay byte-identical and syntactically valid
- **Setup**: the hook has been added
- **Do**: `.claude/hooks/metta-tokens-record.mjs` and `src/templates/hooks/metta-tokens-record.mjs` are compared and each is run through `node --check` (Run: `node --check`)
- **Observe**: the two files are byte-identical and both checks pass
- [ ] Pass

#### Step 7.5: Recording from inside a change worktree attributes to that change
- **Setup**: active changes `alpha` and `beta`, with a worktree at `.metta/worktrees/beta/`
- **Do**: `metta tokens record --task impl --agent executor --model haiku --tokens 1000 --source hook` runs with cwd `.metta/worktrees/beta/` (Run: `metta tokens record --task impl --agent executor --model haiku --tokens 1000 --source hook`)
- **Observe**: the record is appended to `beta`'s `token_usage`; `alpha`'s metadata is unchanged
- [ ] Pass

#### Step 7.6: Repo-root recording keeps the existing single-active-change behavior
- **Setup**: exactly one active change and a cwd at the repository root
- **Do**: `metta tokens record --task impl --agent executor --model haiku --tokens 1000` runs without `--change` (Run: `metta tokens record --task impl --agent executor --model haiku --tokens 1000`)
- **Observe**: the record is appended to that single active change, exactly as before this delta
- [ ] Pass

#### Step 7.7: Unresolvable change fails safely without misattribution
- **Setup**: two active changes, a cwd at the repository root, and no `--change` option
- **Do**: `metta tokens record --json` runs with otherwise valid options (Run: `metta tokens record --json`)
- **Observe**: the output is `error: { code: 4, ... }` naming the candidate changes, the process exits 4, and no change's `token_usage` array is modified
- [ ] Pass

#### Step 7.8: CLI unavailable leaves the subagent run unaffected
- **Setup**: a valid SubagentStop payload with a readable transcript and an environment where the `metta` CLI is not on PATH
- **Do**: the hook is executed with that payload on stdin
- **Observe**: it exits 0 with no blocking decision in its output; no change metadata is modified
- [ ] Pass

#### Step 7.9: Recording command failure is swallowed
- **Setup**: a valid SubagentStop payload and a cwd from which no change can be resolved
- **Do**: the hook runs and its `metta tokens record` child process exits non-zero (Run: `metta tokens record`)
- **Observe**: the hook still exits 0 with no blocking decision, optionally noting the failure on stderr only
- [ ] Pass

#### Step 7.10: Missing transcript is swallowed without blocking the subagent
- **Setup**: a SubagentStop payload whose `agent_transcript_path` does not exist or cannot be read
- **Do**: the hook is executed with that payload on stdin
- **Observe**: it exits 0 with no blocking decision in its output, so the subagent stop proceeds normally; no change metadata is modified
- [ ] Pass

#### Step 7.11: Guard hook behavior is unchanged with the recording hook installed
- **Setup**: the recording hook is registered alongside the existing guard hooks
- **Do**: `metta-guard-bash.mjs` and `metta-guard-edit.mjs` are exercised on their PreToolUse events with inputs from their existing test suites
- **Observe**: every guard decision is identical to its decision before this delta
- [ ] Pass

#### Step 7.12: Duplicate hook and prose records count once, preferring the hook value
- **Setup**: a change whose `token_usage` contains `{ task: "impl", agent: "executor", tokens: 41250, source: "hook", ... }` and `{ task: "impl", agent: "executor", tokens: 40000, ... }` with no `source` field
- **Do**: `TOKENS.md` is generated
- **Observe**: the `impl`/`executor` run appears once with 41250 tokens; the report total and every rollup include 41250 and exclude the 40000 estimate
- [ ] Pass

#### Step 7.13: Prose-only records are retained
- **Setup**: a change whose `token_usage` contains a single record for `task: "plan"` with no `source` field and no hook-sourced record for that task and agent
- **Do**: `TOKENS.md` is generated
- **Observe**: the `plan` record appears in the per-artifact table and is included in all totals
- [ ] Pass

#### Step 7.14: Dedupe never mutates persisted state
- **Setup**: a change with duplicate hook- and prose-sourced records
- **Do**: finalize generates `TOKENS.md`
- **Observe**: the change's persisted `token_usage` array still contains every original record, byte-for-byte unchanged
- [ ] Pass

#### Step 7.15: Hook-sourced record passes strict validation
- **Setup**: a candidate record `{ task: "impl", agent: "executor", model: "haiku", tokens: 41250, timestamp: "2026-08-08T12:00:00.000Z", source: "hook" }`
- **Do**: `TokenUsageRecordSchema.parse` is called on it
- **Observe**: parsing succeeds and the record round-trips through `ChangeMetadataSchema` inside a `token_usage` array
- [ ] Pass

#### Step 7.16: Invalid source values are rejected strictly
- **Setup**: candidate records with, respectively, `source: "manual"`, `source: 1`, and an extra unknown key alongside a valid `source`
- **Do**: each is parsed against `TokenUsageRecordSchema`
- **Observe**: every one fails with a Zod validation error rather than being coerced or silently accepted
- [ ] Pass

#### Step 7.17: Legacy record without source remains valid and reads as prose-sourced
- **Setup**: a pre-delta record `{ task: "plan", agent: "planner", model: "inherit", tokens: 9000, timestamp: "2026-08-01T09:00:00.000Z" }`
- **Do**: it is parsed with the updated schema and consumed by the report generator
- **Observe**: parsing succeeds with `source` absent; the report generator classifies it as prose-sourced for deduplication and provenance display
- [ ] Pass

#### Step 7.18: Source flag persists provenance
- **Setup**: an active change resolvable from the cwd
- **Do**: `metta tokens record --task impl --agent executor --model haiku --tokens 41250 --source hook` runs (Run: `metta tokens record --task impl --agent executor --model haiku --tokens 41250 --source hook`)
- **Observe**: the appended `token_usage` entry carries `source: hook`; the `--json` success payload includes the source
- [ ] Pass

#### Step 7.19: Legacy invocation without source stays backward compatible
- **Setup**: exactly one active change and a repo-root cwd
- **Do**: `metta tokens record --task spec-writer-spec.md --agent spec-writer --model haiku --tokens 42000` runs exactly as prose callers invoked it before this delta (Run: `metta tokens record --task spec-writer-spec.md --agent spec-writer --model haiku --tokens 42000`)
- **Observe**: the command succeeds, exits zero, and the appended record validates with no `source` field or an explicit prose source, classified as prose-sourced by the report
- [ ] Pass

#### Step 7.20: Invalid source value writes nothing
- **Setup**: an active change
- **Do**: `metta tokens record --task impl --agent executor --model haiku --tokens 1000 --source guessed` runs (Run: `metta tokens record --task impl --agent executor --model haiku --tokens 1000 --source guessed`)
- **Observe**: validation fails before any write, the command exits 4, and the change's `token_usage` array is unchanged
- [ ] Pass

#### Step 7.21: No skill mandates per-subagent recording
- **Setup**: the four lifecycle skills metta-plan, metta-execute, metta-verify, and metta-next
- **Do**: each skill file (installed and template copy) is searched for the per-subagent recording mandate (Run: `metta tokens record`)
- **Observe**: none instructs the orchestrator to run `metta tokens record` after every returning subagent; any remaining mention of `metta tokens record` is a fallback note describing hook-driven recording as the default
- [ ] Pass

#### Step 7.22: Template and deployed skill pairs are byte-identical
- **Setup**: the skill edits are complete
- **Do**: each edited file under `src/templates/skills/**` is compared to its counterpart under `.claude/skills/**`
- **Observe**: every pair is byte-identical
- [ ] Pass

#### Step 7.23: Demotion changes nothing about routing or the guard allowlist
- **Setup**: the edited skills and the guard hook
- **Do**: the skills' model-resolution and agent-spawning wording is diffed against the pre-delta versions and `metta tokens record` is issued through an authorized flow (Run: `metta tokens record`)
- **Observe**: the only skill difference is the removed/demoted recording instruction; the guard still resolves `tokens` from `ALLOWED_SUBCOMMANDS` and allows the command
- [ ] Pass

#### Step 7.24: Provenance is distinguishable per record
- **Setup**: a change with one `source: hook` record and one legacy record without `source`
- **Do**: `TOKENS.md` is generated
- **Observe**: the per-artifact table marks the first row as hook-sourced/exact and the second as prose-sourced/estimated; the header explains the exact-versus-estimate distinction
- [ ] Pass

#### Step 7.25: A gap reads as a hook coverage miss
- **Setup**: `artifact_timings` contains keys `plan` and `implementation` but `token_usage` only contains a record with `task: "plan"`
- **Do**: the report is assembled
- **Observe**: the GAPS section lists `implementation` with wording that attributes the missing record to the recording hook missing the run; the GAPS wording contains no attribution to orchestrator or model non-compliance
- [ ] Pass

#### Step 7.26: Report structure is otherwise unchanged
- **Setup**: a change with complete, duplicate-free token records
- **Do**: the pre-delta and post-delta reports for it are compared section by section
- **Observe**: both contain the same seven sections in the same order, with differences confined to the provenance column, header wording, GAPS wording, and dedupe-aware totals
- [ ] Pass

#### Step 7.27: Complete coverage reports no gaps
- **Setup**: every `artifact_timings` key has at least one matching `token_usage` record
- **Do**: the report is assembled
- **Observe**: the GAPS section states that no gaps were found rather than being omitted
- [ ] Pass
