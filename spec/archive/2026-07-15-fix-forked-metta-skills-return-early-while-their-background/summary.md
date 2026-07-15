# Implementation Summary: fix-forked-metta-skills-return-early-while-their-background

## What changed

Forked metta skills can no longer silently abandon in-flight work, and stale finalize locks self-heal instead of requiring manual surgery.

- **Synchronous-completion contract** (`.claude/agents/metta-skill-host.md` + template mirror): new hard rule — forks must not use background Bash, must not end their turn with a dispatched Agent pending, and their final message reports only completed/failed outcomes with evidence. `metta-ship`'s finalize step now states explicitly that the call blocks.
- **Mechanical enforcement** (`.claude/hooks/metta-guard-bash.mjs` + mirror): Bash calls with `run_in_background: true` from `metta-*` agent types are rejected with exit 2 and an audit-log entry (`background-bash-from-fork`), before the tokenize/classify pipeline. Non-metta callers unaffected.
- **Finalize lock hardening** (`src/finalize/finalize-lock.ts`): `FinalizeLockError` now recommends re-running `metta finalize` (dead-pid locks are reclaimed automatically) instead of manual lock deletion; new `checkFinalizeLockStale()` adds an mtime-based 60s staleness fallback for the EPERM-ambiguous pid-probe branch (pid recycling), preserving the existing dead-pid reclaim.
- **Proactive surfacing** (`src/cli/commands/status.ts`, `next.ts`): both commands report a detected stale finalize lock ("safe to retry") in human and `--json` output (`finalize_lock_stale`, `finalize_lock_reason`), so orchestrators see the condition in routine status checks rather than as a thrown error.

## Requirement coverage

All 4 finalize-ship delta requirements: Finalize Lock Contention Error Message, Finalize Lock Staleness Fallback Via Mtime, Stale Finalize Lock Surfaced In Status, Stale Finalize Lock Surfaced In Next Routing. Stories US-1/US-2 (contract + hook) covered by acceptance criteria and hook tests — no capability spec owns the orchestration contract yet (single-capability delta limitation, noted in spec.md).

## Verification

Full suite 1074/1074 (80 files) including 30+ new tests; tsc, lint, build clean; template byte-identity verified for all three mirrored asset pairs; `node --check` on both hook copies during editing.

## Implementation commits

- `69868712c` fix: finalize-lock mtime staleness fallback and retry-oriented error message
- `7b21f4ee1` test: finalize-lock staleness and error message coverage
- `804f4859d` feat: surface stale finalize lock in metta status
- `4a5343181` feat: surface stale finalize lock in metta next
- `93dd29646` feat: synchronous-completion contract for forked skills
- `eb1cc8509` feat: guard-bash rejects background Bash from metta agents
- `c6e35f517` test: hook coverage for background Bash rejection

## Notes

- Research found the offending "I'll wait for it" narration was model-improvised, not template text — the contract rule is preventive; runtime compliance depends on the fork honoring it. Turn-level (Stop-hook) enforcement is explicitly deferred to a follow-up if Agent-dispatch orphaning recurs.
- Advisory constitution check (subagent path): zero violations.
