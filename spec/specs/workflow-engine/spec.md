# WorkflowEngine — Specification

**Source:** `src/workflow/workflow-engine.ts`
**Schema:** `src/schemas/workflow-definition.ts`, `src/schemas/change-metadata.ts`
**Templates:** `src/templates/workflows/`
**Tests:** `tests/workflow-engine.test.ts`
**RFC 2119 Keywords:** MUST, MUST NOT, SHOULD, MAY

---

## 1. Overview

`WorkflowEngine` is the stateful runtime responsible for loading, caching, sorting, and querying workflow graphs. A workflow graph is a directed acyclic graph (DAG) of `WorkflowArtifact` nodes ordered by their dependency declarations. The engine drives the change lifecycle by determining which artifacts are ready to execute at any given moment.

---

## 2. Data Model

### 2.1 WorkflowArtifact

Each artifact within a workflow MUST conform to the following shape (enforced by Zod strict schema):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier within the workflow |
| `type` | `string` | Yes | Category label (e.g. `intent`, `spec`, `execution`) |
| `template` | `string` | Yes | Template filename used to generate this artifact |
| `generates` | `string` | Yes | Output path pattern produced by this artifact (may be glob) |
| `requires` | `string[]` | Yes | IDs of artifacts that must complete before this one may start |
| `agents` | `string[]` | Yes | Agent role names authorized to execute this artifact |
| `gates` | `string[]` | Yes | Gate check names that must pass before the artifact is considered complete |

### 2.2 WorkflowDefinition

A workflow definition MUST conform to:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique workflow name |
| `version` | `integer > 0` | Yes | Schema version |
| `description` | `string` | No | Human-readable purpose |
| `extends` | `string` | No | Name of a base workflow to inherit from |
| `artifacts` | `WorkflowArtifact[]` | Yes | Ordered or unordered list of artifacts |
| `overrides` | `WorkflowOverride[]` | No | Per-artifact field patches applied after inheritance |

### 2.3 WorkflowOverride

An override entry MAY patch `requires`, `agents`, or `gates` on an existing artifact from the base workflow. All fields are optional; unset fields MUST NOT be modified.

| Field | Type | Required |
|-------|------|----------|
| `id` | `string` | Yes |
| `requires` | `string[]` | No |
| `agents` | `string[]` | No |
| `gates` | `string[]` | No |

### 2.4 WorkflowGraph

The resolved in-memory representation produced by the engine:

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Workflow name |
| `artifacts` | `WorkflowArtifact[]` | Full artifact list after merge |
| `buildOrder` | `string[]` | Topologically sorted artifact IDs |

### 2.5 ArtifactStatus

Valid values for per-artifact runtime status (from `ArtifactStatusSchema`):

`pending` | `ready` | `in_progress` | `complete` | `failed` | `skipped`

---

## 3. WorkflowEngine Class

### 3.1 Internal State

The engine MUST maintain an internal `Map<string, WorkflowGraph>` cache. A workflow that has been successfully loaded MUST NOT be re-parsed from disk on subsequent calls to `loadWorkflow` with the same name.

### 3.2 `loadWorkflow(name, searchPaths)`

**Signature:** `async loadWorkflow(name: string, searchPaths: string[]): Promise<WorkflowGraph>`

The engine MUST:

1. Return the cached `WorkflowGraph` immediately if `name` is already in cache.
2. Iterate `searchPaths` in order, attempting to read `<searchPath>/<name>.yaml`.
3. Parse the file content with `YAML.parse` and validate against `WorkflowDefinitionSchema` using Zod.
4. Stop at the first path that succeeds (does not throw).
5. If no path yields a valid file, throw `Error` with message: `Workflow '<name>' not found in: <paths joined by ', '>`.
6. If the definition includes an `extends` field, recursively load the named base workflow using the same `searchPaths` before proceeding.
7. Merge the base workflow and the current definition via `mergeWorkflows`.
8. Run `topologicalSort` on the final artifact list.
9. Cache and return the resulting `WorkflowGraph`.

### 3.3 `loadWorkflowFromDefinition(definition)`

**Signature:** `loadWorkflowFromDefinition(definition: WorkflowDefinition): WorkflowGraph`

The engine MUST:

1. Run `topologicalSort` on `definition.artifacts`.
2. Construct and cache a `WorkflowGraph` keyed by `definition.name`.
3. Return the graph synchronously.

This method MUST NOT perform file I/O or inheritance resolution. It is the preferred entry point for in-memory workflow construction (e.g. in tests).

### 3.4 `getNext(graph, statuses)`

**Signature:** `getNext(graph: WorkflowGraph, statuses: Record<string, ArtifactStatus>): WorkflowArtifact[]`

Returns the set of artifacts that are actionable right now.

The engine MUST include an artifact in the result if and only if ALL of the following are true:

- The artifact's status in `statuses` is `'pending'` OR `'ready'`.
- Every artifact ID listed in `artifact.requires` has a status of `'complete'` OR `'skipped'` in `statuses`.

The engine MUST NOT include artifacts whose status is `'in_progress'`, `'complete'`, `'failed'`, or `'skipped'`.

The engine MUST treat `'skipped'` as equivalent to `'complete'` for dependency resolution purposes.

An artifact absent from `statuses` MUST NOT be returned (its implicit status is `'pending'` per `getStatus`, but `getNext` reads the raw map — an artifact with no entry has no status entry, so the first condition `status !== 'pending' && status !== 'ready'` returns `false` because `undefined !== 'pending'` is `true`).

> **Note:** The current implementation filters using `status !== 'pending' && status !== 'ready'` which causes an artifact with an undefined status to be excluded (since `undefined` is neither `'pending'` nor `'ready'` strictly). See gap file `gap-getnext-implicit-pending.md`.

### 3.5 `getStatus(graph, statuses)`

**Signature:** `getStatus(graph: WorkflowGraph, statuses: Record<string, ArtifactStatus>): Array<{ artifact: WorkflowArtifact; status: ArtifactStatus }>`

The engine MUST return one entry per artifact in `graph.artifacts`, in artifact list order.

For each artifact, the status MUST be `statuses[artifact.id]` if present, or `'pending'` if absent.

### 3.6 `validate(graph)`

**Signature:** `validate(graph: WorkflowGraph): { valid: boolean; errors: string[] }`

The engine MUST inspect every artifact's `requires` array and verify that each referenced ID exists in `graph.artifacts`.

- If all references are satisfied, `valid` MUST be `true` and `errors` MUST be an empty array.
- For each dangling reference, an error string MUST be appended: `"Artifact '<id>' depends on unknown artifact '<dep>'"`.
- `valid` MUST be `false` when `errors.length > 0`.

> **Note:** Because `topologicalSort` already throws on unknown dependencies at load time, `validate` can only report errors for graphs constructed by bypassing `loadWorkflowFromDefinition` (i.e. raw `WorkflowGraph` objects assembled outside the engine). See gap file `gap-validate-redundancy.md`.

---

## 4. Topological Sort

### 4.1 Algorithm

The engine uses **Kahn's algorithm** (in-degree reduction with a queue).

Implementation steps:

1. Initialize `inDegree[id] = 0` and `adjacency[id] = []` for every artifact.
2. For each artifact, for each `dep` in `requires`:
   - If `dep` is not a known artifact ID, throw `Error`: `"Artifact '<id>' depends on unknown artifact '<dep>'"`.
   - Increment `inDegree[artifact.id]` by 1.
   - Append `artifact.id` to `adjacency[dep]`.
3. Seed the queue with all IDs where `inDegree === 0`, sorted alphabetically.
4. While the queue is non-empty:
   a. Dequeue the first element (`current`).
   b. Append `current` to the result.
   c. Collect all neighbors in `adjacency[current]`, decrement their in-degree.
   d. Collect newly zero-degree neighbors, sort them alphabetically, append to queue.
   e. Sort the entire queue alphabetically after appending (ensuring full determinism).
5. If `result.length !== artifacts.length`, a cycle exists. Throw `WorkflowCycleError` with the remaining (unresolved) artifact IDs as the cycle path.

### 4.2 Tie-Breaking

When multiple artifacts become unblocked simultaneously, they MUST be emitted in **alphabetical order** by ID. This is guaranteed by sorting newly-ready neighbors before enqueueing them, and by sorting the full queue after each batch.

### 4.3 Determinism

For any fixed set of artifacts and dependency edges, the topological sort MUST produce the same `buildOrder` on every call.

---

## 5. Cycle Detection

The engine MUST detect cycles using the residual artifact set after Kahn's algorithm completes.

- If `result.length < artifacts.length`, a cycle is present.
- The engine MUST throw `WorkflowCycleError`.
- `WorkflowCycleError` MUST extend `Error` with `name = 'WorkflowCycleError'` and expose `cyclePath: string[]` containing the IDs of the unresolved artifacts.
- The error message MUST be: `"Cycle detected in workflow: <ids joined by ' → '>"`.

The `cyclePath` represents the set of nodes that could not be sorted, not necessarily the minimal cycle. Callers SHOULD NOT assume this list is a minimal cycle path.

---

## 6. Workflow Inheritance (`extends`)

When a workflow definition includes `extends: <base-name>`, the engine MUST:

1. Recursively load the base workflow (which may itself extend another workflow).
2. Apply `mergeWorkflows(base, extension)` to produce the merged definition.

### 6.1 Merge Semantics

1. Start with a copy of the base workflow's `artifacts` array.
2. For each artifact in the extension's `artifacts`:
   - If an artifact with the same `id` already exists in the base list, **replace** it entirely.
   - If no artifact with that `id` exists, **append** the new artifact.
3. Apply each entry in `extension.overrides` (if present):
   - Locate the artifact by `id` in the merged list.
   - If found, patch only the fields present in the override (`requires`, `agents`, `gates`).
   - If not found, the override is silently ignored.
4. The merged definition's `name` and `version` MUST come from the extension (child), not the base.
5. The merged definition MUST NOT carry forward `extends` or `overrides` fields (it is a flattened definition).

---

## 7. YAML Workflow Format

Workflow YAML files are located at `src/templates/workflows/<name>.yaml` (copied to `dist/` at build time). The engine searches caller-supplied paths; there is no hardcoded default.

### 7.1 File Naming

The engine constructs the file path as `<searchPath>/<name>.yaml`. The `name` argument MUST match the filename stem exactly (case-sensitive).

### 7.2 Bundled Workflows

Three built-in workflows are shipped with metta:

#### `quick` (3 artifacts)

Linear pipeline for small, well-understood changes:

```
intent → implementation → verification
```

| ID | Type | Agents | Gates |
|----|------|--------|-------|
| `intent` | `intent` | `[proposer]` | `[]` |
| `implementation` | `execution` | `[executor]` | `[tests, lint, typecheck]` |
| `verification` | `verification` | `[verifier]` | `[uat]` |

#### `standard` (7 artifacts)

Linear pipeline for medium-complexity features:

```
intent → spec → research → design → tasks → implementation → verification
```

#### `full` (10 artifacts)

Full ceremony for complex systems, with a parallel fan-out after `design`:

```
domain-research → intent → spec → research → design ─┬─ architecture ─┐
                                                       ├─ tasks ────────┤→ implementation → verification
                                                       └─ ux-spec ──────┘ (ux-spec not required by implementation)
```

Note: `ux-spec` requires `design` but is NOT listed in `implementation`'s `requires`. It runs in parallel but does not gate implementation.

---

## 8. Scenarios (Given/When/Then)

The following scenarios are derived directly from `tests/workflow-engine.test.ts`.

### S-01: Linear pipeline sort

**Given** a workflow with artifacts `[a (no deps), b (requires a), c (requires b)]`
**When** `loadWorkflowFromDefinition` is called
**Then** `buildOrder` MUST equal `['a', 'b', 'c']`

### S-02: Parallel artifacts sorted alphabetically

**Given** a workflow with `design` (no deps), and `architecture`, `tasks`, `ux-spec` all requiring `design`, and `implementation` requiring `tasks` and `architecture`
**When** `loadWorkflowFromDefinition` is called
**Then** `design` MUST appear first in `buildOrder`
**And** `architecture` and `tasks` MUST appear before `implementation`
**And** the parallel group `[architecture, tasks, ux-spec]` MUST be emitted in alphabetical order

### S-03: Cycle detection throws WorkflowCycleError

**Given** a workflow with `a` requires `c`, `b` requires `a`, `c` requires `b`
**When** `loadWorkflowFromDefinition` is called
**Then** a `WorkflowCycleError` MUST be thrown

### S-04: Unknown dependency throws

**Given** a workflow with artifact `a` requiring `nonexistent`
**When** `loadWorkflowFromDefinition` is called
**Then** an error MUST be thrown

### S-05: getNext returns artifact with all deps complete

**Given** a workflow `intent → spec → design`
**And** statuses `{ intent: 'complete', spec: 'pending', design: 'pending' }`
**When** `getNext` is called
**Then** the result MUST contain only `spec`

### S-06: getNext returns multiple parallel artifacts

**Given** a workflow with `design` complete, `tasks` pending, `arch` ready, both requiring `design`
**When** `getNext` is called
**Then** both `tasks` and `arch` MUST be returned

### S-07: getNext treats skipped as complete for deps

**Given** a workflow with `a` and `b` (requires `a`)
**And** statuses `{ a: 'skipped', b: 'pending' }`
**When** `getNext` is called
**Then** `b` MUST be returned

### S-08: getNext returns empty when no artifact is ready

**Given** statuses `{ a: 'in_progress', b: 'pending' }` where `b` requires `a`
**When** `getNext` is called
**Then** the result MUST be empty

### S-09: getStatus returns all artifacts with defaults

**Given** a workflow with artifacts `a` and `b`
**And** statuses `{ a: 'complete', b: 'in_progress' }`
**When** `getStatus` is called
**Then** the result MUST have length 2
**And** `a.status` MUST be `'complete'` and `b.status` MUST be `'in_progress'`

### S-10: getStatus defaults to pending for absent artifacts

**Given** a workflow with artifact `a`
**And** an empty statuses map
**When** `getStatus` is called
**Then** `a.status` MUST be `'pending'`

### S-11: validate returns valid for well-formed graph

**Given** a loaded graph where all `requires` reference existing artifact IDs
**When** `validate` is called
**Then** `result.valid` MUST be `true` and `result.errors` MUST be `[]`

### S-12: loadWorkflow reads built-in YAML files

**Given** the templates directory is in `searchPaths`
**When** `loadWorkflow('quick', searchPaths)` is called
**Then** a graph with 3 artifacts MUST be returned
**And** `graph.name` MUST be `'quick'`

**Given** `loadWorkflow('standard', searchPaths)` is called
**Then** a graph with 7 artifacts MUST be returned

**Given** `loadWorkflow('full', searchPaths)` is called
**Then** a graph with 10 artifacts MUST be returned

### S-13: loadWorkflow throws for nonexistent workflow

**Given** a non-existent workflow name
**When** `loadWorkflow('nonexistent', ['/tmp'])` is called
**Then** a rejection MUST occur with an error message indicating the workflow was not found

### S-14: loadWorkflow caches results

**Given** a workflow has been successfully loaded
**When** `loadWorkflow` is called again with the same name
**Then** the cached `WorkflowGraph` MUST be returned without re-reading from disk

---

## 9. Built-in Error Types

### `WorkflowCycleError`

- Extends `Error`
- `name`: `'WorkflowCycleError'`
- `cyclePath: string[]`: IDs of artifacts that could not be resolved (the unordered residual set, not necessarily the minimal cycle)
- Message format: `"Cycle detected in workflow: <id1> → <id2> → ..."`
