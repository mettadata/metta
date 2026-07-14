# fix-metta-complete-prints-non-json-output-block-twice

## Problem

`metta complete` and `metta update` have three small, independent correctness bugs that degrade the CLI's day-to-day usability for both human developers and AI orchestrators driving metta via `METTA_SKILL=1`:

1. **Duplicate completion banner in non-JSON mode.** `src/cli/commands/complete.ts` unconditionally writes the completion banner (and, when applicable, the "Next:" banner or "All artifacts complete!" line) to `stderr`, with an inline comment claiming this is needed "even in `--json` mode." In the non-JSON branch, the identical banner and "Next:" line are then written a second time to `stdout` via `console.log`. When stdout and stderr share a TTY — the common case for a developer or agent running `metta complete` interactively — the same block of output appears twice back-to-back, which is confusing and makes terminal/log output harder to read and parse. The stderr copy is genuinely needed only in `--json` mode, where stdout is reserved exclusively for the JSON payload and the banner has no other channel.
2. **Stories parser rejects the grammatically correct `**As an**` phrasing.** `src/specs/stories-parser.ts` defines `FIELD_PREFIXES` with a single literal prefix `'**As a**'` matched via `line.startsWith(prefix)`. A story whose "as a" line reads `**As an** AI orchestrator` (correct English before a vowel sound) never matches, so the `asA` field is never populated and `flushStory` throws `Story US-N is missing required field: asA`. This causes `metta complete stories` to hard-fail on otherwise well-formed, human-written stories files for no real reason — the failure is a parser gap, not a content defect.
3. **`metta update --check` reports a hardcoded, stale version.** `src/cli/commands/update.ts` hardcodes `const current = '0.1.0'` instead of reading the installed package version. Since the framework has already shipped past 0.1.0, every `metta update --check` invocation reports an incorrect `current` value and an incorrect `update_available` computation, making the command actively misleading rather than merely incomplete.

Affected users: any developer or AI orchestrator running `metta complete` in non-JSON mode (double banner), any author writing a `stories.md` using the "as an" article form (parser rejection), and anyone relying on `metta update --check` to know whether they're current (wrong version reported).

## Proposal

Fix all three bugs in place, each scoped to its existing file with no new files or new commands:

1. In `src/cli/commands/complete.ts`, gate the `stderr` banner writes (both the pending-artifacts branch around line 526-531 and the all-complete branch around line 551-552) so they only execute when `json` is `true`. The non-JSON branch's existing `console.log` output (banner, "Next:" line, "Run:" line, or the finalize hint) remains the single human-facing copy of the output, written once to stdout.
2. In `src/specs/stories-parser.ts`, make the `asA` field prefix match both `**As a**` and `**As an**`. This can be done by adding a second `FIELD_PREFIXES` entry for `'**As an**'` (checked before or alongside the existing entry so both are recognized) or by switching the `asA` match to a regex (`/^\*\*As an?\*\*/`) with corresponding updates to `stripFieldPrefix`'s prefix-length handling. Add parser test coverage for a story using `**As an** AI orchestrator` to lock in the fix.
3. In `src/cli/commands/update.ts`, replace the hardcoded `current = '0.1.0'` literal with the version read at runtime from the installed package's `package.json` (consistent with how the rest of the CLI already resolves its own version, if such a mechanism exists elsewhere in the codebase; otherwise via a direct `package.json` read/import).

## Impact

- `metta complete <artifact> [--change <name>]` in non-JSON mode: output changes from two copies of the completion/next-step banner to exactly one. JSON-mode (`--json`) output and its stdout payload are unchanged; the stderr banner is retained for JSON-mode callers that still want a human-readable status line alongside the machine-readable stdout payload.
- `metta complete stories`: stories files using `**As an**` now parse successfully instead of failing with a missing-field error. Files already using `**As a**` continue to parse exactly as before — no regression to the existing accepted form.
- `metta update --check`: `current` in both the console output and the `--json` payload now reflects the actual installed version instead of a fixed `0.1.0`, correcting the `update_available` comparison.
- No changes to artifact schemas, state file formats, workflow graphs, or any other CLI command surface.

## Out of Scope

- Any other output-formatting or banner-styling changes to `metta complete` beyond removing the duplicate non-JSON print (e.g., no redesign of banner content, color scheme, or JSON payload shape).
- Broader stories-parser grammar handling beyond the `a`/`an` article variants (e.g., no general fuzzy-matching of field prefixes, no support for reordering the As a/I want to/So that fields, no changes to other `FIELD_PREFIXES` entries).
- Implementing a full `metta update` self-update mechanism or changing how `--check` resolves the *latest* version (`npm view`) — only the hardcoded `current` value is in scope.
- Any other bugs discovered outside these three during implementation; new findings get logged as separate issues rather than folded into this change.
