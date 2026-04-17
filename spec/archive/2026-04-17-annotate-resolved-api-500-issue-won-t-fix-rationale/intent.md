# annotate-resolved-api-500-issue-won-t-fix-rationale

## Problem

The API-500 issue was archived via `metta fix-issue --remove-issue`, but the archived file still has `Status: logged` and no resolution rationale. Readers can't distinguish "fixed" from "closed as won't-fix".

## Proposal

Append a `Status: closed (won't-fix)` marker and a `Resolution:` line to the archived file explaining that retry-on-5xx belongs in the AI orchestrator's API-client layer (Claude Code), not in metta. Metta is a passive state machine invoked by the orchestrator; it can't wrap subagent spawns that the orchestrator initiates.

## Impact

- `spec/issues/resolved/orchestrator-stalls-when-a-subagent-hits-a-transient-api-500.md` — 2 status/resolution lines added

## Out of Scope

- Adding `--reason` to `metta fix-issue --remove-issue` (separate framework improvement — worth filing if this two-step dance keeps recurring)
- Other resolved issues
