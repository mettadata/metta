# Summary: fix-metta-complete-prints-non-json-output-block-twice

Four localized fixes across the CLI, per the intent's three reported bugs:

1. **Single completion banner per mode** (`src/cli/commands/complete.ts`) — the stderr banner writes in both the pending-artifacts and all-complete branches are now gated on `--json`. Plain mode prints the banner once to stdout; JSON mode keeps stdout as a pure JSON payload with the human-readable banner on stderr. Commit `db580f7df`.
2. **Stories parser accepts `**As an**`** (`src/specs/stories-parser.ts`) — added a second `FIELD_PREFIXES` entry for `'**As an**'` (ordered before `'**As a**'`) so both article forms bind to `asA`; two new parser tests lock in the fix and the no-regression path for `**As a**`. Commit `438064e5e`.
3. **`metta update --check` reads the real version** (`src/cli/commands/update.ts`) — replaced the hardcoded `'0.1.0'` with a runtime `package.json` read. Commit `63139e7f2`.
4. **Single version source for the CLI root** (`src/cli/helpers.ts`, `src/cli/index.ts`) — extracted `getPackageVersion()` into helpers and pointed both `program.version(...)` and `update --check` at it, eliminating the remaining hardcoded version literal in the command surface. Commit `e4e5657f3`.

No schema, state-format, workflow-graph, or other command-surface changes. Verification (see `verification.md`): all fixes exercised live against the built CLI; full gates pass (1044 tests, tsc, lint, build). Verdict: PASS, with one out-of-scope residual (`src/cli/commands/doctor.ts:96` hardcodes `0.1.0`) recommended as a follow-up issue.
