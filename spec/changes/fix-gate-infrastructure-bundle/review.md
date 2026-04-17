# Code Review: fix-gate-infrastructure-bundle

## Summary

Solid refactor of `GateRegistry` that cleanly unifies `on_failure` policy handling behind `runWithPolicy`, with `runAll` threading a single `stoppedBy` sentinel. Code and tests are direct and readable. One spec-compliance miss in `quick.yaml` (`uat` still referenced) and a minor UX inconsistency in `verify.ts` where `warn` renders with the red fail icon. A few questions around the public surface of `runWithPolicy` and the robustness of the `verify-warn.test.ts` prototype-spy strategy.

## Issues Found

### Critical (must fix)

- `src/templates/workflows/quick.yaml:28` — `gates: [uat]` is still present. The spec (`spec.md` lines 91–95, "ADDED: Requirement: Workflow YAMLs MUST NOT reference unimplemented gates") explicitly asserts that `quick.yaml` must not contain `uat`. The design doc incorrectly claims quick.yaml is "already clean" (`design.md:16`, line 133), but it is not — `uat` is unimplemented and still referenced. The scenario "quick.yaml does not reference unimplemented gates" will fail. Remove `uat` from `quick.yaml`'s verification stage (replace with `gates: []`).

### Warnings (should fix)

- `src/gates/gate-registry.ts:132-139` — The `switch` on `gate.on_failure` has no `default` branch and the function's declared return type is `Promise<GateResult>`. Because `on_failure` is a Zod enum of exactly three values, TS control-flow analysis is happy, but any future addition to the enum (e.g. `retry_backoff`) will silently return `undefined` at runtime without a compile error unless `noImplicitReturns` catches it. Add an exhaustive `default` (e.g. `const _exhaustive: never = gate.on_failure; return result`) or annotate with a safety fallthrough to `return result`. Consistent with the codebase's "functional core" discipline and Zod-validated state.

- `src/cli/commands/verify.ts:43` — The icon ternary renders `warn` status with `color('✗', 31)` (red x), which contradicts the new semantics "warn is treated as pass." Users will see a red failure mark next to a gate the CLI is about to declare "All gates passed." Add a `warn` branch that uses a distinct color (e.g. yellow `33`) and a `⚠` glyph to match the stderr line on line 29.

- `src/cli/commands/verify.ts:47` — The success message `'All gates passed.'` is printed even when some gates returned `warn`. Consider `'All gates passed (with warnings).'` when any result has status `warn` so the human-readable and JSON outputs are symmetric with the stderr emission on line 29. Not a bug per spec ("treat warn as pass"), but misleading.

- `tests/verify-warn.test.ts:55-70` — The mocking strategy spies on `ArtifactStore.prototype` and `GateRegistry.prototype` directly. This couples the test to the specific collaborator classes that `createCliContext` happens to construct today. If `createCliContext` is refactored to wrap these (e.g., behind an interface or DI container), the prototype spies will silently no-op and the test will still pass because the command prints nothing. Consider either (a) injecting collaborators into `registerVerifyCommand` or (b) asserting observable side effects strongly enough that a silent no-op would fail (e.g., at minimum assert `runAllSpy` was actually called). Minimum fix: add `expect(runAllSpy).toHaveBeenCalledOnce()` in both tests.

- `tests/verify-warn.test.ts:28-29, 52-53` — `consoleLogSpy` and `consoleErrorSpy` are declared, instantiated, and restored but never asserted against. Dead state; remove them or actually assert on them. They currently just swallow output.

### Suggestions (nice to have)

- `src/gates/gate-registry.ts:97-124` — `runAll` correctly delegates per-gate policy to `runWithPolicy`, but then duplicates the `on_failure === 'stop'` check at lines 116–117 that `runWithPolicy` already inspects (via its own `switch`). This is intentional (the batch has to know *which* gate stopped the batch to build the skip message), but the duplication is a small smell. Consider having `runWithPolicy` return a richer result (e.g., `{ result, shouldStopBatch: boolean }`) or a discriminated union so `runAll` doesn't need to re-read the gate definition. Not required — the current split (policy owns the result shape, batch owns propagation) is defensible and matches the design doc's explicit "caller propagates skip" note.

- `src/gates/gate-registry.ts:126` — `runWithPolicy` is `public` by default. The only external caller is `ExecutionEngine.runTaskGatesInDir`, which could equally well use `runAll` with a single-element array. If the only "real" public method is `runAll` (batch entry point), consider making `runWithPolicy` either `private` or at least documenting on the method that it exists for batch-level composition only. Leaving it public is acceptable given `ExecutionEngine`'s current one-by-one loop — but that loop itself duplicates `runAll`'s sequential logic minus the stop-propagation, which is a separate design smell outside this change.

- `src/gates/gate-registry.ts:142-144` — `runWithRetry` as a one-line back-compat alias is fine, but there's no `@deprecated` JSDoc. If intent.md line 39–40 genuinely plans removal in a follow-up, add `/** @deprecated use runWithPolicy */` so IDEs/TS will flag stragglers.

- `tests/gate-registry.test.ts:86-100` — The original "retries once on failure" test (kept from main) now overlaps with the new `describe('runWithPolicy')` block's three `retry_once` scenarios. The old test calls `runWithRetry` on a command that always fails and asserts `status === 'fail'` — effectively the same as the new `'retry_once — both fails return fail'` test on line 141. Consider removing the older test now that the new block covers the same ground more thoroughly, or keep it only as the explicit back-compat assertion (which already lives at line 243).

- `tests/gate-registry.test.ts:115` — The sentinel-file shell snippet uses `${sentinel}` unquoted. `mkdtemp` returns a path under `tmpdir()` which on some systems (macOS) contains spaces or odd chars. Quote the path: `[ -f "${sentinel}" ]; then rm "${sentinel}"; ...`. Low-likelihood bug but trivial to fix.

- `src/cli/commands/verify.ts:28-30` — The warn-message loop and the `allPassed` computation could be one pass. Negligible; the current form is readable.

- `src/cli/commands/verify.ts:29` — `g.output ?? 'warning'` — if `output` is an empty string, it will print `⚠ gateName: ` (no message). `??` only coalesces null/undefined; empty string passes through. Either use `|| 'warning'` or normalize to undefined in `run()`. Minor.

- `tests/verify-warn.test.ts:87` — `program.exitOverride()` is called but the `ExitCalled` mechanism uses `process.exit` directly. Since `verify.ts` calls `process.exit` (not commander's internal exit), `exitOverride()` is effectively unused here. Either drop the call or explain in a comment why it's belt-and-suspenders.

## Verdict

NEEDS_CHANGES

The single blocking item is the missed `quick.yaml` edit — without it, the "quick.yaml does not reference unimplemented gates" scenario in `spec.md` fails its THEN clause. The warnings around `verify.ts` warn-rendering and the prototype-spy test robustness are important but could be addressed in a follow-up if the `quick.yaml` fix is applied and tests pass.

Required to flip to PASS:

1. Remove `uat` from `src/templates/workflows/quick.yaml` line 28 (set `gates: []`).
2. Add a `warn` branch to the icon ternary in `src/cli/commands/verify.ts:43` so `warn` renders distinctly from `fail`.
3. Add `expect(runAllSpy).toHaveBeenCalledOnce()` (or equivalent) to both tests in `tests/verify-warn.test.ts` to guard against prototype-spy silent no-ops if `createCliContext` is refactored.
