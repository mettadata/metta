# CLI Reference

Complete reference for the `metta` command-line interface. Every command, argument, and flag below is derived directly from the command registrations in `src/cli/`.

## Invocation shape

```
metta <command> [subcommand] [arguments] [options]
```

`metta` is the root program. Most work lives under a named command (e.g. `metta propose`), and several commands group read/write actions under subcommands (e.g. `metta specs list`, `metta config get`).

### Global options

These are accepted on the root program and apply to any command:

| Option | Description |
|--------|-------------|
| `--json` | Machine-readable JSON output |
| `--verbose` | Verbose output |
| `--debug` | Debug output |
| `--quiet` | Minimal output |
| `--version` | Print version (`0.1.0`) |
| `-h, --help` | Help for any command/subcommand |

> Note: `metta tasks plan` also declares a local `--json` flag in addition to the global one.

### Config preflight

Before running most commands, metta loads `.metta/config.yaml`. If the file is corrupt, the command fails fast with a parse error and points you at `metta doctor --fix`. The repair/bootstrap commands are **exempt** from this preflight so you can always recover: `install`, `init`, `doctor`, `update`, `completion`.

### A note for AI orchestrators

If you are an AI coding agent driving metta, **do not call these CLI commands directly.** Use the matching `/metta-*` skill (e.g. `/metta-propose`, `/metta-ship`). A PreToolUse guard hook (`.claude/hooks/metta-guard-bash.mjs`) blocks state-mutating CLI calls from orchestrator sessions; the skills wrap each command with the correct subagent persona. See [Guard policy](#guard-policy-ai-orchestrators) at the end of this doc. Humans running the CLI in a terminal are unaffected.

---

## Lifecycle

The core change workflow: propose → plan → execute → verify → finalize → ship.

### `metta propose <description>`

Start a new change (standard workflow).

| Argument / Option | Description |
|-------------------|-------------|
| `<description>` | Description of the change (required) |
| `--workflow <name>` | Workflow to use (default `standard`) |
| `--from-gap <gap>` | Create from a gap |
| `--from-idea <idea>` | Create from an idea |
| `--from-issue <issue>` | Create from an issue |
| `--discovery <mode>` | Discovery mode: `interactive`, `batch`, `review` (default `interactive`) |
| `--auto`, `--accept-recommended` | Auto-accept adaptive routing recommendations |
| `--stop-after <artifact>` | Stop after the named planning artifact (e.g. `intent`, `stories`, `spec`, `research`, `design`, `tasks`) |

```
metta propose "Add rate limiting to the API gateway"
```

### `metta quick <description>`

Quick mode — skip planning, for small changes.

| Argument / Option | Description |
|-------------------|-------------|
| `<description>` | Description of the change (required) |
| `--auto`, `--accept-recommended` | Auto-accept adaptive routing recommendations |

```
metta quick "Fix typo in error message"
```

### `metta auto <description>`

Full lifecycle loop — discover, build, verify, ship.

| Argument / Option | Description |
|-------------------|-------------|
| `<description>` | Description of what to build (required) |
| `--workflow <name>` | Workflow to use (default `standard`) |
| `--max-cycles <n>` | Maximum iteration cycles (default `10`) |
| `--resume` | Resume an interrupted auto run |
| `--from <phase>` | Start from a specific phase |

```
metta auto "Implement dark mode toggle"
```

### `metta plan [change]`

Build the next planning artifacts for a change.

| Argument / Option | Description |
|-------------------|-------------|
| `[change]` | Change name (required if multiple are active) |
| `--change <name>` | Change name (alternative to the positional argument) |

```
metta plan
```

### `metta execute [change]`

Run implementation for a change.

| Argument / Option | Description |
|-------------------|-------------|
| `[change]` | Change name |
| `--resume` | Resume from the last checkpoint |
| `--change <name>` | Change name (alternative to the positional argument) |

```
metta execute --resume
```

### `metta verify [change]`

Run verification against the spec.

| Argument / Option | Description |
|-------------------|-------------|
| `[change]` | Change name |
| `--change <name>` | Change name (alternative to the positional argument) |

```
metta verify
```

### `metta finalize [change]`

Archive the change, merge specs, generate docs, and refresh context.

| Argument / Option | Description |
|-------------------|-------------|
| `[change]` | Change name |
| `--dry-run` | Preview what would change |
| `--change <name>` | Change name (alternative to the positional argument) |

```
metta finalize --dry-run
```

### `metta ship`

Merge the worktree branch to main.

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview the merge without applying it |
| `--branch <name>` | Source branch to merge |

```
metta ship --dry-run
```

---

## Navigation & status

Read-oriented commands for understanding where a change stands and what to do next.

### `metta status [change]`

Show current change status.

| Argument / Option | Description |
|-------------------|-------------|
| `[change]` | Change name |
| `--change <name>` | Change name (alternative to the positional argument) |

```
metta status
```

### `metta progress`

Show project-level progress across all changes. (No arguments.)

```
metta progress
```

### `metta next`

Show the next step in the workflow.

| Option | Description |
|--------|-------------|
| `--change <name>` | Change name |

```
metta next
```

### `metta complete <artifact>`

Mark an artifact as complete and get next steps.

| Argument / Option | Description |
|-------------------|-------------|
| `<artifact>` | Artifact ID to mark complete (required) |
| `--change <name>` | Change name |

```
metta complete spec
```

### `metta instructions <artifact>`

Get AI instructions for an artifact (the prompt a skill would hand to its subagent).

| Argument / Option | Description |
|-------------------|-------------|
| `<artifact>` | Artifact ID (required) |
| `--change <name>` | Change name |

```
metta instructions intent
```

---

## Specs & organization

Manage specifications, active changes, issues, the backlog, and reconciliation gaps.

### `metta specs <subcommand>`

Manage specifications.

| Subcommand | Description |
|------------|-------------|
| `specs list` | List all capabilities |
| `specs show <capability>` | Show current spec for a capability |
| `specs diff <capability>` | Show pending changes to a spec |
| `specs history <capability>` | Show archive history for a spec |
| `specs review <capability>` | Interactive review of a draft spec |
| `specs approve <capability>` | Mark a draft spec as approved |

```
metta specs show context-engine
```

### `metta changes <subcommand>`

Manage active changes.

| Subcommand | Description |
|------------|-------------|
| `changes list` | List active changes |
| `changes show <name>` | Show change details |
| `changes abandon <name> [--force]` | Abandon a change (`--force` skips confirmation) |

```
metta changes list
```

### `metta issue [description]` and `metta issues <subcommand>`

Log an issue, or manage existing issues.

| Command | Argument / Option | Description |
|---------|-------------------|-------------|
| `issue [description]` | `[description]` | Issue description |
| | `--severity <level>` | Severity: `critical`, `major`, `minor` (default `minor`) |
| | `--on-branch <name>` | Acknowledge a non-main branch and proceed |
| `issues list` | | List all issues |
| `issues show <slug>` | `<slug>` | Show a specific issue |

```
metta issue "Gate runner leaks child processes" --severity major
```

### `metta backlog <subcommand>`

Manage the backlog.

| Subcommand | Argument / Options | Description |
|------------|--------------------|-------------|
| `backlog list` | | List backlog items |
| `backlog show <slug>` | `<slug>` | Show a backlog item |
| `backlog add <title>` | `--priority <level>` (`high`/`medium`/`low`), `--source <source>`, `--description <text>`, `--on-branch <name>` | Add an item to the backlog |
| `backlog promote <slug>` | `<slug>` | Promote a backlog item to an active change |
| `backlog done <slug>` | `--change <name>` (stamp as `Shipped-in`), `--on-branch <name>` | Archive a shipped backlog item |

```
metta backlog add "Dark mode" --priority high --source idea/dark-mode
```

### `metta gaps <subcommand>`

Manage reconciliation gaps (spec vs. code).

| Subcommand | Description |
|------------|-------------|
| `gaps list` | List all gaps with status |
| `gaps show <slug>` | Show a specific gap |

```
metta gaps list
```

### `metta fix-gap [gap-name]`

Fix one or more reconciliation gaps.

| Argument / Option | Description |
|-------------------|-------------|
| `[gap-name]` | Specific gap to fix |
| `--all` | Fix all gaps, sorted by severity |
| `--severity <level>` | Filter by severity: `critical`, `medium`, `low` |
| `--remove-gap <slug>` | Remove a resolved gap |

```
metta fix-gap --all --severity critical
```

### `metta fix-issue [issue-slug]`

Fix one or more logged issues.

| Argument / Option | Description |
|-------------------|-------------|
| `[issue-slug]` | Specific issue to fix |
| `--all` | Fix all issues, sorted by severity |
| `--severity <level>` | Filter by severity: `critical`, `major`, `minor` |
| `--remove-issue <slug>` | Remove a resolved issue |
| `--auto`, `--accept-recommended` | Auto-accept adaptive routing recommendations |

```
metta fix-issue gate-runner-leak
```

---

## Config & system

Configuration, diagnostics, gates, context budgeting, and validation.

### `metta config <subcommand>`

Manage configuration.

| Subcommand | Argument | Description |
|------------|----------|-------------|
| `config get <key>` | `<key>` (dot notation) | Read a config value |
| `config set <key> <value>` | `<key>`, `<value>` | Set a config value |
| `config edit [target]` | `[target]` = `constitution` or `config` | Open config in your editor |

```
metta config get defaults.workflow
metta config set defaults.workflow standard
```

### `metta doctor`

Diagnose common issues.

| Option | Description |
|--------|-------------|
| `--fix` | Repair duplicate keys and schema-invalid entries in `.metta/config.yaml` |

```
metta doctor --fix
```

### `metta gate <subcommand>`

Manage gates (quality checks run during the lifecycle).

| Subcommand | Description |
|------------|-------------|
| `gate run <name>` | Run a specific gate |
| `gate list` | List configured gates |
| `gate show <name>` | Show a gate's config |

```
metta gate run lint
```

### `metta context <subcommand>`

Context budget management.

| Subcommand | Options | Description |
|------------|---------|-------------|
| `context stats` | `--change <name>`, `--artifact <kind>` | Report token utilization per artifact for a change |
| `context check` | | Check for stale context |

```
metta context stats --change my-change
```

> Note: `context check` is currently a stub — it reports "No stale context detected." unconditionally.

### `metta check-constitution`

Check a change's `spec.md` against the project constitution.

| Option | Description |
|--------|-------------|
| `--change <name>` | Change name |

```
metta check-constitution
```

### `metta validate-stories`

Validate user stories for a change against the schema and `spec.md` Fulfills references.

| Option | Description |
|--------|-------------|
| `--change <name>` | Change name |

```
metta validate-stories
```

### `metta tasks <subcommand>`

Inspect change task plans.

| Subcommand | Options | Description |
|------------|---------|-------------|
| `tasks plan` | `--json` | Print a parallel wave execution plan for a change's `tasks.md` |

```
metta tasks plan
```

### `metta answer`

Submit user answers to discovery questions.

| Option | Description |
|--------|-------------|
| `--change <name>` | Change name |
| `--artifact <artifact>` | Artifact ID |

```
metta answer --artifact intent
```

### `metta iteration <subcommand>`

Record iteration counters (review / verify). Skills call this during fan-out.

| Subcommand | Options | Description |
|------------|---------|-------------|
| `iteration record` | `--phase <phase>` (**required**: `review` or `verify`), `--change <name>` | Increment the review or verify iteration counter for a change (auto-selects when exactly one active change exists) |

```
metta iteration record --phase review --change my-change
```

### `metta reconcile`

Re-run reconciliation and update gap files.

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview without writing gap files |

```
metta reconcile --dry-run
```

### `metta cleanup`

Clean orphaned worktrees and tags. (No arguments.)

```
metta cleanup
```

---

## Setup & meta

Install, initialize, refresh, update, generate docs, and shell completion.

### `metta install`

Install Metta into a project.

| Option | Description |
|--------|-------------|
| `--git-init` | Initialize a git repo if one is not detected |
| `--stack <spec>` | Override stack detection: `rust`, `python`, `go`, `js`, or `skip` (comma-separated for multi-stack) |

```
metta install --stack js
```

### `metta init`

Discover project context and emit discovery instructions.

| Option | Description |
|--------|-------------|
| `--skip-scan` | Force greenfield-style init |

```
metta init
```

### `metta refresh`

Regenerate `CLAUDE.md` from the constitution and specs.

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview changes without writing |
| `--no-commit` | Skip the auto-commit of the regenerated `CLAUDE.md` |

```
metta refresh --dry-run
```

### `metta update`

Update the Metta framework to the latest version.

| Option | Description |
|--------|-------------|
| `--check` | Check for updates without installing |

```
metta update --check
```

### `metta import [target]`

Import existing code into metta specs with gap reports.

| Argument / Option | Description |
|-------------------|-------------|
| `[target]` | Directory to import (use `.` for the entire project) |
| `--all` | Alias for `metta import .` |
| `--by-module` | Generate one spec per top-level module/directory |
| `--dry-run` | Preview what would be generated without writing |

```
metta import . --by-module --dry-run
```

### `metta docs <subcommand>`

Generate and manage documentation.

| Subcommand | Argument / Options | Description |
|------------|--------------------|-------------|
| `docs generate [type]` | `[type]` = `architecture`, `api`, `changelog`, `getting-started`; `--dry-run` | Generate documentation from spec sources |

```
metta docs generate architecture --dry-run
```

### `metta completion <shell>`

Generate a shell completion script.

| Argument | Description |
|----------|-------------|
| `<shell>` | Shell type: `bash`, `zsh`, `fish` (required) |

```
metta completion zsh > ~/.metta-completion.zsh
```

---

## Guard policy (AI orchestrators)

The PreToolUse hook `.claude/hooks/metta-guard-bash.mjs` enforces the "use skills, not the CLI" rule for AI orchestrator sessions. Humans in a terminal are unaffected.

**Read-only / allowed** single-word forms: `status`, `instructions`, `progress`, `doctor`, `iteration`, `install`.

**Allowed two-word read-only forms:** `issues list`, `gate list`, `changes list`, `backlog list`, `backlog show`.

**Blocked** (must use the matching `/metta-*` skill): `propose`, `quick`, `auto`, `complete`, `finalize`, `ship`, `issue`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init`, plus the mutating two-word forms `backlog add`, `backlog done`, `backlog promote`, and `changes abandon`.

**Skill-enforced** subcommands require *both* an inline `METTA_SKILL=1` prefix *and* a trusted `metta-*` agent identity — inline bypass alone is not enough: `issue`, `fix-issue`, `propose`, `quick`, `auto`, `ship`.

Any metta subcommand not on an allow or block list is treated as **unknown** and blocked until classified. Skill hint mapping:

| Subcommand | Skill |
|------------|-------|
| `issue` | `/metta-issue` |
| `fix-issue` | `/metta-fix-issues` |
| `propose` | `/metta-propose` |
| `quick` | `/metta-quick` |
| `auto` | `/metta-auto` |
| `ship` | `/metta-ship` |

Emergency bypass: disable the hook in `.claude/settings.local.json`.
