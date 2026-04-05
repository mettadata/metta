# 99 — Suggested Resolutions

For each item in [99-issues.md](99-issues.md), a concrete resolution with the exact changes needed.

---

## Issues

### ISSUE-001: Inconsistent workflow artifact counts

**Resolution**: Standardize on these counts:

| Workflow | Artifacts | List |
|----------|-----------|------|
| Quick | 3 | intent, execution, verification |
| Standard | 6 | intent, spec, design, tasks, execution, verification |
| Full | 9 | research, intent, spec, design, architecture, ux-spec, tasks, execution, verification |

"Ship" is a **command**, not an artifact. Remove it from any artifact list. The Full workflow graph in `03-workflow-engine.md` already shows 9 nodes correctly — propagate this everywhere.

**Changes**:
- `README.md` line 36: change "10 artifacts" to "9 artifacts" in the Full workflow label
- `01-philosophy.md` line 88: remove "ship" from the Full path, recount to 9
- `00-quickstart-usage.md` line 361: change "10 artifacts" to "9 artifacts"
- `03-workflow-engine.md` line 155: change "10 artifacts" heading to "9 artifacts"

---

### ISSUE-002: `change.shipped` hook event misaligned with finalize/ship split

**Resolution**: Split into two events that match the actual commands:

```yaml
# Replace single event:
#   change.shipped → "when a change is archived"

# With two events:
change.finalized:
  fires_when: "metta finalize completes (archive, spec merge, docs, refresh)"
  payload: { change_name, archived_path, merged_specs, generated_docs }

change.shipped:
  fires_when: "metta ship completes (merge to main or PR created)"
  payload: { change_name, merge_commit, pr_url }
```

**Changes**:
- `08-plugins.md` line 144: replace the single `change.shipped` row with two rows:
  - `change.finalized` — fires when `metta finalize` completes (archive, spec merge, doc generation)
  - `change.shipped` — fires when `metta ship` completes (merge to main or PR created)

---

### ISSUE-003: Merge algorithm described under wrong command

**Resolution**: Change the trigger description from `metta ship` to `metta finalize`.

**Changes**:
- `06-spec-model.md` line 168: change "When a change is archived (`metta ship`):" to "When a change is finalized (`metta finalize`):"
- Same section: add a note that `metta ship` only performs the git merge to main — all spec merging and archiving happens in `metta finalize`

---

### ISSUE-004: Change-level vs artifact-level status enums undifferentiated

**Resolution**: Add an explicit callout in both docs distinguishing the two status domains.

**Changes**:
- `06-spec-model.md` above the `ChangeMetadataSchema`: add a paragraph:
  > **Note**: Change-level status (`active | paused | complete | abandoned`) tracks the overall lifecycle of a change. This is distinct from artifact-level status (`pending | ready | in_progress | complete | failed | skipped`) defined in the Workflow Engine, which tracks individual artifacts within a change.
- `03-workflow-engine.md` in the Status Tracking section: add a cross-reference:
  > These are **artifact-level** statuses within a change. For the change's own lifecycle status, see [06-spec-model.md § Change Metadata](06-spec-model.md).

---

### ISSUE-005: `--from-gap` identifier doesn't match gap filename convention

**Resolution**: Use the gap filename slug (without `.md`) as the identifier everywhere.

**Changes**:
- `00-quickstart-usage.md` line 118: change `"payments/refund-processing"` to `"payments-partial-refunds"`
- `11-brownfield.md` line 661: change `"payments/refund-processing"` to `"payments-partial-refunds"`
- Ensure all `--from-gap` examples use dash-separated slugs matching the filenames in `spec/gaps/`

---

### ISSUE-006: Executor context budget vs orchestrator budget unclear

**Resolution**: Add a clarification box in `04-context-engine.md` explaining the distinction between "context budget" (what the framework loads into instructions) and "context window" (total tokens available to the AI tool).

**Changes**:
- `04-context-engine.md` after the Agent-Specific Budgets section, add:

  > ### Budget vs Window
  >
  > An agent's `context_budget` controls how many tokens the Context Engine loads into the agent's instructions — project context, specs, task details. This is **not** the agent's total context window.
  >
  > When an executor spawns with `context_budget: 10000`, it receives ~10K tokens of framework-curated context inside a fresh ~176K token window. The remaining window is available for the AI to read code, think, and generate output.
  >
  > The orchestrator's ~15K budget is higher because it needs the batch plan, gate results, and deviation log — coordination metadata that executors don't carry.

- `07-execution-engine.md` line 61: add "(~15K tokens of framework context)" to clarify the orchestrator figure refers to loaded context, not total window

---

### ISSUE-007: `spec/` path configurability contradicted

**Resolution**: Align on "hardcoded for v1" — this is the simpler and more honest position. Configurability can be added later.

**Changes**:
- `02-architecture.md` line 186: change "(configurable path)" to "(hardcoded to `spec/` in v1)"
- `02-architecture.md` line 173: change "(configurable)" after `docs/` to "(configurable)" and after `spec/` to "(fixed in v1, configurable in future)"
- Keep `docs/` path as configurable since `09-cli-integration.md` already shows `docs.output: ./docs` in config

---

## Gaps

### GAP-001: No behavior defined for `metta init` in non-git repos

**Resolution**: Add a paragraph to `00-quickstart-usage.md` in the Git Safety section and to `07-execution-engine.md` in the Git Configuration section.

**Suggested text for `00-quickstart-usage.md`**:

> ### Non-Git Projects
>
> If `metta init` detects no `.git` directory, it prompts:
>
> ```
> No git repository detected.
>   [1] Initialize git (git init) and continue with full git safety
>   [2] Continue without git (file-only mode — no worktrees, no merge safety)
> ```
>
> Choosing option 2 sets `git.enabled: false` in `.metta/config.yaml`. All workflows run sequentially with no worktree isolation. You can enable git later by initializing a repo and running `metta config set git.enabled true`.

**Suggested text for `07-execution-engine.md`** in the Git Configuration section, after the file-only mode paragraph:

> `metta init` auto-detects whether a git repository exists. If not, it offers to initialize one or fall back to file-only mode. File-only mode can also be set explicitly for projects that use a different VCS or no VCS at all.

---

### GAP-002: No `metta changes abandon` behavior documented

**Resolution**: Add a section to `09-cli-integration.md` or `07-execution-engine.md`.

**Suggested text**:

> ### Abandoning a Change
>
> ```bash
> metta changes abandon add-payment-processing
> ```
>
> Abandoning a change:
>
> 1. **Confirms** — interactive prompt unless `--force` is passed
> 2. **Archives** — moves `spec/changes/<name>/` to `spec/archive/YYYY-MM-DD-<name>-abandoned/` with status `abandoned` in metadata
> 3. **Discards deltas** — delta specs are archived but NOT merged into living specs
> 4. **Cleans worktrees** — removes all worktree branches for this change (`metta/<name>/*`)
> 5. **Removes snapshots** — cleans up `metta/pre-merge/*` tags for this change
> 6. **Resets state** — removes the change from `.metta/state.yaml`
>
> The archived artifacts are preserved for reference (why was this abandoned?) but have no effect on living specs or future changes.
>
> ```bash
> metta changes abandon add-payment-processing --force  # Skip confirmation
> metta changes abandon add-payment-processing --delete  # Archive nothing, just clean up
> ```

---

### GAP-003: No multi-change concurrent workflow described

**Resolution**: Add a "Working with Multiple Changes" section to `09-cli-integration.md` or a new `12-multi-change.md` doc (lighter option: add to 09).

**Suggested text for `09-cli-integration.md`**:

> ### Working with Multiple Changes
>
> You can have multiple active changes simultaneously:
>
> ```bash
> metta propose "add user profiles"
> metta propose "fix payment rounding"
> ```
>
> Each change gets its own directory in `spec/changes/`, its own worktree branch, and its own state.
>
> **Switching between changes**:
> ```bash
> metta status                    # Shows all active changes
> metta status add-user-profiles  # Show specific change
> metta execute add-user-profiles # Operate on a specific change
> ```
>
> If only one change is active, commands operate on it implicitly. If multiple are active, commands that need a target require the change name or prompt for selection.
>
> **Spec overlap**: If two changes modify the same capability's spec, the first to `metta finalize` wins cleanly. The second hits the merge algorithm's conflict detection (see [06-spec-model.md § Merge Algorithm](06-spec-model.md)) and resolves interactively.

---

### GAP-004: No provider system documentation

**Resolution**: Add a "Provider System" section to `08-plugins.md` or create a dedicated `12-providers.md`. Since providers are one of the five plugin types AND critical infrastructure, expanding the existing section in 08 is sufficient for now.

**Suggested text to add after the Provider Plugins section in `08-plugins.md`**:

> ### Provider Configuration
>
> Providers are configured in `~/.metta/config.yaml` (global) or `.metta/config.yaml` (project override):
>
> ```yaml
> providers:
>   main:
>     provider: anthropic
>     model: claude-opus-4-6-20250415
>   research:
>     provider: anthropic
>     model: claude-sonnet-4-6-20250414
>   fallback:
>     provider: openai
>     model: gpt-4.1
> ```
>
> **Roles**: Each provider entry is a role, not a provider instance. Roles determine which model handles which operation:
>
> | Role | Used for | Default |
> |------|----------|---------|
> | `main` | Spec writing, design, execution, verification | Required |
> | `research` | Domain research, codebase analysis, import scanning | Falls back to `main` |
> | `fallback` | Used when `main` provider fails after retries | Optional |
>
> **API Keys**: Never stored in config files. Referenced via environment variables:
>
> ```yaml
> # ~/.metta/local.yaml (gitignored)
> providers:
>   main:
>     api_key_env: ANTHROPIC_API_KEY  # Name of the env var, not the key itself
> ```
>
> **Instruction mode vs Orchestrator mode**:
> - In instruction mode (v1), the provider is only used for the spec-compliance gate (Layer 2) and `metta import` analysis. The external AI tool does the heavy lifting.
> - In orchestrator mode (future), the provider drives all AI operations directly.
>
> **Cost awareness**: Provider calls log token usage to `.metta/state.yaml`. `metta context stats` includes a provider usage section showing tokens consumed and estimated cost per change.

---

### GAP-005: `metta doctor` behavior undocumented

**Resolution**: Add a section to `09-cli-integration.md` under Key Commands.

**Suggested text**:

> ### `metta doctor`
>
> Diagnoses common issues and reports the health of the Metta installation:
>
> ```bash
> metta doctor
> ```
>
> ```
> Metta Doctor
>
> Framework:
>   ✓ Metta version: 1.2.0
>   ✓ Node.js version: 22.4.0 (requires 22+)
>   ✓ Global config: ~/.metta/config.yaml
>
> Project:
>   ✓ Project config: .metta/config.yaml
>   ✓ Constitution: spec/project.md
>   ✓ Schema version: 3 (current)
>
> Git:
>   ✓ Git repository detected
>   ✓ On branch: main (protected)
>   ✗ 2 orphaned worktrees found — run `metta cleanup` to remove
>
> Providers:
>   ✓ ANTHROPIC_API_KEY set
>   ✗ OPENAI_API_KEY not set (fallback provider unavailable)
>
> Gates:
>   ✓ tests: `pnpm test` — found
>   ✓ lint: `pnpm lint` — found
>   ✗ typecheck: `npx tsc --noEmit` — tsc not found in PATH
>
> AI Tools:
>   ✓ Claude Code detected — skills installed
>   ✓ Cursor detected — skills installed
>
> Issues found: 3
>   Run `metta cleanup` to fix orphaned worktrees
>   Set OPENAI_API_KEY for fallback provider
>   Install typescript (`npm i -D typescript`) for typecheck gate
> ```
>
> Checks performed:
> - Framework and Node.js version compatibility
> - Schema version (current, needs migration, or ahead of framework)
> - Git repository state and orphaned worktrees
> - Provider API key availability (env var check only, no API call)
> - Gate command availability (checks commands exist in PATH)
> - AI tool detection and skill installation status
> - State file integrity (Zod validation)
> - Stale context files (constitution newer than generated files)

---

### GAP-006: No team/collaboration workflow guide

**Resolution**: Add a "Team Workflows" section to `02-architecture.md` under ADR-009, or create a dedicated doc. For now, expand ADR-009.

**Suggested text to append to ADR-009 in `02-architecture.md`**:

> ### Team Workflow in Practice
>
> **What's shared** (committed to git):
> - `spec/` — all specs, changes, gaps, ideas, issues, roadmap
> - `.metta/config.yaml` — project-level config
> - `.metta/workflows/`, `.metta/agents/`, `.metta/gates/` — project customizations
>
> **What's local** (gitignored):
> - `.metta/state.yaml` — each developer's execution state
> - `.metta/local.yaml` — personal config overrides
>
> **Coordination model**: Developers coordinate through specs, not through state. When Dev A runs `metta propose "add auth"`, the change directory `spec/changes/add-auth/` is committed. Dev B sees it via `git pull` and `metta changes list`. Ownership is tracked via the `owner` field in `spec/changes/add-auth/.metta.yaml` (set to git username).
>
> **Conflict prevention**: Two developers can work on separate changes simultaneously. If both changes touch the same spec capability, the first to `metta finalize` merges cleanly. The second hits conflict detection at the requirement level and resolves interactively.
>
> **Handoff**: To hand off a change, the new owner updates the `owner` field in `.metta.yaml` and commits. The new developer runs `metta execute --resume` to pick up where the previous owner left off (state is reconstructed from committed artifacts and git history).

---

### GAP-007: `spec/backlog/` directory has no CLI commands

**Resolution**: Remove `spec/backlog/` from the directory structure. Ideas and issues already cover the capture-now-process-later pattern. If a distinction is needed later, it can be added as a status field on ideas (`status: backlog | active | shelved`).

**Changes**:
- `02-architecture.md` line 209: remove the `backlog/` entry and its description from the directory structure
- If the concept of "backlog" is needed, add a `status: backlog` option to ideas and document it in the ideas section of `09-cli-integration.md`

---

### GAP-008: No logging/observability story

**Resolution**: Add a brief section to `09-cli-integration.md` under a new "Observability" heading.

**Suggested text**:

> ### Logging & Observability
>
> **Verbosity levels**:
> ```bash
> metta execute                  # Normal output (progress, results)
> metta execute --verbose        # Detailed output (context loading, gate details, provider calls)
> metta execute --debug          # Full debug output (all internal state transitions)
> ```
>
> **Log file**: When running in auto mode or long-running operations, Metta writes a session log to `.metta/logs/<change-name>-<timestamp>.log`. Logs include:
> - Context loading decisions (what was loaded, truncated, skipped)
> - Provider calls (prompt size, response size, duration, cost estimate)
> - Gate results (pass/fail, duration, output)
> - State transitions (artifact status changes)
> - Deviation events
>
> **Provider token tracking**: Each provider call logs token usage. `metta context stats` includes a provider section:
> ```
> Provider usage (this change):
>   anthropic/claude-opus-4-6:   142K input, 38K output (~$2.40)
>   anthropic/claude-sonnet-4-6:  28K input, 12K output (~$0.18)
> ```
>
> Logs are gitignored. Old logs are cleaned up by `metta cleanup`.

---

## Suggestions

### SUG-001: Add a lifecycle diagram

**Resolution**: Add the following to `00-quickstart-usage.md` after the "Three Ways to Work" section:

```
## Lifecycle Overview

                     ┌─────────────────────────────────────────────┐
                     │              Discovery Gate                  │
                     │  (adaptive questions until zero ambiguity)   │
                     └──────────────────┬──────────────────────────┘
                                        │
    ┌─────────┐   ┌─────────┐   ┌──────▼──┐   ┌────────┐   ┌─────────┐
    │ propose │──▶│  plan   │──▶│ execute │──▶│ verify │──▶│finalize │
    │         │   │         │   │         │   │        │   │         │
    │ intent  │   │ design  │   │ batch 1 │   │ spec   │   │ archive │
    │ spec    │   │ tasks   │   │  gates  │   │ comply │   │ merge   │
    │         │   │         │   │ batch 2 │   │        │   │ docs    │
    └─────────┘   └─────────┘   │  gates  │   └───┬────┘   └────┬────┘
                                │  ...    │       │              │
                                └─────────┘       │         ┌────▼────┐
                                                  │         │  ship   │
                         ┌────────────────────────┘         │         │
                         │ gaps found?                      │ merge   │
                         │                                  │ safety  │
                         ▼                                  │ pipeline│
                    re-plan gaps ──▶ execute ──▶ verify     └─────────┘
                    (auto mode loops until all scenarios pass)

    Gates fire: after each task (tests, lint, typecheck)
                after each batch (build)
                after all batches (spec-compliance)
                after merge to main (post-merge gates)
```

---

### SUG-002: Consolidate merge safety to a single canonical section

**Resolution**:

- `07-execution-engine.md`: keep the full detailed merge safety section as-is (canonical)
- `00-quickstart-usage.md` lines 257-277: replace the 7-step expanded list with a brief summary and cross-reference:

  > ### Git Safety — Everything in Worktrees
  >
  > All work happens in worktree branches. No agent ever commits directly to main. Before anything merges, it passes through a 7-step merge safety pipeline: base drift check, dry-run merge, scope check, gate verification, snapshot, merge, post-merge gates. If post-merge gates fail, main is rolled back automatically.
  >
  > See [07-execution-engine.md § Merge Safety](07-execution-engine.md) for the full pipeline specification.

- `02-architecture.md`: already references 07 correctly, no change needed

---

### SUG-003: Add a "What Happens When Things Go Wrong" section

**Resolution**: Add a new section to `07-execution-engine.md` after the Failure Recovery section, or create a standalone `12-troubleshooting.md`. Since 07 already has Failure Recovery, extending it is natural.

**Suggested heading and topics to add to `07-execution-engine.md`**:

> ### Common Failure Scenarios
>
> **Stalled auto-mode loop**: Same scenarios fail for 2+ cycles. Auto mode halts with a diagnostic showing which scenarios are stuck and what was attempted. User should review the spec for ambiguity or the design for feasibility. Resume after fixing: `metta auto --resume`.
>
> **Provider outage mid-execution**: Provider failure after retries triggers explicit pause. State is saved. Worktree is preserved. Resume when provider is back: `metta execute --resume`. If using a fallback provider, Metta switches automatically (if configured).
>
> **Spec conflicts blocking finalize**: `metta finalize` surfaces conflicts interactively. Use `metta finalize --dry-run` to preview. Resolve conflicts on the worktree branch, commit, and retry `metta finalize`.
>
> **Corrupted state**: If `.metta/state.yaml` fails schema validation, `metta doctor` reports the issue. Recovery: delete `.metta/state.yaml` (it's local, gitignored) and reconstruct from committed artifacts using `metta execute --resume` (which reads artifact status from disk, not state).
>
> **Orphaned worktrees after crash**: `metta cleanup` removes worktrees whose changes no longer exist. `metta doctor` detects them proactively.
>
> **Gate passes in worktree, fails post-merge**: Automatic rollback via snapshot tag. Worktree branch is preserved for diagnosis. The most common cause is integration conflicts between parallel tasks — check which batch's merge introduced the failure.

---

### SUG-004: Document `metta instructions` output format

**Resolution**: Add a sample to `09-cli-integration.md` after the "Key Design Choice: CLI as Bridge" section.

**Suggested text**:

> ### `metta instructions` Output Format
>
> ```bash
> metta instructions intent --json
> ```
>
> ```json
> {
>   "artifact": "intent",
>   "change": "add-payment-processing",
>   "workflow": "standard",
>   "status": "ready",
>   "agent": {
>     "name": "proposer",
>     "persona": "You are a product-minded engineer...",
>     "tools": ["Read", "Grep", "Glob"],
>     "rules": ["..."]
>   },
>   "template": "# add-payment-processing\n\n## Problem\n...",
>   "context": {
>     "project": "E-commerce platform for handmade goods...",
>     "existing_specs": ["auth (4 reqs)", "payments (6 reqs)"],
>     "active_gaps": ["payments-partial-refunds"]
>   },
>   "output_path": "spec/changes/add-payment-processing/intent.md",
>   "next_steps": [
>     "Create the intent artifact following the template",
>     "Run `metta status --json` to confirm completion",
>     "Run `metta instructions spec --json` for the next artifact"
>   ],
>   "gates": [],
>   "budget": {
>     "context_tokens": 18200,
>     "budget_tokens": 20000
>   }
> }
> ```
>
> This is what AI tools receive. The `template` provides structure, `context` provides project knowledge, `agent` provides persona and constraints, and `next_steps` provides the workflow continuation path.

---

### SUG-005: Index the ADRs

**Resolution**: Add an ADR index to the top of `02-architecture.md`, after the system layers diagram.

**Suggested text**:

> ### Architectural Decision Records
>
> | ADR | Decision | Section |
> |-----|----------|---------|
> | ADR-001 | ESM Only | [Link](#adr-001-esm-only) |
> | ADR-002 | Dependency Injection Over Singletons | [Link](#adr-002-dependency-injection-over-singletons) |
> | ADR-003 | Templates as External Files | [Link](#adr-003-templates-as-external-files) |
> | ADR-004 | Schema Validation on Every State Transition | [Link](#adr-004-schema-validation-on-every-state-transition) |
> | ADR-005 | Conflict Detection at Merge Time | [Link](#adr-005-conflict-detection-at-merge-time) |
> | ADR-006 | Git-Aware as a Config Toggle | [Link](#adr-006-git-aware-as-a-config-toggle) |
> | ADR-007 | Dual-Mode Architecture | [Link](#adr-007-dual-mode-architecture) |
> | ADR-008 | Schema Migration on Update | [Link](#adr-008-schema-migration-on-update) |
> | ADR-009 | Team Model | [Link](#adr-009-team-model) |

---

### SUG-006: Clarify executor 10K budget vs fresh 176K window

**Resolution**: Covered by ISSUE-006 resolution above. The same text handles both the issue (confusion) and the suggestion (clarification).
