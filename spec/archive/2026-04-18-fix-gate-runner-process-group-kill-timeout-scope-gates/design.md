# Design: fix-gate-runner-process-group-kill-timeout-scope-gates

## Approach

Two orthogonal changes in one PR:

1. **Gate runner**: replace `exec` with a `spawn`-based helper that detaches the child as a process-group leader and kills the group on timeout. Retry-once path explicitly reaps the first run's PGID before respawning.
2. **Finalizer**: stop running every registered gate; instead, load the change's workflow via `WorkflowEngine`, union each artifact's `gates` array, and run only those.

Also: add `build` to the `implementation` artifact's gates in both `quick.yaml` and `standard.yaml` so it keeps running under scoped mode.

## Components

- `src/gates/gate-registry.ts` — replace `run()` implementation:
  - Drop `exec`/`execAsync`.
  - Add private `runCommand(command, cwd, timeoutMs)` using `spawn({ detached: true, shell: true })` per research sketch. Guards: `child.pid` null check; Windows fallback to `child.kill()` (no `-pid`); `exited` flag to prevent SIGKILL after clean exit; 1-second grace between SIGTERM and SIGKILL.
  - `runWithPolicy` retry: on first-run timeout, explicitly await the kill's completion before spawning retry.
- `src/finalize/finalizer.ts` — scope gates from workflow:
  - Constructor gains optional `workflowEngine?: WorkflowEngine` and `workflowSearchPaths?: string[]`.
  - In `finalize()`, after `getChange(changeName)`, call `workflowEngine.loadWorkflow(metadata.workflow, searchPaths)`; derive `gateNames` from `workflow.artifacts.flatMap(a => a.gates ?? [])` deduped.
  - If `workflowEngine` is undefined (older callers / tests), fall back to the current `gateRegistry.list()` behavior — backward compatible.
- `src/cli/commands/finalize.ts` — wire in `WorkflowEngine`:
  - Import `WorkflowEngine` and construct with the same kind of path resolution already used for gates (`new URL('../../../templates/workflows', import.meta.url).pathname`).
  - Pass to `new Finalizer(...)`.
- `src/templates/workflows/quick.yaml` — append `build` to `implementation.gates`.
- `src/templates/workflows/standard.yaml` — same edit.
- `tests/gate-registry.test.ts` — add a timeout test that spawns a shell script spawning a grandchild `sleep` and asserts the grandchild is reaped within 2s of timeout.
- `tests/finalizer.test.ts` — add a workflow-scoped gate test: pass a stub `WorkflowEngine` whose `loadWorkflow` returns `{ artifacts: [{ gates: ['tests'] }] }`; verify only `tests` gate is invoked (even if `stories-valid`/`lint`/etc. are registered).

## Data Model

No schema changes. `ChangeMetadata.workflow` already exists. `WorkflowArtifact.gates` already exists.

## API Design

- `GateRegistry.run(name, cwd)` — signature unchanged; internals swapped for `spawn`-based helper.
- `Finalizer` constructor — two new optional params (`workflowEngine`, `workflowSearchPaths`).
- `WorkflowEngine.loadWorkflow(name, searchPaths)` — unchanged; we call it fresh from the finalizer path.

## Dependencies

None added.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `child.pid === undefined` (spawn failure) | Guard every `process.kill(-pid)` with `if (child.pid != null)`. |
| Windows has no POSIX PGID | `if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal)`. Document the weaker Windows guarantee in code comment. |
| SIGKILL fires after clean exit | `exited` flag set on `'close'`; SIGKILL callback checks `!exited`. |
| `build` gate silently dropped under scoped mode | Add to both workflow YAMLs in this change. Cross-cutting verification step: grep workflow YAMLs for `build` at the end. |
| Existing callers of `Finalizer` without `workflowEngine` regress | New params are optional; fall back to `gateRegistry.list()` when absent. Only the finalize CLI wires in the new path. |
| Retry-once rekills a PID that belongs to a new, unrelated process | `process.kill(-pid)` targets the PGID; once the original group exits, that PGID cannot be reassigned to another tree until a new spawn runs in it. Combined with the `exited` flag, the kill is a no-op on a dead group. Low risk. |
| Linux-only grandchild-reap test fails on Windows CI | Skip with `describe.skipIf(process.platform === 'win32')`. |
