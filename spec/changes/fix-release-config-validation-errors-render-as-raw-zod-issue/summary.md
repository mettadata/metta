# Summary: fix-release-config-validation-errors-render-as-raw-zod-issue

## What changed

Raw `ZodError`s surfaced by CLI commands (e.g. `metta release status` with an invalid `release.scheme`) now render as friendly, newline-joined `path: message` lines instead of the JSON-serialized Zod issues array. Implemented via candidate solution 3 from the issue: a shared formatter used by both the CLI error handler and the config loader.

Commit: `19916c68` — `fix(cli): render ZodError as path: message lines instead of raw issue array`

## Files

- `src/util/format-zod-error.ts` (new) — `formatZodError(err: ZodError, options?: { prefix?: string }): string`; one `path: message` line per issue; empty-path issues render as the bare message; optional per-line prefix.
- `src/cli/helpers.ts` — `handleError` generic fallback detects `ZodError` and uses `formatZodError`; `validation_error` JSON envelope shape, exit code 4, and the `ConfigParseError` branch are unchanged.
- `src/config/config-loader.ts` — env-override warning branch delegates to `formatZodError(err, { prefix: '  - ' })`; the invalid-file branch still re-throws the raw `ZodError`, preserving the `load()` throw contract.
- `tests/format-zod-error.test.ts` (new, 5 tests) — single/multiple issues, nested + array paths, empty path, prefix.
- `tests/cli-helpers.test.ts` (+3 tests) — `handleError` with `ZodError` in text and json modes, generic-fallback regression.
- `tests/config-loader.test.ts` (+1 test) — warning renders via the shared formatter.

## Gates

- `npm test`: 121 files / 2138 tests — all passed
- `npm run lint` (`tsc --noEmit`): clean
- `npm run build`: succeeded

## Notes

- Behavioral delta beyond formatting reuse: empty-path issues in the env-override warning previously printed `  - : <message>`; now `  - <message>` (dangling colon removed). Intentional, covered by a test.
