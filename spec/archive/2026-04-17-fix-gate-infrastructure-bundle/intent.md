# fix-gate-infrastructure-bundle

## Problem

Three issues were logged against the gate infrastructure that together create inconsistency and silent quality loss:

**Issue 1 — Unimplemented gates referenced in workflow YAMLs** (`spec/issues/code-driven-gates-spec-quality-design-review-task-quality-ua.md`): Four gate names — `spec-quality`, `design-review`, `task-quality`, and `uat` — appear in `src/templates/workflows/standard.yaml`, `src/templates/workflows/full.yaml`, and `src/templates/workflows/quick.yaml`. No corresponding gate handlers exist under `src/gates/` or `src/templates/gates/`. When `GateRegistry.run()` receives an unknown name it falls through to the default branch and returns `{ status: 'skip' }` with the message `"Gate '<name>' not configured"`. The mismatch is never surfaced to the user as an error. The practical effect is that the `full` workflow's verification stage runs zero enforcement: `uat` is listed but silently skipped on every run.

**Issue 2 — `on_failure` policy honoring is incomplete and asymmetric** (`spec/issues/on-failure-gate-policy-inconsistently-honored-retry-once-wor.md`): `GateDefinitionSchema` declares `on_failure` as an enum of `retry_once | stop | continue_with_warning` (see `src/schemas/gate-definition.ts:9`). Only `retry_once` is acted upon, and only in the execute-time path: `ExecutionEngine.runTaskGatesInDir` at `src/execution/execution-engine.ts:355` calls `GateRegistry.runWithRetry`, which checks the flag and re-runs on fail. The finalize-time path (`Finalizer` at `src/finalize/finalizer.ts:53`) calls `GateRegistry.runAll`, which iterates plain `run()` with no policy awareness. `stop` and `continue_with_warning` are parsed by Zod but never branched on anywhere in the registry. A gate authored with `on_failure: stop` will not halt the batch; a gate with `on_failure: continue_with_warning` will still produce a `fail` result.

**Issue 3 — `warn` status has opposite semantics between Finalizer and the `verify` command** (`spec/issues/gate-warn-status-treated-inconsistently-between-finalizer-an.md`): `GateResultSchema` includes `warn` as a valid status value (`src/schemas/gate-result.ts:14`). `Finalizer` at `src/finalize/finalizer.ts:54` counts `warn` as pass: `g.status === 'pass' || g.status === 'skip' || g.status === 'warn'`. The `verify` command at `src/cli/commands/verify.ts:28` counts only `pass` and `skip` as success — `warn` falls through to the fail branch and causes `process.exit(1)`. No existing gate emits `warn` today, but the contradiction means the first gate that ever does will succeed under `metta finalize` and fail under `metta verify` with no code change.

These three issues share a root: the gate execution layer was built incrementally and the policy/status semantics were never reconciled across call paths. Fixing them individually would require touching the same files multiple times; bundling them is the least-disruptive path.

## Proposal

A single change that reconciles gate infrastructure across all three issue axes:

**1. Remove unimplemented gate references from workflow YAMLs.**
Strip `spec-quality`, `design-review`, `task-quality`, and `uat` from the `gates:` arrays in `src/templates/workflows/quick.yaml`, `src/templates/workflows/standard.yaml`, and `src/templates/workflows/full.yaml`. Affected entries:
- `quick.yaml` — `verification` artifact: `gates: [uat]` → `gates: []`
- `standard.yaml` — `spec` artifact: `gates: [spec-quality, stories-valid]` → `gates: [stories-valid]`; `design` artifact: `gates: [design-review]` → `gates: []`; `tasks` artifact: `gates: [task-quality]` → `gates: []`; `verification` artifact: `gates: [uat]` → `gates: []`
- `full.yaml` — `spec` artifact: `gates: [spec-quality]` → `gates: []`; `design` artifact: `gates: [design-review]` → `gates: []`; `tasks` artifact: `gates: [task-quality]` → `gates: []`; `verification` artifact: `gates: [uat]` → `gates: []`

No semantic enforcement is lost because these gates have never run. `stories-valid` is a real gate and MUST be retained.

**2. Introduce `GateRegistry.runWithPolicy(name, cwd)`.**
Add a new method to `GateRegistry` that reads `gate.on_failure` and applies the correct branch:
- `retry_once`: run the gate; on `fail`, run once more and return the retry result.
- `continue_with_warning`: run the gate; on `fail`, return a `warn` result with the original failure output preserved.
- `stop`: run the gate; on `fail`, return the result decorated with a sentinel field (e.g., `{ ...result, _stopBatch: true }`) that `runAll` detects to halt further execution.

**3. Reshape `GateRegistry.runAll` to iterate via `runWithPolicy`.**
`runAll` MUST call `runWithPolicy` for each name in sequence. When a result carries the `stop` sentinel, all remaining names in the batch MUST be appended as `{ gate: name, status: 'skip', duration_ms: 0, output: 'Skipped due to earlier fail of <stoppedGateName>' }`. The final returned array MUST contain one entry per requested gate name regardless of early stop. The sentinel field MUST be stripped before results leave `runAll`.

**4. Migrate `ExecutionEngine.runTaskGatesInDir` to `runWithPolicy`.**
Replace the `runWithRetry` call at `src/execution/execution-engine.ts:355` with `runWithPolicy`. The `retry_once` path through `runWithPolicy` produces identical behavior to the current `runWithRetry` call, so execute-time behavior is preserved while the call site is unified.

**5. Retain `runWithRetry` as a deprecated alias.**
`runWithRetry` SHOULD delegate to `runWithPolicy` to avoid breaking any future callers that might reference it directly. It MAY be removed in a follow-up change; the decision is deferred to task authoring.

**6. Update `src/cli/commands/verify.ts` to treat `warn` as pass.**
Change the `allPassed` predicate from `r.status === 'pass' || r.status === 'skip'` to `r.status === 'pass' || r.status === 'skip' || r.status === 'warn'`. When any result has `status === 'warn'`, the command MUST write the gate name and its output to stderr before exiting 0. The JSON output path MUST include `warn` results in the `gates` array with their actual status so callers can inspect them.

**7. Add Vitest unit tests.**
New or expanded tests in `tests/gate-registry.test.ts` MUST cover:
- `runWithPolicy` with `on_failure: retry_once`: mock command fails first call, passes second; assert result is `pass` and `run` was called twice.
- `runWithPolicy` with `on_failure: retry_once`: mock command fails both calls; assert result is `fail`.
- `runWithPolicy` with `on_failure: continue_with_warning`: mock command fails; assert result status is `warn` and output preserves failure detail.
- `runWithPolicy` with `on_failure: stop`: mock command fails; assert result is `fail`.
- `runAll` stop propagation: two gates, first has `on_failure: stop` and fails; assert second result has `status: 'skip'` and output matches the skip message template.
- `runAll` with no stop: all gates run independently regardless of prior results.
- Finalizer: gate returns `warn`; assert finalize result has `gatesPassed: true`.
- `verify` command: gate returns `warn`; assert exit code is 0 and stderr contains the gate name.

## Impact

**Files changed:**

- `src/gates/gate-registry.ts` — add `runWithPolicy(name, cwd): Promise<GateResult>`; reshape `runAll` to use it with stop-propagation logic; update `runWithRetry` to delegate to `runWithPolicy`.
- `src/execution/execution-engine.ts` — line 355: `runWithRetry` → `runWithPolicy`.
- `src/cli/commands/verify.ts` — extend `allPassed` predicate to include `warn`; add stderr surface for warn results; update human-readable icon branch.
- `src/finalize/finalizer.ts` — no behavior change; existing `runAll` call at line 53 picks up policy honoring automatically through the reshaped `runAll`.
- `src/ship/merge-safety.ts` — no behavior change; `runAll` call at line 210 picks up policy honoring automatically.
- `src/templates/workflows/quick.yaml` — strip `uat` from `verification` gates.
- `src/templates/workflows/standard.yaml` — strip `spec-quality` from `spec`, `design-review` from `design`, `task-quality` from `tasks`, `uat` from `verification`.
- `src/templates/workflows/full.yaml` — strip `spec-quality` from `spec`, `design-review` from `design`, `task-quality` from `tasks`, `uat` from `verification`.
- `tests/gate-registry.test.ts` — new or expanded unit tests as described in Proposal item 7.

**No schema changes.** `GateDefinitionSchema.on_failure` retains all three enum values — they are now honored rather than ignored. `GateResultSchema.status` retains `warn` — it is now consistent across call paths.

**Resolves issues:**
- `spec/issues/code-driven-gates-spec-quality-design-review-task-quality-ua.md`
- `spec/issues/on-failure-gate-policy-inconsistently-honored-retry-once-wor.md`
- `spec/issues/gate-warn-status-treated-inconsistently-between-finalizer-an.md`

## Out of Scope

- **Implementing the four removed gates.** `spec-quality`, `design-review`, `task-quality`, and `uat` are removed from YAML, not implemented. If any of them are wanted in the future they require a separate change with their own intent, command, and test coverage.
- **Changing `on_failure` enum values.** All three values (`retry_once`, `stop`, `continue_with_warning`) are retained in the schema and honored after this change. No values are added or removed.
- **Adding new gate status values.** The `pass / fail / warn / skip` set is closed for this change.
- **Refactoring the gate YAML loader** (`loadFromDirectory`) or the gate-result rendering in `metta finalize` terminal output.
- **Changes to `src/ship/merge-safety.ts` beyond shared-path pickup.** The `runAll` call at line 210 will automatically honor `on_failure` policies after `runAll` is reshaped, but no logic specific to merge-safety's rollback path is altered.
- **Surfacing policy metadata in JSON output.** The JSON shape of `GateResult` is unchanged; `_stopBatch` is a transient internal field stripped before results are returned from `runAll`.
- **Changing the default `on_failure` value** in `GateDefinitionSchema` (currently `retry_once`).
- **Updating existing gate YAML files** to set specific `on_failure` values — the default `retry_once` continues to apply to all current gates after this change.
