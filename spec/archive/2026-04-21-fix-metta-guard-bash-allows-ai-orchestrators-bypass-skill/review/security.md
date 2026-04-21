# Security Review

**Verdict**: PASS

## Summary

Round 2 closes the two spec-compliance deltas flagged in round 1 without weakening the security posture:

1. `spec.md` (commit `1380e8cf3`) was rewritten to state the enforced set `exactly` as `{issue, fix-issue, propose, quick, auto, ship}` and to explicitly document that `complete` and `finalize` are orchestrator-called subcommands kept in `BLOCKED_SUBCOMMANDS` with today's inline-bypass behavior preserved. The audit-log schema in spec.md now matches the implementation (`agent_type`, `skill_bypass` — the code-level fields — rather than the earlier `skill_hint`).
2. The hook stderr was unified (commit `1175c5411`) so every block of an enforced subcommand now emits the "Inline METTA_SKILL=1 prefix no longer bypasses skill-enforced subcommands" advisory, including the bare-call case previously routed to the generic block path. This does not widen the block set; it only changes the rejection text.

The round-1 warnings that were explicitly accepted as residual (`startsWith('metta-')` permissiveness, `event.cwd` trust) remain correctly documented in `summary.md` §Residual risk and design.md §Risk 4. No new attack surface introduced.

## Threat Model

- **Trust boundary**: AI orchestrator (`tool_input.command`, potentially attacker-controlled) vs. Claude Code runtime (`event.agent_type`, set by the platform when a forked subagent fires a tool). The hook relies on that boundary holding.
- **Assets**: the RCA-quality contract of `spec/issues/` and `spec/changes/`, plus the append-only audit trail in `.metta/logs/guard-bypass.log`.
- **Attacker capability**: an AI orchestrator session with Bash, Write, Edit, Agent, and Skill tools, operating within a Claude Code session on the target repo. No code execution outside the sandbox, no ability to mutate `process.env.METTA_SKILL` for the hook child process.
- **What round 2 changes**: no expansion of enforcement-path code; spec text tightened to match code scope; rejection message unified. The behavior change at line 169 (removing `&& offender.skillBypass`) is semantically equivalent for security — any path that lands at line 169 under round 2 was already exit-2-blocked under round 1 (it just flowed through the generic block branch at line 193). Exit code, audit-log emission, and process termination are unchanged.

## Findings

### Critical

None.

### Warnings

None net-new. The three residual items from round 1 remain accepted and are documented in the change artifacts:

- `src/templates/hooks/metta-guard-bash.mjs:100` — `startsWith('metta-')` is intentionally broader than a closed allowlist so future metta subagents don't require hook edits. An orchestrator with Agent tool access can dispatch via `metta-skill-host` (or author `.claude/agents/metta-evil.md`); the audit log captures `agent_type` on every block/allow-with-bypass write, so post-hoc detection of unexpected agent names is feasible. `summary.md` §Residual risk and `design.md` §Risk 4 accept this. No round-2 regression.
- `src/templates/hooks/metta-guard-bash.mjs:107` — `event.cwd ?? process.cwd()` is trusted to resolve the log path; `event.cwd` is runtime-populated per `research-pretooluse-event-payload.md`. Defense-in-depth path canonicalization was flagged in round 1 as a nice-to-have and was explicitly accepted as a note, not a blocker. No round-2 regression.
- `src/templates/hooks/metta-guard-bash.mjs:38-40` — `SKILL_ENFORCED_SUBCOMMANDS` covers the six user-facing skills; `complete` and `finalize` remain in `BLOCKED_SUBCOMMANDS` with inline-bypass preserved. Round 2 aligns `spec.md` and the "preserves inline-bypass" requirement (lines 19-27 of spec.md) with this narrower scope. The orchestrator-path exposure for `complete`/`finalize` is tracked as a future-scope concern and explicitly out-of-band per the round-2 scope decision ("enforcing them would require forking the orchestrator itself").

### Notes

- **Round-2 code delta is security-neutral.** Removing `&& offender.skillBypass` from the enforced-block branch at line 169 does not open a new bypass: the `offender`-selection logic at line 142-150 still requires `skillBypass && isTrustedSkillCaller(event)` for any enforced subcommand to be classified as a non-offender. Bare `metta issue` was offender-classified under round 1 (short of both conditions) and took the generic block path; under round 2 it takes the unified skill-enforced block path. Both paths call `appendAuditLog('block', ...)` and `process.exit(2)`. Verified by tests/metta-guard-bash.test.ts `blocks bare enforced subcommand with unified skill-enforced message` (commit `2925bd45e`).
- **Byte-identity** remains enforced: `diff -q src/templates/hooks/metta-guard-bash.mjs .claude/hooks/metta-guard-bash.mjs` is clean after round 2 (empty output confirmed). `tests/metta-guard-bash.test.ts` exercises both source and deployed copies (77 tests pass locally).
- **Audit-log schema** (`agent_type`, `skill_bypass` both captured on every non-allowed invocation) remains strictly more forensically useful than the earlier `skill_hint` alternative. Raw command strings continue to be intentionally excluded from the log, preventing accidental leak of secrets passed as `metta issue "API_KEY=..."` arguments.
- **No new dependencies, no new file-write surface, no new network calls** introduced in round 2. The diff is scoped to one line of hook logic, one line of the hook's stderr branch, one test, and spec.md text alignment.
- **`process.env.METTA_SKILL === '1'`** belt-and-suspenders path at line 134 untouched. Operators who export this globally effectively disable the guard; this trade-off is spec-mandated (line 5 of spec.md) and documented.
- **Follow-up still pending** (non-blocking, from round 1): log-retention/rotation in `metta cleanup` once that command lands. Round 2 does not make this worse; log-line size (~200 bytes) and tool-call rate-limit at the orchestrator level bound practical disk exposure within a session.
