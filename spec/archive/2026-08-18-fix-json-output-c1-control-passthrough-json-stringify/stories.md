# fix-json-output-c1-control-passthrough-json-stringify — User Stories

## US-1: Safe --json output on terminals

**As a** developer running metta CLI commands with `--json` in a terminal
**I want to** have DEL (U+007F) and C1 control characters (U+0080–U+009F) in stored user content emitted as JSON `\uXXXX` escapes instead of raw bytes
**So that** eyeballing or piping `--json` output (e.g. through `cat` or `jq`) can never replay a raw CSI byte that terminals interpret as the start of an escape sequence
**Priority:** P1
**Independent Test Criteria:** Seeding a store record whose title contains raw U+009B and U+007F bytes and running the corresponding `--json` command produces stdout containing no code units in the U+007F–U+009F range.

**Acceptance Criteria:**
- **Given** a stored issue whose title contains a raw single-byte CSI (U+009B) **When** the user runs `metta --json issues show <slug>` **Then** the emitted JSON text contains no raw bytes in the U+007F–U+009F range and the affected code points appear as `\uXXXX` escape sequences
- **Given** a stored record containing DEL (U+007F) in a user-influenced field **When** any `--json` command emits that record via `outputJson` **Then** the raw DEL byte does not appear in stdout
- **Given** a `--json` command fails and `handleError` emits a JSON error envelope containing user-influenced text with C1 controls **When** the envelope is written to stdout **Then** the same escaping applies and no raw U+007F–U+009F code units are emitted
- **Given** stored content containing ordinary text, boundary neighbors (U+007E, U+00A0), and multi-byte UTF-8 characters **When** emitted via `--json` **Then** those code points pass through unchanged (only the U+007F–U+009F range is escaped)

## US-2: Parsed-value fidelity preserved for machine consumers

**As a** machine consumer (script or tool) that parses metta `--json` output with `JSON.parse`
**I want to** receive string values that are byte-identical to the stored data despite the emission-edge escaping
**So that** the fix changes only the JSON text encoding, not the data, and no downstream automation or stored state is mutated
**Priority:** P1
**Independent Test Criteria:** `JSON.parse` of the escaped `--json` stdout yields string values byte-identical to the stored originals, and all four existing byte-faithful test suites pass unmodified.

**Acceptance Criteria:**
- **Given** a stored title containing U+009B and U+007F **When** the `--json` output is passed through `JSON.parse` **Then** the resulting string values are byte-identical to the stored originals
- **Given** the existing byte-faithful `--json` tests in `tests/cli-issue-backlog.test.ts`, `tests/cli-gaps.test.ts`, `tests/cli-roadmap.test.ts`, and `tests/cli-status.test.ts` **When** the full test suite runs after the fix **Then** all four pass without modification
- **Given** stored data in `.metta/` state files and `spec/` stores containing C1 controls **When** any `--json` command runs **Then** the stored files are not modified — escaping happens only at the emission edge

## US-3: All CLI stdout JSON edges covered

**As a** developer relying on metta's render-edge sanitization guarantee
**I want to** have every CLI stdout JSON emission point — not just `outputJson` — apply the same DEL/C1 escaping when it carries user-influenced strings
**So that** no alternate JSON output path (e.g. `config get`, tasks `--json` rendering) reintroduces the raw-C1 passthrough the fix closes
**Priority:** P2
**Independent Test Criteria:** An audit of `src/cli/` JSON stdout emission points (`outputJson`, `config get` in `src/cli/commands/config.ts`, tasks renderer in `src/cli/commands/tasks-renderer.ts`) shows each user-influenced path routed through the shared escape helper, with tests exercising hostile content at each covered edge.

**Acceptance Criteria:**
- **Given** the `config get` command prints an object value as JSON containing user-influenced strings with C1 controls **When** it writes to stdout **Then** the U+007F–U+009F range is escaped identically to `outputJson`
- **Given** the tasks `--json` rendering path emits user-influenced strings **When** it writes to stdout **Then** the same escape helper is applied and no raw C1 bytes reach stdout
- **Given** the shared escape helper receives already-escaped JSON text, an empty string, or boundary code points (U+007E, U+007F, U+009F, U+00A0) **When** invoked **Then** it is idempotent, leaves non-target code points intact, and escapes exactly the U+007F–U+009F range
