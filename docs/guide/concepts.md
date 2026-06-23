# Concepts & Glossary

The mental model you need before using metta. This page defines the core ideas and vocabulary; the [`../workflows/`](../workflows/) reference docs go deeper on each.

## The core idea: spec-driven development

metta is a **spec-driven development framework**. Instead of jumping straight to code, every non-trivial change flows through a sequence of artifacts — a problem statement, requirements, a design, a task plan — each authored, reviewed, and committed before the next begins. The specs are the contract; the code is measured against them.

metta runs in **instruction mode**: metta itself is a passive state machine that manages state and specs, while *any* AI coding tool executes the actual work. metta tracks which artifact comes next, which quality gates must pass, and where everything lives on disk. The AI tool authors the artifacts and writes the code. This split is why metta works alongside whatever AI coding assistant you already use.

## The change lifecycle

Every change moves through six conceptual phases:

| Phase | What happens |
|-------|--------------|
| **propose** | Frame the change — declare the problem, proposal, impact, and what's out of scope (the `intent` artifact). |
| **plan** | Author planning artifacts (stories, spec, research, design, tasks) up to the execution boundary. |
| **execute** | Implement the code against the task plan; commit atomically per task. |
| **verify** | Check the implementation against the spec's scenarios and gate results; produce a verification summary. |
| **finalize** | Run the terminal quality gates; block on any failure. |
| **ship** | Merge the spec delta into the living specs, archive the change, merge the branch. |

You drive these phases through **skills** (`/metta-*` slash commands), never by calling the CLI directly. See [Skills vs agents vs CLI](#skills-vs-agents-vs-cli) below.

## Workflow tiers

A **workflow** is an ordered DAG of artifacts defined in YAML. It declares which artifacts a change produces, in what order, which AI persona authors each, and which gates run afterward. metta ships three built-in workflows plus an implied trivial tier; you pick the one that matches the size of your change.

| Tier | For | Stages | Artifacts produced |
|------|-----|--------|--------------------|
| **trivial** | One-liners, copy edits — work too small for any ceremony. | n/a | none (handled inline) |
| **quick** | Small, well-understood bug fixes, tiny refactors, one- or two-file changes. | 3 | `intent` → implementation → `summary` |
| **standard** | New features with user-facing stories, multi-file changes, API surface changes. **Default.** | 8 | `intent` → `stories` → `spec` → `research` → `design` → `tasks` → implementation → `summary` |
| **full** | Complex, cross-subsystem systems work; greenfield domains; UX-heavy or high-stakes changes. | 10 | `domain-research` → `intent` → `spec` → `research` → `design` → (`architecture`, `tasks`, `ux-spec`) → implementation → `summary` |

Notes:
- **quick** skips all planning — no spec, no design, no tasks — but runs the same code-quality gates as the bigger tiers. Only planning is shortcut, never correctness.
- **standard** is the default invoked by `/metta-propose`. Its `stories` stage is mandatory.
- **full** drops the separate `stories` stage (stories fold into the spec), starts with `domain-research`, and fans out after `design` into parallel `architecture`, `tasks`, and `ux-spec` artifacts.

See [`../workflows/workflows.md`](../workflows/workflows.md) for the full stage DAGs, `requires:` edges, and gate bindings.

## Artifacts

An **artifact** is a markdown file authored by an AI persona at one workflow stage and written under `spec/changes/<slug>/`. Each artifact is the input for the stage that follows it.

| Artifact | File | What it is |
|----------|------|------------|
| **intent** | `intent.md` | The change's charter: Problem, Proposal, Impact, Out of Scope. The entry point for every change. |
| **stories** | `stories.md` | User stories (As-a / I-want / So-that) with priority and Given/When/Then acceptance criteria. *(standard only)* |
| **spec** | `spec.md` | Formal requirements as ADDED/MODIFIED/REMOVED deltas against the living spec, in RFC 2119 keywords (MUST/SHOULD/MAY), each backed by a Given/When/Then scenario. The contract verification is measured against. |
| **research** | `research.md` | Decision record: approaches considered, the one chosen, and the rationale. |
| **design** | `design.md` | High-level design: approach, components, data model, API design, dependencies, risks. |
| **tasks** | `tasks.md` | Executable task plan grouped into dependency batches; each task has Files / Action / Verify / Done and a checkbox the executor flips on commit. |
| **architecture** | `architecture.md` | Deep architectural reference — interfaces, state/data flow, deployment topology. *(full only)* |
| **ux-spec** | `ux-spec.md` | UX contract — user goals, flows, screens, components, accessibility, visual tone. *(full only)* |
| **summary** | `summary.md` | Verification report: spec scenarios as a checklist, gate results, implementation summary. The final artifact before ship. |

Artifacts must carry **real content** authored by the matching persona — placeholder text like `"intent stub"` is explicitly forbidden. See [`../workflows/artifacts.md`](../workflows/artifacts.md) for required sections per artifact.

## Gates

A **gate** is a named quality check that runs after an artifact is authored (when the stage declares it) and again during finalize. Each gate returns `pass`, `fail`, `warn`, or `skip`.

The five YAML-defined gates run real shell commands:

| Gate | Runs | Default `on_failure` |
|------|------|----------------------|
| **tests** | `npm test` | `retry_once` |
| **lint** | `npm run lint` | `retry_once` |
| **typecheck** | `npx tsc --noEmit` | `retry_once` |
| **build** | `npm run build` | `stop` |
| **stories-valid** | `metta validate-stories` (schema + cross-ref checks) | `stop` |

The workflow YAMLs also reference four agent/CLI-enforced gate names — `spec-quality`, `design-review`, `task-quality`, and `uat` — whose rigor today comes from the reviewer/verifier subagent personas rather than a registered programmatic gate (they resolve to `skip` in the gate registry).

### `on_failure` policies

| Policy | Behavior |
|--------|----------|
| `retry_once` | On `fail`, run the command once more and report the retry result. Honored during execution. |
| `stop` | Fail-fast intent — halt without retry. |
| `continue_with_warning` | Surface a non-blocking warning. *(parsed but not yet acted on)* |

A `fail` during finalize **blocks** the change — no archive, no spec merge. Projects can retarget any gate's command or policy via a `gates:` block in `.metta/config.yaml`. See [`../workflows/gates.md`](../workflows/gates.md) for exact semantics and the finalize gate loop.

## Skills vs agents vs CLI

These three layers are how a change actually gets driven. Understanding the split is the most important part of the mental model.

| Layer | What it is |
|-------|-----------|
| **Skills** (`/metta-*`) | The **user entry points** — slash commands an AI orchestrator invokes (e.g. `/metta-propose`, `/metta-plan`, `/metta-execute`, `/metta-verify`, `/metta-ship`). A skill wraps the underlying CLI calls *and* spawns the correct subagent personas. |
| **Agents / personas** (`metta-*`) | Single-turn AI subagents, each a specialist that authors one artifact and commits it: `proposer` (authors both intent and spec), `product`, `researcher`, `architect`, `planner`, `executor`, `reviewer`, `verifier`, plus `discovery` for setup. (Workflow YAML names the spec stage's agent `specifier`, but that maps to the `metta-proposer` persona — there is no separate `specifier` agent.) A skill selects a workflow; the workflow binds an agent to each stage. |
| **CLI** (`metta <cmd>`) | The underlying state machine — reads/writes `.metta/` and `spec/`, validates with Zod, runs gates. |

**The core rule:** an AI orchestrator MUST invoke the matching skill — never call `metta <cmd>` directly. Skills own the persona wrapping and artifact-quality guarantees; calling the CLI directly bypasses them and has shipped broken artifacts in the past. (A human running `metta` in a terminal is unaffected — the rule scopes to AI-driven sessions.)

See [`../workflows/agents.md`](../workflows/agents.md) for each persona's role, tools, and the artifacts it authors, and [`../workflows/README.md`](../workflows/README.md) for the skill decision tree.

## Specs & the spec store

metta is filesystem-based. The **spec store** lives under `spec/` and separates living specs from in-flight work:

| Location | Holds |
|----------|-------|
| `spec/specs/` | **Living specs** — one capability per file, the current source of truth for what the system does. |
| `spec/changes/<slug>/` | **In-flight changes** — the artifacts (`intent.md`, `spec.md`, `design.md`, …) for a change currently being worked. |
| `spec/archive/` | **Completed changes** — change directories moved here on ship, with their `gates.yaml` audit record. |

On `/metta-ship`, a change's `spec.md` delta (its ADDED/MODIFIED/REMOVED requirements) is reconciled into the living capability spec under `spec/specs/`, and the change directory moves from `spec/changes/` to `spec/archive/`. metta's durable state also lives under `.metta/` (YAML state files), with git as the transaction log.

## The constitution

The **constitution** at [`spec/project.md`](../../spec/project.md) is the project's foundational ruleset: its principles, stack, conventions, architectural constraints, quality standards, and off-limits rules. It's authored once at setup (via `/metta-init`) and is the baseline every change is checked against.

`/metta-check-constitution` validates a change's `spec.md` against the constitution's **Conventions** and **Off-Limits** articles, emitting a structured violation report. `CLAUDE.md` — the file your AI tool reads — is regenerated from the constitution and the active specs by `/metta-refresh`.

## Glossary

| Term | One-line definition |
|------|---------------------|
| Spec-driven development | Authoring requirements/design artifacts before code, and measuring code against them. |
| Instruction mode | metta manages state/specs as a passive state machine; any AI tool executes the work. |
| Change | A unit of work moving through the lifecycle, living under `spec/changes/<slug>/`. |
| Workflow | A YAML-defined DAG of artifacts (quick / standard / full) selected per change. |
| Artifact | A markdown file one workflow stage produces (intent, spec, design, tasks, …). |
| Gate | A named quality check (tests, lint, typecheck, build, stories-valid, …). |
| Skill | A `/metta-*` slash command — the user entry point that wraps the CLI and spawns personas. |
| Agent / persona | A single-turn AI subagent (`metta-*`) that authors one artifact. |
| Living spec | The current source-of-truth capability spec under `spec/specs/`. |
| Constitution | `spec/project.md` — the project's principles, conventions, and off-limits rules. |
| Spec delta | The ADDED/MODIFIED/REMOVED requirements in a change's `spec.md`, merged on ship. |

## Where to go next

- [`../workflows/README.md`](../workflows/README.md) — the skill decision tree: which `/metta-*` to use when.
- [`../workflows/workflows.md`](../workflows/workflows.md) — the three workflow DAGs in detail.
- [`../workflows/artifacts.md`](../workflows/artifacts.md) — every artifact's required sections.
- [`../workflows/gates.md`](../workflows/gates.md) — gate semantics, `on_failure`, and the finalize loop.
- [`../workflows/agents.md`](../workflows/agents.md) — the subagent personas.
- [`../../spec/project.md`](../../spec/project.md) — the project constitution.
