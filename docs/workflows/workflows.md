# Workflows

Reference for metta's four built-in YAML-defined workflows.

## What a workflow is

A **workflow** is an ordered DAG of **artifacts**. Each artifact declares:

- `id` — stable name (e.g. `intent`, `design`, `tasks`)
- `type` — artifact category consumed by the context engine
- `template` — markdown template copied into `spec/changes/<change>/` to seed authoring
- `generates` — filename (or glob) the artifact produces on disk
- `requires` — list of upstream artifact IDs that must be `complete` or `skipped` before this one is ready
- `agents` — persona(s) the orchestrator spawns to author this artifact
- `gates` — gate IDs that run after the artifact is authored

`WorkflowEngine` (`src/workflow/workflow-engine.ts`) loads a workflow YAML, validates it with `WorkflowDefinitionSchema` (`src/schemas/workflow-definition.ts`), topologically sorts `requires:` with alphabetical tie-breaking (Kahn's algorithm), and exposes `getNext(graph, statuses)` — the set of artifacts whose dependencies are all satisfied. That is how the engine decides which artifact is ready next, which agent persona to spawn, and which gates to run once authoring completes.

### Engine semantics

- **Loading.** `loadWorkflow(name, searchPaths)` walks each search path, reads `<name>.yaml`, parses with `yaml`, and validates with `WorkflowDefinitionSchema` (a strict Zod object). Results are cached per engine instance. Every workflow is fully specified — each YAML lists all of its artifacts directly.
- **Build order.** `topologicalSort` throws on unknown `requires:` references and on cycles (`WorkflowCycleError`). Tie-breaking is alphabetical — the ready set is sorted before being handed out so ordering is deterministic.
- **Readiness.** `getNext(graph, statuses)` returns every artifact with status `pending` or `ready` whose every dependency has status `complete` or `skipped`. Statuses are drawn from `ArtifactStatusSchema` (`src/schemas/change-metadata.ts`): `pending | ready | in_progress | complete | failed | skipped`.
- **Gates run after authoring.** The workflow YAML only names gates. Gate definitions live elsewhere (see `gates.md`). The engine is not responsible for executing them; it reports which gates apply per artifact.

## Workflow comparison

| Aspect | trivial | quick | standard | full |
|---|---|---|---|---|
| Stage count | 3 | 3 | 8 | 10 |
| Discovery intensity | none | none | light (stories + spec + research) | heavy (domain-research + spec + research + architecture + ux-spec) |
| Typical duration | minutes | minutes to an hour | hours to a day | days |
| User-facing stories required | no | no | yes (`stories` stage) | no (spec-first, stories folded into spec) |
| UX contract required | no | no | no | yes (`ux-spec` stage) |
| Separate architecture artifact | no | no | no | yes (`architecture` stage) |
| Implementation gates | tests, lint, typecheck, build | tests, lint, typecheck, build | tests, lint, typecheck, build | tests, lint, typecheck |
| Verification gate | (none) | (none) | (none) | (none) |

---

## trivial

Source: `src/templates/workflows/trivial.yaml`

### Stage flow

```
intent → implementation → verification
```

### Stages

| Stage | Template | Agent | Gates | Requires |
|---|---|---|---|---|
| intent | `intent.md` | proposer | (none) | (none) |
| implementation | `execute.md` | executor | tests, lint, typecheck, build | intent |
| verification | `verify.md` | verifier | (none) | implementation |

Each stage generates:

- `intent` → `intent.md`
- `implementation` → `**/*` (source files anywhere in the repo)
- `verification` → `summary.md`

### When to use this workflow

- Single-file fixes where scope is unambiguous (selected automatically when the change scores `file_count <= 1`)
- One-line corrections, typo fixes, and trivial config tweaks
- The smallest changes where even `quick`'s framing is overhead

### Notes

- Same stage shape as `quick`: intent → implementation → verification, zero planning ceremony.
- `intent` has no gates; the change is greenlit as soon as the proposer writes intent.
- `implementation` runs the full code-quality gate set (`tests`, `lint`, `typecheck`, `build`) — correctness is never shortcut, only planning.
- `verification` runs no gates; it produces `summary.md` confirming the fix matches the intent.

---

## quick

Source: `src/templates/workflows/quick.yaml`

### Stage flow

```
intent → implementation → verification
```

### Stages

| Stage | Template | Agent | Gates | Requires |
|---|---|---|---|---|
| intent | `intent.md` | proposer | (none) | (none) |
| implementation | `execute.md` | executor | tests, lint, typecheck, build | intent |
| verification | `verify.md` | verifier | (none) | implementation |

Each stage generates:

- `intent` → `intent.md`
- `implementation` → `**/*` (source files anywhere in the repo)
- `verification` → `summary.md`

### When to use this workflow

- Small, well-understood bug fixes touching one or two files
- Tiny refactors where scope is obvious and no design work is required
- Documentation fixes or copy changes (excluding edits to the metta workflow section itself)
- Hotfixes where the failure mode is already reproduced and the patch is local

### Notes

- Three stages, zero planning ceremony. No spec, no stories, no research, no design, no tasks.
- `intent` has no gates; the change is greenlit as soon as the proposer writes intent.
- `implementation` runs the same code-quality gates as the larger workflows (`tests`, `lint`, `typecheck`, `build`) — there is no shortcut on correctness, only on planning.
- `verification` runs no gates; it produces `summary.md` confirming the fix matches the intent.

---

## standard

Source: `src/templates/workflows/standard.yaml`

### Stage flow

```
intent → stories → spec → research → design → tasks → implementation → verification
```

### Stages

| Stage | Template | Agent | Gates | Requires |
|---|---|---|---|---|
| intent | `intent.md` | proposer | (none) | (none) |
| stories | `stories.md` | product | (none) | intent |
| spec | `spec.md` | specifier | stories-valid | stories |
| research | `research.md` | researcher | (none) | spec |
| design | `design.md` | architect | (none) | research |
| tasks | `tasks.md` | planner | (none) | design |
| implementation | `execute.md` | executor | tests, lint, typecheck, build | tasks |
| verification | `verify.md` | verifier | (none) | implementation |

Each stage generates a file of the same name (`intent.md`, `stories.md`, `spec.md`, `research.md`, `design.md`, `tasks.md`, `summary.md`); `implementation` writes to `**/*`.

### When to use this workflow

- New features with a defined user-facing story set (the `stories` gate is the point)
- Multi-file changes that cross module boundaries and need a written design
- API surface changes where you want a spec committed before code
- Any change that is too big for `quick` but does not cross multiple subsystems

This is the default workflow invoked by `/metta-propose`.

### Notes

- `stories` is a mandatory stage. User stories are authored by the `product` agent before the spec is written.
- `spec` runs one gate: `stories-valid` (the spec's stories are internally consistent).
- `spec` is the only planning stage that runs a gate; `research`, `design`, and `tasks` are unblocked by gates entirely (`gates: []`).
- The build order is strictly linear — each stage has exactly one predecessor, so the engine will only ever surface one ready artifact at a time until implementation.

---

## full

Source: `src/templates/workflows/full.yaml`

### Stage flow

```
domain-research → intent → spec → research → design ┬─→ tasks ──────┐
                                                    ├─→ ux-spec     │
                                                    └─→ architecture─┴─→ implementation → verification
```

- `tasks`, `ux-spec`, and `architecture` all depend on `design` (they fan out in parallel once design is complete).
- `implementation` requires both `tasks` and `architecture` (`requires: [tasks, architecture]`).
- `ux-spec` is not a prerequisite of `implementation`, but it is produced before implementation begins because it depends on `design` and implementation depends on `tasks` which also depends on `design`. The engine will surface `ux-spec` as ready alongside `tasks` and `architecture`.

### Stages

| Stage | Template | Agent | Gates | Requires |
|---|---|---|---|---|
| domain-research | `domain-research.md` | researcher | (none) | (none) |
| intent | `intent.md` | proposer | (none) | domain-research |
| spec | `spec.md` | specifier | (none) | intent |
| research | `research.md` | researcher | (none) | spec |
| design | `design.md` | architect | (none) | research |
| architecture | `architecture.md` | architect | (none) | design |
| tasks | `tasks.md` | planner | (none) | design |
| ux-spec | `ux-spec.md` | architect | (none) | design |
| implementation | `execute.md` | executor | tests, lint, typecheck | tasks, architecture |
| verification | `verify.md` | verifier | (none) | implementation |

Each stage generates a file of the same name (`domain-research.md`, `intent.md`, `spec.md`, `research.md`, `design.md`, `architecture.md`, `tasks.md`, `ux-spec.md`, `summary.md`); `implementation` writes to `**/*`.

Notable differences from `standard`:

- Begins with `domain-research` (no `requires:`) before any intent is written.
- Does not include a separate `stories` stage — user stories are folded into `spec`.
- `spec` depends on `intent` directly (no stories between them) and runs no gates (`standard`'s `spec` runs `stories-valid`).
- Adds `architecture` (deep system design) and `ux-spec` (UX contract) as siblings of `tasks`, all depending on `design`.
- `implementation` requires both `tasks` and `architecture` — architecture must be authored and signed off before code starts.
- `implementation` runs `tests`, `lint`, `typecheck` but **not** `build` (the smaller workflows add `build`).

### When to use this workflow

- Complex systems work crossing multiple subsystems or services
- Greenfield subsystems where domain vocabulary is not yet established
- Changes with significant UX surface that need a UX contract before implementation
- High-stakes changes where architecture sign-off gating implementation is a requirement

### Notes

- The fan-out after `design` means `getNext` can return `tasks`, `ux-spec`, and `architecture` simultaneously. Alphabetical tie-breaking orders them `architecture`, `tasks`, `ux-spec` in the build order.
- `ux-spec` is off the critical path to implementation: `implementation.requires = [tasks, architecture]` does not include `ux-spec`. A change may ship without `ux-spec` being `complete` only if it is explicitly `skipped` — status `skipped` is treated as satisfied by `getNext`.
- `architecture` runs no gates itself. The signal for architecture readiness is that the `architect` agent has authored it and the change advances to `implementation`.
- `spec` in `full` runs no gates at all; in particular it does not run the `stories-valid` gate (standard does). Stories are handled inline within the spec.

---

## How to invoke each workflow

All invocations go through metta skills (AI orchestrators must not call the CLI directly):

| Workflow | Slash command |
|---|---|
| trivial | auto-selected for single-file changes (`file_count <= 1`); also `/metta-propose --workflow trivial "<description>"` |
| quick | `/metta-quick "<description>"` |
| standard | `/metta-propose "<description>"` |
| full | `/metta-propose --workflow full "<description>"` |

`/metta-propose` defaults to `standard`. Pass `--workflow trivial`, `--workflow quick`, or `--workflow full` to override.

Once a change is active, downstream skills advance through whatever workflow the change was created with:

- `/metta-plan` — author planning artifacts (stories, spec, research, design, tasks, etc.) up to the execution boundary
- `/metta-execute` — run the `implementation` stage
- `/metta-verify` — run the `verification` stage
- `/metta-ship` — finalize and merge
- `/metta-auto "<description>"` — full lifecycle loop (propose → plan → execute → verify → ship)

The engine selects the next artifact by calling `getNext(graph, statuses)`: an artifact is ready when its status is `pending` or `ready` and every ID in its `requires:` list has status `complete` or `skipped`.

## DAG adjacency (derived from `requires:`)

### trivial

| Artifact | Upstream (`requires:`) | Downstream |
|---|---|---|
| intent | (none) | implementation |
| implementation | intent | verification |
| verification | implementation | (sink) |

### quick

| Artifact | Upstream (`requires:`) | Downstream |
|---|---|---|
| intent | (none) | implementation |
| implementation | intent | verification |
| verification | implementation | (sink) |

### standard

| Artifact | Upstream (`requires:`) | Downstream |
|---|---|---|
| intent | (none) | stories |
| stories | intent | spec |
| spec | stories | research |
| research | spec | design |
| design | research | tasks |
| tasks | design | implementation |
| implementation | tasks | verification |
| verification | implementation | (sink) |

### full

| Artifact | Upstream (`requires:`) | Downstream |
|---|---|---|
| domain-research | (none) | intent |
| intent | domain-research | spec |
| spec | intent | research |
| research | spec | design |
| design | research | architecture, tasks, ux-spec |
| architecture | design | implementation |
| tasks | design | implementation |
| ux-spec | design | (sink — not required by implementation) |
| implementation | tasks, architecture | verification |
| verification | implementation | (sink) |

## Reading a workflow YAML

The shape each workflow YAML must match is `WorkflowDefinitionSchema` in `src/schemas/workflow-definition.ts`:

```yaml
name: <string>                 # workflow name (matches filename stem)
description: <string>          # optional
version: <positive integer>    # schema version
artifacts:
  - id: <string>               # stable identifier
    type: <string>             # artifact category (intent, spec, design, ...)
    template: <string>         # template filename relative to templates/artifacts/
    generates: <string>        # output filename or glob
    requires: [<id>, ...]      # upstream artifact IDs
    agents: [<name>, ...]      # agent personas that author this artifact
    gates: [<id>, ...]         # gate IDs to run after authoring
```

All object shapes are `.strict()` Zod — unknown keys will fail to load.

## Selection heuristics

| Signal | Workflow |
|---|---|
| Single-file fix, unambiguous scope (`file_count <= 1`) | trivial |
| Small change touching one or two files, known root cause | quick |
| New user-facing feature with stories | standard |
| Greenfield subsystem, new domain vocabulary | full |
| API-breaking change | standard or full |
| UX-heavy change needing a UX contract | full |
| Cross-subsystem refactor | full |

## Artifact status lifecycle

Every artifact in a change carries a status drawn from `ArtifactStatusSchema`:

| Status | Meaning | Counts as satisfied for downstream `requires:`? |
|---|---|---|
| `pending` | Not yet started | no |
| `ready` | Dependencies satisfied, waiting for agent | no |
| `in_progress` | Agent is authoring | no |
| `complete` | Authored and all gates passed | yes |
| `failed` | A gate failed or authoring errored | no |
| `skipped` | Explicitly skipped by the user/orchestrator | yes |

`getNext` returns artifacts whose status is `pending` or `ready`; the engine does not promote `pending` → `ready` itself — that transition is owned by the caller (typically the skill/orchestrator) once it observes that all upstream dependencies are `complete` or `skipped`.

`skipped` is the escape hatch: any artifact may be skipped, and the DAG still progresses. The relevant example is `ux-spec` in the `full` workflow — skipping it unblocks nothing (nothing depends on it), but the change can be marked complete without it because `verification` only transitively requires `tasks` and `architecture` (through `implementation`).

## Cross-links

- [`artifacts.md`](./artifacts.md) — what each stage's artifact file looks like (intent, stories, spec, research, design, architecture, tasks, ux-spec, execution, verification)
- [`agents.md`](./agents.md) — agent personas: `proposer`, `product`, `specifier`, `researcher`, `architect`, `planner`, `executor`, `verifier`
- [`gates.md`](./gates.md) — gate definitions: `tests`, `lint`, `typecheck`, `build`, `stories-valid`

## Source of truth

If this document drifts from the YAML, the YAML wins. Regenerate or update this file from:

- `src/templates/workflows/trivial.yaml`
- `src/templates/workflows/quick.yaml`
- `src/templates/workflows/standard.yaml`
- `src/templates/workflows/full.yaml`
- `src/schemas/workflow-definition.ts` — `WorkflowDefinitionSchema`
- `src/workflow/workflow-engine.ts` — `WorkflowEngine.loadWorkflow`, `getNext`, `topologicalSort`
