# fix-forked-metta-skills-return-early-while-their-background

## Problem

Forked metta skills (`context: fork`, hosted by `metta-skill-host`) can end their turn while background work they launched — a `run_in_background` Bash call, a dispatched Agent, or a long-running CLI operation the host merely narrated as running "in the background" — is still in flight. Emitting the final summary message ends the subagent's turn immediately; the framework returns that text to the orchestrator as the fork's result regardless of whether the fork's children have finished. The fork's background children are then orphaned: nothing in the fork's contract or the surrounding hook infrastructure requires the fork to block until launched work completes, and nothing detects or recovers from a fork that returned early.

This was observed twice in one session (2026-07-13/14):

1. **`/metta-propose` fork**: returned "The proposer is authoring intent.md in the background. I'll wait for it to complete," but had already exited. The change record existed with `intent.md` unwritten. The orchestrator, seeing an incomplete change, resumed via `metta-next` and spawned a duplicate proposer — which raced the orphaned original proposer (still running from the exited fork) and had to be killed by hand.
2. **`/metta-ship` fork**: returned "The finalize dry-run is running in the background. I'll wait for it to complete," but no finalize process was running afterward. A stale lock file `.metta/locks/finalize-<change>.lock` remained, holding a dead pid (2936177). The orchestrator had to manually verify the pid was dead, delete the lock, and drive finalize itself.

Affected parties: any AI orchestrator session driving metta through the `/metta-*` skills (the framework's primary supported usage pattern per this project's own `CLAUDE.md`). The failure mode is silent — the fork reports success/in-progress language while actually having abandoned the work — so it defeats the orchestrator's ability to trust a fork's completion report, forcing manual pid inspection and lock surgery instead of a clean retry.

## Proposal

Close the gap with a combination of a contract fix, mechanical enforcement, and lock-lifecycle hardening, so that a forked skill either finishes its launched work before ending its turn, or the orchestrator can safely and automatically recover when it doesn't:

1. **Synchronous-completion contract.** Add an explicit, non-negotiable rule to `.claude/agents/metta-skill-host.md` and to every `context: fork` skill under `.claude/skills/` (`metta-issue`, `metta-fix-issues`, `metta-propose`, `metta-quick`, `metta-auto`, `metta-ship`): the fork MUST NOT invoke `Bash` with `run_in_background: true`, MUST NOT dispatch an `Agent` call and end its turn before that agent returns, and MUST NOT emit a final summary that describes work as still "in progress" or "running in the background." Any tool call or subagent the fork launches MUST complete (or definitively fail) before the fork's final message is emitted. Replace the two offending phrasings that caused this issue ("I'll wait for it to complete" while not actually waiting) with a rule that the fork's last message reports only completed, verified outcomes.

2. **Mechanical enforcement via hooks.** Extend `.claude/hooks/metta-guard-bash.mjs` (PreToolUse) to reject any `Bash` call with `run_in_background: true` when `event.agent_type` starts with `metta-` (i.e., when the caller is a forked skill host or one of its subagents), with a clear stderr message pointing back to the synchronous-completion rule. This makes rule 1 mechanically enforced for the Bash-background case rather than advisory-only, mirroring the existing caller-identity pattern already used for `SKILL_ENFORCED_SUBCOMMANDS`.

3. **Finalize lock lifecycle hardening.** Fix the secondary failure surfaced by the ship case in `src/finalize/finalize-lock.ts` and its callers:
   - Reword `FinalizeLockError`'s message to recommend re-running `metta finalize` (which already reclaims a dead-pid lock per the existing `isPidAlive` check at acquisition) instead of telling the caller to manually delete the lock file.
   - Add a time-based staleness fallback (an mtime/heartbeat check, consistent with the 60s stale-lock convention already used by the state store) to cover pid-recycling and `EPERM` edge cases where `isPidAlive` alone cannot distinguish a live unrelated process from a dead owner.
   - Surface dead-pid / stale-lock detection from `metta status` and `metta next` (`src/cli/commands/status.ts`, `src/cli/commands/next.ts`) so an orchestrator sees "stale finalize lock detected, safe to retry" in routine status output instead of only encountering it as a thrown error mid-finalize.

## Impact

- `.claude/agents/metta-skill-host.md` — new hard rule section governing background dispatch and turn-ending conditions.
- Every `context: fork` `SKILL.md` under `.claude/skills/` (`metta-issue`, `metta-fix-issues`, `metta-propose`, `metta-quick`, `metta-auto`, `metta-ship`) — audited and corrected to remove any "I'll wait for it to complete" / background-narration language, and to make any step that currently reads as backgroundable (e.g. `/metta-ship`'s finalize dry-run) explicit about blocking until the CLI call returns.
- `.claude/hooks/metta-guard-bash.mjs` — new rejection branch for background Bash dispatch by `metta-*` agent types; existing `SKILL_ENFORCED_SUBCOMMANDS` and audit-log behavior are unaffected.
- `src/finalize/finalize-lock.ts` — `FinalizeLockError` message text changes; new staleness-fallback logic added alongside the existing `isPidAlive` reclaim path (existing dead-pid reclaim behavior is preserved, not replaced).
- `src/cli/commands/status.ts`, `src/cli/commands/next.ts` — new lock-staleness reporting; existing status/next output is additive, not restructured.
- Orchestrator sessions driving `/metta-propose` and `/metta-ship` (and by extension every other `context: fork` skill) gain a guarantee they did not have before: a returned fork summary reflects completed work, and if the guarantee is ever violated by a lock specifically, the orchestrator gets a self-healing retry path instead of manual pid/lock surgery.
- No change to non-forked (host-invoked directly) skill behavior, to the `metta-guard-edit.mjs` hook, or to the `SKILL_ENFORCED_SUBCOMMANDS` allow/block classification logic in `metta-guard-bash.mjs`.

## Out of Scope

- A general-purpose `Stop`/`SubagentStop` hook that blocks *any* subagent (not just forked skill hosts) from ending its turn while background tasks are registered. The issue's candidate solution 2 raised this, but `SubagentStop` hook semantics are not yet reliably available across supported Claude Code versions per this project's constraints; the Bash-level `run_in_background` block in the PreToolUse hook covers the concrete failure modes observed and is the mechanism this change ships. A follow-up issue may revisit turn-level enforcement if background-Agent dispatch (rather than background-Bash) turns out to cause the same failure.
- Detecting or recovering from orphaned background *Agent* dispatches (as opposed to background *Bash* calls) mechanically. The contract rule in item 1 forbids ending a turn with a pending dispatched agent, but no hook-level enforcement is added for the Agent-dispatch case in this change — only the Bash `run_in_background` flag is mechanically blocked.
- Rewriting `acquireFinalizeLock`'s `process.once('exit', ...)` cleanup strategy into something more robust than exit-hook-based (e.g. a heartbeat-refreshing daemon or OS-level lock). The staleness fallback in item 3 is a detection/recovery mechanism layered on top of the existing exit-hook cleanup, not a replacement for it.
- Any change to the `state-store`'s own existing 60s stale-lock convention; this change reuses that convention's approach for finalize locks but does not modify the state-store implementation itself.
- Retroactively cleaning up any currently-existing stale lock files or orphaned processes on disk; this change fixes the mechanism going forward.
