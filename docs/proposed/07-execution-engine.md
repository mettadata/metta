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

When parallel execution isn't available (tool doesn't support subagents):
- Tasks execute one at a time in a single worktree branch
- Each task still gets a fresh context load
- Commits are still atomic per task
- Worktree merges back to main after all tasks complete

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

### Spec-Compliance Gate

The spec-compliance gate is fundamentally different from other gates — it uses **3-layer verification**, not a single shell command:

**Layer 1: Test-mapped (automatic)** — Every Given/When/Then scenario in the spec has a corresponding passing test. The gate maps scenario IDs to test names and checks coverage. If a scenario has no mapped test, it fails.

**Layer 2: AI-powered review (automatic)** — The Provider calls the AI with a verification prompt asking it to check each scenario against the implementation code. Output is a structured `GateResult` with per-scenario pass/fail and evidence (file + line where the behavior is implemented, or "not found"). This consumes provider tokens — it is not free like `npm test`.

**Layer 3: User checklist (interactive)** — Manual sign-off on subjective criteria (UX quality, naming conventions, architectural fit) before finalize. Presented as an interactive checklist derived from the spec's requirements.

If the provider is unavailable for Layer 2, the gate degrades to Layers 1 + 3 only (test coverage + manual checklist). This gate is required for standard/full workflows and opt-in for quick mode.

---

## Provider Resilience

AI provider failures are a distinct failure mode from gate failures. The Provider Registry handles resilience; engines receive clean results and route based on error type.

### Retry Policy

Configurable retry count per provider (default: 1 retry). On failure, retry once, then stop. No exponential backoff chains — fail fast and surface to the user.

### Failure Behavior

On provider failure after retries are exhausted, the default behavior is **explicit pause**: stop the current task, save state, and surface the error to the user. This is configurable but is the default because silent fallback chains can mask quality degradation.

### Rate Limit Handling

If the provider returns 429 (rate limited), respect the `Retry-After` header and pause the entire batch, not just the current task. Rate limits are provider-level, not task-level.

### Garbage Detection

If the AI returns output that fails Zod schema validation (for structured output) or is empty/truncated, treat it as a **provider failure**, not a gate failure. The distinction matters: gate failures mean the code is wrong; provider failures mean the AI response is wrong. Provider failures trigger the retry policy, not the gate's `on_failure` handler.

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

### Principle: All Work Happens in Worktrees

No agent ever commits directly to main. Every change — whether it's a single quick-mode task or a 20-task batch execution — is done in a git worktree branch. The only path back to main is through the merge safety pipeline.

This is non-negotiable. The worktree is the blast radius boundary. If an agent hallucinates, corrupts state, or goes off-plan, main is untouched. You can always throw away a worktree branch. You can't undo a bad commit to main that other work has built on.

```
Every metta operation (when git-aware):
  1. Checkout main and pull latest
  2. Create worktree branch from main HEAD
  3. All agent work happens in the worktree
  4. Merge safety pipeline → main
  5. Clean up worktree

No exceptions. Quick mode, standard mode, auto mode — all use worktrees.
All worktrees branch from main — never from another worktree or stale ref.
```

### Worktree Branch Naming

Branches are namespaced by change and task for traceability:

```
metta/<change-name>                    # Change-level branch (quick mode, single task)
metta/<change-name>/batch-1-task-1.1   # Task-level branch (batch execution)
metta/<change-name>/batch-1-task-1.2
metta/<change-name>/batch-2-task-2.1
```

### Principle: No Blind Merges

Nothing merges into main without passing every step of the verification pipeline. No shortcuts, no `--force`, no "it's probably fine." A blind merge can destroy a day's work — and unlike a bad commit on a feature branch, damage to main cascades into every subsequent worktree that branches from it.

This is the hardest rule in the framework. It cannot be disabled, overridden by config, or bypassed by autonomous mode. The merge safety pipeline is the only path to main.

### Principle: Executors Don't Merge

The executor's job ends with a commit in its worktree branch. It never touches main. The orchestrator owns the merge, and the merge is never automatic — it passes through the full verification pipeline first.

```
Executor scope:     worktree branch only → commit → exit
Orchestrator scope: verify → dry-run merge → scope check → snapshot → merge

There is no fast path. There is no "skip verification for small changes."
Every merge goes through every step.
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

Re-run gates on the merged state. This catches integration issues that pass in isolation but fail when combined. **If post-merge gates fail, main is rolled back immediately.** No prompts, no "continue anyway" — the snapshot exists for exactly this reason.

```typescript
const postMergeGates = await gateRegistry.run(['tests', 'typecheck', 'build'])

if (postMergeGates.some(g => g.status === 'fail')) {
  // Integration failure. Roll back immediately. No exceptions.
  await git.reset('hard', snapshotTag)
  log.error(`Post-merge gates failed. Main rolled back to ${snapshotTag}.`)
  log.error(`Worktree branch preserved for diagnosis: ${worktree.branch}`)
  return {
    status: 'post_merge_failure',
    snapshot: snapshotTag,
    worktree_branch: worktree.branch,  // Preserved — not cleaned up
    failures: postMergeGates.filter(g => g.status === 'fail')
  }
}

// Success — clean up snapshot tag (or keep for safety)
```

On rollback, the worktree branch is **preserved** so the user can diagnose and fix. Main is always left in a known-good state.

### Git Configuration

```yaml
# ~/.metta/config.yaml (or .metta/config.yaml for project override)
git:
  enabled: true                # true = git-aware, false = file-only mode
  commit_convention: conventional  # conventional | none | custom
  protected_branches:
    - main
    - master
    - production
    - release/*
  merge_strategy: ff-only     # ff-only | no-ff | squash
  snapshot_retention: until_ship  # until_ship | always | never
```

#### Git-Aware Mode (`git.enabled: true`, default)

When git-aware, Metta manages commits for all framework operations:
- Every task completion produces an atomic commit
- Spec archiving and merging are committed
- State changes are committed
- Worktree isolation is available for parallel execution
- Pre-merge verification pipeline is active
- Protected branch enforcement is active

#### File-Only Mode (`git.enabled: false`)

When git is disabled, Metta operates purely on the filesystem:
- No commits, no worktrees, no branch protection
- Parallel execution falls back to sequential (no worktree isolation)
- Merge safety pipeline is skipped
- User manages version control independently
- Useful for non-git projects or when Metta is embedded in another tool's workflow

#### Commit Convention (`git.commit_convention`)

When `conventional`, all framework-generated commits follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

Types used by Metta:

| Type | When |
|------|------|
| `feat` | Task commits that add new functionality |
| `fix` | Bug fixes discovered during execution (Deviation Rule 1) |
| `refactor` | Structural changes without behavior change |
| `docs` | Spec, design, and artifact creation/updates |
| `test` | Test additions from gate requirements |
| `chore` | Framework state updates, archiving, merges |

Scope is derived from the change name and task:

```bash
# Task commit
feat(add-mfa): implement TOTP verification endpoint

# Deviation fix
fix(add-mfa): null check in auth middleware discovered during API implementation

# Spec artifact
docs(add-mfa): create intent and spec artifacts

# Archive
chore(add-mfa): archive change and merge specs

# Merge from worktree
chore(add-mfa): merge task 2.1 (add auth API)
```

When `none`, commits use freeform messages. When `custom`, a user-provided template in `.metta/config.yaml` defines the format:

```yaml
git:
  commit_convention: custom
  commit_template: "[{change_name}] {type}: {description}"
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

### Common Failure Scenarios

**Stalled auto-mode loop**: Same scenarios fail for 2+ cycles. Auto mode halts with a diagnostic showing which scenarios are stuck and what was attempted. Review the spec for ambiguity or the design for feasibility. Resume after fixing: `metta auto --resume`.

**Provider outage mid-execution**: Provider failure after retries triggers explicit pause. State is saved. Worktree is preserved. Resume when provider is back: `metta execute --resume`. If a fallback provider is configured, Metta switches automatically.

**Spec conflicts blocking finalize**: `metta finalize` surfaces conflicts interactively. Use `metta finalize --dry-run` to preview. Resolve conflicts on the worktree branch, commit, and retry `metta finalize`.

**Corrupted state**: If `.metta/state.yaml` fails schema validation, `metta doctor` reports the issue. Recovery: delete `.metta/state.yaml` (it's local, gitignored) and reconstruct from committed artifacts using `metta execute --resume`.

**Orphaned worktrees after crash**: `metta cleanup` removes worktrees whose changes no longer exist. `metta doctor` detects them proactively.

**Gate passes in worktree, fails post-merge**: Automatic rollback via snapshot tag. Worktree branch is preserved for diagnosis. Most common cause: integration conflicts between parallel tasks in the same batch.

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

## Finalize (Prepare for Ship)

After `metta verify` passes, `metta finalize` handles all the bookkeeping — spec merging, doc generation, context refresh — **on the worktree branch**. This keeps the merge to main clean and atomic.

```bash
metta verify          # Gates pass, spec compliance confirmed
metta finalize   # Archive, merge specs, generate docs, refresh
metta ship            # Merge to main
```

Three explicit steps. No hidden logic.

### What `metta finalize` Does (on worktree branch)

```
1. Archive change       — move spec/changes/<name>/ to spec/archive/YYYY-MM-DD-<name>/
2. Merge delta specs    — apply deltas to living specs in spec/specs/
                          (conflict detection, dry-run, requirement-level merge)
3. Generate changelog   — append entry to docs/changelog.md from change artifacts
4. Generate docs        — update docs/ (architecture, API, etc.)
5. Refresh              — regenerate CLAUDE.md, .cursorrules, etc. (marker sections)
6. Surface captures     — report ideas and bugs logged during this change
7. Cleanup              — remove snapshot tags, clean temp state
8. Commit               — conventional commit: docs(<change>): archive and finalize
```

Everything is committed on the worktree branch. Main is untouched until `metta ship`.

### Conflict Handling During Spec Merge

If another change has been shipped while this one was in flight, the delta spec merge may hit conflicts:

```
metta finalize

Merging delta specs...
  ✓ auth/user-login — clean merge (base unchanged)
  ✗ auth/session-management — CONFLICT
    Base version: sha256:abc123
    Current version: sha256:def456 (changed by "add-session-refresh" shipped yesterday)
    This change modifies: session expiry scenario

  Resolve interactively before documentation can complete.
```

Documentation pauses for conflict resolution. The user resolves on the branch, commits, and retries.

### Dry Run

```bash
metta finalize --dry-run   # Preview what would change without applying
```

---

## Ship (Merge to Main)

`metta ship` is **only the merge**. All preparation happened in `metta finalize`. Ship is the safe landing on main.

```bash
metta ship              # Merge worktree branch → main
metta ship --dry-run    # Preview merge without applying
```

### What Ship Does

```
1. Merge safety pipeline  — full 7-step verification:
   a. Base drift check    — has main advanced?
   b. Dry-run merge       — does it apply cleanly?
   c. Scope check         — only expected files changed?
   d. Gate verification   — all gates passed on branch?
   e. Snapshot            — tag main HEAD for rollback
   f. Merge               — fast-forward or merge commit
   g. Post-merge gates    — re-run gates on main (auto-rollback on failure)

2. Create PR             — if configured (git.create_pr: true)
                           PR body generated from change artifacts

That's it. No bookkeeping, no spec merging, no doc generation.
Those all happened in metta finalize, on the branch.
```

### Ship Configuration

```yaml
# .metta/config.yaml
git:
  create_pr: false          # true = create PR instead of direct merge
  pr_base: main             # target branch for PRs
```

When `create_pr: true`, ship creates a PR instead of merging directly. The PR body is generated from the change's intent, spec, and summary artifacts. The actual merge happens through your normal PR review process (GitHub, CI, etc.).

### What Ship Does NOT Do

- **No git tags** — tagging is a CI/CD concern, not a framework concern
- **No spec merging** — that's `metta finalize`
- **No doc generation** — that's `metta finalize`
- **No cleanup** — that's `metta finalize`
- **No deployment** — Metta is a development framework, not a CD pipeline

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
