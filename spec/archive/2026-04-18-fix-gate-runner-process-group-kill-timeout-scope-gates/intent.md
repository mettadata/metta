# fix-gate-runner-process-group-kill-timeout-scope-gates

## Problem

Three coupled bugs block reliable finalization on quick-workflow and auto-workflow changes.

**Bug 1 — orphaned worker processes on gate timeout** (`metta-finalize-tests-gate-leaks-vitest-worker-processes-on`): `gate-registry.ts:55` calls `exec(gate.command, { timeout })`. Node's `exec` kills only the direct shell child when the timeout fires. Grandchild processes spawned by that shell (npm → vitest → worker threads) become orphaned under init and keep consuming CPU. During Group A validation, three cascade-timeouts left multiple vitest workers at 60%+ CPU after finalize returned.

**Bug 2 — stories-valid gate runs unconditionally on quick-workflow changes** (`stories-valid-gate-runs-on-quick-workflow-changes-that-do-no`): `finalizer.ts:51` derives the gate list from `gateRegistry.list()` — every registered gate, regardless of the active workflow. The quick workflow never produces `stories.md`, so `stories-valid` fails unconditionally. Once it fails, the early-return at line 58 prevents downstream gates (tests, typecheck) and the archive step from running at all.

**Bug 3 — quick/auto changes not archived to spec/archive/** (`metta-quick-and-metta-auto-do-not-archive-the-spec-changes`): After finalize, `spec/changes/<name>/` remains on main instead of moving to `spec/archive/`. This is a downstream symptom of Bug 2: the archive step at `finalizer.ts:84` is unreachable when stories-valid fails first. No independent logic change is expected; fixing Bug 2 unblocks the archive step and resolves this symptom. Covered by an integration test.

## Proposal

**Fix 1 — PGID kill in gate-registry.ts**: Replace `execAsync` with `spawn({ detached: true, shell: true })` so the gate command runs as its own process group. Collect the child PID immediately. On timeout, send `SIGTERM` to `-pid` (the entire process group), wait a short grace period (e.g. 2 s), then send `SIGKILL -pid` to ensure all descendants are dead. Before any retry fires, assert the first-run PGID is fully reaped. This is the standard POSIX process-group pattern and requires no schema changes.

**Fix 2 — workflow-scoped gate selection in finalizer.ts**: Change `finalizer.ts:51` to derive the gate list from the workflow's artifact `gates:` fields rather than from `gateRegistry.list()`. The workflow YAML already declares per-artifact gates (`quick.yaml` lists `[tests, lint, typecheck]` on the implementation artifact; `stories-valid` appears only under the standard workflow's spec artifact). The finalizer receives the active workflow object; deduplicate and flatten all artifact gate lists to produce the run set. This change makes the gate list a property of the workflow definition, not of the registry.

**Fix 3 — integration test for archive on quick-workflow changes**: Add an integration test that invokes finalize end-to-end on a quick-workflow change fixture and asserts that `spec/changes/<name>/` does not exist and `spec/archive/<name>/` does exist after completion. No new archive logic is needed — Fix 2 unblocks the existing archive step.

## Impact

Files touched:
- `src/gates/gate-registry.ts` — spawn + PGID kill replaces exec
- `src/finalize/finalizer.ts` — workflow-scoped gate list derivation
- `src/cli/commands/finalize.ts` or caller — plumb active workflow object into finalizer if not already passed
- `tests/gate-registry.test.ts` — PGID kill coverage; test spawns a real subprocess tree and confirms descendants are dead post-timeout. This test uses `ps` and process groups and MUST be marked Linux/macOS-only (skip on Windows CI via `process.platform === 'win32'` guard).
- `tests/finalizer.test.ts` — workflow-scoped gate selection coverage; integration test for archive path

Behavior change: projects that registered custom gates via `gateRegistry.register()` but did not declare those gates in any workflow artifact's `gates:` field will no longer have those gates run during finalize. Teams using custom gates MUST add them to the appropriate workflow YAML artifact entry or they will be silently skipped.

## Out of Scope

- Language-agnostic or shell-portable gate commands (Group G refactor)
- Gate timeout values — already increased in a prior fix
- Gate schema changes (`src/schemas/gate-definition.ts` is unchanged)
- Windows support for PGID kill — `process.kill(-pid)` is not supported on Windows; document as a known gap and follow-up issue, do not implement a Windows shim in this change
- Changes to workflow YAML structure or new gate declaration syntax
