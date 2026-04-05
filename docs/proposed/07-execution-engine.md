# 07 — Execution Engine

## Core Concept

The Execution Engine turns tasks into code. It combines GSD's batch-based parallelism, Ralph's fresh-context-per-task pattern, and BMAD's deviation rules into a unified system with programmatic backpressure gates.

---

## Batch Planning

Tasks are grouped into batches based on dependencies:

```
Input tasks:
  Task 1.1: Create auth models          (no deps)
  Task 1.2: Create product models       (no deps)
  Task 2.1: Build auth API              (depends on 1.1)
  Task 2.2: Build product API           (depends on 1.2)
  Task 3.1: Build checkout flow         (depends on 2.1 + 2.2)

Batch plan:
  Batch 1: [1.1, 1.2]       ← parallel, no deps
  Batch 2: [2.1, 2.2]       ← parallel, Batch 1 complete
  Batch 3: [3.1]            ← sequential, Batch 2 complete
```

### Overlap Detection

Before running a batch in parallel, the engine checks for file overlap:

```
Batch 2 tasks:
  Task 2.1 files: src/auth/api.ts, src/auth/middleware.ts
  Task 2.2 files: src/product/api.ts, src/product/models.ts
  Overlap: none → safe to parallelize

Batch 2 tasks (with overlap):
  Task 2.1 files: src/api/routes.ts, src/auth/api.ts
  Task 2.2 files: src/api/routes.ts, src/product/api.ts
  Overlap: src/api/routes.ts → run sequentially within batch
```

Overlap detection uses the `files` field declared in each task. If files aren't declared, the engine defaults to sequential execution (safe fallback).

---

## Execution Modes

### Parallel (default when safe)

Each task in a batch gets its own:
- **Fresh context window** — no pollution from previous tasks
- **Git worktree** — isolated file state, no merge conflicts during execution
- **Scoped tools** — only the tools the executor agent is allowed to use
- **Atomic commit** — one commit per task, revertable independently

```
Orchestrator (lean context, ~15K tokens)
  ├── Batch 1
  │   ├── Worktree A → Executor(Task 1.1) → commit → gate → exit
  │   └── Worktree B → Executor(Task 1.2) → commit → gate → exit
  │   [merge worktrees into main branch]
  ├── Batch 2
  │   ├── Worktree C → Executor(Task 2.1) → commit → gate → exit
  │   └── Worktree D → Executor(Task 2.2) → commit → gate → exit
  │   [merge worktrees]
  └── Batch 3
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

Gates are verification checks that run after each task (or batch). They provide programmatic backpressure — the primary control mechanism for agent behavior.

### Built-in Gates

| Gate | What it checks | Runs |
|------|---------------|------|
| `tests` | Test suite passes | After each task |
| `lint` | Linter has no errors | After each task |
| `typecheck` | Type checker passes | After each task |
| `build` | Project builds successfully | After each batch |
| `spec-compliance` | Implementation matches spec scenarios | After all batches |

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

The orchestrator reviews deviations after each batch and can adjust the plan accordingly.

---

## Orchestrator Design

The orchestrator is intentionally lean:

```
Orchestrator responsibilities:
  ✓ Parse batch plan
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

## Merge Safety

Executors must never merge into protected branches. This is the most dangerous moment in the execution lifecycle — a bad merge can overwrite a day's work. Metta treats every worktree merge as a potentially destructive operation requiring multiple safety checks.

### Principle: Executors Don't Merge

The executor's job ends with a commit in its worktree branch. It never touches main. The orchestrator owns the merge, and the merge is never automatic — it passes through a verification pipeline first.

```
Executor scope:     worktree branch only → commit → exit
Orchestrator scope: verify → dry-run merge → scope check → snapshot → merge
```

### Executor Sandboxing

Executors have restricted Bash access. Destructive git operations on protected branches are blocked at the tool-scoping level:

```yaml
# .metta/agents/executor.yaml
tools:
  - Read
  - Write
  - Edit
  - Bash:
      deny_patterns:
        - "git checkout main"
        - "git checkout master"
        - "git merge"
        - "git push.*--force"
        - "git reset --hard"
        - "git branch -D"
      allow_cwd: worktree_only  # Cannot cd outside worktree root
```

The deny list is enforced by the Command Delivery layer when generating executor instructions, and by a pre-execution hook that intercepts Bash calls. Both layers must agree — defense in depth.

### Pre-Merge Verification Pipeline

Before the orchestrator merges any worktree back into the target branch:

```
1. Base drift check    — Has the target branch advanced since the worktree was created?
2. Dry-run merge       — Does the merge apply cleanly? Any conflicts?
3. Scope check         — Did the executor only modify files declared in the task?
4. Gate verification   — Did all required gates pass in the worktree?
5. Snapshot            — Tag the current target HEAD for instant rollback
6. Merge               — Fast-forward if possible, merge commit if not
7. Post-merge gates    — Re-run gates on merged state (catches integration issues)
```

#### Step 1: Base Drift Check

```typescript
const baseCommit = worktree.baseCommit
const targetHead = await git.resolveRef(targetBranch)

if (baseCommit !== targetHead) {
  // Target branch advanced while executor was working.
  // Another batch's work landed, or the user committed directly.
  // Proceed to dry-run merge — do NOT fast-forward blindly.
  log.warn(`Target branch advanced: ${baseCommit.slice(0,7)} → ${targetHead.slice(0,7)}`)
}
```

#### Step 2: Dry-Run Merge

```typescript
const dryRun = await git.merge(worktree.branch, targetBranch, { dryRun: true })

if (dryRun.conflicts.length > 0) {
  // Surface conflicts interactively. Never auto-resolve.
  return {
    status: 'conflict',
    conflicts: dryRun.conflicts,
    action: 'User must resolve before proceeding'
  }
}
```

#### Step 3: Scope Check

Executors declare which files they'll touch in the task's `files:` field. Any modification outside that scope is flagged:

```typescript
const changedFiles = await git.diffFiles(worktree.branch, worktree.baseCommit)
const declaredFiles = expandGlobs(task.files)
const undeclaredChanges = changedFiles.filter(f => !declaredFiles.includes(f))

if (undeclaredChanges.length > 0) {
  // Executor touched files outside its declared scope.
  // Could be a deviation (Rule 1-3) or a hallucination.
  log.warn(`Scope violation: ${undeclaredChanges.join(', ')}`)
  
  if (mode === 'autonomous') {
    // In autonomous mode, allow if deviation was logged
    const loggedDeviations = task.deviations.flatMap(d => d.files)
    const unlogged = undeclaredChanges.filter(f => !loggedDeviations.includes(f))
    if (unlogged.length > 0) {
      return { status: 'scope_violation', files: unlogged }
    }
  } else {
    // In interactive/supervised mode, always surface for approval
    return { status: 'scope_violation', files: undeclaredChanges }
  }
}
```

#### Step 4: Gate Verification

Confirm all required gates passed in the worktree before merging:

```typescript
const gateResults = worktree.gateResults
const failedRequired = gateResults.filter(g => g.required && g.status !== 'pass')

if (failedRequired.length > 0) {
  return { status: 'gates_failed', failures: failedRequired }
}
```

#### Step 5: Pre-Merge Snapshot

Tag the current target HEAD for instant rollback. Cheap insurance:

```bash
git tag -f metta/pre-merge/batch-2-task-2.1 HEAD
```

Tags are namespaced per batch and task. The most recent snapshot is always available:

```bash
# Recovery: undo the last merge
git reset --hard metta/pre-merge/batch-2-task-2.1
```

Old snapshots are cleaned up when the change is archived (`metta ship`).

#### Step 6: Merge

Prefer fast-forward when possible (preserves linear history). Fall back to merge commit with metadata:

```bash
# Fast-forward (clean case)
git merge --ff-only worktree-branch

# Merge commit (diverged case)
git merge --no-ff worktree-branch -m "metta: merge task 2.1 (add auth API)"
```

#### Step 7: Post-Merge Gates

Re-run gates on the merged state. This catches integration issues that pass in isolation but fail when combined:

```typescript
const postMergeGates = await gateRegistry.run(['tests', 'typecheck', 'build'])

if (postMergeGates.some(g => g.status === 'fail')) {
  // Integration failure. Roll back the merge.
  await git.reset('hard', snapshotTag)
  return {
    status: 'post_merge_failure',
    snapshot: snapshotTag,
    failures: postMergeGates.filter(g => g.status === 'fail')
  }
}

// Success — clean up snapshot tag (or keep for safety)
```

### Protected Branch Configuration

```yaml
# .metta/config.yaml
git:
  protected_branches:
    - main
    - master
    - production
    - release/*
  merge_strategy: ff-only  # or no-ff, squash
  snapshot_retention: until_ship  # or always, never
```

Protected branches cannot be force-pushed, reset, or directly committed to by executors. Only the orchestrator's merge pipeline can write to them.

---

## Failure Recovery

### Task Failure
1. Gate fails → executor retries once (if `on_failure: retry_once`)
2. Still fails → mark task as `failed`
3. Orchestrator pauses batch
4. User decides: fix manually, re-plan task, or skip

### Batch Failure
1. Any task in batch fails → remaining tasks in batch continue (if independent)
2. Failed tasks block downstream batches that depend on them
3. Non-dependent downstream batches proceed normally
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
  batches:
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

---

## Auto Mode

Auto mode is the outer loop that chains the full lifecycle — propose, plan, execute, verify — and keeps going until the spec is satisfied. It's the Ralph pattern with Metta's structure around it.

### UX

```bash
# Full auto: spec it, plan it, build it, verify it
metta auto "build payment processing system"

# Auto from a specific point (spec already exists)
metta auto --from execute

# Auto with a max iteration cap
metta auto --max-cycles 5 "add dark mode toggle"
```

### Discovery Gate

Auto mode begins with the framework's Discovery Gate (see [03-workflow-engine.md](03-workflow-engine.md#discovery-gate)) — the only interactive part of the process. The agent generates a spec, asks all questions it needs, and iterates until the user confirms: "this spec is complete, go build it."

Once the discovery gate passes, the spec is locked for Cycle 1 and auto mode runs unattended. Gap analysis in later cycles can extend the spec, but the core requirements are stable.

```
metta auto "build payment processing system"

Phase 0: Discovery (interactive) — see Workflow Engine § Discovery Gate
Phase 1+: Build (unattended) — plan → execute → verify → [gap → re-plan] → ship
```

To skip discovery when the spec is already reviewed:
```bash
metta auto --from plan "add user profiles"
```

### The Loop

```
metta auto "description"

Cycle 1:
  ┌─ Propose ─── AI-driven discovery, intent + spec generation
  ├─ Plan ────── Design, task decomposition into batches
  ├─ Execute ─── Batch 1 → gates → Batch 2 → gates → ...
  ├─ Verify ──── Check deliverables against spec scenarios
  │
  └─ Spec-compliance gate passes? ──→ YES ──→ Ship
                                   └─→ NO ──→ Gap analysis

Cycle 2 (if gaps found):
  ┌─ Re-plan ── Generate tasks for unmet requirements only
  ├─ Execute ── Run new tasks
  ├─ Verify ─── Re-check all spec scenarios
  │
  └─ Passes? ──→ YES ──→ Ship
               └─→ NO ──→ Cycle 3 ...

Termination:
  ✓ All spec scenarios pass          → metta ship (auto or prompt)
  ✗ Max cycles reached               → pause, surface status to user
  ✗ Deviation Rule 4 triggered       → stop, architectural decision needed
  ✗ Same failures repeat 2+ cycles   → stop, likely design issue
```

### Cycle State

Each cycle is tracked in state:

```yaml
# .metta/state.yaml (auto section)
auto:
  description: "build payment processing system"
  started: "2026-04-04T12:00:00Z"
  max_cycles: 10
  current_cycle: 2
  cycles:
    - id: 1
      phase: complete
      artifacts: [intent, spec, design, tasks]
      batches_run: 3
      verification:
        total_scenarios: 14
        passing: 11
        failing: 3
        gaps: ["MFA challenge timeout", "rate limiting", "audit logging"]
    - id: 2
      phase: execute
      artifacts: [tasks]  # Re-planned from gaps only
      batches_run: 1
```

### Gap Analysis (Verify → Re-Plan Bridge)

When verification finds gaps, the auto runner doesn't re-plan from scratch. It:

1. Collects failing spec scenarios from the verification report
2. Maps failures to specific requirements
3. Generates a **gap task list** — only the work needed to close the gaps
4. Feeds gap tasks into the execution engine as a new batch plan

```
Cycle 1 verify result:
  ✓ User login (3/3 scenarios)
  ✓ Session management (2/2 scenarios)
  ✗ MFA challenge (1/3 scenarios) — timeout handling missing
  ✗ Rate limiting (0/2 scenarios) — not implemented

Gap analysis:
  → Task G1: Add MFA timeout handling to auth flow
  → Task G2: Implement rate limiting middleware
  → Task G3: Add rate limiting tests

Cycle 2 executes only [G1, G2, G3], not the entire plan.
```

### Guardrails

Auto mode is powerful but needs limits:

**Max cycles** (default: 10): Prevents infinite loops. Configurable per-run or in config:
```yaml
# .metta/config.yaml
auto:
  max_cycles: 10
  ship_on_success: false  # true = auto-ship, false = prompt user
```

**Stall detection**: If the same scenarios fail for 2+ consecutive cycles, auto mode stops. The agent is stuck — continuing won't help. Surface the failures and let the user decide.

**Deviation Rule 4 halts auto**: Architectural decisions require human judgment. Auto mode pauses, saves state, and surfaces the issue. Resume with `metta auto --resume` after the decision is made.

**Gate escalation**: If post-merge gates fail in auto mode, the cycle rolls back the batch and retries once. Second failure stops the loop.

### Scope Control

Auto mode respects the workflow selection:

```bash
metta auto --workflow quick "fix the login button"     # intent → execute → verify
metta auto --workflow standard "add user profiles"      # full 6-artifact cycle
metta auto --workflow full "rebuild auth system"        # 10-artifact cycle with research
```

Quick workflow + auto = the lightest possible loop. Full workflow + auto = maximum ceremony with no human in the loop (backpressure gates are the safety net).

### Resumability

Auto mode is fully resumable. If the session ends mid-cycle:

```bash
metta auto --resume
```

Reads auto state, identifies where in the cycle it stopped, and continues. Works across sessions because all state is on disk — the auto runner is stateless between iterations (Ralph pattern).
