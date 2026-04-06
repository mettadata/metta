# Execution Engine Specification

**Module**: `src/execution/`
**Version**: 1.0.0
**Date**: 2026-04-06
**Status**: Draft

---

## 1. Overview

The execution engine orchestrates the lifecycle of task execution within a metta change. It coordinates four subsystems:

- **BatchPlanner** — resolves task dependencies and groups tasks into ordered batches
- **ExecutionEngine** — drives batch execution, manages state persistence, and routes tasks to parallel or sequential paths
- **WorktreeManager** — creates and manages Git worktrees for parallel task isolation
- **FanOut** — creates multi-perspective parallel work plans (review, research) and merges results

All state transitions MUST be persisted to `state.yaml` via `StateStore` immediately after they occur.

---

## 2. Definitions

| Term | Meaning |
|------|---------|
| Task | An atomic unit of work with a unique dot-notation ID (e.g., `1.1`), a file list, dependency list, and lifecycle fields |
| Batch | An ordered group of tasks that are all ready to run (all dependencies satisfied) |
| File overlap | Two or more tasks in the same batch that touch the same file path or a path that is a prefix ancestor of another task's path |
| Worktree | A Git worktree created under `$TMPDIR` providing an isolated working directory for a single task |
| Deviation | A recorded departure from the plan spec, keyed by rule number (1–4) |
| Fan-out | A parallel multi-agent work pattern where each agent operates on the same context from a distinct perspective |
| Gate | A required quality check (e.g., tests, lint) run in the task's working directory after task completion |

---

## 3. Batch Planner

### 3.1 Task Model

A `TaskDefinition` MUST contain the following fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | yes | Dot-notation identifier, e.g. `1.1` |
| `name` | `string` | yes | Human-readable task name |
| `files` | `string[]` | yes | File paths touched by this task |
| `depends_on` | `string[]` | yes | IDs of tasks that must complete before this task |
| `action` | `string` | yes | Description of what the task does |
| `verify` | `string` | yes | How to verify task completion |
| `done` | `string` | yes | Acceptance criterion |

### 3.2 Batch Planning Algorithm

The `planBatches` function MUST implement a topological sort that produces the minimal number of batches required to satisfy all dependencies.

**Algorithm**:

1. Maintain a `completed` set, initially empty.
2. On each iteration, collect all tasks whose `depends_on` entries are all in `completed` and which are not yet in `completed`. These are the `ready` tasks for the current batch.
3. If no tasks are ready and `completed.size < tasks.length`, there is a circular dependency — the planner MUST throw an error identifying the remaining task IDs.
4. Evaluate whether the ready tasks have file overlap (see §3.3). Set `parallel = !hasFileOverlap(ready)`.
5. Append `{ id: batchId, tasks: ready, parallel }` to the batch list.
6. Add all ready tasks to `completed`. Increment `batchId`.
7. Repeat until `completed.size === tasks.length`.

**Scenarios** (derived from `tests/batch-planner.test.ts`):

**Scenario 3.2.1 — Independent tasks collapse into one parallel batch**
```
Given two tasks with no dependencies and no file overlap
When planBatches is called
Then the result contains exactly one batch
And that batch contains both tasks
And batch.parallel is true
```

**Scenario 3.2.2 — Linear dependency chain produces sequential batches**
```
Given tasks 1.1, 2.1 (depends on 1.1), 3.1 (depends on 2.1)
When planBatches is called
Then the result contains three batches in order
And batch 1 contains 1.1, batch 2 contains 2.1, batch 3 contains 3.1
```

**Scenario 3.2.3 — Diamond dependency graph**
```
Given tasks 1.1 and 1.2 (no deps), 2.1 (depends on 1.1), 2.2 (depends on 1.2),
  and 3.1 (depends on 2.1 and 2.2)
When planBatches is called
Then the result contains three batches
And batch 1 contains [1.1, 1.2]
And batch 2 contains [2.1, 2.2]
And batch 3 contains [3.1]
```

**Scenario 3.2.4 — Circular dependency throws**
```
Given task 1.1 depends_on [2.1] and task 2.1 depends_on [1.1]
When planBatches is called
Then an error is thrown containing "Circular dependency"
And the error message includes the IDs of the remaining tasks
```

### 3.3 File Overlap Detection

The planner MUST detect two forms of file overlap between tasks in the same batch:

1. **Exact match** — two tasks list the same normalized file path
2. **Prefix/ancestor match** — one path is a directory prefix of another (e.g., `src/api/` and `src/api/routes.ts`)

File paths MUST be normalized before comparison by stripping backtick characters and trimming surrounding whitespace. Empty strings after normalization MUST be ignored.

**Scenario 3.3.1 — Exact file overlap disables parallelism**
```
Given task 1.1 touches [src/shared.ts, src/a.ts]
And task 1.2 touches [src/shared.ts, src/b.ts]
And neither task has dependencies
When planBatches is called
Then the single batch has parallel = false
```

**Scenario 3.3.2 — Directory prefix overlap disables parallelism**
```
Given task 1.1 touches [src/api/]
And task 1.2 touches [src/api/routes.ts]
When file overlap is evaluated
Then overlap is detected and parallelism is disabled
```

**Scenario 3.3.3 — No file overlap enables parallelism**
```
Given task 1.1 touches [src/auth/model.ts]
And task 1.2 touches [src/product/model.ts]
And neither task has dependencies
When planBatches is called
Then batch.parallel is true
```

The `detectOverlaps` function provides an audit-level report listing every overlapping pair with shared file names, and a `safe` list of task IDs that have no overlap with any other task.

### 3.4 Task Markdown Parsing

`parseTasks` MUST parse task lists from plan markdown in either of two line formats:

- `### Task 1.1: name` (heading format)
- `- [ ] **Task 1.1: name**` or `- [x] **Task 1.1: name**` (checklist format)

Each task block MAY include the following field lines (all optional in parsing; see §3.1 for required fields in execution):

| Markdown line pattern | Field populated |
|-----------------------|-----------------|
| `- **Files**: f1, f2` | `files` (split on comma, trimmed) |
| `- **Depends on**: Task 1.1, Task 1.2` | `depends_on` (IDs extracted, `Task ` prefix stripped) |
| `- **Action**: ...` | `action` |
| `- **Verify**: ...` | `verify` |
| `- **Done**: ...` | `done` |

**Scenario 3.4.1 — Full markdown parse**
```
Given valid plan markdown with three tasks (1.1, 1.2, 2.1)
When parseTasks is called
Then three TaskDefinition objects are returned
And task 1.1 has files [src/auth/model.ts, src/auth/types.ts] and empty depends_on
And task 2.1 has depends_on [1.1, 1.2]
```

**Scenario 3.4.2 — Empty markdown returns empty list**
```
Given an empty string
When parseTasks is called
Then an empty array is returned
```

### 3.5 Task Completion Marking

`markTaskComplete` MUST replace `- [ ] **Task X.X:` with `- [x] **Task X.X:` for the given task ID in the markdown string, leaving all other lines unchanged.

`getCompletedTasks` MUST scan markdown and return all task IDs that appear in a `- [x] **Task N.N:` line.

---

## 4. Execution Engine

### 4.1 Construction

`ExecutionEngine` MUST be constructed with:

- `stateStore: StateStore` — for reading and writing `state.yaml`
- `gateRegistry: GateRegistry` — for running post-task gates
- `cwd: string` — the repository root
- `mode: ExecutionMode` — one of `'sequential' | 'parallel' | 'auto'` (default: `'auto'`)

The engine MUST instantiate a `WorktreeManager` bound to `cwd` at construction time.

### 4.2 Execution State Shape

Execution state MUST conform to `ExecutionStateSchema`:

```
ExecutionState {
  change: string           // change name
  started: ISO datetime    // when execution began
  batches: ExecutionBatch[]
  deviations: Deviation[]
}

ExecutionBatch {
  id: number (positive int)
  status: 'pending' | 'in_progress' | 'complete' | 'failed'
  tasks: ExecutionTask[]
}

ExecutionTask {
  id: string
  status: 'pending' | 'in_progress' | 'complete' | 'failed' | 'skipped'
  commit?: string
  worktree?: string        // path when running in a worktree
  gates?: Record<string, 'pass' | 'fail' | 'warn' | 'skip'>
  deviations?: Deviation[]
}
```

### 4.3 Execution Lifecycle

`execute(changeName, batchPlan, callbacks?)` MUST:

1. Initialize an `ExecutionState` with all batches and tasks in `'pending'` status.
2. Persist state to disk immediately.
3. Process batches in order. For each batch:
   a. Set `batch.status = 'in_progress'` and persist.
   b. Invoke `callbacks.onBatchStart(batchId, useParallel)`.
   c. Execute the batch using the parallel or sequential path (see §4.4).
   d. Persist state after batch execution.
   e. Compute `batch.status`: `'complete'` if all tasks are complete, `'failed'` if any task failed.
   f. Invoke `callbacks.onBatchComplete(batchId)`.
   g. Persist state.
   h. If `batch.status === 'failed'`, STOP. Do not execute subsequent batches.
4. Return the final `ExecutionState`.

**Scenario 4.3.1 — Simple single-task execution**
```
Given a plan with one task (1.1) and a passing gate
When execute is called with event callbacks
Then onTaskStart is called with "1.1"
And onTaskComplete is called with "1.1"
And state.batches[0].status is "complete"
And state.batches[0].tasks[0].status is "complete"
```

**Scenario 4.3.2 — State persisted to disk**
```
Given a plan with one task
When execute completes
Then state.yaml exists in the state store directory
```

**Scenario 4.3.3 — Multi-batch execution in order**
```
Given tasks 1.1, 1.2 (parallel batch 1) and 2.1 (depends on 1.1, batch 2)
When execute is called
Then onBatchStart fires for batch 1 before batch 2
And all batches reach status "complete"
```

**Scenario 4.3.4 — Batch failure halts execution**
```
Given tasks 1.1 and 2.1 (depends on 1.1)
And a gate that always fails
When execute is called
Then batch 1 reaches status "failed"
And batch 2 remains at status "pending"
```

**Scenario 4.3.5 — Gate failure marks task failed**
```
Given task 1.1 and a required gate that exits non-zero
When execute is called
Then state.batches[0].tasks[0].status is "failed"
And onTaskFailed is called with task ID "1.1"
```

### 4.4 Parallel vs Sequential Mode

The engine MUST select the execution path per batch according to this table:

| `mode` setting | Batch `parallel` flag | `tasks.length` | Execution path |
|---|---|---|---|
| `'sequential'` | any | any | Sequential |
| `'parallel'` | `true` | any | Parallel |
| `'parallel'` | `false` | any | Sequential |
| `'auto'` | `true` | > 1 | Parallel |
| `'auto'` | `true` | 1 | Sequential |
| `'auto'` | `false` | any | Sequential |

**Sequential path**: Tasks run one at a time in array order. No worktrees are created.

**Parallel path**: Worktrees are created for each task (failures silently fall back to running without a worktree). All tasks execute concurrently via `Promise.all`. After all tasks complete, successful task worktrees are merged into the main branch in array order. A merge conflict MUST mark the task as `'failed'`. All worktrees MUST be removed regardless of task outcome.

### 4.5 Gate Execution

After each task completes (in either mode), the engine MUST run all `required: true` gates from the `GateRegistry` in the task's working directory:

- Parallel mode: gates run in the worktree directory (`wt.path`), or `cwd` if no worktree was created.
- Sequential mode: gates run in `cwd`.

Gate results MUST be recorded on `task.gates` as a map from gate name to status string. If any gate status is not `'pass'` or `'skip'`, the task MUST be marked `'failed'`.

### 4.6 Deviation Logging

`logDeviation(state, deviation)` MUST append a `Deviation` to `state.deviations`. The deviation MUST conform to `DeviationSchema`:

- `rule`: integer 1–4
- `description`: string
- `commit`: optional string
- `files`: optional string array
- `action`: optional `'fixed' | 'added' | 'stopped'`
- `reason`: optional string

**Scenario 4.6.1 — Deviation recorded**
```
Given a completed execution state
When logDeviation is called with rule=1 and a description
Then state.deviations has length 1
And state.deviations[0].rule equals 1
```

### 4.7 Resume

`resume(changeName, batchPlan, callbacks?)` MUST:

1. Attempt to load existing state from `state.yaml`.
2. If state does not exist, or `state.execution.change !== changeName`, fall through to a fresh `execute` call.
3. Otherwise, iterate batches. Skip any batch with `status === 'complete'`.
4. Within each non-complete batch, skip tasks with `status === 'complete'` or `'skipped'`.
5. Re-run incomplete tasks sequentially (resume always uses sequential mode regardless of batch parallelism flag).
6. Apply the same failure-halt logic as `execute`.

---

## 5. Worktree Manager

### 5.1 Create

`create(changeName, taskId)` MUST:

1. Construct branch name `metta/{changeName}/task-{taskId}`.
2. Construct worktree path `$TMPDIR/metta-worktree-{changeName}-{taskId}-{timestamp}`.
3. Capture the current HEAD commit via `git rev-parse HEAD`.
4. Create the branch at HEAD via `git branch {branch} HEAD` (silently ignore if branch already exists).
5. Create the worktree directory.
6. Register the worktree via `git worktree add {path} {branch}`.
7. Return `{ path, branch, baseCommit }`.

### 5.2 Merge

`merge(worktree, targetBranch?)` MUST:

1. Default `targetBranch` to the current branch if not provided.
2. Compute changed files via `git diff --name-only {baseCommit}...{branch}`.
3. Attempt `git merge --no-ff {branch}` with commit message `chore: merge task worktree {branch}`.
4. On success, return `{ status: 'clean', changedFiles }`.
5. On failure, abort the merge via `git merge --abort` and return `{ status: 'conflict', changedFiles, detail }`.

### 5.3 Remove

`remove(worktree)` MUST:

1. Attempt `git worktree remove {path} --force`.
2. If that fails, fall back to `rm -rf {path}`.
3. Attempt `git branch -D {branch}`. Silently ignore if the branch is already deleted.

### 5.4 List

`list()` MUST parse `git worktree list --porcelain` output and return only worktrees whose branch name starts with `metta/`. On any git error, return an empty array.

### 5.5 Cleanup

`cleanup()` MUST call `remove` for every worktree returned by `list` and return the count of worktrees removed.

---

## 6. Fan-Out

### 6.1 Review Fan-Out

`createReviewFanOut(changeName, changedFiles, context)` MUST return a `FanOutPlan` with exactly three tasks:

| Task ID | Agent | Perspective |
|---------|-------|-------------|
| `correctness` | `metta-reviewer` | Logic errors, off-by-one bugs, unhandled edge cases, spec adherence |
| `security` | `metta-reviewer` | OWASP top 10, XSS, injection, unvalidated input, secrets in code |
| `quality` | `metta-reviewer` | Dead code, unused imports, naming, duplication, missing error handling, test gaps |

The merge strategy MUST be `'structured'`.

### 6.2 Research Fan-Out

`createResearchFanOut(description, context, approaches)` MUST return a `FanOutPlan` with one task per entry in `approaches`. Each task MUST:

- Have ID `approach-{1-based index}`
- Use agent `metta-researcher`
- Include a persona that names the approach and instructs thorough pros/cons evaluation against the existing codebase

The merge strategy MUST be `'structured'`.

### 6.3 Merge Strategies

`mergeFanOutResults(results, strategy)` MUST handle three strategies:

| Strategy | Output format |
|----------|---------------|
| `'concat'` | One `## {agent} — {id}` section per successful result |
| `'structured'` | Summary header with count, then `### {id} ({agent}, {duration_ms}ms)` per result |
| `'vote'` | Bullet list of first line per result under `## Votes ({n} agents)` |

Failed results MUST be listed in a `## Failed ({n})` section prepended before successful content regardless of strategy.

### 6.4 Fan-Out Skill Format

`formatFanOutForSkill(plan)` MUST return a plain object suitable for passing to the orchestrator skill:

```json
{
  "parallel": true,
  "agents": [
    {
      "subagent_type": "<agent>",
      "description": "<id>: <first 60 chars of task>",
      "prompt": "<persona>\n\n## Task\n<task>\n\n## Context\n<context>"
    }
  ],
  "merge_strategy": "<mergeStrategy>"
}
```

---

## 7. Callback Interface

The `ExecutionCallbacks` interface defines optional async hooks called by the engine at lifecycle events:

| Callback | When fired |
|----------|-----------|
| `onTaskStart(taskId, worktree?)` | Before task execution begins |
| `onTaskComplete(taskId, commit?)` | After task logic completes (before gates) |
| `onTaskFailed(taskId, error)` | When task reaches `'failed'` status |
| `onBatchStart(batchId, parallel)` | Before a batch begins execution |
| `onBatchComplete(batchId)` | After a batch finishes (pass or fail) |
| `onDeviation(deviation)` | When a deviation is recorded |
| `onGateResult(result)` | After each gate runs |
| `onWorktreeCreated(taskId, worktree)` | After a worktree is successfully created |
| `onWorktreeMerged(taskId, changedFiles)` | After a worktree is cleanly merged |

All callbacks MUST be treated as optional. The engine MUST NOT throw if any callback is undefined. Callback errors MUST NOT suppress task state transitions.

---

## 8. Error Handling

| Condition | Behavior |
|-----------|----------|
| Circular dependency in task graph | `planBatches` throws `Error` with message including `"Circular dependency"` and the remaining task IDs |
| Worktree creation failure during parallel batch | Engine silently skips worktree for that task; task runs without isolation |
| Gate failure | Task marked `'failed'`; `onTaskFailed` called; batch stops processing further tasks in sequential mode |
| Merge conflict | Task marked `'failed'`; `onTaskFailed` called with message prefixed `"Worktree merge conflict: "` |
| Batch failure | Engine stops and does not execute subsequent batches |
| State read failure during resume | Engine falls back to a fresh execution |
