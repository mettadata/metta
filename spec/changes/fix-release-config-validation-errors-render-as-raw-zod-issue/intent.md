# fix-release-config-validation-errors-render-as-raw-zod-issue

## Problem

When file-layer config is invalid (e.g. `release.scheme: calver` in `.metta/config.yaml`), `ConfigLoader.load()` re-throws the raw `ZodError` (`src/config/config-loader.ts:159`). CLI commands catch it and delegate to `handleError(err, json)` (`src/cli/helpers.ts:241`), which special-cases only `ConfigParseError`; everything else falls through to `getErrorMessage(err)` (`src/util/errors.ts:8`), which returns `err.message` verbatim. For a `ZodError`, `.message` is the JSON-serialized issues array, so the user sees:

```
Error: [ { received: calver, code: invalid_literal, ... } ]
```

The useful message ("release.scheme: only 'semver' is supported") is buried inside library internals. Observed on `metta release status` during the UAT run of `fix-automatic-versioning-release-capability-metta` (steps 1.2/8.2, 2026-08-11), but the fault path is shared: any command that loads config and hits an invalid file layer leaks the same raw Zod output. Affected users are all metta CLI users with a hand-edited or drifted config file — exactly the users who most need a readable pointer to the offending key.

A clean rendering already exists in the codebase: the env-override warning path formats issues as `path: message` lines (`src/config/config-loader.ts:154`), but that formatting is not applied on the re-throw path, and `handleError` has no `ZodError` awareness.

## Proposal

Adopt candidate solution 3 — extract one canonical Zod-issue formatter and use it at both ends of the fault path:

1. **Add `formatZodError(err: ZodError): string`** in `src/util/errors.ts` (or a sibling `src/util/` module per the kebab-case/1:1-test conventions). It renders each issue as a `path: message` line — e.g. `release.scheme: only 'semver' is supported` — joining multiple issues with newlines, matching the existing formatting at `config-loader.ts:154`.
2. **Teach `handleError` to detect `ZodError`** before the generic fallback. Text mode prints `Error: <formatted lines>` (one `path: message` per line); `--json` mode emits `{ error: { code: 4, type: 'validation_error', message: <formatted> } }` with the same exit code 4 as today. No raw issue objects appear in either mode.
3. **Reuse the formatter in `ConfigLoader`** for the env-override warning branch (`config-loader.ts:154`) so there is exactly one rendering of Zod issues in the codebase. The invalid-file branch continues to throw a `ZodError` (unchanged contract), now rendered correctly at the CLI edge.
4. **Tests**: unit tests for `formatZodError` (single issue, multiple issues, nested path, empty path) and for the new `handleError` branch (text and `--json`), maintaining the 1:1 test-to-source ratio.

Why option 3 over the alternatives: option 1 alone would duplicate the formatting already living in config-loader; option 2 (wrapping in `ConfigParseError`) changes the throw contract of a load path shared by many commands and misattributes a schema-validation failure to the "parse error / run doctor --fix" remedy. The shared formatter fixes every CLI command at once while keeping the loader's error contract intact. `handleError` importing `zod` is acceptable: the CLI layer already depends transitively on Zod-validated modules, and this keeps formatting knowledge out of every individual command.

## Impact

- `metta release status` (and `release bump`/`release preview`) with invalid file config now prints `Error: release.scheme: only 'semver' is supported` instead of the raw issue array — the observed UAT symptom is fixed.
- Every other CLI command routing through `handleError` gains the same friendly rendering for any escaped `ZodError` (config or state validation), text and `--json` alike.
- Exit codes are unchanged (still 4 via the `validation_error` path); the `--json` payload shape is unchanged — only the `message` string content improves. Scripts matching on the exact raw-array message text (unlikely, and previously broken output) would see different text.
- `ConfigParseError` handling, the env-override warning behavior, and `ConfigLoader`'s throw contract are all preserved; the warning text formatting is byte-identical after the formatter extraction.
- New/edited files: `src/util/errors.ts` (+ test), `src/cli/helpers.ts` (+ test), `src/config/config-loader.ts` (refactor to use the shared formatter).

## Out of Scope

- Changing which config values are valid (e.g. adding `calver` support to `release.scheme`) or any Zod schema messages themselves.
- Wrapping the loader's re-thrown `ZodError` in a new typed error class or otherwise changing `ConfigLoader.load()`'s error contract (candidate solution 2).
- Changing exit codes, the `--json` error envelope shape, or the `ConfigParseError` branch of `handleError`.
- Auditing or rewriting error rendering for non-`ZodError` failures (network, git, filesystem errors) — the generic `getErrorMessage` fallback stays as-is.
- Adding remediation hints (e.g. "run metta doctor") to schema-validation errors; the fix is limited to rendering the existing issue messages readably.
