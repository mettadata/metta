# Summary: statusline-context-undercount

## What changed

`findLatestAssistantUsage` in `src/templates/statusline/statusline.mjs` now returns `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` (treating missing cache fields as 0). This fixes the 0% display bug during cached sessions.

## Files modified

- `src/templates/statusline/statusline.mjs` — `findLatestAssistantUsage` sums all three token fields
- `tests/statusline-transcript-parser.test.ts` — 2 new tests (cache-inclusive sum, missing fields → 0)

## Verification

- All 14 transcript-parser tests pass
- Backward compatible: existing tests using only `input_tokens` still pass
