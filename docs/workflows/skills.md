# Skills — `/metta-*` Reference

Complete reference for the 18 metta skills shipped with metta. Each skill is a slash command
available to AI orchestrators once installed (see `/metta-init`). Skill source lives at
`src/templates/skills/metta-*/SKILL.md`; installed mirrors at `.claude/skills/metta-*/SKILL.md`
are kept byte-identical to the source templates — enforced by `tests/grounding.test.ts` and
`tests/skill-discovery-loop.test.ts`.

An orchestrator invokes a skill, the skill calls the underlying CLI (see the **Wraps CLI** line
for each entry), parses the JSON response, and spawns the appropriate subagents. For the
subagent taxonomy see [`agents.md`](agents.md); for artifact definitions see
[`artifacts.md`](artifacts.md); for the YAML workflow sequences see
[`workflows.md`](workflows.md).

## Skill index

| Group | Skill | Purpose |
|-------|-------|---------|
| Lifecycle | [`/metta-propose`](#metta-propose) | Start a new change with Metta |
| Lifecycle | [`/metta-quick`](#metta-quick) | Quick mode — small change without full planning |
| Lifecycle | [`/metta-auto`](#metta-auto) | Full lifecycle loop — discover, build, verify, ship |
| Lifecycle | [`/metta-plan`](#metta-plan) | Build planning artifacts for the active change |
| Lifecycle | [`/metta-execute`](#metta-execute) | Run implementation for the active change |
| Lifecycle | [`/metta-verify`](#metta-verify) | Verify implementation against spec |
| Lifecycle | [`/metta-ship`](#metta-ship) | Finalize and ship the active change |
| Status | [`/metta-status`](#metta-status) | Check current Metta change status |
| Status | [`/metta-progress`](#metta-progress) | Show project-level progress across all changes |
| Status | [`/metta-next`](#metta-next) | Advance to the next step in the workflow |
| Organization | [`/metta-issue`](#metta-issue) | Log an issue |
| Organization | [`/metta-fix-issues`](#metta-fix-issues) | Resolve an issue through the full metta change lifecycle |
| Organization | [`/metta-backlog`](#metta-backlog) | Manage backlog |
| Spec management | [`/metta-import`](#metta-import) | Analyze existing code and generate specs with gap reports |
| Spec management | [`/metta-fix-gap`](#metta-fix-gap) | Resolve a reconciliation gap through the full metta change lifecycle |
| Spec management | [`/metta-check-constitution`](#metta-check-constitution) | Check a change spec.md against the project constitution |
| Setup | [`/metta-init`](#metta-init) | Initialize Metta in a project with interactive discovery |
| Setup | [`/metta-refresh`](#metta-refresh) | Regenerate CLAUDE.md from project constitution and specs |

---

## Lifecycle skills

The seven lifecycle skills drive a change from proposal through merge. `/metta-propose`,
`/metta-quick`, and `/metta-auto` are top-level entry points; the remaining four
(`/metta-plan`, `/metta-execute`, `/metta-verify`, `/metta-ship`) are stage-level resumption
points that the orchestration skills invoke internally.

### `/metta-propose`

**Purpose:** Start a new change with Metta.
**Arguments:** `<description of what you want to build>` (from `argument-hint`). Also accepts
an optional `--workflow <name>` token embedded in the argument string — valid names are
`standard` (default), `quick`, and `full`, validated by the CLI.
**Wraps CLI:** `metta propose "<description>" [--workflow <name>] --json` (see
`src/cli/commands/propose.ts`). Subsequently drives `metta instructions`, `metta complete`, and
`metta finalize`.
**When to use:**
- Any non-trivial change — new feature, multi-file refactor, API surface change.
- Greenfield feature that needs a spec, design, and tasks.
- Change that will likely spawn research (2+ viable approaches).
- Change where discovery needs to be captured before writing artifacts.

**Flow summary:**
- Parse optional `--workflow <name>` from arguments and call `metta propose` to create the
  change on branch `metta/<change-name>`.
- Run the mandatory **discovery loop**: Round 1 (scope + architecture, always), Round 2 (data
  model + integration, conditional), Round 3 (edge cases + non-functional, conditional), Round
  4+ (open-ended). Every `AskUserQuestion` call includes a final `I'm done — proceed with
  these answers` option. A status line is printed between rounds.
- For each planning artifact in the chosen workflow (intent, spec, stories, research, design,
  tasks) call `metta instructions <artifact>` to get the persona + template, spawn the
  matching subagent to write the artifact, then run `metta complete <artifact>`.
- Parse `tasks.md` batches and spawn one `metta-executor` per task (parallel when files do
  not overlap, sequential when they do), then write `summary.md`.
- Run the three-reviewer fan-out (correctness, security, quality) with a bounded review-fix
  loop (max 3 iterations), then the three-verifier fan-out (tests, types+lint, spec
  scenarios).
- Call `metta finalize` then `git checkout main && git merge metta/<change-name> --no-ff` to
  ship.

**Subagents spawned:**
- `metta-proposer` — intent, spec (the proposer writes both).
- `metta-product` — stories (standard workflow). Intent content is wrapped in
  `<INTENT>...</INTENT>` XML tags for prompt-injection protection.
- `metta-researcher` — 2–4 in parallel, one per candidate approach.
- `metta-architect` — design.
- `metta-planner` — tasks.
- `metta-executor` — one per task, parallel when batches permit.
- `metta-reviewer` — three in parallel (correctness, security, quality).
- `metta-verifier` — three in parallel (tests, types+lint, spec compliance).

**Output:**
- A new git branch `metta/<change-name>`.
- All planning artifacts under `spec/changes/<change-name>/` (each its own commit).
- `review.md` and `summary.md` under the same directory.
- `metta finalize` archives the change to `spec/archive/` and merges delta specs into
  `spec/specs/`.
- A no-fast-forward merge commit on `main`.

---

### `/metta-quick`

**Purpose:** Quick mode — small change without full planning.
**Arguments:** `<description of the small change>` (from `argument-hint`).
**Wraps CLI:** `metta quick "$ARGUMENTS" --json` (see `src/cli/commands/quick.ts`). Then
drives `metta instructions intent`, `metta complete intent/implementation/verification`, and
`metta finalize`.
**When to use:**
- Single-line fixes, typo corrections, one-file deletes (the trivial-detection gate will skip
  discovery entirely).
- Small bug fixes where the approach is obvious.
- Tiny refactors with no open approach or scope questions.
- A change that would be waste-of-motion to route through full planning — but still wants the
  review + verify + finalize + merge scaffolding.

**Flow summary:**
- `metta quick "$ARGUMENTS" --json` creates the change on branch `metta/<change-name>`.
- Run the **trivial-detection gate** first. If zero approach/scope/integration decisions
  remain, skip discovery and go directly to proposing. Otherwise enter the light discovery
  loop (same round structure as `/metta-propose`).
- Spawn a `metta-proposer` for `intent.md` only (no spec, no design, no tasks); call
  `metta complete intent` to advance to implementation.
- Parallelize implementation if independent file groups exist; otherwise spawn a single
  `metta-executor`. Each executor runs tests, commits `feat(<change>): ...`. Finally write
  `summary.md`.
- Run the three-reviewer fan-out with a bounded review-fix loop, then the three-verifier
  fan-out, then `metta complete verification`.
- `metta finalize` + no-fast-forward merge back to `main`.

**Subagents spawned:**
- `metta-proposer` — intent only.
- `metta-executor` — one per independent file group (parallel) or one sequential.
- `metta-reviewer` — three in parallel.
- `metta-verifier` — three in parallel.

**Output:**
- A new git branch `metta/<change-name>`.
- `spec/changes/<change-name>/intent.md`, `summary.md`, `review.md`.
- Implementation commits on the feature branch using `feat(<change>): ...`.
- Archive under `spec/archive/`, merged delta specs, and a merge commit on `main`.

Note: if the change turns out to be more complex than expected, the skill tells the user to
use `/metta-propose` instead.

---

### `/metta-auto`

**Purpose:** Full lifecycle loop — discover, build, verify, ship.
**Arguments:** `<description of what to build>` (from `argument-hint`). Also accepts optional
`--workflow <name>` embedded in the argument string.
**Wraps CLI:** `metta propose "<description>" [--workflow <name>] --json` (see
`src/cli/commands/auto.ts` and `src/cli/commands/propose.ts`). Drives the entire lifecycle
including `metta instructions`, `metta complete`, `metta finalize`, and the final `git merge`.
**When to use:**
- You want to run a change end-to-end without manually invoking each stage skill.
- The orchestrator has high confidence the change can be produced with no human intervention
  beyond the initial discovery round.
- A batch-style workflow where the caller will walk away and check results later.

**Flow summary:**
- Parse optional `--workflow <name>` and call `metta propose` to create the change.
- Run the mandatory **discovery gate** (3–6 focused questions) before writing any artifacts.
- For each planning artifact in the workflow (intent, spec, design, tasks), run the
  `metta instructions` → spawn subagent → `metta complete` loop. Research uses 2–4 parallel
  `metta-researcher` agents.
- Parse `tasks.md` batches and spawn `metta-executor` agents per task, parallel by default,
  sequential on file overlap.
- Three-reviewer fan-out + bounded review-fix loop (max 3 iterations), then three-verifier
  fan-out, then `metta complete verification`.
- `metta finalize` followed by `git checkout main && git merge metta/<change-name> --no-ff`.

**Subagents spawned:**
- `metta-proposer`, `metta-researcher` (parallel), `metta-architect`, `metta-planner`,
  `metta-executor` (parallel per batch), `metta-reviewer` (×3 parallel), `metta-verifier`
  (×3 parallel). The `metta-product` stage is not included in `/metta-auto`'s default flow
  (contrast with `/metta-propose`).

**Output:**
- Full change directory under `spec/changes/<change-name>/` with all artifacts.
- Archive at `spec/archive/<change-name>/`, merged delta specs, and a merge commit on `main`.

---

### `/metta-plan`

**Purpose:** Build planning artifacts for the active change.
**Arguments:** none (frontmatter omits `argument-hint`).
**Wraps CLI:** `metta status --json` to discover readiness; then the
`metta instructions <artifact>` → `metta complete <artifact>` loop; finally
`metta check-constitution --change <name> --json` (see `src/cli/commands/plan.ts`,
`src/cli/commands/instructions.ts`, `src/cli/commands/complete.ts`,
`src/cli/commands/check-constitution.ts`).
**When to use:**
- Resume planning for an in-flight change after `metta propose` created it.
- Rebuild or extend planning artifacts after spec edits.
- Run the constitution check at the end of the planning phase as a standalone step.

**Flow summary:**
- `metta status --json` identifies which artifacts are ready next.
- For each ready artifact, fetch instructions, spawn the matching subagent type (research →
  `metta-researcher`, design → `metta-architect`, tasks → `metta-planner`, intent/spec →
  `metta-proposer`), and call `metta complete`.
- Continue until all planning artifacts are committed.
- Run `metta check-constitution --change <name> --json`. On exit 0 report success; on exit 4
  surface blocking violations and halt — the user must edit spec.md or add a
  `## Complexity Tracking` justification (critical violations are never justifiable).
- Re-running the skill re-runs the constitution check automatically.

**Subagents spawned:**
- `metta-proposer` (intent/spec), `metta-researcher` (research), `metta-architect` (design),
  `metta-planner` (tasks).

**Output:**
- Planning artifacts at `spec/changes/<change>/` (one commit per artifact).
- Constitution verdict either passing silently or blocking the workflow with a `violations.md`
  file written by the CLI.

---

### `/metta-execute`

**Purpose:** Run implementation for the active change.
**Arguments:** none.
**Wraps CLI:** `metta status --json` to confirm readiness and
`metta complete implementation --json --change <name>` to advance after implementation (see
`src/cli/commands/execute.ts`).
**When to use:**
- Resume implementation after planning is complete and `tasks.md` is written.
- Re-run execution after a review-fix loop surfaces additional work.
- Dispatch executors in parallel across independent files without driving a whole lifecycle.

**Flow summary:**
- `metta status --json` confirms implementation is ready.
- Read `spec/changes/<change>/tasks.md` and group tasks by `## Batch N`.
- For each batch, check file overlap across task `Files:` fields. No overlap → spawn all
  `metta-executor` agents in a single message (parallel). Overlap → sequential, one at a time.
- Each executor prompt carries that specific task's fields (Files, Action, Verify, Done) and
  the deviation rules (bug fix → separate commit, missing utility → separate commit, blocked
  >10 lines → stop, design wrong → stop).
- After all batches complete, write `summary.md` then `metta complete implementation`.

**Subagents spawned:**
- `metta-executor` — one per task, parallel per batch when files do not overlap.

**Output:**
- Implementation commits on the feature branch (`feat(<change>): ...`).
- `spec/changes/<change>/summary.md` with a recap of the batches executed.
- Workflow advances past the implementation stage.

---

### `/metta-verify`

**Purpose:** Verify implementation against spec.
**Arguments:** none.
**Wraps CLI:** `metta verify --json --change <name>` then
`metta complete verification --json --change <name>` (see `src/cli/commands/verify.ts`).
**When to use:**
- Re-run verification after a fix commit.
- Verify a change that was implemented without `/metta-auto`, `/metta-propose`, or
  `/metta-quick` orchestration.
- Run gates and author the verification summary as a standalone step.

**Flow summary:**
- Call `metta verify --json --change <name>` to run the gate suite and collect results.
- Spawn a single `metta-verifier` subagent with the spec, the gate results, and the task:
  walk each Given/When/Then scenario in `spec.md` and cite tests/code that cover it. Write
  the findings to `summary.md` with a conventional commit.
- `metta complete verification --json --change <name>`.
- When `all_complete: true`, instruct the user to run `/metta-ship`.

**Subagents spawned:**
- `metta-verifier` (single instance; the fan-out variant is driven by the larger orchestration
  skills).

**Output:**
- `spec/changes/<change>/summary.md` with verification findings committed as
  `docs(<change>): verification summary`.
- Workflow advances out of the verification stage.

---

### `/metta-ship`

**Purpose:** Finalize and ship the active change.
**Arguments:** none.
**Wraps CLI:** `metta finalize --dry-run --json --change <name>` then
`metta finalize --json --change <name>` (see `src/cli/commands/finalize.ts`), followed by
`git checkout main && git merge metta/<change-name> --no-ff -m "chore: merge <change-name>"`.
**When to use:**
- Verification is green and the change is ready to archive + merge.
- As a standalone follow-up after `/metta-verify` returns `all_complete: true`.
- Recovering from a prior ship attempt that halted on a dry-run difference.

**Flow summary:**
- Dry-run finalize to preview the archive + spec-merge plan.
- If clean, run the real finalize to archive the change to `spec/archive/<change-name>/` and
  merge delta specs into `spec/specs/`.
- If spec conflicts are reported, stop and tell the user — do not force-resolve.
- Switch to `main` and merge the feature branch with `--no-ff`.
- Report the final state to the user.

**Subagents spawned:** none (pure CLI + git).

**Output:**
- Archive directory at `spec/archive/<change-name>/` with all artifacts.
- Living specs at `spec/specs/<capability>/spec.md` updated with delta content.
- Merge commit `chore: merge <change-name>` on `main`.

---

## Status skills

Status skills are read-only dashboards that wrap the CLI's status surface. They do not spawn
subagents, author artifacts, or mutate state.

### `/metta-status`

**Purpose:** Check current Metta change status.
**Arguments:** none.
**Wraps CLI:** `metta status --json` (see `src/cli/commands/status.ts`).
**When to use:**
- Confirm which change is active on the current branch.
- Inspect the current lifecycle stage and the next expected artifact.
- Orient before running another lifecycle skill.

**Flow summary:**
- Run `metta status --json`.
- If no changes are active, suggest `/metta-propose` or `/metta-quick`.
- If multiple changes exist, list them with their status.

**Subagents spawned:** none.

**Output:**
- Status report printed to the user; no file or state mutation.

---

### `/metta-progress`

**Purpose:** Show project-level progress across all changes.
**Arguments:** none.
**Wraps CLI:** `metta progress --json` (see `src/cli/commands/progress.ts`).
**When to use:**
- Review project health across the whole `spec/changes/` set.
- Count shipped/completed changes for status reporting.
- Identify stalled changes by their current artifact.

**Flow summary:**
- Run `metta progress --json`.
- Surface active changes with progress percentage and current artifact, completed/shipped
  counts, and a project-wide summary.

**Subagents spawned:** none.

**Output:**
- Dashboard printed to the user; no mutations.

---

### `/metta-next`

**Purpose:** Advance to the next step in the workflow.
**Arguments:** none.
**Wraps CLI:** `metta next --json` (see `src/cli/commands/next.ts`). Executes whatever command
the response identifies.
**When to use:**
- You know a change is in flight but aren't sure which stage skill to run next.
- Orchestrating a long-running lifecycle and want the CLI to pick each next step.
- Recover from a partial state without manually inspecting `.metta/`.

**Flow summary:**
- `metta next --json` returns the next action plus a concrete command.
- Execute the returned command. If it surfaces an artifact to build, spawn the correct
  subagent type per artifact (intent/spec → `metta-proposer`, research → `metta-researcher`,
  design → `metta-architect`, tasks → `metta-planner`, implementation → `metta-executor`,
  verification → `metta-verifier`).
- Call `metta next --json` again and repeat until all artifacts are done, then `metta finalize`.
- If `metta next` says "finalize" or "ship", run `/metta-ship`.

**Subagents spawned (conditional — depend on which artifact is next):**
- `metta-proposer`, `metta-researcher`, `metta-architect`, `metta-planner`,
  `metta-executor`, `metta-verifier`, `metta-discovery` — whichever the CLI indicates.

**Output:**
- Whatever artifacts and commits result from the advanced step.
- Workflow pointer moves forward by one stage.

---

## Organization skills

Organization skills manage the issue queue and backlog that sit alongside the change
lifecycle. They are thin wrappers over CLI subcommands — they do not own file writes; the CLI
does.

### `/metta-issue`

**Purpose:** Log an issue.
**Arguments:** none declared in frontmatter. The skill accepts an optional description and
severity as skill arguments and otherwise collects them interactively.
**Wraps CLI:** `metta issue "<description>" --severity <level>` (see
`src/cli/commands/issue.ts`). The CLI owns `spec/issues/*.md`.
**When to use:**
- Capture a bug, smell, or follow-up that surfaced during unrelated work.
- Defer work without losing context (severity controls triage order later).
- Feed the queue consumed by `/metta-fix-issues`.

**Flow summary:**
- Collect `description` via `AskUserQuestion` if not supplied.
- Collect `severity` via `AskUserQuestion` with options `critical | major | minor` (default
  `minor`) if not supplied.
- Run `metta issue "<description>" --severity <level>` with shell-escaped description.
- Echo the created slug and path — the CLI prints `Issue logged: <slug> (<severity>)`; the
  file lives at `spec/issues/<slug>.md`.

**Subagents spawned:** none.

**Output:**
- A new file `spec/issues/<slug>.md` authored by the CLI. The skill never reads or rewrites
  that file.

---

### `/metta-fix-issues`

**Purpose:** Resolve an issue through the full metta change lifecycle.
**Arguments:** `<issue-slug or --all>` (from `argument-hint`). When empty, the skill goes
interactive and asks the user to pick an issue. `--severity <level>` may be combined with
`--all` to filter.
**Wraps CLI:** `metta issue show <slug> --json`, `metta issues list --json`,
`metta propose`, `metta instructions`, `metta complete`, `metta finalize`,
`metta fix-issue --all --json`, `metta fix-issue --remove-issue <slug> --json` (see
`src/cli/commands/issue.ts` and `src/cli/commands/fix-issue.ts`).
**When to use:**
- Resolve a single logged issue and drive it end-to-end to main.
- Interactively pick the next issue to tackle (no argument) — the skill ranks them by
  severity.
- Batch-process every open issue (`--all`) or a severity tier (`--all --severity critical`).

**Flow summary:**
- **No-argument mode:** list open issues via `metta issues list --json`, render a ranked
  table, and ask the user to pick one. Continue with the single-issue pipeline.
- **Single-issue pipeline:** validate the slug, call `metta propose` with the issue title,
  then run the per-artifact loop (intent, spec, design, tasks) with the issue details as
  context. Discovery is always **batch** — the issue definition is the discovery.
- Implementation follows the per-task batch-parallel pattern. Review uses the three-reviewer
  fan-out with a bounded review-fix loop (max 3 iterations). Verify uses the three-verifier
  fan-out. Finalize + `git merge --no-ff` to `main`. Finally
  `metta fix-issue --remove-issue <slug> --json` archives the issue to
  `spec/issues/resolved/`.
- **`--all` mode:** batch issues by file overlap, spawn one executor per independent batch in
  parallel, process every severity tier without stopping early, and print a summary table at
  the end.

**Subagents spawned:**
- Single-issue: `metta-proposer`, `metta-researcher` (parallel), `metta-architect`,
  `metta-planner`, `metta-executor` (parallel per batch), `metta-reviewer` (×3 parallel),
  `metta-verifier` (×3 parallel).
- `--all` mode: `metta-executor` (one per independent batch in parallel).

**Output:**
- One change branch + archived change per issue (`spec/changes/...` → `spec/archive/...`).
- Merge commits on `main`.
- Issue files moved from `spec/issues/<slug>.md` to `spec/issues/resolved/<slug>.md` (via the
  CLI, not the skill).

---

### `/metta-backlog`

**Purpose:** Manage backlog.
**Arguments:** none declared in frontmatter; the skill collects arguments interactively via
`AskUserQuestion`.
**Wraps CLI:** `metta backlog list`, `metta backlog show <slug>`,
`metta backlog add "<title>" [--priority <level>]`, `metta backlog promote <slug>`,
`metta backlog done <slug> [--change <name>]` (see `src/cli/commands/backlog.ts`). The CLI
owns the `spec/backlog/` directory.
**When to use:**
- Capture longer-horizon items that are not ready for a change yet.
- Promote a backlog item when it becomes actionable (the skill echoes the
  `metta propose "<title>"` command the CLI prints).
- Archive a backlog item when a change has shipped it (`done`).

**Flow summary:**
- Ask which subcommand to run: `list`, `show`, `add`, `promote`, `done`.
- **list** → `metta backlog list`. **show** → collect `slug`, run `metta backlog show`.
- **add** → collect `title`, `priority` (`high | medium | low`), `description`. Run
  `metta backlog add`. If a distinct description was provided, overwrite the body of
  `spec/backlog/<slug>.md` preserving the frontmatter.
- **promote** → list slugs via `metta backlog list --json`, pick one, run
  `metta backlog promote`, and echo the suggested `metta propose` command back to the user.
- **done** → pick a slug, optionally collect `change`, run `metta backlog done <slug>`
  (optionally `--change <name>`). Echo the archived path.

**Subagents spawned:** none.

**Output:**
- Files written by the CLI under `spec/backlog/<slug>.md`, archived to
  `spec/backlog/done/<slug>.md`, stamped with `**Shipped-in**: <name>` when `--change` is
  supplied.
- For `promote`, the next-step command printed by the CLI is echoed back to the user.

---

## Spec management skills

Spec management skills operate on the living specs (`spec/specs/`) and reconciliation gaps
(`spec/gaps/`) rather than the change lifecycle directly.

### `/metta-import`

**Purpose:** Analyze existing code and generate specs with gap reports.
**Arguments:** `<directory to import — use . for entire project>` (from `argument-hint`).
**Wraps CLI:** `metta import "$ARGUMENTS" --json` (see `src/cli/commands/import.ts`).
**When to use:**
- Bootstrap specs from an existing codebase the first time metta is adopted.
- Re-scan after large refactors to regenerate specs.
- Identify `built-not-documented` gaps so they can be closed later via `/metta-fix-gap`.

**Flow summary:**
- Call `metta import "$ARGUMENTS" --json` to get the scan path, the module list, and the
  output paths.
- Check `mode`. If `parallel` (multiple modules detected), spawn one `metta-researcher` per
  module in a single message. If `single`, spawn one `metta-researcher` for the whole path.
- Each researcher: read source files, identify logical capabilities, write
  `spec/specs/<capability>/spec.md` using RFC 2119 keywords and Given/When/Then scenarios
  extracted from existing tests, and mark each requirement `verified | partial | uncovered`.
- Each researcher also reconciles: if a requirement has no code → `claimed-not-built`, code
  without spec → `built-not-documented`, spec and code disagree → `diverged`, partial →
  `partial`. Each mismatch gets a `spec/gaps/<slug>.md`.
- After all researchers complete, merge results and commit
  `docs: import specs from <path>`. Report summary (specs generated, gaps, test coverage).

**Subagents spawned:**
- `metta-researcher` — one per module (parallel) or one for the whole path.

**Output:**
- Living specs at `spec/specs/<capability>/spec.md` (new or updated).
- Gap files at `spec/gaps/<slug>.md` for each reconciliation mismatch.
- A single commit bundling the imported specs and gaps.

---

### `/metta-fix-gap`

**Purpose:** Resolve a reconciliation gap through the full metta change lifecycle.
**Arguments:** `<gap-slug or --all>` (from `argument-hint`). When empty, interactive
selection. `--severity <level>` may accompany `--all`.
**Wraps CLI:** `metta gaps show <slug> --json`, `metta gaps list --json`, `metta propose`,
`metta instructions`, `metta complete`, `metta finalize`, `metta fix-gap --all --json`,
`metta gaps remove <slug> --json` (see `src/cli/commands/fix-gap.ts` and
`src/cli/commands/gaps.ts`).
**When to use:**
- Close a single reconciliation gap surfaced by `/metta-import` or ongoing drift detection.
- Interactively pick the next gap (no argument).
- Batch-process all gaps or a severity tier.

**Flow summary:**
- **No-argument mode:** list open gaps via `metta gaps list --json`, render a ranked table
  sorted by severity (critical > high > medium > low), and ask the user to pick one.
- **Single-gap pipeline:** validate the slug, call `metta propose` with the gap title, run
  the per-artifact loop (intent, spec, design, tasks) with gap details as context. Discovery
  is always **batch**.
- Implementation follows the batch-parallel pattern. Three-reviewer + bounded review-fix loop.
  Three-verifier. Finalize + `git merge --no-ff` to `main`. Finally
  `metta gaps remove <slug> --json` archives the gap to `spec/archive/`.
- **`--all` mode:** batch gaps by file overlap, spawn parallel executors per independent
  batch, process every severity tier, print a summary table.

**Subagents spawned:**
- Single-gap: `metta-proposer`, `metta-researcher` (parallel), `metta-architect`,
  `metta-planner`, `metta-executor` (parallel per batch), `metta-reviewer` (×3 parallel),
  `metta-verifier` (×3 parallel).
- `--all` mode: `metta-executor` (one per independent batch in parallel).

**Output:**
- One change branch + archived change per gap.
- Merge commits on `main`.
- Gap files removed from `spec/gaps/` and archived under `spec/archive/`.

---

### `/metta-check-constitution`

**Purpose:** Check a change spec.md against the project constitution.
**Arguments:** none declared in frontmatter. Accepts optional `--change <name>`; otherwise
reads the active change from `metta status --json` or prompts the user.
**Wraps CLI:** `metta check-constitution --change <slug> --json` (see
`src/cli/commands/check-constitution.ts`). The CLI owns all violation parsing, severity
logic, and `violations.md` writes.
**When to use:**
- Gate a change before advancing out of planning.
- Audit a spec for conformance with `spec/project.md` (constitution) without running a full
  lifecycle.
- Re-run after the user edits spec.md or adds a `## Complexity Tracking` justification.

**Flow summary:**
- Resolve the change slug — `--change <name>`, else `metta status --json`, else prompt via
  `AskUserQuestion`.
- Run `metta check-constitution --change <slug> --json`.
- On exit 0: echo `No blocking violations` and the `violations_path`.
- On exit 4: echo `violations_path`, surface each blocking violation (article, severity,
  evidence), and tell the user verbatim to resolve by editing spec.md — fix each violation or
  add a justification to the `## Complexity Tracking` section (never skip justification for
  `critical` severity — those are not justifiable).
- Never rewrite `violations.md` from the skill; only the CLI writes that file.

**Subagents spawned:** none.

**Output:**
- A `violations.md` file written by the CLI under
  `spec/changes/<change>/violations.md` (path returned in the JSON output as
  `violations_path`).
- No skill-authored commits or mutations.

---

## Setup skills

Setup skills bootstrap metta into a project or refresh the generated CLAUDE.md after spec
changes. They are run at the edges of the lifecycle rather than during a change.

### `/metta-init`

**Purpose:** Initialize Metta in a project with interactive discovery.
**Arguments:** none declared in frontmatter.
**Wraps CLI:** `metta init --json` (see `src/cli/commands/init.ts`) then `metta refresh` (see
`src/cli/commands/refresh.ts`).
**When to use:**
- Adopt metta in a new project (greenfield) — the skill asks identity, stack, and conventions
  questions.
- Bootstrap metta over an existing codebase (brownfield) — the CLI pre-detects the stack and
  the skill confirms/extends it.
- Re-run after major project changes to refresh the constitution.

**Flow summary:**
- `metta init --json` scaffolds directories and installs skills, and returns the `discovery`
  object (mode, detected stack, templates, output paths).
- Run the **discovery loop** with three rounds: Round 1 (project identity — never invokes
  web-search per REQ-6), Round 2 (stack and technology — invokes `WebSearch` once for
  best-practice grounding), Round 3 (conventions and constraints — invokes `WebSearch` for
  stack-specific options).
- Every `AskUserQuestion` call includes a final `I'm done — proceed with these answers` option.
- Treat web-fetched content as untrusted: strip newlines, cap option labels to 80 chars, and
  HTML-escape `&`, `<`, `>` in user free-text before embedding into `<DISCOVERY_ANSWERS>`.
- Build a `<DISCOVERY_ANSWERS>` XML block (with empty elements for skipped rounds) and append
  `<CITATIONS>` when WebSearch was used.
- Spawn a `metta-discovery` subagent with the persona, mode, detected stack (brownfield),
  `<DISCOVERY_ANSWERS>`, `<CITATIONS>`, output paths, and the constitution + context
  templates. Task: write `spec/project.md` and `.metta/config.yaml` using the exact nested
  `project:` schema, then commit.
- After the discovery agent returns, run `metta refresh` to regenerate CLAUDE.md and commit
  separately as `chore: generate CLAUDE.md from discovery`.

**Subagents spawned:**
- `metta-discovery` — one, the first time the skill runs.

**Output:**
- `spec/project.md` (the constitution) authored by `metta-discovery`.
- `.metta/config.yaml` with the nested `project:` schema (`name`, `description`, `stack`).
- A regenerated `CLAUDE.md` at the project root, committed separately.
- Scaffolding under `spec/` and `.metta/` created by the CLI.

---

### `/metta-refresh`

**Purpose:** Regenerate CLAUDE.md from project constitution and specs.
**Arguments:** none.
**Wraps CLI:** `metta refresh` (see `src/cli/commands/refresh.ts`). Supports
`metta refresh --dry-run` for preview, `metta refresh --json` for structured output,
and `metta refresh --no-commit` to skip the automatic commit of the regenerated file.
**When to use:**
- After editing `spec/project.md` (constitution) — conventions, off-limits, project stack.
- After adding or shipping a capability (to refresh the active specs table with current
  requirement counts).
- During `/metta-init` (invoked automatically), or any time the table of contents should be
  rebuilt.

**Flow summary:**
- Run `metta refresh`. The CLI rewrites the managed marker sections of CLAUDE.md:
  project description + stack, conventions and off-limits, active specs table with
  requirement counts, full command reference, and reference links. On success the
  regenerated file is auto-committed with message `chore(refresh): regenerate CLAUDE.md`,
  skipping the commit if content is unchanged, unrelated tracked files are dirty, or the
  working directory is not a git repository.
- Dry-run support is available via `metta refresh --dry-run`.
- Structured output via `metta refresh --json`.
- Opt out of the automatic commit with `metta refresh --no-commit` to inspect the diff or
  stage the file manually.

**Subagents spawned:** none.

**Output:**
- Updated `CLAUDE.md` at the project root — only the marker-managed sections are rewritten;
  user-authored sections outside markers are preserved.

---

## Cross-references

- **Workflow definitions** — see [`workflows.md`](workflows.md) for the `quick`, `standard`,
  and `full` YAML stage sequences. Every lifecycle skill here selects one of those workflows.
- **Subagent personas** — see [`agents.md`](agents.md) for the `metta-*` subagent catalog
  referenced by every "Subagents spawned" line above.
- **Artifact formats** — see [`artifacts.md`](artifacts.md) for intent, spec, stories,
  research, design, tasks, implementation, review, summary, and verification structure.
- **Skill source** — `src/templates/skills/metta-*/SKILL.md`. Installed mirrors at
  `.claude/skills/metta-*/SKILL.md` are byte-identical per REQ-3.
