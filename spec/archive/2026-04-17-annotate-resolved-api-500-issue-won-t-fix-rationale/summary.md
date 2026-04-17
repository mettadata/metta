# Summary: annotate-resolved-api-500-issue-won-t-fix-rationale

Added `Status: closed (won't-fix)` + `Resolution:` note to `spec/issues/resolved/orchestrator-stalls-when-a-subagent-hits-a-transient-api-500.md`. Retry-on-5xx is an AI orchestrator concern (Claude Code); metta is a passive state machine and can't wrap subagent spawns the orchestrator initiates.
