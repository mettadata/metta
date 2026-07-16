# Data Model & Persistence

A contributor-facing reference for **what metta persists, where, in what schema, and how state transitions over a change's lifecycle.**

metta has no database. All durable state is plain files on disk:

- **YAML state files** — structured, validated against [Zod](https://zod.dev) schemas on every read and write.
- **Markdown artifact/spec bodies** — free-form prose authored by subagents; deliberately *not* schema-validated.
- **git** — the transaction log. Changes and specs are committed as work progresses; completed changes are archived on ship.

Related reading: [Architecture](./architecture.md) for how the components fit together, and the [Configuration guide](../guide/configuration.md) for the user-facing view of `.metta/config.yaml`.

---

## On-disk layout

Two top-level directories hold all metta state: `.metta/` (tool config and runtime locks, mostly git-ignored) and `spec/` (the durable, committed knowledge base).

```
<project root>/
├── .metta/                         # tool runtime — mostly git-ignored
│   ├── config.yaml                 # → ProjectConfigSchema  (project-config.ts)
│   ├── .gitignore
│   ├── locks/                      # advisory lock files
│   │   └── finalize-<change>.lock  # → FinalizeLockSchema   (finalize-lock.ts)
│   └── logs/                       # rotating runtime logs (e.g. guard-bypass.log)
│
└── spec/                           # the spec store — committed to git
    ├── project.md                  # the constitution (raw markdown — no schema)
    │
    ├── specs/                      # living specifications, one dir per capability
    │   └── <capability>/
    │       ├── spec.md             # requirement + scenario prose (raw markdown)
    │       └── spec.lock           # → SpecLockSchema        (spec-lock.ts)
    │
    ├── changes/                    # work in flight, one dir per change slug
    │   └── <slug>/
    │       ├── .metta.yaml         # → ChangeMetadataSchema  (change-metadata.ts)
    │       ├── intent.md           # raw markdown artifact bodies …
    │       ├── spec.md             #   (authored by metta-* subagents)
    │       ├── stories.md          #   parsed against StorySchema (story.ts)
    │       ├── plan.md
    │       ├── implementation.md
    │       └── verification.md
    │
    ├── archive/                    # completed/abandoned changes (moved on ship)
    │   └── <YYYY-MM-DD>-<slug>[-abandoned]/   # full change dir, frozen
    │
    ├── issues/                     # logged issues (raw markdown)
    ├── backlog/                    # prioritized backlog items (raw markdown)
    └── gaps/                       # reconciliation gaps, spec vs. code (raw markdown)
```

`state.yaml` (→ `StateFileSchema`, `state-file.ts`) holds transient execution and `--auto` loop state. It is written by the execution engine at the `StateStore` base path (the spec store root) and is not part of the durable per-change artifact set.

The set of artifact files inside a `changes/<slug>/` directory is not fixed — it is determined by the active **workflow definition** (`WorkflowArtifactSchema.generates`), so a `quick` change has fewer files than a `full` one.

---

## Schemas

Every YAML file above maps to exactly one Zod schema in `src/schemas/`. Schemas are `.strict()` (unknown keys are rejected) unless noted. The tables below mirror the schemas — if a field is not listed, it is not in the schema.

### ChangeMetadata — `changes/<slug>/.metta.yaml`

The per-change control record. Source: `src/schemas/change-metadata.ts`.

| Field | Type | Notes |
|-------|------|-------|
| `workflow` | `string` | Name of the active workflow definition (e.g. `quick`, `standard`, `full`). |
| `created` | datetime string | ISO-8601 creation timestamp. |
| `status` | `ChangeStatus` enum | `active` \| `paused` \| `complete` \| `abandoned`. |
| `current_artifact` | `string` | ID of the artifact currently in focus. |
| `base_versions` | `Record<string,string>` | Capability → spec version pinned at change start (basis for reconciliation/merge). |
| `artifacts` | `Record<string, ArtifactStatus>` | Per-artifact status map (see lifecycle below). |
| `complexity_score` | `ComplexityScore?` | Estimated tier at proposal time. |
| `actual_complexity_score` | `ComplexityScore?` | Measured tier after execution. |
| `auto_accept_recommendation` | `boolean?` | Auto-accept the recommended workflow tier. |
| `workflow_locked` | `boolean?` | Workflow tier pinned; no further re-tiering. |
| `artifact_timings` | `Record<string, {started?, completed?}>?` | Per-artifact start/complete datetimes. |
| `artifact_tokens` | `Record<string, {context, budget}>?` | Per-artifact context tokens consumed vs. budget. |
| `review_iterations` | `int ≥ 0`? | Count of review passes. |
| `verify_iterations` | `int ≥ 0`? | Count of verification passes. |
| `stop_after` | `string?` | Artifact ID after which the workflow halts (e.g. stop after planning). |

`ComplexityScore` = `{ score: 0..3, signals: { file_count }, recommended_workflow: trivial|quick|standard|full }`.

`ArtifactStatus` enum: `pending` \| `ready` \| `in_progress` \| `complete` \| `failed` \| `skipped`.

### SpecLock — `specs/<capability>/spec.lock`

The structured, versioned index over a capability's `spec.md`. The markdown holds the prose; the lock holds the hashes and machine-checkable requirement/scenario index. Source: `src/schemas/spec-lock.ts`.

| Field | Type | Notes |
|-------|------|-------|
| `version` | `int > 0` | Monotonic spec version; bumped on each accepted change. |
| `hash` | `string` | Content hash of the spec (e.g. `sha256:…`). |
| `updated` | datetime string | Last update timestamp. |
| `status` | `draft` \| `reviewed` \| `approved`? | Review state of the spec. |
| `source` | `scan` \| `manual` \| `change`? | How the spec was produced (import scan, hand-authored, or via a change). |
| `scanned_from` | `string[]?` | Source files, when produced by `metta import` scan. |
| `uncovered_behaviors` | `int ≥ 0`? | Count of behaviors observed but not yet specified. |
| `requirements` | `SpecLockRequirement[]` | One entry per requirement (see below). |
| `reconciliation` | `Reconciliation?` | Latest spec-vs-code reconciliation result. |

`SpecLockRequirement` = `{ id, hash, scenarios: string[] }` — each requirement carries its own content hash and the IDs of its Given/When/Then scenarios.

`Reconciliation` = `{ verified_at, requirements: ReconciliationRequirement[] }`, where each `ReconciliationRequirement` = `{ id, status, gaps?, evidence? }` and `status` is one of: `verified` \| `partial` \| `missing` \| `unimplemented` \| `diverged` \| `undocumented`.

### ExecutionState — inside `state.yaml`

Tracks batched, parallel execution of a change. Embedded in `StateFile` (below). Source: `src/schemas/execution-state.ts`.

| Field | Type | Notes |
|-------|------|-------|
| `change` | `string` | Change slug being executed. |
| `started` | datetime string | Execution start. |
| `batches` | `ExecutionBatch[]` | Ordered batches of tasks. |
| `deviations` | `Deviation[]` | Change-level deviations from plan. |

`ExecutionBatch` = `{ id: int>0, status: pending|in_progress|complete|failed, tasks: ExecutionTask[] }`.

`ExecutionTask` = `{ id, status, commit?, worktree?, gates?: Record<name, pass|fail|warn|skip>, deviations? }` where task `status` is `pending` \| `in_progress` \| `complete` \| `failed` \| `skipped`.

`Deviation` = `{ rule: 1..4, description, commit?, files?, action?: fixed|added|stopped, reason? }` — records where execution departed from the plan and why.

### StateFile — `state.yaml`

The transient runtime envelope, distinct from the durable per-change `.metta.yaml`. Source: `src/schemas/state-file.ts`.

| Field | Type | Notes |
|-------|------|-------|
| `schema_version` | `int > 0` | State file format version (currently `1`). |
| `execution` | `ExecutionState?` | Active execution state. |

### WorkflowDefinition — workflow templates

Defines which artifacts a change produces, in what order, and which agents/gates apply. Loaded from template YAML (shipped to `dist/`), not stored per-change. Source: `src/schemas/workflow-definition.ts`.

| Field | Type | Notes |
|-------|------|-------|
| `name` | `string` | Workflow identifier (recorded into `ChangeMetadata.workflow`). |
| `description` | `string?` | Human description. |
| `version` | `int > 0` | Definition version. |
| `artifacts` | `WorkflowArtifact[]` | Ordered artifact pipeline (see below). |

`WorkflowArtifact` = `{ id, type, template, generates, requires: string[], agents: string[], gates: string[] }`. `generates` is the output filename written into `changes/<slug>/`; `requires` lists prerequisite artifact IDs.

### GateDefinition — gate templates

A runnable quality gate. Loaded from template/registry YAML. Source: `src/schemas/gate-definition.ts`.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `name` | `string` | — | Gate identifier. |
| `description` | `string` | — | What it checks. |
| `command` | `string` | — | Shell command to run. |
| `timeout` | `int > 0` | `120000` | Milliseconds. |
| `required` | `boolean` | `true` | Whether failure blocks progress. |
| `on_failure` | enum | `retry_once` | `retry_once` \| `stop` \| `continue_with_warning`. |

Project config may override individual gates via `GateConfigSchema` (a partial of the above) under `gates:` in `config.yaml`.

### ProjectConfig — `.metta/config.yaml`

Project-level configuration. Source: `src/schemas/project-config.ts`. Most sections are optional with sensible defaults.

| Field | Type | Notes |
|-------|------|-------|
| `project` | `ProjectInfo?` | `name`, `description?`, `stack?`/`stacks?`, `conventions?`. |
| `defaults` | object? | `workflow` (default `standard`), `mode` (`interactive`\|`autonomous`\|`supervised`, default `supervised`). |
| `providers` | `Record<string, ProviderConfig>?` | `{ provider, model?, api_key_env? }` per named provider. |
| `tools` | `string[]?` | Enabled AI tool adapters. |
| `gates` | `Record<string, GateConfig>?` | Per-gate overrides (partial `GateDefinition`). |
| `git` | `GitConfig?` | Commit/merge/snapshot policy (see below). |
| `docs` | `DocsConfig` | `output` (`./docs`), `generate_on` (`finalize`), `types[]`. Defaults to `{}`. |
| `auto` | `AutoConfig?` | `max_cycles` (10), `ship_on_success` (false). |
| `context_sections` | `string[]?` | Context-engine section toggles. |
| `adapters` | `string[]?` | Adapter list. |
| `cleanup` | object? | `log_retention_days` (30). |
| `verification` | `VerificationConfig?` | `strategy` (`tmux_tui`\|`playwright`\|`cli_exit_codes`\|`tests_only`), `instructions?`. |

`GitConfig` defaults are safety-oriented: `enabled: true`, `commit_convention: conventional`, `protected_branches: [main, master]`, `merge_strategy: ff-only`, `snapshot_retention: until_ship`, `create_pr: false`, `pr_base: main`.

### Story — `changes/<slug>/stories.md`

User stories are authored as markdown but **parsed and validated** against `StorySchema`. Source: `src/schemas/story.ts`.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | Must match `US-<N>` (e.g. `US-1`). |
| `title` | `string` | Non-empty. |
| `asA` / `iWantTo` / `soThat` | `string` | Standard user-story clauses. |
| `priority` | `P1` \| `P2` \| `P3` | — |
| `independentTestCriteria` | `string` | How the story is independently testable. |
| `acceptanceCriteria` | `AcceptanceCriterion[]` | ≥ 1 Given/When/Then triple. |

The whole document is a discriminated union (`StoriesDocumentSchema`): either `{ kind: 'stories', stories: [...] }` (≥ 1) or a `{ kind: 'sentinel', justification }` opt-out (justification ≥ 10 chars).

### FinalizeLock — `.metta/locks/finalize-<change>.lock`

A per-change advisory lock that prevents two finalize/ship runs from racing. Source: `src/schemas/finalize-lock.ts`.

| Field | Type | Notes |
|-------|------|-------|
| `pid` | `int > 0` | Owning process PID (liveness-checked on contention). |
| `startedAt` | `string` | When the lock was taken. |
| `change` | `string` | Change slug it guards. |

---

## State lifecycle

### Change status

`ChangeMetadata.status` moves through the `ChangeStatusSchema` enum:

```
                 created (proposal)
                        │
                        ▼
   ┌──────────────►  active  ◄──────────────┐
   │  (resume)         │      (pause)        │
   │                   ├──────────► paused ──┘
   │                   │
   │     (complete /   │   (abandon →
   │      ship)        │    move to archive/…-abandoned)
   ▼                   ▼
complete  ◄────────────┘──────────► abandoned
   (move to archive/<date>-<slug>)
```

- `createChange` writes `status: active` (`artifact-store.ts`).
- `abandon` sets `status: abandoned`, then **moves** the change dir to `archive/<date>-<slug>-abandoned`.
- On ship/finalize the change is marked `complete` and `archive(name)` moves the directory to `archive/<date>-<slug>`.

### Artifact status

Each entry in `ChangeMetadata.artifacts` advances through `ArtifactStatusSchema`:

```
pending ──► ready ──► in_progress ──► complete
                          │
                          ├──► failed   (gate/verification failure)
                          └──► skipped  (not applicable for this tier)
```

- At change creation, every artifact starts `pending` and the **first** artifact is bumped to `ready` (`createChange`).
- `markArtifact(change, id, status)` is the single transition point. When it sets a status of `ready`, `in_progress`, or `complete`, it also advances `current_artifact` to that ID.
- Transitions originate from: the **artifact-store** (creation, generic marking), the **complete** command (marking an artifact `complete` and unlocking the next), and **finalize/ship** (final `complete` + archive). The execution engine separately tracks task/batch progress in `state.yaml`, not in the artifact map.

---

## Validation discipline

Structured state is never written blind. `StateStore` (`src/state/state-store.ts`) is the single gateway:

- **`read(path, schema)`** parses YAML, then `schema.safeParse` — a failure throws `StateValidationError` carrying the Zod issues. Callers never see unvalidated state.
- **`write(path, schema, data)`** validates **before** serializing — invalid data cannot reach disk. Output is written with `YAML.stringify(..., { lineWidth: 0 })`.

**The deliberate exception — raw markdown.** Spec bodies and change artifact prose (`intent.md`, `spec.md`, `plan.md`, `verification.md`, etc.) are written via **`writeRaw` / `readRaw`**, which bypass Zod entirely. This is by design: artifact bodies are natural-language prose authored by `metta-*` subagents and carry no machine-checkable shape. The *structured index over* that prose — `spec.lock` (hashes, requirement/scenario IDs) and `.metta.yaml` (statuses, timings) — is what gets Zod-validated. `stories.md` is the middle case: raw on disk, but its content is parsed against `StorySchema` when consumed.

### Locking

`StateStore.acquireLock(lockFile, timeout)` provides advisory locks by exclusively creating a `<state-file>.lock` next to the file it guards (`wx` flag). On contention it checks the lock's age: a lock older than **`STALE_LOCK_THRESHOLD_MS` (60 000 ms)** is treated as stale, removed, and re-acquired; otherwise it retries until `timeout` (default 5 000 ms), then throws `StateLockError`. Finalize uses a richer, PID-liveness-checked lock (`FinalizeLock`) under `.metta/locks/`.

---

## git as the transaction log

metta has no separate write-ahead log — **git is the durability and rollback mechanism.**

- Specs (`spec/specs/`) and change artifacts (`spec/changes/`) are committed as work progresses, so every state transition is a recoverable commit.
- The execution engine records the `commit` SHA for each completed task (`ExecutionTask.commit`), tying state back to git history.
- `git.snapshot_retention` (default `until_ship`) and `merge_strategy` (default `ff-only`) keep the history recoverable and protected branches safe.
- **On ship**, the completed change directory is moved out of `changes/` into `archive/<date>-<slug>/` (or `…-abandoned`) and committed — the archive is the frozen, post-merge record of the change and its artifacts.

See [Architecture](./architecture.md) for the component boundaries and [the Configuration guide](../guide/configuration.md) for tuning the git/merge policy.
