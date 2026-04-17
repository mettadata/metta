# finalize-surfaces-failing-gate

## Problem

When `metta finalize` fails a quality gate, the human-readable output shows only `Quality gates failed:` followed by a status list (`✓ build: pass`, `✗ stories-valid: fail`) and then `Fix failures and retry.` — no gate output, no error lines, no file paths. The workaround is re-running with `--json` or running the gate individually, both of which waste time on every failed run. Observed repeatedly during the trello-clone e2e dogfood.

## Proposal

After the status list, append a failure detail block for each failing gate:

```
Quality gates failed:
  ✓ build: pass (5125ms)
  ✓ lint: pass (4262ms)
  ✗ stories-valid: fail (490ms)
  ✓ tests: pass (230919ms)
  ✓ typecheck: pass (4491ms)

✗ stories-valid
    validate-stories failed: not_found — spec/changes/foo/stories.md

Fix failures and retry.
```

When the gate emits structured `failures` (from `GateResult.failures`), render each as `  <file>:<line> — <message>`. Otherwise fall back to the gate's `output` string, trimmed. No changes to `--json` mode (already carries full detail).

## Impact

Only `src/cli/commands/finalize.ts` — a ~20-line addition inside the `!json` branch of the gate-failure path. No schema changes, no behavior change for JSON consumers or for success paths.

## Out of Scope

- Restructuring the gate result schema.
- Coloring/formatting changes beyond the new failure block.
- JSON output changes.
- Fixes for the other three major issues logged the same day.
