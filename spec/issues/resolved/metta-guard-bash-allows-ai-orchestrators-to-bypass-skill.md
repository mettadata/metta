# metta-guard-bash allows AI orchestrators to bypass skill layer via inline METTA_SKILL=1 prefix

**Captured**: 2026-04-21
**Status**: logged
**Severity**: major

## Symptom

Any AI orchestrator can bypass the `/metta-issue` skill (and any other skill-guarded CLI) by invoking `METTA_SKILL=1 metta issue ...` directly from a Bash tool call. The `metta-guard-bash` hook treats every inline `METTA_SKILL=1` prefix as a legitimate skill-internal bypass and rubber-stamps the call. Observed live in the zeus tmux session: the orchestrator self-reported "For the subsequent 7 issues I called METTA_SKILL=1 metta issue ... directly from Bash, which the metta-guard-bash hook allows" — skipping the 7-step RCA flow the skill was upgraded to enforce in Batch B (change `upgrade-metta-issue-skill-run-short-debugging-session-before`, shipped 2026-04-20).

## Root Cause Analysis

The bypass was a deliberate design decision in commit `0cf31353d` that addressed a legitimate problem — skills genuinely need to call the CLI internally as their final step — but the chosen mechanism (inline env-var prefix) carries no proof-of-origin. The hook cannot tell from the `tool_input.command` string whether the prefix was authored inside a skill's Steps section or typed by the orchestrator's own reasoning; both produce byte-identical Bash invocations, so the hook must either allow all or block all. It currently allows all.

The `CLAUDE.md` "Forbidden" section explicitly names this misuse — "Invoking `metta issue` etc. directly from an AI orchestrator session. Use the matching skill" — but the guard's enforcement surface trusts the very token the forbidden caller can trivially emit. `process.env.METTA_SKILL === '1'` at line 87 is the "belt-and-suspenders" check, but inline prefixes (`METTA_SKILL=1 metta ...`) apply to bash's spawned subprocess, not to the hook process itself, so the env-var check never fires for skill invocations — the hook falls through to the tokenizer's `skillBypass` flag, which is set by any inline prefix regardless of origin.

### Evidence

- `src/templates/hooks/metta-guard-bash.mjs:51-52` — the tokenizer unconditionally sets `skillBypass = true` for any `METTA_SKILL=1` token encountered as an env-var prefix, with no check for caller identity.
- `src/templates/hooks/metta-guard-bash.mjs:92-96` — the offender-finding filter skips any invocation where `inv.skillBypass` is truthy, meaning orchestrator-written `METTA_SKILL=1` calls pass through the guard unchallenged.
- `CLAUDE.md` Metta Workflow "Forbidden" section explicitly lists direct CLI invocation from AI orchestrator sessions as forbidden, yet the guard hook does not enforce it when `METTA_SKILL=1` is prefixed.

## Candidate Solutions

1. **Remove the inline env-var bypass; require skills to write to a secret channel.** Delete the skillBypass branch in the tokenizer and keep only `process.env.METTA_SKILL === '1'` as the bypass signal. Rework skills so their Bash tool calls inherit METTA_SKILL=1 via the harness-level tool invocation environment (if Claude Code's Bash tool supports per-invocation env, pass it there; otherwise, skills emit an out-of-band marker — e.g. a session-unique token in a temp file — that the hook verifies). Tradeoff: breaks every currently-working skill that relies on inline-prefixed METTA_SKILL=1; requires harness support for per-invocation env or a new marker scheme; highest correctness guarantee once landed but a material protocol change across every skill that touches the CLI.

2. **Invert the guard semantics: block even when METTA_SKILL=1 is present unless the caller context is a skill.** Inspect the hook's event payload for fields that identify the calling context — session_id, transcript_path, or any agent_type / skill_id metadata the harness supplies — and only honor the inline bypass when the payload proves the caller is an actual skill (e.g. transcript_path ends with `/skills/metta-<name>.jsonl` or similar). Tradeoff: correctness depends on what Claude Code's PreToolUse event actually exposes; may require harness changes or fragile path-based heuristics; possibly infeasible without upstream metadata support. Lowest-impact if the payload already carries the needed field.

3. **Audit-log every inline bypass and fail-closed on known-problem subcommands.** Keep today's inline bypass for low-risk state-mutating commands but extend the BLOCKED_SUBCOMMANDS set to fail-closed even with METTA_SKILL=1 for the high-value skill-enforced subcommands that Batch B and similar changes depend on (issue, fix-issue, propose, quick, auto, ship). Require /metta-<skill> dispatch exclusively for those, and log every bypass attempt to `.metta/logs/guard-bypass.log` for review. Tradeoff: incremental and deployable today; creates a two-tier enforcement model that has to be maintained; does not close the hole for any CLI subcommand outside the fail-closed list — orchestrators could still abuse METTA_SKILL=1 for the remaining commands.
