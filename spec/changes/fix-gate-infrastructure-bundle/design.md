# Design: fix-gate-infrastructure-bundle

## Approach

In-place refactor of `GateRegistry` to add a unified `runWithPolicy(name, cwd)` method that honors all three `on_failure` values. `runAll` iterates via `runWithPolicy` and tracks a `stopped` flag to skip remaining gates when a `stop` policy fires. Existing `runWithRetry` becomes a back-compat alias. Call sites in `ExecutionEngine` and `verify` migrate. Workflow YAMLs prune references to the four unimplemented gates.

## Components

| File | Role |
|------|------|
| `src/gates/gate-registry.ts` | Modified. Add `runWithPolicy`; reshape `runAll` to honor `stop`; keep `runWithRetry` as alias. |
| `src/execution/execution-engine.ts` | Modified. Line ~355: `runWithRetry` → `runWithPolicy`. |
| `src/cli/commands/verify.ts` | Modified. Treat `warn` as pass; emit stderr line per warn. |
| `src/templates/workflows/standard.yaml` | Modified. Strip `spec-quality`, `design-review`, `task-quality` references. |
| `src/templates/workflows/full.yaml` | Modified. Strip `spec-quality`, `design-review`, `task-quality`, `uat` references. |
| `src/templates/workflows/quick.yaml` | Unchanged (already clean — no unimplemented gate references). |
| `tests/gate-registry.test.ts` | New or expanded. Cover each `on_failure` branch plus `stop`-propagation. |
| `tests/verify.test.ts` or equivalent | Expanded. Assert `warn` → exit 0 + stderr surface. |

## Module: `GateRegistry.runWithPolicy`

### Responsibilities

- Invoke `run(name, cwd)` to get the baseline result.
- Inspect the gate's `on_failure` value.
- Apply the policy transformation:
  - `retry_once`: on fail, re-run once, return second result.
  - `continue_with_warning`: on fail, clone the result with `status: 'warn'`, preserving `output` and `failures`.
  - `stop`: return the result unchanged (the batch-level caller is responsible for the skip propagation).
- On `pass` or non-fail statuses, pass through unchanged regardless of `on_failure`.

### Pseudocode

```typescript
async runWithPolicy(name: string, cwd: string): Promise<GateResult> {
  const gate = this.gates.get(name)
  const result = await this.run(name, cwd)
  if (result.status !== 'fail') return result
  if (!gate) return result

  switch (gate.on_failure) {
    case 'retry_once':
      return await this.run(name, cwd)
    case 'continue_with_warning':
      return { ...result, status: 'warn' }
    case 'stop':
      return result  // caller propagates skip
  }
}
```

## Module: `GateRegistry.runAll` (reshape)

### Responsibilities

- Iterate gate names in order.
- For each name, if a prior `stop` fired, emit a `skip` result without calling `runWithPolicy`.
- Otherwise call `runWithPolicy`; if the returned status is `fail` AND the gate's `on_failure` is `stop`, set a local `stopped` flag with the failing gate's name.
- Return the full-length array of results.

### Pseudocode

```typescript
async runAll(names: string[], cwd: string): Promise<GateResult[]> {
  const results: GateResult[] = []
  let stoppedBy: string | null = null

  for (const name of names) {
    if (stoppedBy !== null) {
      results.push({
        gate: name,
        status: 'skip',
        duration_ms: 0,
        output: `Skipped due to earlier fail of ${stoppedBy}`,
      })
      continue
    }

    const result = await this.runWithPolicy(name, cwd)
    results.push(result)

    if (result.status === 'fail') {
      const gate = this.gates.get(name)
      if (gate?.on_failure === 'stop') {
        stoppedBy = name
      }
    }
  }

  return results
}
```

## Module: `runWithRetry` (back-compat alias)

```typescript
async runWithRetry(name: string, cwd: string): Promise<GateResult> {
  return this.runWithPolicy(name, cwd)
}
```

## Module: `verify.ts` warn handling

### Before

```typescript
const gatesPassed = results.every(g => g.status === 'pass' || g.status === 'skip')
```

### After

```typescript
const gatesPassed = results.every(g => g.status === 'pass' || g.status === 'skip' || g.status === 'warn')

for (const g of results.filter(r => r.status === 'warn')) {
  process.stderr.write(`⚠ ${g.gate}: ${g.output ?? 'warning'}\n`)
}
```

## Workflow YAML edits

### `standard.yaml` — remove 3 references

- `spec` stage: `gates: [spec-quality]` → `gates: []`
- `design` stage: `gates: [design-review]` → `gates: []`
- `tasks` stage: `gates: [task-quality]` → `gates: []`

### `full.yaml` — remove 4 references

Same three above plus:
- `verification` stage: `gates: [uat]` → `gates: []`

### `quick.yaml` — no changes

## Test plan

### `tests/gate-registry.test.ts`

| Case | Setup | Assertion |
|------|-------|-----------|
| retry_once passes on retry | mock: fail, then pass | `status === 'pass'`, run called 2× |
| retry_once fails on retry | mock: fail, then fail | `status === 'fail'`, run called 2× |
| retry_once skips retry on pass | mock: pass | `status === 'pass'`, run called 1× |
| continue_with_warning downgrades fail | mock: fail | `status === 'warn'`, `output` preserved |
| continue_with_warning leaves pass | mock: pass | `status === 'pass'` unchanged |
| stop signals batch skip | mock: A passes, B (stop) fails, C mock | result[2].status === 'skip', output contains "earlier fail of B" |
| runAll returns full-length on stop | same as above | `result.length === 3` |
| runWithRetry equivalent to runWithPolicy for retry_once | same retry scenarios | both return same result |

### `tests/verify.test.ts` (or cli.test.ts)

| Case | Setup | Assertion |
|------|-------|-----------|
| verify exits 0 on warn | gate returns warn | exit code 0, stderr contains gate name |
| verify exits non-zero on fail | gate returns fail | exit code non-zero |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `runAll` reshape changes behavior for existing callers (Finalizer, merge-safety) when no `stop` policy is involved | Behavior IS unchanged when no gate has `on_failure: stop`. Verify with existing Finalizer/merge-safety tests — they should continue passing unmodified. |
| `verify` warn change could silently hide real regressions | Warn gates MUST emit to stderr so users see the caveat. Document the semantic change in the change summary. |
| External consumers of `runWithRetry` break when behavior subtly changes | Keep `runWithRetry` as a delegating alias that calls `runWithPolicy`. The behavior for `retry_once` is identical to current; `stop` and `continue_with_warning` gates now behave per-spec when called via `runWithRetry` (strict improvement). |
| YAML edits could break tests that assert the gate names | Grep for test assertions on `spec-quality`/`design-review`/`task-quality`/`uat`. Found references in test files will need updating to remove (not a concern if the gates never ran). |

## Dependencies

No new dependencies. All work within the existing code.
