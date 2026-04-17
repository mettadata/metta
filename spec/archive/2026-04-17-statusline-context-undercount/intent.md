# statusline-context-undercount

## Problem

The statusline shipped in `custom-claude-statusline-conte` shows `0%` during active sessions that `/context` reports as 14% full. Root cause: `findLatestAssistantUsage` reads only `message.usage.input_tokens`, which in Claude Code's caching model is just the incremental (non-cached) portion of the latest turn — typically a few hundred tokens after the cache warms. Actual context fill lives in `cache_read_input_tokens + cache_creation_input_tokens`.

Design doc ADR-2 explicitly acknowledged this undercount as a deferred limitation; live usage confirms it makes the context % effectively useless.

## Proposal

Sum all three token fields — `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` — when computing the context utilization. Treat missing cache fields as 0 so legacy/minimal payloads still work.

## Impact

- `src/templates/statusline/statusline.mjs` — `findLatestAssistantUsage` returns the cache-inclusive total.
- `tests/statusline-transcript-parser.test.ts` — add two cases: cache-inclusive sum, missing cache fields treated as zero.

## Out of Scope

- Any other statusline behavior (format, colors, install).
- Historical accuracy for pre-cache turns — the new formula degrades gracefully when cache fields are absent.
