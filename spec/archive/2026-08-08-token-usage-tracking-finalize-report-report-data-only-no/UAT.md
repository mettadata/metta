# UAT: token-usage-tracking-finalize-report-report-data-only-no

- **Change**: token-usage-tracking-finalize-report-report-data-only-no
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

### US-1: Record subagent token usage against a change

*Independent test:* Running `metta tokens record --task <id> --agent <role> --model <alias> --tokens <n>` appends a validated `{task, agent, model, tokens, timestamp}` entry to the active change's `token_usage` array in its `.metta.yaml`.

#### Step 1.1
- **Setup**: an active change
- **Do**: the orchestrator runs `metta tokens record --task spec-writer-spec.md --agent spec-writer --model cheap --tokens 42000` (Run: `metta tokens record --task spec-writer-spec.md --agent spec-writer --model cheap --tokens 42000`)
- **Observe**: a new `token_usage` entry with task, agent, model, tokens, and timestamp is persisted to the change's metadata and validates against the strict schema
- [ ] Pass

#### Step 1.2
- **Setup**: an invalid invocation (missing flag, non-numeric tokens, unknown change name)
- **Do**: `metta tokens record` is run (Run: `metta tokens record`)
- **Observe**: the command fails with a clear error and no partial state is written
- [ ] Pass

#### Step 1.3
- **Setup**: the `metta-guard-bash` hook is active in an AI session
- **Do**: an authorized skill flow issues `metta tokens record` (Run: `metta tokens record`)
- **Observe**: the guard allowlist (identical in both hook copies) permits the command
- [ ] Pass

#### Step 1.4
- **Setup**: a change other than the active one
- **Do**: `--change <name>` is supplied
- **Observe**: the entry is recorded against that named change
- [ ] Pass

### US-2: Lifecycle skills contractually capture token usage

*Independent test:* Each subagent-spawning lifecycle skill (metta-plan, metta-execute, metta-verify, metta-next) contains an instruction to run `metta tokens record` after each subagent returns, with template and deployed skill files byte-identical.

#### Step 2.1
- **Setup**: a lifecycle skill that spawns subagents
- **Do**: a subagent (executor, reviewer, verifier, or planning role) completes and reports token usage (Run: `metta tokens record`)
- **Observe**: the skill directs the orchestrator to record that usage via `metta tokens record` before proceeding
- [ ] Pass

#### Step 2.2
- **Setup**: the skill template files and their deployed copies
- **Do**: the change is finalized
- **Observe**: each template/deployed pair is byte-identical
- [ ] Pass

#### Step 2.3
- **Setup**: the recording instruction is in place
- **Do**: skills run
- **Observe**: model routing and agent behavior are otherwise unchanged — recording is observability only
- [ ] Pass

### US-3: Per-change token report at finalize

*Independent test:* Finalizing a change with `token_usage` data produces a deterministic, template-driven TOKENS.md in the change directory (surfaced as `tokensPath` in human and `--json` output), and a failed finalize leaves no stray TOKENS.md behind.

#### Step 3.1
- **Setup**: a change with recorded `token_usage` entries
- **Do**: finalize passes its gates
- **Observe**: TOKENS.md is assembled from an external template into the change dir before archiving, with an approximate-figures header, totals, per-artifact table, per-role and per-model rollups, and cheap-vs-inherit split
- [ ] Pass

#### Step 3.2
- **Setup**: artifacts with run evidence in `artifact_timings` but no matching token record
- **Do**: the report is assembled
- **Observe**: those artifacts appear in a GAPS section
- [ ] Pass

#### Step 3.3
- **Setup**: report assembly fails
- **Do**: finalize runs
- **Observe**: finalize warns and continues (mirroring the UAT.md precedent) rather than blocking the change
- [ ] Pass

#### Step 3.4
- **Setup**: `tokens.enabled` is set to false in config
- **Do**: finalize runs
- **Observe**: no TOKENS.md is generated and finalize completes normally
- [ ] Pass

#### Step 3.5
- **Setup**: finalize completes with a report
- **Do**: output is rendered
- **Observe**: `tokensPath` appears in both human and `--json` output, additively alongside `uatPath`
- [ ] Pass

### US-4: Cross-change token averages by workflow tier

*Independent test:* `metta progress` displays avg-tokens-per-change per workflow tier computed from `token_usage` across active and archived changes, distinguishing explicit no-data from zero and passing null through in `--json`.

#### Step 4.1
- **Setup**: multiple changes with `token_usage` data across tiers
- **Do**: `metta progress` runs (Run: `metta progress`)
- **Observe**: the dashboard shows average tokens per change grouped by workflow tier
- [ ] Pass

#### Step 4.2
- **Setup**: a tier with no recorded token data
- **Do**: the aggregate is rendered
- **Observe**: it is shown as explicit no-data (not zero) in human output and as null in `--json`, following ceremony-metric conventions
- [ ] Pass

#### Step 4.3
- **Setup**: archived changes recorded before this feature (no `token_usage` field)
- **Do**: aggregation runs
- **Observe**: they are handled gracefully without errors and without being retrofitted
- [ ] Pass

## Additional scenarios

#### Step 5.1: Delta merges into finalize-ship despite spanning adjacent surfaces
- **Setup**: this delta's H1 names the existing capability `finalize-ship`
- **Do**: `metta finalize` merges the delta (Run: `metta finalize`)
- **Observe**: all requirements in this delta, including those governing schemas, CLI, guard hooks, skills, config, and progress, land in the finalize-ship capability spec; no new capability is created for the adjacent surfaces
- [ ] Pass

#### Step 5.2: Valid record passes strict validation
- **Setup**: a candidate record `{ task: "spec-writer-spec.md", agent: "spec-writer", model: "haiku", tokens: 42000, timestamp: "2026-08-08T12:00:00.000Z" }`
- **Do**: `TokenUsageRecordSchema.parse` is called on it
- **Observe**: parsing succeeds and the record round-trips through `ChangeMetadataSchema` inside a `token_usage` array
- [ ] Pass

#### Step 5.3: Invalid records are rejected strictly
- **Setup**: candidate records with, respectively, a `tokens` value of `0`, a `tokens` value of `12.5`, a `model` value not in `ModelAliasEnum`, and an extra unknown key
- **Do**: each is parsed against `TokenUsageRecordSchema`
- **Observe**: every one fails with a Zod validation error rather than being coerced or silently accepted
- [ ] Pass

#### Step 5.4: Metadata without token_usage remains valid and artifact_tokens is untouched
- **Setup**: an existing `.metta.yaml` that has an `artifact_tokens` record but no `token_usage` field
- **Do**: the file is parsed with the updated `ChangeMetadataSchema`
- **Observe**: parsing succeeds with `token_usage` absent; the `artifact_tokens` field's schema and parsed value are byte-for-byte unchanged from before this delta
- [ ] Pass

#### Step 5.5: Record appended against the single active change
- **Setup**: exactly one active change exists
- **Do**: `metta tokens record --task spec-writer-spec.md --agent spec-writer --model haiku --tokens 42000` runs (Run: `metta tokens record --task spec-writer-spec.md --agent spec-writer --model haiku --tokens 42000`)
- **Observe**: the change's `.metta.yaml` gains one validated `token_usage` entry with task, agent, model, tokens, and an ISO timestamp; the command exits zero with a confirmation
- [ ] Pass

#### Step 5.6: Explicit change targeting with --change
- **Setup**: two active changes `alpha` and `beta`
- **Do**: `metta tokens record --task impl --agent executor --model inherit --tokens 90000 --change beta` runs (Run: `metta tokens record --task impl --agent executor --model inherit --tokens 90000 --change beta`)
- **Observe**: the record is appended to `beta`'s `token_usage` and `alpha` is untouched
- [ ] Pass

#### Step 5.7: Ambiguous or missing change fails typed with exit 4
- **Setup**: zero active changes, or two active changes with no `--change` supplied
- **Do**: `metta tokens record --json` runs with otherwise valid options (Run: `metta tokens record --json`)
- **Observe**: the output is `error: { code: 4, ... }` with a message naming the problem (no changes, or the candidate names); the process exits 4 and no `.metta.yaml` is modified
- [ ] Pass

#### Step 5.8: Invalid tokens value writes nothing
- **Setup**: an active change
- **Do**: `metta tokens record --task impl --agent executor --model haiku --tokens -5` runs (Run: `metta tokens record --task impl --agent executor --model haiku --tokens -5`)
- **Observe**: Zod validation fails before any write, the command exits 4, and the change's `token_usage` array is unchanged
- [ ] Pass

#### Step 5.9: Skill-issued tokens record passes the guard
- **Setup**: the guard hook is active in an AI session
- **Do**: an authorized skill flow issues `metta tokens record --task impl --agent executor --model haiku --tokens 1000` (Run: `metta tokens record --task impl --agent executor --model haiku --tokens 1000`)
- **Observe**: the hook resolves the subcommand `tokens` from `ALLOWED_SUBCOMMANDS` and returns `allow`
- [ ] Pass

#### Step 5.10: Hook copies stay byte-identical and syntactically valid
- **Setup**: the allowlist edit has been applied
- **Do**: `.claude/hooks/metta-guard-bash.mjs` and `src/templates/hooks/metta-guard-bash.mjs` are compared and each is run through `node --check` (Run: `node --check`)
- **Observe**: the two files are byte-identical and both checks pass
- [ ] Pass

#### Step 5.11: Other guard classifications are unchanged
- **Setup**: the edited hook
- **Do**: a session-tier command such as `metta finalize` is issued without a valid session credential, or a fork-tier command is issued outside a fork (Run: `metta finalize`)
- **Observe**: the guard's decision for those commands is identical to its decision before this delta
- [ ] Pass

#### Step 5.12: Each spawning skill carries the recording instruction
- **Setup**: the four lifecycle skills metta-plan, metta-execute, metta-verify, and metta-next
- **Do**: each skill file's subagent pass-through section is inspected (Run: `metta tokens record`)
- **Observe**: each contains an instruction to run `metta tokens record` after every returning subagent, specifying role, model (or `inherit`), and the completion-report token count
- [ ] Pass

#### Step 5.13: Template and deployed skill pairs are byte-identical
- **Setup**: the skill edits are complete
- **Do**: each edited file under `src/templates/skills/**` is compared to its counterpart under `.claude/skills/**`
- **Observe**: every pair is byte-identical
- [ ] Pass

#### Step 5.14: Recording instruction changes nothing about routing
- **Setup**: the edited skills
- **Do**: their model-resolution and agent-spawning wording is diffed against the pre-delta versions
- **Observe**: the only difference is the added recording instruction — no model, tier, or routing wording changed
- [ ] Pass

#### Step 5.15: Successful finalize writes TOKENS.md before archive
- **Setup**: a change with recorded `token_usage` entries, all artifacts complete, a clean delta, and passing gates
- **Do**: `metta finalize` runs to completion (Run: `metta finalize`)
- **Observe**: `TOKENS.md` is written into `spec/changes/<name>/` after the spec merge and before `artifactStore.archive` runs; the archived directory `spec/archive/<date>-<name>/` contains `TOKENS.md` alongside `UAT.md` and the other artifacts
- [ ] Pass

#### Step 5.16: Assembly is deterministic, template-driven, and AI-free
- **Setup**: a fixed set of `token_usage` and `artifact_timings` inputs and a fixed generation date
- **Do**: the tokens assembler runs twice
- **Observe**: both runs produce byte-identical `TOKENS.md` content rendered from the external template file; no AI provider is called and no TypeScript source contains the template body as a string literal
- [ ] Pass

#### Step 5.17: No token records still yields a report
- **Setup**: a change with subagent run evidence but an empty or absent `token_usage` array, and tokens reporting enabled
- **Do**: finalize completes
- **Observe**: a `TOKENS.md` exists with zero-entry rollups and every expected-run artifact listed in the GAPS section
- [ ] Pass

#### Step 5.18: Full report sections render from recorded data
- **Setup**: a change with `token_usage` entries spanning two roles and both `haiku` and `inherit` models
- **Do**: `TOKENS.md` is generated
- **Observe**: the report contains the approximate-figures header, the correct total, a per-artifact row per entry, per-role and per-model rollups whose sums match the entries, and a cheap/pinned (non-inherit) vs inherit split whose two figures sum to the total of non-inherit-plus-inherit usage
- [ ] Pass

#### Step 5.19: Missing records surface in GAPS
- **Setup**: `artifact_timings` contains keys `plan` and `implementation` but `token_usage` only contains a record with `task: "plan"`
- **Do**: the report is assembled
- **Observe**: the GAPS section lists `implementation` as an artifact that ran without a token record; `plan` does not appear in GAPS
- [ ] Pass

#### Step 5.20: Complete coverage reports no gaps
- **Setup**: every `artifact_timings` key has at least one matching `token_usage` record
- **Do**: the report is assembled
- **Observe**: the GAPS section states that no gaps were found rather than being omitted
- [ ] Pass

#### Step 5.21: Disabled toggle skips the report cleanly
- **Setup**: `.metta/config.yaml` sets `tokens.enabled: false`
- **Do**: `metta finalize` runs to completion on a complete change with recorded `token_usage` (Run: `metta finalize`)
- **Observe**: finalize succeeds, no `TOKENS.md` is written to the change directory or archive, and UAT generation and all other finalize behavior are unchanged
- [ ] Pass

#### Step 5.22: Omitted tokens key defaults to enabled
- **Setup**: `.metta/config.yaml` with no `tokens` section
- **Do**: config is loaded and `metta finalize` runs to completion (Run: `metta finalize`)
- **Observe**: config validation passes and a `TOKENS.md` is generated
- [ ] Pass

#### Step 5.23: Invalid tokens config is rejected strictly
- **Setup**: a `tokens` config block containing an unknown key or a non-boolean `enabled` value
- **Do**: config is loaded
- **Observe**: `TokensConfigSchema` rejects it with a Zod validation error rather than coercing or ignoring the value
- [ ] Pass

#### Step 5.24: Gate failure leaves no TOKENS.md behind
- **Setup**: a change with recorded `token_usage` and a configured gate that will fail
- **Do**: `metta finalize` runs and reports the gate failure (Run: `metta finalize`)
- **Observe**: no `TOKENS.md` exists in `spec/changes/<name>/` after the run
- [ ] Pass

#### Step 5.25: Dry-run finalize writes no TOKENS.md
- **Setup**: a fully complete change with `token_usage` data that would finalize cleanly
- **Do**: `metta finalize` runs in dry-run mode (Run: `metta finalize`)
- **Observe**: no `TOKENS.md` is written and the change remains in the active changes list unchanged
- [ ] Pass

#### Step 5.26: Incomplete artifacts and merge conflicts abort before report generation
- **Setup**: , in turn, a change with a workflow-required artifact not `complete`, and a change whose delta conflicts with the current capability spec lock
- **Do**: `metta finalize` runs against each (Run: `metta finalize`)
- **Observe**: each run exits on its failure path and no `TOKENS.md` exists in either change directory afterward
- [ ] Pass

#### Step 5.27: Assembly error degrades to a warning, finalize still succeeds
- **Setup**: a change that finalizes cleanly except that tokens-report assembly throws (for example the tokens template file is missing from the resolved templates directory)
- **Do**: `metta finalize` runs (Run: `metta finalize`)
- **Observe**: the spec merge is written, `UAT.md` is generated, the change is archived, and the command exits zero; no `TOKENS.md` is present in the archive
- [ ] Pass

#### Step 5.28: Degraded run reports the failure in both output modes
- **Setup**: a finalize run whose tokens-report generation failed and degraded
- **Do**: output is rendered
- **Observe**: human mode prints a warning that the tokens report failed with the reason; `--json` mode reports `tokensPath: null` alongside a warning describing the failure, while the payload remains the success shape
- [ ] Pass

#### Step 5.29: JSON success payload carries the tokens path additively
- **Setup**: a successful finalize with tokens reporting enabled
- **Do**: `metta finalize --json` output is rendered (Run: `metta finalize --json`)
- **Observe**: the success JSON includes `tokensPath` set to the generated `TOKENS.md` path; `uatPath` and all previously existing success fields are present and unchanged
- [ ] Pass

#### Step 5.30: Human output reports the tokens path
- **Setup**: a successful finalize with tokens reporting enabled
- **Do**: output is rendered in human-readable mode
- **Observe**: a line reports the path where `TOKENS.md` was written
- [ ] Pass

#### Step 5.31: Disabled generation yields null path, no human line, and untouched error shapes
- **Setup**: a successful finalize with `tokens.enabled: false`, and separately a finalize that fails with gates_failed
- **Do**: `--json` and human output are rendered for each
- **Observe**: the success JSON `tokensPath` is `null` with no tokens line in human output; the `gates_failed` error payload matches its pre-existing shape with no `tokensPath` field added
- [ ] Pass

#### Step 5.32: Tier-grouped averages render from recorded data
- **Setup**: two quick-tier changes with per-change token totals of 10000 and 30000, and one standard-tier change with 50000, spread across active and archived changes
- **Do**: `metta progress` runs (Run: `metta progress`)
- **Observe**: the dashboard shows average tokens per change of 20000 for the quick tier and 50000 for the standard tier
- [ ] Pass

#### Step 5.33: No-data tier is distinct from zero and null in JSON
- **Setup**: no change of the full tier has any `token_usage` data
- **Do**: `metta progress` runs in human mode and in `--json` mode (Run: `metta progress`)
- **Observe**: human output presents the full tier as explicit no-data rather than `0`; the `--json` payload carries `null` for that tier, not `0`
- [ ] Pass

#### Step 5.34: Pre-feature archives aggregate gracefully
- **Setup**: archived changes whose metadata predates this feature and has no `token_usage` field
- **Do**: the aggregate is computed
- **Observe**: those changes are skipped without error, are not counted as zero-token changes, and are not modified
- [ ] Pass
