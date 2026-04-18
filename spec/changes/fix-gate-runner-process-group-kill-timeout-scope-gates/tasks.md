# Tasks: fix-gate-runner-process-group-kill-timeout-scope-gates

## Batch 1: Independent groundwork (parallel — different files)

### Task 1.1: Refactor gate runner to use spawn + PGID kill [x]
- **Files:** `src/gates/gate-registry.ts`
- **Action:** Replace the `execAsync`-based `run()` method. Drop the `const execAsync = promisify(exec)` line. Add a private `runCommand(command, cwd, timeoutMs): Promise<{stdout, stderr, killed, exitCode}>` helper using `spawn(command, { cwd, shell: true, detached: true, env: { ...process.env } })`. Accumulate stdout/stderr from `child.stdout`/`child.stderr` data events. On `setTimeout(timeoutMs)`, set `killed=true`, then `process.kill(-child.pid, 'SIGTERM')` (guarded by `child.pid != null` and Windows fallback to `child.kill('SIGTERM')`). 1 second later, `process.kill(-child.pid, 'SIGKILL')` guarded by an `exited` flag set on the `'close'` event. Resolve on close with the captured stdout/stderr + killed flag. Wire `run()` to call this helper and return `GateResult` with `status: 'fail'`, `failures: [{ message: 'Timeout' }]` when `killed` is true. Preserve exit-code handling for non-timeout failure (stdout/stderr echoed).
- **Verify:** `npx tsc --noEmit` exits 0; `npx vitest run tests/gate-registry.test.ts` exits 0 (existing tests still pass).
- **Done:** `exec`/`execAsync` no longer imported; spawn-based helper in place; existing gate-registry tests green.

### Task 1.2: Add `build` gate to quick + standard workflow YAMLs [x]
- **Files:** `src/templates/workflows/quick.yaml`, `src/templates/workflows/standard.yaml`
- **Action:** In both files, find the `implementation` artifact's `gates:` line. Current is `[tests, lint, typecheck]`. Change to `[tests, lint, typecheck, build]`. No other edits.
- **Verify:** `grep -A1 'id: implementation' src/templates/workflows/quick.yaml` shows `gates: [tests, lint, typecheck, build]` (or similar multi-line); same for standard.yaml. `npm run build` still succeeds (dist templates mirror the source).
- **Done:** Both workflow YAMLs list `build` on the implementation artifact; dist mirrors regenerated.

### Task 1.3: Add new gate-runner timeout test (Linux/macOS) [x]
- **Files:** `tests/gate-registry.test.ts`
- **Action:** Add a new `describe.skipIf(process.platform === 'win32')` block `'gate timeout reaps process group'`. The test registers a gate whose command is `bash -c 'sleep 10 & sleep 10'` (or equivalent that ensures a grandchild), timeout: 500ms. Runs the gate, asserts `result.status === 'fail'` and `result.output` contains `Timeout`. Then polls `ps` via `execSync('ps -eo pid,ppid,comm')` or similar to confirm no descendant `sleep` processes from that PGID remain alive (use `pgrep -P <child-pid>` with a short timeout). Ensure cleanup happens within ~1.5s (1s SIGKILL grace + slack).
- **Verify:** `npx vitest run tests/gate-registry.test.ts` — new test passes on Linux/macOS; skipped on Windows.
- **Done:** New timeout-kill coverage exists; existing 18 gate-registry tests still pass.

---

## Batch 2: Finalizer wiring (sequential — depends on Batch 1.2 workflow shape being stable)

### Task 2.1: Scope finalizer gates to workflow artifacts [x]
- **Files:** `src/finalize/finalizer.ts`, `src/cli/commands/finalize.ts`
- **Action:** In `Finalizer` constructor, add two optional params `workflowEngine?: WorkflowEngine` and `workflowSearchPaths?: string[]`. In `finalize()`, between the `getChange` call (line 29) and the gate block (line 47), when both `workflowEngine` and `workflowSearchPaths` are present, call `const workflow = await this.workflowEngine.loadWorkflow(metadata.workflow, this.workflowSearchPaths)` and derive `const scopedGateNames = [...new Set(workflow.artifacts.flatMap(a => a.gates ?? []))]`. Replace `const gateNames = this.gateRegistry.list().map(g => g.name)` with `const gateNames = (scopedGateNames ?? null) ?? this.gateRegistry.list().map(g => g.name)`. When workflowEngine is absent, behavior is unchanged. In `src/cli/commands/finalize.ts`, import `WorkflowEngine` from `../../workflow/workflow-engine.js`, construct `const workflowEngine = new WorkflowEngine()` plus `const workflowPaths = [new URL('../../../templates/workflows', import.meta.url).pathname]` (mirror the gate path resolution), and pass both to `new Finalizer(...)`.
- **Verify:** `npx tsc --noEmit` exits 0; `npx vitest run tests/finalizer.test.ts` passes (2 existing tests still green — they don't pass workflowEngine so the fallback path runs).
- **Done:** Finalizer constructor signature extended; CLI wires in WorkflowEngine; fallback behavior preserved.

### Task 2.2: Add finalizer workflow-scoping test
- **Files:** `tests/finalizer.test.ts`
- **Action:** Add a new `it('runs only gates declared in the workflow artifacts')` test. Create a stub `WorkflowEngine` whose `loadWorkflow` returns `{ artifacts: [{ id: 'implementation', gates: ['tests'] }] }`. Register three gates on `GateRegistry`: `tests`, `lint`, `build`, each with a `command: 'true'` (always pass) and `timeout: 5000`. Call `finalizer.finalize(changeName)` and assert the returned `gates` list contains only `tests` (not lint or build). Use `ChangeMetadata` with `workflow: 'quick'`.
- **Verify:** Test passes; tsc clean.
- **Done:** Scoped-gate behavior covered; 3 finalizer tests total.

---

## Batch 3: Summary + full gate suite (sequential — depends on all above)

### Task 3.1: Write summary.md and run full gate suite
- **Files:** `spec/changes/fix-gate-runner-process-group-kill-timeout-scope-gates/summary.md`
- **Action:** Write summary covering problem (3 bundled issues + 1 downstream symptom), solution (spawn PGID kill, workflow-scoped gates, `build` added to workflow YAMLs), files touched (list all), test coverage added (timeout-reap test + workflow-scope test). Then run `npx tsc --noEmit`, `npm test`, `npm run lint`, `npm run build`.
- **Verify:** All four gates exit 0. Cross-cutting grep: (a) `grep -n 'execAsync' src/gates/gate-registry.ts` returns 0 (no more exec); (b) `grep -n 'build' src/templates/workflows/quick.yaml src/templates/workflows/standard.yaml` returns 2+ matches; (c) `grep -n 'WorkflowEngine' src/cli/commands/finalize.ts` returns ≥1.
- **Done:** summary.md written; all gates green; cross-cutting greps pass.
