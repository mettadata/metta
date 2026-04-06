# Config-Loader Gap Fixes Summary

## Changes Made

### GAP-CL-01 + GAP-CL-03 (P1): Malformed YAML handling
- **File:** `src/config/config-loader.ts` - `loadYamlFile` now distinguishes ENOENT (returns null) from YAML parse errors (logs warning to stderr, returns null) and other I/O errors (re-throws).
- **Test:** Added "logs warning and falls back to defaults for malformed YAML" test.

### GAP-CL-02 (P1): Env var segment separator changed to `__`
- **File:** `src/config/config-loader.ts` - `applyEnvOverrides` now splits on `__` (double underscore) instead of `_`, preserving single underscores within config key names (e.g., `api_key_env`).
- **Test:** Added "env vars with double underscore separator handle keys containing single underscores" test. Updated existing env var test.
- **Spec:** Updated `spec/specs/config-loader/spec.md` section 5 to document the new separator.

### GAP-CL-04 (P2): Cache invalidation documented
- **File:** `src/config/config-loader.ts` - Added JSDoc on `ConfigLoader` class documenting that cache is not auto-invalidated on env changes and recommending short-lived instances.

### GAP-CL-05 (P2): local.yaml gitignore requirement
- **File:** `spec/specs/config-loader/spec.md` - Strengthened local.yaml gitignore from SHOULD to MUST, added note that `metta init` should enforce this.

### GAP-CL-06 (P3): Default globalDir test
- **Test:** Added "defaults globalDir to ~/.metta when not provided" test verifying `homedir()` resolution.

### GAP-CL-07 (P3): Zod validation error from env vars
- **File:** `src/config/config-loader.ts` - `load()` now catches ZodError, checks if file-only config is valid, and if so falls back to file-only config with a stderr warning instead of crashing.
- **Test:** Added "warns and ignores env vars that cause Zod validation errors" test.

## Verification
- `npx tsc --noEmit` passes
- `npx vitest run` passes (192/192 tests, 22 test files)
