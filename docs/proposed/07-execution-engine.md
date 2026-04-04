# 07 — Execution Engine

## Core Concept

The Execution Engine turns tasks into code. It combines GSD's wave-based parallelism, Ralph's fresh-context-per-task pattern, and BMAD's deviation rules into a unified system with programmatic backpressure gates.

---

## Wave Planning

Tasks are grouped into waves based on dependencies:

```
Input tasks:
  Task 1.1: Create auth models          (no deps)
  Task 1.2: Create product models       (no deps)
  Task 2.1: Build auth API              (depends on 1.1)
  Task 2.2: Build product API           (depends on 1.2)
  Task 3.1: Build checkout flow         (depends on 2.1 + 2.2)

Wave plan:
  Wave 1: [1.1, 1.2]       ← parallel, no deps
  Wave 2: [2.1, 2.2]       ← parallel, Wave 1 complete
  Wave 3: [3.1]            ← sequential, Wave 2 complete
```

### Overlap Detection

Before running a wave in parallel, the engine checks for file overlap:

```
Wave 2 tasks:
  Task 2.1 files: src/auth/api.ts, src/auth/middleware.ts
  Task 2.2 files: src/product/api.ts, src/product/models.ts
  Overlap: none → safe to parallelize

Wave 2 tasks (with overlap):
  Task 2.1 files: src/api/routes.ts, src/auth/api.ts
  Task 2.2 files: src/api/routes.ts, src/product/api.ts
  Overlap: src/api/routes.ts → run sequentially within wave
```

Overlap detection uses the `files` field declared in each task. If files aren't declared, the engine defaults to sequential execution (safe fallback).

---

## Execution Modes

### Parallel (default when safe)

Each task in a wave gets its own:
- **Fresh context window** — no pollution from previous tasks
- **Git worktree** — isolated file state, no merge conflicts during execution
- **Scoped tools** — only the tools the executor agent is allowed to use
- **Atomic commit** — one commit per task, revertable independently

```
Orchestrator (lean context, ~15K tokens)
  ├── Wave 1
  │   ├── Worktree A → Executor(Task 1.1) → commit → gate → exit
  │   └── Worktree B → Executor(Task 1.2) → commit → gate → exit
  │   [merge worktrees into main branch]
  ├── Wave 2
  │   ├── Worktree C → Executor(Task 2.1) → commit → gate → exit
  │   └── Worktree D → Executor(Task 2.2) → commit → gate → exit
  │   [merge worktrees]
  └── Wave 3
      └── Inline → Executor(Task 3.1) → commit → gate → exit
```

### Sequential (fallback)

When parallel execution isn't available (tool doesn't support subagents/worktrees):
- Tasks execute inline, one at a time
- Each task still gets a fresh context load
- Commits are still atomic per task

### Interactive

User reviews each task's output before proceeding to the next:
```
Task 1.1: Create auth models
  [executor completes]
  → Gate: tests pass ✓
  → Gate: lint pass ✓
  → User: looks good? [y/n/edit]
  y
Task 1.2: Create product models
  ...
```

---

## Backpressure Gates

Gates are verification checks that run after each task (or wave). They provide programmatic backpressure — the primary control mechanism for agent behavior.

### Built-in Gates

| Gate | What it checks | Runs |
|------|---------------|------|
| `tests` | Test suite passes | After each task |
| `lint` | Linter has no errors | After each task |
| `typecheck` | Type checker passes | After each task |
| `build` | Project builds successfully | After each wave |
| `spec-compliance` | Implementation matches spec scenarios | After all waves |

### Gate Definition

```yaml
# .metta/gates/tests.yaml
name: tests
description: Run project test suite
command: npm test
timeout: 120000  # ms
required: true    # Blocks next task if failed
on_failure: retry_once  # retry_once | stop | continue_with_warning
```

### Custom Gates

```yaml
# .metta/gates/schema-drift.yaml
name: schema-drift
description: Detect ORM schema changes missing migrations
command: metta gate schema-drift
timeout: 30000
required: true
on_failure: stop

# .metta/gates/security-scan.yaml
name: security-scan
description: Run SAST scanner on changed files
command: semgrep --config auto --changed-files
timeout: 60000
required: false  # Warning only
on_failure: continue_with_warning
```

### Gate Results

Gates produce typed results:

```typescript
interface GateResult {
  gate: string
  status: "pass" | "fail" | "warn" | "skip"
  duration_ms: number
  output?: string
  failures?: GateFailure[]
}

interface GateFailure {
  file: string
  line?: number
  message: string
  severity: "error" | "warning"
}
```

Gate results are stored in the change's summary and available to the verification agent.

---

## Deviation Rules

During execution, agents encounter situations not covered by the task plan. Deviation rules define how to handle them:

### Rule 1: Auto-Fix Discovered Bugs
If the executor discovers a bug while implementing a task, fix it immediately. Commit separately from the task commit with a clear message.

### Rule 2: Add Critical Missing Pieces
If a task can't work without a small addition not in the plan (e.g., a missing utility function), add it. Commit separately. Log the deviation.

### Rule 3: Fix Blockers
If a task is blocked by an infrastructure issue (e.g., broken dependency, missing env var), attempt to fix it. If the fix is > 10 lines, stop and escalate.

### Rule 4: Stop for Architectural Decisions
If execution reveals that the design is wrong or a major change is needed, stop immediately. Don't improvise architecture. Surface the issue to the orchestrator.

### Deviation Logging

Every deviation is logged in the task summary:

```yaml
deviations:
  - rule: 1
    description: "Fixed null check in auth middleware discovered during API implementation"
    commit: "abc123f"
    files: ["src/auth/middleware.ts"]
  - rule: 4
    description: "Database schema requires a migration not in the plan"
    action: stopped
    reason: "Architectural decision needed: add migration step or modify schema in-place"
```

The orchestrator reviews deviations after each wave and can adjust the plan accordingly.

---

## Orchestrator Design

The orchestrator is intentionally lean:

```
Orchestrator responsibilities:
  ✓ Parse wave plan
  ✓ Spawn executors (parallel or sequential)
  ✓ Collect results
  ✓ Run gates
  ✓ Update state
  ✓ Handle deviations (rule 4 → escalate)
  ✓ Merge worktrees

Orchestrator does NOT:
  ✗ Read implementation details
  ✗ Make design decisions
  ✗ Write code
  ✗ Debug test failures (delegates to executor)
```

This keeps the orchestrator's context lean (~15K tokens), reserving the full window for executors.

---

## Failure Recovery

### Task Failure
1. Gate fails → executor retries once (if `on_failure: retry_once`)
2. Still fails → mark task as `failed`
3. Orchestrator pauses wave
4. User decides: fix manually, re-plan task, or skip

### Wave Failure
1. Any task in wave fails → remaining tasks in wave continue (if independent)
2. Failed tasks block downstream waves that depend on them
3. Non-dependent downstream waves proceed normally
4. State is saved — resuming later picks up where it stopped

### Session Recovery
If the session ends mid-execution:
```bash
metta execute --resume
```
Reads state from `.metta/state.yaml`, identifies incomplete tasks, and resumes from the last successful checkpoint.

---

## Execution State

```yaml
# .metta/state.yaml (execution section)
execution:
  change: add-mfa
  started: "2026-04-04T12:00:00Z"
  waves:
    - id: 1
      status: complete
      tasks:
        - id: "1.1"
          status: complete
          commit: "abc123f"
          gates: { tests: pass, lint: pass }
        - id: "1.2"
          status: complete
          commit: "def456a"
          gates: { tests: pass, lint: pass }
    - id: 2
      status: in_progress
      tasks:
        - id: "2.1"
          status: in_progress
          worktree: "/tmp/metta-worktree-2.1"
        - id: "2.2"
          status: pending
  deviations: []
```

State is updated atomically after each task completion. Schema-validated on every write.
