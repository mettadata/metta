# Release config validation errors render as a raw Zod issue array instead of a friendly message

**Captured**: 2026-08-11
**Status**: logged
**Severity**: minor

## Symptom
Running `metta release status` with `release.scheme: calver` in config prints a raw Zod issue array to the terminal: `Error: [ { received: calver, code: invalid_literal, ... } ]`. The embedded message ("release.scheme: only 'semver' is supported") is correct and names the offending key, but it is buried inside a JSON-serialized array of Zod issue objects, leaking library internals to the user. Observed during the UAT run of fix-automatic-versioning-release-capability-metta (UAT.md steps 1.2/8.2, 2026-08-11).

## Root Cause Analysis
When file-layer config is invalid, `ConfigLoader.load()` re-throws the original `ZodError` (config-loader.ts:159). The release command catches it and delegates to `handleError(err, json)` (release.ts:139), which has a dedicated branch only for `ConfigParseError`; everything else falls through to `getErrorMessage(err)`, which returns `err.message` for any `Error` instance (util/errors.ts:8). For a `ZodError`, `.message` is `JSON.stringify` of the full issues array — so the terminal output is `Error: <raw issue array>`. A clean formatting pattern already exists in the codebase: config-loader.ts:154 maps issues to `` `${i.path.join(".")}: ${i.message}` `` lines for the env-override warning path, but that formatting is not applied on the re-throw path, and `handleError` has no `ZodError` awareness.

### Evidence
- `src/util/errors.ts:8` — `getErrorMessage` returns `err.message` verbatim; for `ZodError` that is the JSON-serialized issues array, producing the leaked output.
- `src/config/config-loader.ts:154-159` — the env-override branch formats Zod issues as joined `path: message` lines, but the invalid-file branch re-throws the raw `ZodError` unformatted.
- `src/cli/helpers.ts:241-264` — `handleError` special-cases only `ConfigParseError`; a raw `ZodError` falls into the generic `Error: ${message}` path.

## Candidate Solutions
1. **Add a `ZodError` branch to `handleError`** — In `src/cli/helpers.ts`, detect `err instanceof ZodError` and render the joined `.issues` as `path: message` lines (reusing the format at config-loader.ts:154), for both text and `--json` output. Tradeoff: fixes every CLI command at once but couples the CLI helper layer to Zod as a direct import.
2. **Wrap the re-thrown `ZodError` in config-loader** — In `config-loader.ts:159`, throw a `ConfigParseError` (or new typed error) carrying the pre-formatted joined issue messages instead of the raw `ZodError`, so `handleError` needs no change. Tradeoff: touches a shared load path used by many commands; any caller that currently catches `ZodError` specifically would need updating.
3. **Extract a shared `formatZodError` util** — Add a small formatter in `src/util/` used by both config-loader (both branches) and `handleError`, keeping one canonical rendering of Zod issues. Tradeoff: slightly more surface area (new module plus test per the 1:1 test convention) for a cosmetic fix.
