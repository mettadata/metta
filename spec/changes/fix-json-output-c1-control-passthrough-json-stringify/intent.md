# fix-json-output-c1-control-passthrough-json-stringify

## Problem

`outputJson` (`src/cli/helpers.ts:220-235`) emits every `--json` CLI response via `JSON.stringify(data, null, 2)`. The JSON spec only requires escaping C0 controls (U+0000 through U+001F), so `JSON.stringify` passes DEL (U+007F) and the C1 control range (U+0080 through U+009F) through as raw code units. A stored issue/gap/backlog title containing a raw single-byte CSI (U+009B) therefore reaches stdout unescaped in `--json` mode, where it can be interpreted as the start of an escape sequence by terminals that honor C1 controls and by downstream tools that re-emit the raw JSON text.

Text-mode rendering is already protected: `src/util/sanitize-text.ts` strips bare C0, DEL, and C1 controls (the `\x00-\x1f` and `\x7f-\x9f` ranges) at the render edge, and the render-edge sanitization work shipped in PR #86 covered every text-mode print site. The `--json` branch was deliberately left byte-faithful and got no equivalent protection. The gap was noted in PR #86's `research-renderer-sanitization.md` and logged as this issue (severity minor: JSON mode targets machine consumers, but humans routinely eyeball `--json` output in a terminal, and piping it through tools like `jq` or `cat` replays the raw C1 bytes).

Repro shape: seed an issue whose title contains a raw `\x9b` byte (the existing hostile-content tests already do exactly this, e.g. `HOSTILE_ISSUE` in `tests/cli-issue-backlog.test.ts:472-480`), then run `metta --json issues show <slug>`. The emitted JSON text contains the raw `0x9b` byte.

### The byte-faithfulness tension (addressed explicitly)

Recently shipped changes added tests asserting `--json` output carries stored strings "byte-faithfully": `tests/cli-issue-backlog.test.ts` ("issues show --json carries title and description byte-faithfully"), `tests/cli-gaps.test.ts` ("--json carries title and action byte-faithfully"), `tests/cli-roadmap.test.ts` (promote handoff), `tests/cli-status.test.ts` (sentinel justification). **The invariant those tests protect is parsed-value fidelity, not raw-byte JSON text encoding.** Every one of them calls `JSON.parse(stdout)` and compares the resulting string values. Escaping the DEL/C1 range as JSON `\uXXXX` escape sequences preserves that invariant exactly: parsing the emitted JSON yields byte-identical string values; only the JSON *encoding* of those code points changes (which the JSON grammar explicitly permits). The existing byte-faithful tests MUST continue to pass unchanged; they are the regression guard proving this fix does not reintroduce the data-mutation failure mode that render-edge sanitization was designed to avoid. Any future test asserting that raw C1 bytes appear in the emitted JSON *text* (none exist today in `tests/`) would be asserting at the wrong level and must assert parsed-value equality instead.

## Proposal

Escape U+007F through U+009F (DEL + C1) at the JSON emission edge, without touching stored data:

1. Add a small pure helper (e.g. `escapeJsonControls(jsonText: string): string`) that replaces every code unit in the U+007F..U+009F range in already-serialized JSON text with its `\uXXXX` escape. Post-stringify replacement is safe: in `JSON.stringify` output these code points can only occur inside string literals (structural characters and inserted whitespace are all ASCII below 0x7F), so a global replace cannot corrupt JSON structure.
2. Apply it in `outputJson` (`src/cli/helpers.ts`), the single stdout edge for all `--json` command output, including the `handleError` JSON error envelopes.
3. Audit and cover the other CLI stdout JSON emission points found in `src/cli/`: `src/cli/commands/config.ts:58` (`config get` printing object values as JSON) and `src/cli/commands/tasks-renderer.ts:82` (tasks `--json` rendering). Route them through the same helper if their output reaches stdout with user-influenced strings.
4. Tests: (a) hostile-content fixture with U+009B and U+007F in a stored title, asserting the raw bytes never appear in `--json` stdout and that `JSON.parse` round-trips to the exact stored string; (b) unit tests for the escape helper (boundary code points U+007E/U+007F/U+009F/U+00A0, multi-byte UTF-8 neighbors left intact, idempotency on already-escaped text, empty string); (c) the four existing byte-faithful test suites pass unmodified.

## Impact

- `src/cli/helpers.ts`: `outputJson` gains the escape step; the behavior change is limited to the textual encoding of U+007F..U+009F in emitted JSON
- Possibly `src/cli/commands/config.ts` and `src/cli/commands/tasks-renderer.ts`: same edge treatment if their stdout carries user-influenced strings
- New helper module + matching test file (near 1:1 test-to-source ratio), plus hostile-content test additions in the CLI test suites
- Machine consumers that `JSON.parse` the output see **zero** change; parsed values are byte-identical
- Consumers doing raw byte comparison of the JSON text will see a six-character `\uXXXX` escape (e.g. backslash-u009b) instead of a raw `0x9b` byte for affected code points: an encoding-level change that is legal JSON and the entire point of the fix
- No changes to `.metta/` state files, `spec/` stores, schemas, or any stored data; no text-mode rendering changes

## Out of Scope

- Mutating stored data or sanitizing at write time: render/emission-edge-only treatment is a deliberate, established invariant of this codebase (PR #86)
- Text-mode rendering: already handled by `src/util/sanitize-text.ts` and the shipped render-edge sanitization work
- File-writing `JSON.stringify` sites (`src/cli/commands/install.ts` writing `.claude/settings.json`): settings content is metta-controlled, not user-influenced title/description data, and files are not terminal output
- Escaping other exotic code points (U+2028/U+2029 line separators, bidi controls, zero-width characters): not control characters honored by terminals; a separate concern if ever needed
- Non-CLI serialization (YAML state writes, spec markdown): no terminal/machine-consumer JSON edge involved
