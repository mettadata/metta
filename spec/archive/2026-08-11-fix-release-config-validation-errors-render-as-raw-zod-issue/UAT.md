# UAT: fix-release-config-validation-errors-render-as-raw-zod-issue

- **Change**: fix-release-config-validation-errors-render-as-raw-zod-issue
- **Generated**: 2026-08-11
- **Source**: intent + summary (reduced)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

*Reduced script — derived from intent/summary; steps are confirmation prompts.*

### Intent proposal

#### Step 1.1
- **Do**: Confirm: Add `formatZodError(err: ZodError): string` in `src/util/errors.ts` (or a sibling `src/util/` module per the kebab-case/1:1-test conventions). It renders each issue as a `path: message` line — e.g. `release.scheme: only 'semver' is supported` — joining multiple issues with newlines, matching the existing formatting at `config-loader.ts:154`.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Teach `handleError` to detect `ZodError` before the generic fallback. Text mode prints `Error: <formatted lines>` (one `path: message` per line); `--json` mode emits `{ error: { code: 4, type: 'validation_error', message: <formatted> } }` with the same exit code 4 as today. No raw issue objects appear in either mode.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: Reuse the formatter in `ConfigLoader` for the env-override warning branch (`config-loader.ts:154`) so there is exactly one rendering of Zod issues in the codebase. The invalid-file branch continues to throw a `ZodError` (unchanged contract), now rendered correctly at the CLI edge.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.4
- **Do**: Confirm: Tests: unit tests for `formatZodError` (single issue, multiple issues, nested path, empty path) and for the new `handleError` branch (text and `--json`), maintaining the 1:1 test-to-source ratio.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Raw `ZodError`s surfaced by CLI commands (e.g. `metta release status` with an invalid `release.scheme`) now render as friendly, newline-joined `path: message` lines instead of the JSON-serialized Zod issues array. Implemented via candidate solution 3 from the issue: a shared formatter used by both the CLI error handler and the config loader.

#### Step 2.1
- **Do**: Confirm: `src/util/format-zod-error.ts` (new) — `formatZodError(err: ZodError, options?: { prefix?: string }): string`; one `path: message` line per issue; empty-path issues render as the bare message; optional per-line prefix.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: `src/cli/helpers.ts` — `handleError` generic fallback detects `ZodError` and uses `formatZodError`; `validation_error` JSON envelope shape, exit code 4, and the `ConfigParseError` branch are unchanged.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: `src/config/config-loader.ts` — env-override warning branch delegates to `formatZodError(err, { prefix: '  - ' })`; the invalid-file branch still re-throws the raw `ZodError`, preserving the `load()` throw contract.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.4
- **Do**: Confirm: `tests/format-zod-error.test.ts` (new, 5 tests) — single/multiple issues, nested + array paths, empty path, prefix.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.5
- **Do**: Confirm: `tests/cli-helpers.test.ts` (+3 tests) — `handleError` with `ZodError` in text and json modes, generic-fallback regression.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.6
- **Do**: Confirm: `tests/config-loader.test.ts` (+1 test) — warning renders via the shared formatter.
- **Observe**: behaves as described
- [ ] Pass
