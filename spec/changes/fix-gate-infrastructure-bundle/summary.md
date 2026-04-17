# Summary: fix-gate-infrastructure-bundle

## What changed

Three open gate-infrastructure issues resolved together with a single refactor of the gate-runner.

## Files modified

- `src/gates/gate-registry.ts` — new `runWithPolicy(name, cwd)` method honoring all three `on_failure` values (`retry_once`, `continue_with_warning`, `stop`). `runAll` reshaped to iterate via `runWithPolicy` and propagate `stop` semantics as `skip` results for remaining gates. `runWithRetry` kept as a delegating back-compat alias.
- `src/execution/execution-engine.ts` — line 355 call site migrated from `runWithRetry` to `runWithPolicy` (no behavioral change for `retry_once`; now also honors `stop` and `continue_with_warning` at execute-time).
- `src/cli/commands/verify.ts` — `warn` now treated as pass; stderr emits `⚠ <gate>: <output>` per warn gate; icon/summary updated to distinguish warn from fail.
- `src/templates/workflows/standard.yaml` — stripped `spec-quality`, `design-review`, `task-quality` from their respective stages; `stories-valid` retained on the spec stage.
- `src/templates/workflows/full.yaml` — stripped `spec-quality`, `design-review`, `task-quality`, `uat` from their respective stages.
- `src/templates/workflows/quick.yaml` — stripped `uat` (review fix — initially missed).

## Files added

- `tests/gate-registry.test.ts` — expanded (9 new cases): `retry_once` retry/no-retry/fail-on-retry, `continue_with_warning` fail→warn/pass-unchanged, `stop` fail-unchanged, `runAll` stop propagation (skip output matches spec), `runAll` full-length on stop, `runWithRetry` back-compat alias.
- `tests/verify-warn.test.ts` — new test file covering `verify` exit 0 on `warn`, exit non-zero on `fail`.

## Resolves (3 issues, archived to spec/issues/resolved/)

1. `code-driven-gates-spec-quality-design-review-task-quality-ua` (major) — gate references removed from workflow YAMLs
2. `on-failure-gate-policy-inconsistently-honored-retry-once-wor` (major) — all three `on_failure` values honored uniformly at execute-time and finalize-time via the unified `runWithPolicy` path
3. `gate-warn-status-treated-inconsistently-between-finalizer-an` (minor) — `verify` now treats `warn` as pass, matching `Finalizer`'s behavior

## Verification

- `npx tsc --noEmit`: clean
- `npm test`: 539/539 pass (43 test files)
- 3-reviewer parallel pass: initial NEEDS_CHANGES (2 critical, 3 warnings) → all fixed → re-verification green
- Workflow YAML grep: no references to unimplemented gates across all three workflows

## Non-goals (deferred)

- Implementing real checks for `spec-quality`, `design-review`, `task-quality`, `uat` — removed, not implemented. Any future reintroduction should be its own change with concrete check semantics.
- Changing the `on_failure` enum values themselves — all three preserved and honored.
- Adding new gate status values beyond `pass`/`fail`/`warn`/`skip`.
- `merge-safety.ts` stderr surface for warn — it operates silently by design.
