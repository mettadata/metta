# bump-metta-finalize-tests-gate-timeout-300s-600s

## Problem

`metta finalize`'s `tests` gate times out at 300000ms (5 min). The project test suite runs ~305-315s at default concurrency on current-generation hardware, placing it right on or over the edge of the gate timeout. Observed 2026-04-18 during change `centralize-slugify-utility-strip-non-ascii-truncate-at-word`: the tests gate timed out three runs in a row despite all 576 tests passing when allowed to finish. This blocks finalize for any non-trivial change that touches many modules.

Tracked as issue `metta-finalize-tests-gate-timeout-of-300s-is-too-tight-test` (major).

## Proposal

Bump `timeout` in `src/templates/gates/tests.yaml` from `300000` to `600000` (10 min). Sync the dist mirror (`dist/templates/gates/tests.yaml`) so the running CLI picks up the new value. Single-line YAML change.

## Impact

- `src/templates/gates/tests.yaml` — the one source file.
- `dist/templates/gates/tests.yaml` — the mirrored compiled copy.
- No TypeScript code, no schema, no tests. The gate config file is read at runtime.
- Finalize runs that used to spuriously fail at the 5-min mark now have 10-min headroom.

## Out of Scope

- Making the timeout per-project configurable (a separate, richer change).
- Adaptive timeouts based on previous observed duration.
- Fixing the orphan vitest leak on timeout (tracked separately as `metta-finalize-tests-gate-leaks-vitest-worker-processes-on`).
- Rewriting any other gate's timeout.
