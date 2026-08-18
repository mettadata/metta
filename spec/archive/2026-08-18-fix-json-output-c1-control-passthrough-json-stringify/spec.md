# issue-logging

## ADDED: Requirement: CLI JSON output escapes DEL and C1 control characters

`outputJson` (`src/cli/helpers.ts`), the single stdout edge for all `--json` command output including the `handleError` JSON error envelopes, MUST escape every code unit in the range U+007F through U+009F (DEL plus the C1 controls) in the serialized JSON text as a six-character JSON escape sequence — a backslash followed by `uXXXX` (e.g. `\` + `u009b` for U+009B) — applied after `JSON.stringify`. C0 control handling (U+0000–U+001F) performed by `JSON.stringify` itself MUST remain unchanged. Code points at or below U+007E and at or above U+00A0 — including multi-byte UTF-8 characters — MUST pass through the emission edge unchanged. Emitted `--json` stdout MUST NOT contain any raw code unit in the U+007F–U+009F range.
Fulfills: US-1

### Scenario: Raw CSI byte in a stored issue title is escaped in issues show --json
- GIVEN a stored issue whose title contains a raw single-byte CSI character (U+009B)
- WHEN the user runs `metta --json issues show <slug>`
- THEN the emitted JSON text contains no raw bytes in the U+007F–U+009F range and the affected code point appears as the six-character escape sequence backslash + `u009b`

### Scenario: DEL in a user-influenced field never reaches stdout raw
- GIVEN a stored record whose user-influenced field contains DEL (U+007F)
- WHEN any `--json` command emits that record via `outputJson`
- THEN the raw DEL byte does not appear in stdout and the code point is emitted as the six-character escape sequence backslash + `u007f`

### Scenario: JSON error envelopes receive the same escaping
- GIVEN a `--json` command that fails such that `handleError` emits a JSON error envelope containing user-influenced text with C1 control characters
- WHEN the envelope is written to stdout
- THEN no raw code units in the U+007F–U+009F range appear in the emitted envelope text

### Scenario: Boundary neighbors and multi-byte characters pass through unchanged
- GIVEN stored content containing ordinary printable text, the boundary code points U+007E and U+00A0, and multi-byte UTF-8 characters
- WHEN the content is emitted via a `--json` command
- THEN those code points appear in the emitted JSON text unchanged, and only code points in the U+007F–U+009F range are escaped

## ADDED: Requirement: JSON escaping preserves parsed-value fidelity and never mutates stored data

Applying `JSON.parse` to the emitted `--json` stdout MUST yield string values byte-identical to the stored originals; the DEL/C1 escaping changes only the JSON text encoding, which the JSON grammar permits, and MUST NOT alter parsed values. Escaping MUST apply at the emission edge only: `.metta/` state files and `spec/` store files MUST NOT be modified by any `--json` emission. The existing byte-faithful `--json` regression tests in `tests/cli-issue-backlog.test.ts`, `tests/cli-gaps.test.ts`, `tests/cli-roadmap.test.ts`, and `tests/cli-status.test.ts` MUST continue to pass without modification.
Fulfills: US-2

### Scenario: JSON.parse round-trips escaped output to the exact stored strings
- GIVEN a stored title containing U+009B and U+007F
- WHEN the corresponding `--json` command output is passed through `JSON.parse`
- THEN the resulting string values are byte-identical to the stored originals

### Scenario: Existing byte-faithful test suites pass unmodified
- GIVEN the existing byte-faithful `--json` tests in `tests/cli-issue-backlog.test.ts`, `tests/cli-gaps.test.ts`, `tests/cli-roadmap.test.ts`, and `tests/cli-status.test.ts`
- WHEN the full test suite runs after the fix
- THEN all four suites pass without any modification to their assertions

### Scenario: Stored files are untouched by JSON emission
- GIVEN stored data in `.metta/` state files and `spec/` stores containing C1 control characters
- WHEN any `--json` command runs and emits that data
- THEN the stored files on disk are byte-identical to their pre-emission state

## ADDED: Requirement: Shared pure escape helper applied at every CLI stdout JSON edge

A single shared pure helper (e.g. `escapeJsonControls(jsonText: string): string`) MUST implement the DEL/C1 escaping over already-serialized JSON text. The helper MUST be idempotent — applying it to already-escaped output produces identical text — MUST return an empty string unchanged, and MUST escape exactly the U+007F–U+009F range while leaving all other code points intact. Every CLI stdout JSON emission point that carries user-influenced strings MUST route through this helper: `outputJson` in `src/cli/helpers.ts`, the `config get` JSON object-value edge in `src/cli/commands/config.ts`, and the tasks `--json` rendering edge in `src/cli/commands/tasks-renderer.ts`. The helper MUST NOT be applied to stored data at write time.
Fulfills: US-3

### Scenario: config get escapes C1 controls identically to outputJson
- GIVEN a config object value containing user-influenced strings with C1 control characters
- WHEN `metta config get` prints that value as JSON to stdout
- THEN the U+007F–U+009F range is escaped as backslash + `uXXXX` sequences identically to `outputJson` output and no raw C1 bytes reach stdout

### Scenario: Tasks --json rendering routes through the shared helper
- GIVEN the tasks `--json` rendering path emitting user-influenced strings containing C1 control characters
- WHEN it writes JSON to stdout
- THEN the shared escape helper is applied and no raw code units in the U+007F–U+009F range appear in stdout

### Scenario: Helper is idempotent and precise at range boundaries
- GIVEN inputs consisting of already-escaped JSON text, an empty string, and strings containing the boundary code points U+007E, U+007F, U+009F, and U+00A0
- WHEN the escape helper is invoked on each input
- THEN already-escaped text is returned unchanged, the empty string is returned unchanged, U+007F and U+009F are escaped as backslash + `u007f` and backslash + `u009f` respectively, and U+007E and U+00A0 are left intact
