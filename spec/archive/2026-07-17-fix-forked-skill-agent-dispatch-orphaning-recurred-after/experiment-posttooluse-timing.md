# Experiment: PostToolUse timing for backgrounded Agent dispatches

**Question** (research-prescribed, undocumented in the hooks reference — confirmed absent by
WebFetch of code.claude.com/docs/en/hooks on 2026-07-17): does `PostToolUse` for a backgrounded
`Agent` dispatch fire at dispatch time or at child completion? The deferred SubagentStop-ledger
design requires completion-time firing (PreToolUse writes a ledger entry, PostToolUse clears it,
SubagentStop consults it).

## Method

A log-only probe hook (`posttooluse-probe.mjs`, session scratchpad) was registered as a
`PostToolUse` / `matcher: Agent` hook via `.claude/settings.local.json` in the live session (the
hooks doc confirms settings-file hook edits are picked up by a file watcher mid-session). Two
background Agent dispatches were driven from the main session with recorded dispatch timestamps and
known run durations; the probe logged timestamp, event name, and payload shape for every firing.
The probe registration was removed after the experiment.

## Observations

| | Dispatch (UTC) | PostToolUse fired | Child ran | Completion-time event? |
|---|---|---|---|---|
| Probe 1 (13.9s child) | 03:00:32.900 | 03:00:41.878 (+9.0s) | ~03:00:46 | none (log checked >80s past completion) |
| Probe 2 (42.9s child) | 03:01:59.880 | 03:02:08.891 (+9.0s) | ~03:02:52 | none (log checked past completion) |

Both firings carried `has_tool_response: true` — the "response" is the dispatch acknowledgment
("Async agent launched"), not the child's result. Exactly one event per dispatch; zero events at
either child's completion.

## Verdict: NOT GREEN

`PostToolUse` for a backgrounded `Agent` dispatch fires at **dispatch acknowledgment** (+~9s in
both runs), never at child completion. The SubagentStop-ledger design is therefore not viable as
specified: the ledger entry would be cleared at dispatch time, making the SubagentStop consultation
a permanent no-op. Per tasks.md 3.1's green-gate, **no ledger follow-up issue is logged**.

## Consequence

The shipped primary mechanism — `PreToolUse` rejection of `run_in_background === true` Agent
dispatches from fork context (metta-guard-agent-dispatch.mjs, batch 1) — stands as the only
mechanically viable enforcement of the Fork Dispatch Completion Guarantee, with the codified
recovery protocol (batch 2) as the residual backstop. If a future harness version adds a
completion-time event (e.g. the `TaskCompleted` event research noted), the ledger can be revisited.
