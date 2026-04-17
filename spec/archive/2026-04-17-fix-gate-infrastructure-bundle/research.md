# Research: fix-gate-infrastructure-bundle

## Decision: In-place refactor of `GateRegistry` — no new classes, no library additions

### Approaches Considered

1. **In-place `runWithPolicy` method + reshape `runAll`** (selected) — Add `runWithPolicy(name, cwd)` to the existing `GateRegistry`. Reshape `runAll` to iterate via `runWithPolicy`, threading a `stopped` flag. Keep `runWithRetry` as a one-line delegate for backwards compat. Self-contained refactor in one file (`src/gates/gate-registry.ts`); call-site changes in `execution-engine.ts` and `verify.ts` are one-liners.
2. **Extract a new `GatePolicyExecutor` class** — Separate the policy logic from registry state. Cleaner separation but introduces a new module and requires updating DI wiring in `cli/helpers.ts`. Rejected because the policy logic is tightly coupled to the registry's command execution — splitting adds indirection without eliminating any coupling.
3. **Adopt a retry library (e.g. `p-retry`, `async-retry`)** — Outsource retry to a well-tested dependency. Rejected: current `retry_once` need is trivially simple (one retry, no backoff, no jitter), adding a dependency for a 4-line branch is net-negative. Also keeps the project dependency-light per its stated conventions.

### Rationale

**Policy state machine.** The three `on_failure` values map to three tiny state transitions:
- `retry_once`: run → on fail → run again → return second result
- `continue_with_warning`: run → on fail → shallow-copy result with `status: 'warn'`
- `stop`: run → on fail → return result as-is + set a side-channel flag telling the caller to skip remaining gates

The cleanest way to surface the `stop` side-channel is to have `runAll` track it internally (since `stop` only has meaning within a batch). That way `runWithPolicy` returns a pure `GateResult` and the batch-level skip logic lives in `runAll`.

**Stop-sentinel implementation.** Rather than introduce a new enum value or throw a custom error, `runAll` inspects the gate definition's `on_failure` value AFTER `runWithPolicy` returns. If the returned status is `fail` AND the gate's `on_failure` is `stop`, set a local `stopped = true`. Subsequent iterations see `stopped` and skip to `{status: 'skip', output: 'Skipped due to earlier fail of <failingGateName>'}` without calling `runWithPolicy`.

**Back-compat: `runWithRetry`.** Currently called once at `src/execution/execution-engine.ts:355`. Migrating the call to `runWithPolicy` is a one-line change. Keeping `runWithRetry` as a back-compat alias costs nothing (`return this.runWithPolicy(name, cwd)`), so we keep it to avoid breakage if any external consumer depends on it.

**Verify `warn` semantic change.** `src/cli/commands/verify.ts` currently does:

```
gatesPassed = gates.every(g => g.status === 'pass' || g.status === 'skip')
```

The fix is to add `|| g.status === 'warn'`. Plus emit a stderr line per `warn` gate so the user sees the caveat.

**Workflow YAML pruning.** Concretely (inspected 2026-04-17):
- `standard.yaml` → `spec` stage has `gates: [spec-quality]`, `design` has `gates: [design-review]`, `tasks` has `gates: [task-quality]` — all become `gates: []`
- `full.yaml` → same three plus `verification` has `gates: [uat]` — all become `gates: []`
- `quick.yaml` → only YAML-defined gates (`[tests, lint, typecheck]` on implementation) — no change needed; already clean

### Artifacts Produced

None beyond this note. Findings feed directly into design.md and tasks.md.

### Sources

- `src/gates/gate-registry.ts` (current logic — 116 lines)
- `src/schemas/gate-definition.ts` (the `on_failure` enum)
- `src/schemas/gate-result.ts` (the status enum)
- `src/finalize/finalizer.ts:53-54` (runAll caller + warn-as-pass)
- `src/execution/execution-engine.ts:355` (runWithRetry caller)
- `src/cli/commands/verify.ts` (warn-as-fail)
- `src/templates/workflows/{quick,standard,full}.yaml` (gate references)
