# 99 — Design Review Issues

## Issues (Contradictions / Errors)

### ISSUE-001: Inconsistent workflow artifact counts

The "Full" workflow artifact count varies across docs:

- `README.md`: "10 artifacts"
- `01-philosophy.md`: lists 9 phases (research, intent, spec, design, architecture, tasks, execute, verify, ship)
- `03-workflow-engine.md`: shows 10 artifacts in the graph but "ship" is not an artifact node
- `00-quickstart-usage.md`: labels Full as "10 artifacts"

"Ship" appears as a phase in 01 but is not represented as an artifact elsewhere. The Standard workflow YAML in 03 only defines 6 artifacts. Settle on exact counts per workflow and make them consistent across all docs.

**Files**: README.md, 01-philosophy.md, 03-workflow-engine.md, 00-quickstart-usage.md

---

### ISSUE-002: `change.shipped` hook event misaligned with finalize/ship split

`08-plugins.md` line 144 defines hook event `change.shipped` as firing "when a change is archived." But archiving happens during `metta finalize`, not `metta ship`. Ship only performs the git merge to main.

Either rename the event to `change.finalized` or add separate events for both steps (`change.finalized` and `change.shipped`).

**Files**: 08-plugins.md

---

### ISSUE-003: Merge algorithm described under wrong command

`06-spec-model.md` line 168 says the merge algorithm runs "When a change is archived (`metta ship`)." Per `07-execution-engine.md`, spec merging happens during `metta finalize`, not `metta ship`. Ship only does the git merge to main.

**Files**: 06-spec-model.md

---

### ISSUE-004: Change-level vs artifact-level status enums undifferentiated

- `06-spec-model.md` line 293: `status: z.enum(["active", "paused", "complete", "abandoned"])`
- `03-workflow-engine.md` lines 326-335: artifact statuses are `pending | ready | in_progress | complete | failed | skipped`

These are separate concepts (change status vs artifact status) but this is never explicitly stated. Easy to conflate when reading across docs.

**Files**: 06-spec-model.md, 03-workflow-engine.md

---

### ISSUE-005: `--from-gap` identifier doesn't match gap filename convention

- `00-quickstart-usage.md` line 118: `metta propose --from-gap "payments/refund-processing"` (slash-separated)
- `11-brownfield.md` line 661: same slash-separated format
- Gap files are named `payments-partial-refunds.md` (dash-separated, flat in `spec/gaps/`)

The gap identifier in CLI examples should match the actual filename convention (dash-separated, no subdirectory path).

**Files**: 00-quickstart-usage.md, 11-brownfield.md

---

### ISSUE-006: Executor context budget vs orchestrator budget unclear

- `04-context-engine.md` line 41: execution budget is `10000` tokens
- `05-agent-system.md` line 53: executor budget is `10K`
- `07-execution-engine.md` line 61: orchestrator is "~15K tokens"

The executor gets 10K but the orchestrator (supposed to be "lean") gets 15K. Meanwhile executors get fresh 176K windows per task. The 10K budget appears to be for context manifest loading (instructions only), not the full window. This distinction is not clarified.

**Files**: 04-context-engine.md, 05-agent-system.md, 07-execution-engine.md

---

### ISSUE-007: `spec/` path configurability contradicted

- `09-cli-integration.md` line 449: spec working artifacts are "hardcoded for v1"
- `02-architecture.md` line 186: `spec/` is labeled as a "configurable path"

Pick one and propagate consistently.

**Files**: 09-cli-integration.md, 02-architecture.md

---

## Gaps (Missing Coverage)

### GAP-001: No behavior defined for `metta init` in non-git repos

`metta init` assumes git exists. `git.enabled: true` is the default, but what happens if there is no `.git` directory? Does it auto-set `git.enabled: false`? Silently skip worktree setup? Prompt the user? This flow is not covered.

**Files**: 00-quickstart-usage.md, 02-architecture.md, 07-execution-engine.md

---

### GAP-002: No `metta changes abandon` behavior documented

`metta changes abandon <name>` appears in the CLI listing (`09-cli-integration.md` line 59) but no doc explains what happens: worktree cleanup, spec delta discarding, state reset, partially committed work. This is an important real-world scenario.

**Files**: 09-cli-integration.md

---

### GAP-003: No multi-change concurrent workflow described

`01-philosophy.md` says parallel changes are first-class. `06-spec-model.md` has the merge algorithm. But no doc describes the UX of working on two changes simultaneously:

- Can you `metta propose` twice?
- Does `metta status` show multiple changes?
- How do you switch between active changes?
- What happens if two changes touch the same spec capability?

**Files**: 01-philosophy.md, 06-spec-model.md, 09-cli-integration.md

---

### GAP-004: No provider system documentation

`08-plugins.md` shows the provider plugin interface. `09-cli-integration.md` references `providers.yaml`. But there is no doc covering:

- How to configure API keys (env vars, local.yaml, etc.)
- How role-based model selection works (main/research/fallback routing)
- How the provider is invoked during orchestrator mode vs instruction mode
- Retry/fallback chain behavior in practice
- Token usage tracking and cost awareness

This is critical infrastructure — it deserves a dedicated section or doc.

**Files**: 08-plugins.md, 09-cli-integration.md, 02-architecture.md

---

### GAP-005: `metta doctor` behavior undocumented

Mentioned in the CLI command list and ADR-008 (schema version check), but no doc describes what `metta doctor` actually checks. Likely candidates: schema version, gate configurations, provider connectivity, missing dependencies, orphaned worktrees, stale state.

**Files**: 09-cli-integration.md, 02-architecture.md

---

### GAP-006: No team/collaboration workflow guide

`02-architecture.md` ADR-009 mentions the team model briefly (state is gitignored, specs are committed, ownership via `owner` field). But there is no practical guide for:

- How two developers work simultaneously on different changes
- How spec conflicts are handled in real-time (not just at merge)
- How change ownership and handoff works
- How `metta status` looks for a team member joining mid-project

**Files**: 02-architecture.md

---

### GAP-007: `spec/backlog/` directory has no CLI commands

`spec/backlog/` exists in the directory structure (`02-architecture.md` line 209). `spec/ideas/` and `spec/issues/` both have full CLI support. But `spec/backlog/` has no commands, no creation flow, and no promotion path.

Is backlog the same as ideas? If so, remove the separate directory. If distinct, add CLI commands and document the distinction.

**Files**: 02-architecture.md, 09-cli-integration.md

---

### GAP-008: No logging/observability story

No mention of how Metta logs its own operations: debug logging, audit trails, verbose mode (`--verbose`), log file location. For a framework that orchestrates potentially expensive AI calls and multi-step workflows, users need to see what happened and why — especially when diagnosing auto-mode failures or unexpected gate results.

**Files**: all docs

---

## Suggestions (Improvements)

### SUG-001: Add a lifecycle diagram to README or 00-quickstart

A single visual showing `init -> propose -> plan -> execute -> verify -> finalize -> ship` with the discovery gate, auto-mode loop, and where gates fire would make the whole system click faster than reading 12 separate docs.

**Files**: README.md or 00-quickstart-usage.md

---

### SUG-002: Consolidate merge safety to a single canonical section

Merge safety is partially described in:
- `00-quickstart-usage.md` (abbreviated 7-step list)
- `07-execution-engine.md` (full detail with code)
- `02-architecture.md` (referenced)

Make `07-execution-engine.md` the canonical reference. Have others point to it with a one-liner rather than maintaining partial duplications that can drift.

**Files**: 00-quickstart-usage.md, 07-execution-engine.md, 02-architecture.md

---

### SUG-003: Add a "What Happens When Things Go Wrong" section

Each doc describes the happy path well. A dedicated troubleshooting/failure-mode section (or standalone doc) covering:
- Stalled auto-mode loops
- Provider outages mid-execution
- Spec conflicts blocking finalize
- Corrupted state recovery (`metta doctor` + manual fixes)
- Worktree cleanup after crashes

This would build confidence that the framework handles real-world chaos.

---

### SUG-004: Document `metta instructions` output format

`metta instructions <artifact> --json` is the core bridge between the framework and AI tools — it's what every slash command calls. But its output structure is never shown. A sample response would help both users and future adapter authors understand what the AI tool actually receives.

**Files**: 09-cli-integration.md

---

### SUG-005: Index the ADRs

There are 9 ADRs in `02-architecture.md` (ADR-001 through ADR-009). Add a quick index at the top of the architecture doc or in the README so they are discoverable without reading the full document.

**Files**: 02-architecture.md, README.md

---

### SUG-006: Clarify executor 10K budget vs fresh 176K window

The executor's `context_budget: 10000` in the agent definition controls how much context the Context Engine loads into the instructions. The executor then runs in a fresh 176K window where most of the budget is available for the AI to think and generate code. This distinction between "context loaded by the framework" and "context window available to the AI" should be stated explicitly.

**Files**: 04-context-engine.md, 05-agent-system.md
