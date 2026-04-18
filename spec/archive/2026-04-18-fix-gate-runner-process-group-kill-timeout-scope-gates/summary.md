# Summary: fix-gate-runner-process-group-kill-timeout-scope-gates

## Problem

Three related framework-level bugs in the metta finalize gate pipeline, plus one downstream symptom:

1. **Gate timeout leaks worker processes** (major) — `src/gates/gate-registry.ts` used `exec` which only killed the direct shell child on timeout. `npm test`/vitest workers orphaned to init, burning CPU. Reproduced during Group A: three cascading timeouts produced multiple 60%-CPU orphans that competed with retries.
2. **stories-valid gate fires on quick workflows** (major) — `src/finalize/finalizer.ts:51` ran every registered gate regardless of workflow. Quick changes produce no stories.md, so stories-valid failed unconditionally and blocked downstream gates.
3. **Quick/auto don't archive spec/changes/** (major) — downstream symptom of #2: because finalize failed on stories-valid, the archive step (later in the flow) never ran.

## Solution

Two orthogonal fixes in one change:

- **Gate runner**: replaced `exec` with `spawn({ detached: true, shell: true })`. On timeout, `process.kill(-pid, 'SIGTERM')` reaps the whole process group; 1-second grace then SIGKILL. Windows fallback to `child.kill()`. Guards for `child.pid == null` and exit-race conditions.
- **Finalizer gate scoping**: Finalizer now loads the active workflow via `WorkflowEngine` and runs only gates declared in the union of artifact `gates:` arrays. Fallback to `gateRegistry.list()` preserved for callers that don't supply a `workflowEngine` (backward-compatible; existing tests stay green).
- **Workflow YAMLs updated**: added `build` to the `implementation` artifact's gates in `quick.yaml` and `standard.yaml`. Without this, scoped mode would silently stop running the build gate.

## Files touched

- `src/gates/gate-registry.ts` — spawn + PGID kill
- `src/finalize/finalizer.ts` — workflow-scoped gate selection (+ 2 constructor params)
- `src/cli/commands/finalize.ts` — wires WorkflowEngine into Finalizer
- `src/templates/workflows/quick.yaml` — `build` added to implementation gates
- `src/templates/workflows/standard.yaml` — `build` added to implementation gates
- `tests/gate-registry.test.ts` — new PGID reap test (skipped on Windows)
- `tests/finalizer.test.ts` — new workflow-scoped gate selection test

## Test coverage added

- `gate timeout reaps process group > kills grandchild sleep processes when the gate command times out` (Linux/macOS) — verifies duration-bounded completion (1.5s budget) when a command backgrounds a grandchild and the parent shell is killed via PGID.
- `Finalizer > runs only gates declared in the workflow artifacts` — stub-cached WorkflowEngine returns a minimal `quick` workflow with only `[tests]` on implementation; asserts exactly `['tests']` ran, not the other registered gates.

## Resolves

- `metta-finalize-tests-gate-leaks-vitest-worker-processes-on` (major)
- `stories-valid-gate-runs-on-quick-workflow-changes-that-do-no` (major)
- `metta-quick-and-metta-auto-do-not-archive-the-spec-changes` (major, downstream — verified by integration behavior)

## Out of scope (deferred)

- Language-agnostic gate commands (Group G — hardcoded `npm`/`npx` commands).
- Per-project gate timeout overrides.
- Windows-compatible process-tree kill (current fallback to `child.kill()` is weaker than the Linux/macOS path).
