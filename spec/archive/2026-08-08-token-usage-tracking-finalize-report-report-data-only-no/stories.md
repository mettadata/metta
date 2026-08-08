<!--
User stories for this change.

Format: one `## US-N:` block per story with six bold-label fields
(**As a**, **I want to**, **So that**, **Priority:**, **Independent Test Criteria:**,
**Acceptance Criteria:**) followed by one or more Given/When/Then bullets.
Story IDs MUST be monotonic starting at US-1.
-->

# token-usage-tracking-finalize-report-report-data-only-no — User Stories

## US-1: Record subagent token usage against a change

**As a** developer paying for top-model credits on metta-driven changes
**I want to** have each subagent's reported token usage durably recorded against the task, agent role, and model that consumed it
**So that** token data observed only by the orchestrator session no longer evaporates when the session ends, and I have raw evidence for where credits go

**Priority:** P1
**Independent Test Criteria:** Running `metta tokens record --task <id> --agent <role> --model <alias> --tokens <n>` appends a validated `{task, agent, model, tokens, timestamp}` entry to the active change's `token_usage` array in its `.metta.yaml`.

**Acceptance Criteria:**
- **Given** an active change **When** the orchestrator runs `metta tokens record --task spec-writer-spec.md --agent spec-writer --model cheap --tokens 42000` **Then** a new `token_usage` entry with task, agent, model, tokens, and timestamp is persisted to the change's metadata and validates against the strict schema
- **Given** an invalid invocation (missing flag, non-numeric tokens, unknown change name) **When** `metta tokens record` is run **Then** the command fails with a clear error and no partial state is written
- **Given** the `metta-guard-bash` hook is active in an AI session **When** an authorized skill flow issues `metta tokens record` **Then** the guard allowlist (identical in both hook copies) permits the command
- **Given** a change other than the active one **When** `--change <name>` is supplied **Then** the entry is recorded against that named change

---

## US-2: Lifecycle skills contractually capture token usage

**As a** metta user running lifecycle skills (plan, execute, verify, next)
**I want to** have the skills instruct the orchestrator to record every returning subagent's token usage automatically
**So that** token capture happens by contract — like iteration and model-escalation records — instead of depending on anyone remembering to log it manually

**Priority:** P1
**Independent Test Criteria:** Each subagent-spawning lifecycle skill (metta-plan, metta-execute, metta-verify, metta-next) contains an instruction to run `metta tokens record` after each subagent returns, with template and deployed skill files byte-identical.

**Acceptance Criteria:**
- **Given** a lifecycle skill that spawns subagents **When** a subagent (executor, reviewer, verifier, or planning role) completes and reports token usage **Then** the skill directs the orchestrator to record that usage via `metta tokens record` before proceeding
- **Given** the skill template files and their deployed copies **When** the change is finalized **Then** each template/deployed pair is byte-identical
- **Given** the recording instruction is in place **When** skills run **Then** model routing and agent behavior are otherwise unchanged — recording is observability only

---

## US-3: Per-change token report at finalize

**As a** developer reviewing a completed change
**I want to** receive a TOKENS.md report in the change directory before archive — totals, per-artifact table, per-role and per-model rollups, cheap-vs-inherit split, and a GAPS section for artifacts that ran without a token record
**So that** I can see exactly which artifacts, roles, and model tiers consumed the change's credits, and where recording coverage is incomplete

**Priority:** P1
**Independent Test Criteria:** Finalizing a change with `token_usage` data produces a deterministic, template-driven TOKENS.md in the change directory (surfaced as `tokensPath` in human and `--json` output), and a failed finalize leaves no stray TOKENS.md behind.

**Acceptance Criteria:**
- **Given** a change with recorded `token_usage` entries **When** finalize passes its gates **Then** TOKENS.md is assembled from an external template into the change dir before archiving, with an approximate-figures header, totals, per-artifact table, per-role and per-model rollups, and cheap-vs-inherit split
- **Given** artifacts with run evidence in `artifact_timings` but no matching token record **When** the report is assembled **Then** those artifacts appear in a GAPS section
- **Given** report assembly fails **When** finalize runs **Then** finalize warns and continues (mirroring the UAT.md precedent) rather than blocking the change
- **Given** `tokens.enabled` is set to false in config **When** finalize runs **Then** no TOKENS.md is generated and finalize completes normally
- **Given** finalize completes with a report **When** output is rendered **Then** `tokensPath` appears in both human and `--json` output, additively alongside `uatPath`

---

## US-4: Cross-change token averages by workflow tier

**As a** developer deciding whether to push more work to cheap models
**I want to** see average tokens per change grouped by workflow tier in `metta progress`, aggregated across active and archived changes
**So that** future routing and tiering decisions are grounded in per-tier token evidence instead of guesswork

**Priority:** P2
**Independent Test Criteria:** `metta progress` displays avg-tokens-per-change per workflow tier computed from `token_usage` across active and archived changes, distinguishing explicit no-data from zero and passing null through in `--json`.

**Acceptance Criteria:**
- **Given** multiple changes with `token_usage` data across tiers **When** `metta progress` runs **Then** the dashboard shows average tokens per change grouped by workflow tier
- **Given** a tier with no recorded token data **When** the aggregate is rendered **Then** it is shown as explicit no-data (not zero) in human output and as null in `--json`, following ceremony-metric conventions
- **Given** archived changes recorded before this feature (no `token_usage` field) **When** aggregation runs **Then** they are handled gracefully without errors and without being retrofitted

---
