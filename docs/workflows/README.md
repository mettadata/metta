# Workflows — Internal Guide

Orientation hub for contributors working on metta itself. For users of the tool, see [`../getting-started.md`](../getting-started.md).

## What is metta's workflow system?

metta's workflow system is three concepts that compose. **Skills** are the `/metta-*` slash commands an AI orchestrator invokes to drive a change through its lifecycle; they wrap the CLI and spawn the correct subagent personas. **Workflows** are YAML-defined stage sequences — `quick`, `standard`, and `full` — that declare which artifacts a change produces and in what order. **Artifacts** are the markdown files each stage authors (`intent.md`, `design.md`, `tasks.md`, `implementation.md`, `verification.md`, and so on) under `spec/changes/<slug>/`. A skill invocation selects a workflow; the workflow schedules stages; each stage binds a subagent that writes one artifact. Gates fire between stages to enforce quality; state on disk (`.metta/` + `spec/`) is the durable transaction log, with git as the audit trail.

## Decision tree: which skill should I use?

| Situation | Skill | Workflow | Notes |
|-----------|-------|----------|-------|
| One-line typo, one-file bug fix, tiny refactor | `/metta-quick <description>` | `quick` | Skips planning. Intent → implementation → verification. |
| New feature, multi-file change, API surface change | `/metta-propose <description>` | `standard` | Default. Intent → design → tasks → implementation → verification. |
| Complex system redesign with UX + architecture concerns | `/metta-propose --workflow full <description>` | `full` | Adds research, UX, architecture, and review stages. |
| Resolve a logged issue from `spec/issues/` | `/metta-fix-issues <slug>` | varies | Routes into the appropriate workflow based on issue scope. |
| Resolve a reconciliation gap (spec vs code drift) | `/metta-fix-gap <slug>` | varies | Chooses workflow based on gap severity. |
| Generate specs from an existing codebase | `/metta-import` | n/a | Analyses source, writes `spec/specs/`, emits a gap report. |
| See status of the active change | `/metta-status` | n/a | Reads `.metta/` state for the current branch. |
| See project-wide dashboard across all changes | `/metta-progress` | n/a | Aggregates `spec/changes/`, `spec/issues/`, `spec/backlog/`. |
| Ask "what should I do next?" | `/metta-next` | n/a | Routes to the next logical lifecycle step. |
| Log an issue for later | `/metta-issue <description>` | n/a | Writes to `spec/issues/`. |
| Manage the prioritized backlog | `/metta-backlog` | n/a | Reads/writes `spec/backlog/`. |
| Initialize metta in a project | `/metta-init` | n/a | Interactive discovery; bootstraps `spec/` and `.metta/`. |
| Regenerate `CLAUDE.md` after spec changes | `/metta-refresh` | n/a | Rewrites managed sections only. |
| Check a change against the constitution | `/metta-check-constitution` | n/a | Reads `spec/project.md`, validates the active change. |
| Run the full lifecycle loop (discover → ship) | `/metta-auto <description>` | varies | Chains propose → plan → execute → verify → ship. |

Lifecycle skills — `/metta-plan`, `/metta-execute`, `/metta-verify`, `/metta-ship` — are stage-level entry points invoked by orchestration skills above. Call them directly only when resuming a specific stage.

## Index

Each sibling doc is self-contained reference material. Read `walkthroughs.md` first if you learn better from examples.

| Doc | Covers |
|-----|--------|
| [`workflows.md`](workflows.md) | The three YAML workflow definitions: stage sequences, `requires` dependencies, gate bindings, agent bindings. |
| [`skills.md`](skills.md) | All 18 `/metta-*` skills: slash-command name, CLI commands wrapped, subagents spawned, when to use. |
| [`agents.md`](agents.md) | The 10 `metta-*` subagent personas: role, permitted tools, artifacts authored, stages participated in. |
| [`artifacts.md`](artifacts.md) | The 11 artifact types: purpose, required sections, author agent, owning workflow stages. |
| [`gates.md`](gates.md) | Quality gates: the 5 YAML-defined (`build`, `lint`, `typecheck`, `tests`, `stories-valid`) plus agent/CLI-enforced (`spec-quality`, `design-review`, `task-quality`, `uat`). |
| [`state.md`](state.md) | On-disk state model under `.metta/` and `spec/` — layout, ownership, lifecycle events that write each location. |
| [`walkthroughs.md`](walkthroughs.md) | Four end-to-end examples tracing skill → workflow → artifact → gate → state → commit. |

## Core rule: skills, not CLI

**AI orchestrators MUST invoke the matching metta skill — never call the CLI directly.** This applies to every AI-driven session. Humans running `metta <cmd>` in a terminal are unaffected; the rule scopes to orchestrator contexts where subagent personas and artifact-quality guarantees are load-bearing.

Calling `metta quick`, `metta propose`, `metta finalize`, `metta complete`, `metta issue`, or any other `metta <cmd>` directly from an orchestrator bypasses the subagent wrappers. This has shipped broken artifacts in the past — see `spec/issues/metta-complete-accepts-stub-placeholder-artifacts-on-intent-.md`. Placeholder content like `"intent stub"` or `"summary stub"` is explicitly forbidden; artifacts must carry real content authored by the matching `metta-*` subagent.

The source of truth for this rule lives in the project's [`CLAUDE.md`](../../CLAUDE.md) under the `Metta Workflow` section. That file is regenerated by `/metta-refresh`; if this README drifts from it, `CLAUDE.md` wins.

## Cross-links

- [`../architecture.md`](../architecture.md) — system design, components, ADRs.
- [`../api.md`](../api.md) — user-facing capabilities and scenarios.
- [`../getting-started.md`](../getting-started.md) — setup and quick start for users of metta.
- [`../changelog.md`](../changelog.md) — what changed and when.
- [`../../spec/project.md`](../../spec/project.md) — the project constitution.
- [`../../CLAUDE.md`](../../CLAUDE.md) — the live workflow section and conventions.
