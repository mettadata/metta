# Research: fix-gate-runner-process-group-kill-timeout-scope-gates

## Decision: spawn+detached PGID kill in GateRegistry; workflow-driven gate list in Finalizer

### Approaches Considered

1. **`spawn({ detached: true, shell: true })` + `process.kill(-pid)`** (selected for PGID) — standard POSIX pattern. No new dep. Pseudocode from research fits in ~40 lines.
2. **`tree-kill` npm package** (rejected) — third-party dep for a one-off problem; no Windows users currently.
3. **Workflow-driven gate list from Finalizer** (selected for scoping) — read `metadata.workflow` (already persisted), load workflow via `WorkflowEngine`, union all `artifact.gates` arrays, pass to `runAll`. No schema change.
4. **Gate YAML declares `workflows: [...]`** (rejected) — self-describing but requires touching every gate YAML and a schema change. More effort for less gain.

### Rationale

The workflow YAML already declares the truth about what gates belong to what artifact. The finalizer just needs to honor it. The PGID kill is isolated to the gate runner; every other caller of `exec` in metta already handles their own lifecycles.

### Key findings (from researcher)

1. **`metadata.workflow` already available** — `ChangeMetadataSchema` in `src/schemas/change-metadata.ts` has `workflow: z.string()`. `Finalizer.finalize()` already fetches `metadata` via `getChange()` at line 29 (currently only uses `base_versions`).
2. **WorkflowEngine loader ready** — `src/workflow/workflow-engine.ts:27-67` `loadWorkflow(name, searchPaths)` already exists and returns `{ artifacts: [{ id, gates: string[] }, ...] }`. Not instantiated anywhere on the finalize path; must be wired in.
3. **No spawn precedent in TS source** — first introduction of `node:child_process.spawn`. `src/cli/commands/finalize.ts:3` imports `execFile` for git, but that's unrelated.
4. **No existing timeout test** — `tests/gate-registry.test.ts` covers pass/fail/skip/retry but never asserts a timeout kills the process tree. Must add.
5. **`finalizer.test.ts` doesn't pass a gateRegistry** — both existing tests construct `Finalizer(specDir, artifactStore, lockManager)` with no gates, so the new gate-scoping behavior isn't covered. Must add.
6. **`stories-valid` gate exists** (research was wrong) — `src/templates/gates/stories-valid.yaml` is real. `standard.yaml:spec.gates = [stories-valid]` works today because all registered gates are run.
7. **`build` gate is registered but NOT listed in any workflow YAML** — currently runs because "all registered" behavior. Under the scoped model, `build` will silently stop running unless added to workflow YAMLs. **Must add `build` to the `implementation` artifact's gates in both `quick.yaml` and `standard.yaml`** to preserve behavior.

### API sketch — gate runner

```typescript
function runCommand(command: string, cwd: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, detached: true, env: { ...process.env } })
    let stdout = '', stderr = '', killed = false, exited = false
    const killGroup = (signal: 'SIGTERM' | 'SIGKILL') => {
      if (exited || child.pid == null) return
      try { process.kill(-child.pid, signal) } catch { /* ESRCH */ }
    }
    const timer = setTimeout(() => {
      killed = true
      killGroup('SIGTERM')
      setTimeout(() => killGroup('SIGKILL'), 1000)
    }, timeoutMs)
    child.stdout?.on('data', d => { stdout += d.toString() })
    child.stderr?.on('data', d => { stderr += d.toString() })
    child.on('close', code => {
      exited = true
      clearTimeout(timer)
      if (killed) return resolve({ stdout, stderr, killed: true, code })
      if (code === 0) return resolve({ stdout, stderr, killed: false, code })
      reject(Object.assign(new Error('Gate failed'), { stdout, stderr, killed: false, code }))
    })
    child.on('error', reject)
  })
}
```

### API sketch — finalizer gate scoping

```typescript
// In Finalizer.finalize(), after getting metadata:
const workflow = await this.workflowEngine.loadWorkflow(metadata.workflow, this.workflowSearchPaths)
const scopedGateNames = [...new Set(workflow.artifacts.flatMap(a => a.gates ?? []))]
const gates = scopedGateNames.length > 0
  ? await this.gateRegistry.runAll(scopedGateNames, this.projectRoot)
  : []
```

`Finalizer` constructor gains `workflowEngine: WorkflowEngine` and `workflowSearchPaths: string[]` params. CLI passes the same `[builtinWorkflowsPath, customWorkflowsPath]` it already resolves.

### Risks carried forward (from researcher)

1. `child.pid` can be undefined — guard all `process.kill(-pid)` calls.
2. Windows: `process.kill(-pid)` not supported. Check `process.platform === 'win32'` and fall back to `child.kill()` on Windows (gracefully weaker).
3. SIGKILL fallback timer must guard on `exited` flag to avoid killing a recycled PID.
4. **`build` gate must be added to `quick.yaml` and `standard.yaml` implementation artifacts** — otherwise the scoping change silently drops a required gate.
5. Existing `finalizer.test.ts` tests don't cover the new scoping path; new tests needed.

### Artifacts Produced

None — direct code + YAML edits.
