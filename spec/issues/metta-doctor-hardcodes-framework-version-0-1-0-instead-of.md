# metta doctor hardcodes framework version 0.1.0 instead of reading package.json

**Captured**: 2026-07-14
**Status**: logged
**Severity**: minor

## Symptom
`metta doctor` always reports the framework version as `0.1.0` in its "Framework version" check, regardless of the actually installed package version. The value is a hardcoded string literal, so as soon as the package version is bumped, doctor output silently disagrees with `metta --version` and `metta update`, which now both read the real version from package.json.

## Root Cause Analysis
Change `fix-metta-complete-prints-non-json-output-block-twice` (commit e4e5657f3) introduced a shared `getPackageVersion()` helper in `src/cli/helpers.ts` that reads the version from `package.json`, and migrated `src/cli/index.ts` and `src/cli/commands/update.ts` to use it. The same defect family exists in `src/cli/commands/doctor.ts`, but that occurrence was outside that change's scope: line 96 pushes a check result with `detail: '0.1.0'` as a literal. It was found by that change's verifier during its residual `grep -rn '0.1.0' src/` sweep — the doctor.ts literal is now the only remaining hardcoded version in `src/`. The check is also unconditionally `status: 'pass'`, so nothing forces the value to be recomputed.

### Evidence
- `src/cli/commands/doctor.ts:96` — `checks.push({ check: 'Framework version', status: 'pass', detail: '0.1.0' })` hardcodes the version instead of deriving it from package.json.
- `src/cli/helpers.ts:382` — `getPackageVersion()` already exists, is exported, and resolves `package.json` correctly from both `src/` and `dist/` layouts, so the fix is a drop-in call.
- `src/cli/commands/update.ts:20` and `src/cli/index.ts:50` — sibling call sites already migrated to `await getPackageVersion()` in commit e4e5657f3, confirming the intended pattern.

## Candidate Solutions
1. **Use the shared helper (one-line fix)** — In `doctor.ts`, replace the literal with `detail: await getPackageVersion()` (the surrounding handler is already async) and import `getPackageVersion` from `../helpers.js`. This matches the pattern already applied to `index.ts` and `update.ts` and eliminates the last hardcoded version in `src/`. Tradeoff: adds a filesystem read per doctor run — negligible, but the value is fetched even though the check can never fail, which slightly muddies the check's pass/fail semantics.
2. **Use the helper and make the check meaningful** — Same as option 1, but also report `status: 'warn'` with a remedy detail when `getPackageVersion()` returns `'unknown'` (missing/corrupt package.json), so the check can actually detect a broken install instead of always passing. Tradeoff: slightly larger diff and a new warn path that needs a test, pushing a trivial-tier fix toward quick-tier scope.

