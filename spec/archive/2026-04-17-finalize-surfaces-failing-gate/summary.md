# Summary: finalize-surfaces-failing-gate

## What changed

`metta finalize` human-readable output now prints each failing gate's structured `failures` (or trimmed `output`) beneath the status list, so the user can see *why* a gate failed without re-running with `--json`.

## Files modified

- `src/cli/commands/finalize.ts` — added failure-detail block after the status list in the non-JSON path.

## Verification

Smoke test against this change's own finalize before `stories.md` was written:

```
Quality gates failed:
  ✓ build: pass (5125ms)
  ✓ lint: pass (4262ms)
  ✗ stories-valid: fail (490ms)
  ✓ tests: pass (230919ms)
  ✓ typecheck: pass (4491ms)

✗ stories-valid
    validate-stories failed: not_found — .../stories.md

Fix failures and retry.
```

Build clean. No changes to `--json` output or to any gate schema.

## Resolves

`spec/issues/metta-finalize-error-output-is-cryptic-when-a-gate-fails-the.md`
