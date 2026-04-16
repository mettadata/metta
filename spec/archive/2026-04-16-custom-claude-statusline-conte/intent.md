# custom-claude-statusline-conte

## Problem

Developers running long, nested Claude Code sessions — like the trello-clone dogfood — face two compounding pain points that erode focus and efficiency.

First, context window blindness: Claude Code does not surface how much of the model's context window is consumed during an active session. When working on complex features with deep file trees and long conversation threads, the session can quietly approach the context limit. The first signal is often a degraded response or a hard failure, not a visible warning. Users have no way to pace themselves or decide when to start a fresh session.

Second, invisible metta workflow state: during nested sessions the metta change lifecycle (intent → stories → spec → research → design → tasks → implementation → verification) advances without any ambient indicator. The developer has to context-switch out of their coding flow to run `metta status`, or they lose track of which artifact is in progress and what the current change slug even is. This cognitive overhead is especially pronounced when Claude Code orchestrates sub-agents in parallel and the outer session's change context becomes ambiguous.

Both problems share a root cause: information that exists in the environment (stdin payload, JSONL transcript, `metta status --json` output) is never aggregated and surfaced where the developer's eyes already are — the Claude Code statusline.

## Proposal

Add a statusline script at `src/templates/statusline/statusline.mjs` that Claude Code invokes after each turn. The script receives a JSON payload on stdin (the standard Claude Code statusline contract), reads two signals, and emits a single formatted string to stdout.

**Signal 1 — context utilization %.**
The stdin payload contains a `transcript_path` field pointing to the session's JSONL file. The script reads that file, finds the most recent assistant turn, sums `usage.input_tokens` from its `message.usage` block, and divides by the context window size. Context window size is inferred from the `model` field in the stdin payload: 1 000 000 tokens when the model id contains `[1m]`, 200 000 tokens otherwise.

**Signal 2 — current metta workflow artifact.**
The script shells out to `metta status --json` with a 5-second timeout. It reads the `current_artifact` field from the response to determine which lifecycle stage is active (`intent`, `stories`, `spec`, `research`, `design`, `tasks`, `implementation`, or `verification`). When no active change exists the label is `idle`.

**Output format.**
`[metta: <artifact>] <ctx>%`

Examples:
- `[metta: implementation] 43%`
- `[metta: idle]` (context % omitted when transcript is unavailable)
- `[metta: unknown]` (on any unrecoverable error)

When a change branch is active the artifact label is ANSI-colorized. The color is deterministic: the change slug is hashed to one of eight standard ANSI foreground colors, so the same change always shows the same color across sessions.

**Failure contract.**
Any error — malformed stdin, unreadable transcript, `metta` binary missing, non-zero exit from `metta status`, JSON parse failure — causes the script to print `[metta: unknown]` and exit 0. The statusline must never emit a non-zero exit or unhandled exception that could disrupt the Claude Code UI.

**Installation.**
`metta install` gains a new step: it copies `dist/templates/statusline/statusline.mjs` to `.claude/statusline/statusline.mjs` (mode 0o755) and idempotently merges a `statusLine` key into `.claude/settings.json`, mirroring the existing metta-guard hook merge pattern. The registered command is the absolute path to `.claude/statusline/statusline.mjs`.

**Source layout.**
`src/templates/statusline/statusline.mjs` — template copied to `dist/` at build time, following the same convention as `src/templates/hooks/metta-guard-edit.mjs`.

**Tests.**
Vitest unit tests cover the four pure helper functions: transcript parser, context % calculator, output formatter, and color picker. No runtime integration tests.

## Impact

- `metta install` gains one new step and its output messaging updates to reflect statusline registration.
- `.claude/settings.json` schema gains a `statusLine` key alongside the existing `hooks` key; the install merge logic must handle both absent and pre-populated `statusLine` values without clobbering user customizations.
- A new directory `src/templates/statusline/` is created; the build pipeline's template-copy step picks it up automatically if it already globs `src/templates/**/*.mjs`.
- The `dist/` tree grows by one file (`dist/templates/statusline/statusline.mjs`); no packaging changes needed.
- The install-side logic in `src/commands/install.ts` (or equivalent) changes to register the statusline in addition to hooks.
- Four new Vitest test files cover the helper functions introduced by this feature.
- No changes to existing specs, schemas, or state files.

## Out of Scope

- Support for editors or AI tools other than Claude Code (Cursor, Copilot Chat, Zed, etc.) — the statusline contract is Claude Code-specific.
- Hot-reloading statusline configuration changes without re-running `metta install`.
- Remote telemetry or logging of context utilization data anywhere outside the local machine.
- Multi-pane or multi-column statusline layouts beyond the single `[metta: <artifact>] <ctx>%` string.
- Surfacing token counts for individual tool calls or sub-agent turns separately from the aggregate session usage.
- Modifying the statusline refresh cadence — that is controlled by Claude Code, not by this script.
- Interactive configuration of statusline display options via `metta config`.
- Uninstall / removal of the statusline registration from `.claude/settings.json` (can be addressed in a follow-on change).
