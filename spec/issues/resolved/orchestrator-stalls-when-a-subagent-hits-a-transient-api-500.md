# orchestrator stalls when a subagent hits a transient API 500. During feature 9 of trello-clone dogfood, an Anthropic API 500 killed an in-flight metta-executor subagent and the orchestrator paused indefinitely until nudged with 'continue the workflow'. Fix: detect transient API/network failures (5xx, request_id) and retry the subagent with backoff (e.g. 3 attempts, 5s/15s/45s) before escalating to user.

**Captured**: 2026-04-15
**Status**: closed (won't-fix)
**Severity**: major
**Resolution**: 2026-04-17 — closed as out of scope. The "orchestrator" here is Claude Code (or whichever AI tool is driving metta via skills). Retry-on-5xx belongs in the AI tool's API client / session-loop layer, not in metta. Metta is a passive state machine invoked by the orchestrator; it can't wrap or retry subagent spawns that the orchestrator initiates. If the underlying AI tool adds transient-retry handling, this concern disappears automatically.

orchestrator stalls when a subagent hits a transient API 500. During feature 9 of trello-clone dogfood, an Anthropic API 500 killed an in-flight metta-executor subagent and the orchestrator paused indefinitely until nudged with 'continue the workflow'. Fix: detect transient API/network failures (5xx, request_id) and retry the subagent with backoff (e.g. 3 attempts, 5s/15s/45s) before escalating to user.
