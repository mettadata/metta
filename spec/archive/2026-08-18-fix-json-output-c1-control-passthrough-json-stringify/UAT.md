# UAT: fix-json-output-c1-control-passthrough-json-stringify

- **Change**: fix-json-output-c1-control-passthrough-json-stringify
- **Generated**: 2026-08-18
- **Source**: user stories (stories.md)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

### US-1: Safe --json output on terminals

*Independent test:* Seeding a store record whose title contains raw U+009B and U+007F bytes and running the corresponding `--json` command produces stdout containing no code units in the U+007F–U+009F range.

#### Step 1.1
- **Setup**: a stored issue whose title contains a raw single-byte CSI (U+009B)
- **Do**: the user runs `metta --json issues show <slug>`
- **Observe**: the emitted JSON text contains no raw bytes in the U+007F–U+009F range and the affected code points appear as `\uXXXX` escape sequences
- **Machine-verified** — summary.md references "US-1"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 1.2
- **Setup**: a stored record containing DEL (U+007F) in a user-influenced field
- **Do**: any `--json` command emits that record via `outputJson`
- **Observe**: the raw DEL byte does not appear in stdout
- **Machine-verified** — summary.md references "US-1"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 1.3
- **Setup**: a `--json` command fails and `handleError` emits a JSON error envelope containing user-influenced text with C1 controls
- **Do**: the envelope is written to stdout
- **Observe**: the same escaping applies and no raw U+007F–U+009F code units are emitted
- **Machine-verified** — summary.md references "US-1"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 1.4
- **Setup**: stored content containing ordinary text, boundary neighbors (U+007E, U+00A0), and multi-byte UTF-8 characters
- **Do**: emitted via `--json`
- **Observe**: those code points pass through unchanged (only the U+007F–U+009F range is escaped)
- **Machine-verified** — summary.md references "US-1"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

### US-2: Parsed-value fidelity preserved for machine consumers

*Independent test:* `JSON.parse` of the escaped `--json` stdout yields string values byte-identical to the stored originals, and all four existing byte-faithful test suites pass unmodified.

#### Step 2.1
- **Setup**: a stored title containing U+009B and U+007F
- **Do**: the `--json` output is passed through `JSON.parse`
- **Observe**: the resulting string values are byte-identical to the stored originals
- **Machine-verified** — summary.md references "US-2"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 2.2
- **Setup**: the existing byte-faithful `--json` tests in `tests/cli-issue-backlog.test.ts`, `tests/cli-gaps.test.ts`, `tests/cli-roadmap.test.ts`, and `tests/cli-status.test.ts`
- **Do**: the full test suite runs after the fix
- **Observe**: all four pass without modification
- **Machine-verified** — summary.md references "US-2"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 2.3
- **Setup**: stored data in `.metta/` state files and `spec/` stores containing C1 controls
- **Do**: any `--json` command runs
- **Observe**: the stored files are not modified — escaping happens only at the emission edge
- **Machine-verified** — summary.md references "US-2"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

### US-3: All CLI stdout JSON edges covered

*Independent test:* An audit of `src/cli/` JSON stdout emission points (`outputJson`, `config get` in `src/cli/commands/config.ts`, tasks renderer in `src/cli/commands/tasks-renderer.ts`) shows each user-influenced path routed through the shared escape helper, with tests exercising hostile content at each covered edge.

#### Step 3.1
- **Setup**: the `config get` command prints an object value as JSON containing user-influenced strings with C1 controls
- **Do**: it writes to stdout (Run: `config get`)
- **Observe**: the U+007F–U+009F range is escaped identically to `outputJson`
- **Machine-verified** — summary.md references "US-3"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 3.2
- **Setup**: the tasks `--json` rendering path emits user-influenced strings
- **Do**: it writes to stdout
- **Observe**: the same escape helper is applied and no raw C1 bytes reach stdout
- **Machine-verified** — summary.md references "US-3"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 3.3
- **Setup**: the shared escape helper receives already-escaped JSON text, an empty string, or boundary code points (U+007E, U+007F, U+009F, U+00A0)
- **Do**: invoked
- **Observe**: it is idempotent, leaves non-target code points intact, and escapes exactly the U+007F–U+009F range
- **Machine-verified** — summary.md references "US-3"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

## Additional scenarios

#### Step 4.1: Raw CSI byte in a stored issue title is escaped in issues show --json
- **Setup**: a stored issue whose title contains a raw single-byte CSI character (U+009B)
- **Do**: the user runs `metta --json issues show <slug>`
- **Observe**: the emitted JSON text contains no raw bytes in the U+007F–U+009F range and the affected code point appears as the six-character escape sequence backslash + `u009b`
- [ ] Pass

#### Step 4.2: DEL in a user-influenced field never reaches stdout raw
- **Setup**: a stored record whose user-influenced field contains DEL (U+007F)
- **Do**: any `--json` command emits that record via `outputJson`
- **Observe**: the raw DEL byte does not appear in stdout and the code point is emitted as the six-character escape sequence backslash + `u007f`
- [ ] Pass

#### Step 4.3: JSON error envelopes receive the same escaping
- **Setup**: a `--json` command that fails such that `handleError` emits a JSON error envelope containing user-influenced text with C1 control characters
- **Do**: the envelope is written to stdout
- **Observe**: no raw code units in the U+007F–U+009F range appear in the emitted envelope text
- [ ] Pass

#### Step 4.4: Boundary neighbors and multi-byte characters pass through unchanged
- **Setup**: stored content containing ordinary printable text, the boundary code points U+007E and U+00A0, and multi-byte UTF-8 characters
- **Do**: the content is emitted via a `--json` command
- **Observe**: those code points appear in the emitted JSON text unchanged, and only code points in the U+007F–U+009F range are escaped
- [ ] Pass

#### Step 4.5: JSON.parse round-trips escaped output to the exact stored strings
- **Setup**: a stored title containing U+009B and U+007F
- **Do**: the corresponding `--json` command output is passed through `JSON.parse`
- **Observe**: the resulting string values are byte-identical to the stored originals
- [ ] Pass

#### Step 4.6: Existing byte-faithful test suites pass unmodified
- **Setup**: the existing byte-faithful `--json` tests in `tests/cli-issue-backlog.test.ts`, `tests/cli-gaps.test.ts`, `tests/cli-roadmap.test.ts`, and `tests/cli-status.test.ts`
- **Do**: the full test suite runs after the fix
- **Observe**: all four suites pass without any modification to their assertions
- [ ] Pass

#### Step 4.7: Stored files are untouched by JSON emission
- **Setup**: stored data in `.metta/` state files and `spec/` stores containing C1 control characters
- **Do**: any `--json` command runs and emits that data
- **Observe**: the stored files on disk are byte-identical to their pre-emission state
- [ ] Pass

#### Step 4.8: config get escapes C1 controls identically to outputJson
- **Setup**: a config object value containing user-influenced strings with C1 control characters
- **Do**: `metta config get` prints that value as JSON to stdout (Run: `metta config get`)
- **Observe**: the U+007F–U+009F range is escaped as backslash + `uXXXX` sequences identically to `outputJson` output and no raw C1 bytes reach stdout
- [ ] Pass

#### Step 4.9: Tasks --json rendering routes through the shared helper
- **Setup**: the tasks `--json` rendering path emitting user-influenced strings containing C1 control characters
- **Do**: it writes JSON to stdout
- **Observe**: the shared escape helper is applied and no raw code units in the U+007F–U+009F range appear in stdout
- [ ] Pass

#### Step 4.10: Helper is idempotent and precise at range boundaries
- **Setup**: inputs consisting of already-escaped JSON text, an empty string, and strings containing the boundary code points U+007E, U+007F, U+009F, and U+00A0
- **Do**: the escape helper is invoked on each input
- **Observe**: already-escaped text is returned unchanged, the empty string is returned unchanged, U+007F and U+009F are escaped as backslash + `u007f` and backslash + `u009f` respectively, and U+007E and U+00A0 are left intact
- [ ] Pass
