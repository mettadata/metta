# Summary: custom-claude-statusline-conte

## What changed

Added a Claude Code statusline that surfaces two live signals after every turn:

1. **Current metta workflow artifact** — parsed from `metta status --json` (e.g. `intent`, `spec`, `implementation`, or `idle`)
2. **Context window utilization %** — derived from the session's JSONL transcript (`input_tokens / window_size`)

Active change branches get a deterministic ANSI color based on the change slug.

## Files added

| File | Purpose |
|------|---------|
| `src/templates/statusline/statusline.mjs` | Statusline script — reads stdin JSON, tail-reads transcript, shells out to metta status, prints formatted line |
| `tests/statusline-resolve-context-window.test.ts` | 6 tests for context window resolution |
| `tests/statusline-transcript-parser.test.ts` | 12 tests for transcript reading and usage extraction |
| `tests/statusline-compute-percent.test.ts` | 6 tests for percentage calculation |
| `tests/statusline-format.test.ts` | 9 tests for output formatting and color picking |
| `tests/statusline-install.test.ts` | 6 tests for install helper |

## Files modified

| File | Change |
|------|--------|
| `src/cli/commands/install.ts` | Added `installMettaStatusline(root)` helper + call site + JSON/human output |
| `package.json` | Extended `copy-templates` to include `src/templates/statusline/` |

## Verification

- 524 tests pass (42 files), 0 failures
- `tsc --noEmit` clean
- `npm run build` produces `dist/templates/statusline/statusline.mjs`
- Manual test: `node src/templates/statusline/statusline.mjs < /dev/null` → `[metta: tasks]` with ANSI color, exit 0

## Output format

```
[metta: implementation] 43%    # active change, context available
[metta: idle]                   # no active change
[metta: unknown]                # unrecoverable error
```
