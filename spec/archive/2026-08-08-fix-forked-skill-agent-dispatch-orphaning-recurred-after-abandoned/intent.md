# fix-forked-skill-agent-dispatch-orphaning-recurred-after

## Problem

The issue `forked-skill-agent-dispatch-orphaning-recurred-after-the` (captured 2026-07-15, severity minor) reported that a `/metta-fix-issues` fork ended its turn with a dispatched Agent still pending — the exact pattern the synchronous-completion contract in `.claude/agents/metta-skill-host.md` forbids — proving that contract prose alone cannot prevent Agent-dispatch orphaning and that mechanical enforcement was needed.

That enforcement has already shipped. The archived change `spec/archive/2026-07-17-fix-forked-skill-agent-dispatch-orphaning-recurred-after/` (same slug as this change) implemented and verified:

- **PreToolUse Agent-dispatch guard** — `.claude/hooks/metta-guard-agent-dispatch.mjs`, wired via `metta-skill-host.md` frontmatter, rejects (exit 2, audit-logged) any Agent dispatch with `run_in_background: true` from the fork context; unrecognized field shapes fail open with an audit record.
- **Residual orphaning recovery protocol** — codified in `metta-skill-host.md` and pointed to from all six fork skills: in-progress narration in a fork result is a failed non-terminal result; wait for/attach to the orphan, never duplicate.
- **Candidate evaluation** — the issue's candidate 1 (Stop/SubagentStop hook with pending-children check) was investigated by live experiment (`experiment-posttooluse-timing.md`): PostToolUse fires at dispatch acknowledgment, never at child completion, so the pending-children ledger premise is broken. Forced-synchronous rejection (candidate 2) is the only viable mechanical control and is what shipped; candidate 3 (recovery protocol) shipped as the codified floor beneath it.

The remaining problem is bookkeeping and confirmation, not engineering: the issue file still sits in `spec/issues/` with `Status: logged`, so every issue listing, backlog review, and `/metta-fix-issues` routing decision treats a fixed defect as open. That is what caused this very change to be spun up — an orchestrator routed a fix cycle at an already-resolved issue. Affected parties: anyone (human or AI orchestrator) triaging `spec/issues/`, and any future session that burns a change cycle re-discovering that the fix exists.

## Proposal

Close the loop on the shipped fix, scoped to verification and issue resolution:

1. **Verify the shipped enforcement is intact and live on this branch.** Confirm `.claude/hooks/metta-guard-agent-dispatch.mjs` is present and byte-identical to its template pair, the `hooks:` frontmatter wiring in `.claude/agents/metta-skill-host.md` is in place, the recovery-protocol section and the six fork-skill pointers are present, and the guard's test coverage still passes. Confirm no recurrence evidence since 2026-07-17 (no `rejected-async-agent-dispatch` or `fail-open-unrecognized-shape` entries in `.metta/logs/guard-bypass.log` indicating an unhandled failure, and no newer orphaning issues logged).
2. **Resolve the issue.** Move `spec/issues/forked-skill-agent-dispatch-orphaning-recurred-after-the.md` to `spec/issues/resolved/` with a resolution record: fixed by the archived 2026-07-17 change (commits `c2208978f`, `78b2a3b14`, `aa61a48c5`), enforcement mechanism, and the SubagentStop dead-end finding so the turn-level-hook idea is not re-litigated from the issue text alone.
3. **Contingency:** if step 1 finds the enforcement regressed, missing, or demonstrably insufficient (e.g. post-2026-07-17 recurrence evidence surfaces), stop and escalate — this change's scope then expands only after the gap is confirmed and recorded, rather than assuming it.

Desired outcome: `spec/issues/` reflects reality — the Agent-dispatch orphaning defect is closed, with a traceable pointer from the resolved issue to the shipped mechanism and its verification evidence.

## Impact

- `spec/issues/forked-skill-agent-dispatch-orphaning-recurred-after-the.md` — moved to `spec/issues/resolved/` with resolution metadata appended. Issue listings and fix-issue routing stop offering it as open work.
- No source, hook, skill, or agent files change. `.claude/hooks/metta-guard-agent-dispatch.mjs`, `metta-skill-host.md`, the six fork skills, and the orchestration-guard spec are read for verification only.
- No behavior change for orchestrator sessions: the enforcement they rely on is already live; this change only confirms and documents it.

## Out of Scope

- Re-implementing or redesigning the Agent-dispatch guard, its audit logging, or its audited fail-open semantics for unrecognized `run_in_background` shapes — all shipped and spec-covered by the 2026-07-17 change.
- Reviving the Stop/SubagentStop turn-level enforcement idea (issue candidate 1). The archived change's live experiment proved the pending-children ledger premise broken in current Claude Code hook semantics; revisiting it requires new evidence that those semantics changed, which would be a new issue, not this change.
- Strengthening the orchestrator-side recovery protocol (issue candidate 3) beyond what shipped — e.g. mechanical detection of in-progress narration in fork summaries.
- Any change to `metta-guard-bash.mjs`, the two-tier trust model, or the session-token mechanism.
- Fixing whatever routing gap allowed a completed-and-archived change slug to be re-proposed against a stale-open issue. If the verification in this change suggests a systemic cause (e.g. `/metta-fix-issues` or `metta complete` failing to resolve the source issue on ship), that gets logged as its own issue.
