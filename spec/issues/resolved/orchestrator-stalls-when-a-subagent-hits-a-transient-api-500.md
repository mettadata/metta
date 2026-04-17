# orchestrator stalls when a subagent hits a transient API 500. During feature 9 of trello-clone dogfood, an Anthropic API 500 killed an in-flight metta-executor subagent and the orchestrator paused indefinitely until nudged with 'continue the workflow'. Fix: detect transient API/network failures (5xx, request_id) and retry the subagent with backoff (e.g. 3 attempts, 5s/15s/45s) before escalating to user.

**Captured**: 2026-04-15
**Status**: logged
**Severity**: major

orchestrator stalls when a subagent hits a transient API 500. During feature 9 of trello-clone dogfood, an Anthropic API 500 killed an in-flight metta-executor subagent and the orchestrator paused indefinitely until nudged with 'continue the workflow'. Fix: detect transient API/network failures (5xx, request_id) and retry the subagent with backoff (e.g. 3 attempts, 5s/15s/45s) before escalating to user.
