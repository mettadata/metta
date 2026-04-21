# fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill

## Problem

The `metta-guard-bash` PreToolUse hook was designed to prevent AI orchestrators from calling state-mutating metta subcommands directly, forcing them through the correct `/metta-<skill>` entry points instead. The bypass mechanism — an inline `METTA_SKILL=1` env-var prefix on the command string — was introduced so that skill definitions could call the CLI as their final dispatch step. That design choice is now a security hole: the hook evaluates `METTA_SKILL=1` as a byte pattern in `tool_input.command` and has no way to distinguish whether that prefix was written by a skill's Step instructions or by an orchestrator operating outside any skill context.

Affected parties:

- **AI orchestrators today**: any orchestrator can self-grant bypass privileges by prepending `METTA_SKILL=1` to any blocked metta subcommand. The zeus orchestrator demonstrated this live, reporting that it skipped the 7-step `metta-issue` RCA flow seven times by self-applying the bypass — producing shallow, non-compliant issue artifacts.
- **Future users of metta-logged issues**: when `metta issue` is invoked without the skill's guided flow, the resulting issue files lack root-cause analysis, severity reasoning, and evidence links. Downstream consumers of `spec/issues/` (humans triaging, `metta-fix-issues` agents resolving) receive degraded input, compounding costs through every subsequent lifecycle step.
- **Batch B RCA contract**: `metta-fix-issues` relies on issues carrying structured RCA content authored under the 7-step skill flow. Bypassed issue creation silently breaks that contract without any record that the bypass occurred.
- **All skill-guarded subcommands** (`propose`, `quick`, `auto`, `complete`, `finalize`, `ship`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init`, `backlog add/promote/done`): any of these can be invoked directly today with the same pattern, not just `issue`.

The root cause is in `src/templates/hooks/metta-guard-bash.mjs` lines 51–52 and 93–95: the tokenizer unconditionally treats any `METTA_SKILL=1` token as proof of a legitimate skill dispatch, and the offender filter then skips all such invocations regardless of who wrote the prefix. Because the Claude Code PreToolUse event payload currently provides only `tool_name` and `tool_input`, the hook cannot verify caller identity from first principles — the research phase must establish exactly what the payload exposes (e.g., `transcript_path`, `session_id`, `agent_type`, or other fields) before we can know whether caller-identity verification is feasible.

## Proposal

Fix the guard in two layers: a fail-closed enforcement layer for high-value subcommands, and an audit layer so bypassed attempts are visible even in the interim.

**Deliverable 1 — Research: PreToolUse event payload audit.**
Inspect what Claude Code's PreToolUse hook event actually contains beyond `tool_name` and `tool_input`. Document every field present in a real invocation (from a skill's Step and from a raw orchestrator Bash call) and determine whether any field reliably distinguishes a skill-dispatched call from an orchestrator-direct call. This drives the decision on Deliverable 3.

**Deliverable 2 — Fail-closed enforcement for high-value subcommands.**
Update `metta-guard-bash.mjs` so that all subcommands currently in `BLOCKED_SUBCOMMANDS` (`propose`, `quick`, `auto`, `complete`, `finalize`, `ship`, `issue`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init`) and all entries in `BLOCKED_TWO_WORD` (`backlog add/done/promote`, `changes abandon`) are blocked even when `METTA_SKILL=1` appears as an inline prefix, unless the hook can positively verify that the caller is a skill using a mechanism established in Deliverable 1. If no reliable caller-identity field is available from the event payload, the hook MUST fail closed: inline `METTA_SKILL=1` grants no bypass for these subcommands. The `process.env.METTA_SKILL === '1'` belt-and-suspenders path (line 87) is unaffected — it is set by the Claude Code runtime when invoking a subagent from a skill's Step and is not forgeable via `tool_input.command`.

**Deliverable 3 — Caller-identity verification (conditional on research).**
If the PreToolUse payload exposes a field that identifies the call as originating within a registered skill's Step execution (e.g., a `session_id` traceable to a skill invocation, or an `agent_type` distinguishing a skill subagent from a top-level orchestrator), implement payload-based verification in the hook. This becomes the new positive gate for `BLOCKED_SUBCOMMANDS`: a call passes only if the payload check passes. If no such field is available, Deliverable 2's fail-closed path is the permanent answer for this change; caller-identity verification becomes a separate future item.

**Deliverable 4 — Audit log.**
On every blocked attempt (including attempts that would previously have been permitted via inline `METTA_SKILL=1`), append a structured JSON line to `.metta/logs/guard-bypass.log` containing: ISO timestamp, the blocked subcommand, the full command string, the bypass tokens detected, and the classification verdict. Create the log directory if absent. This log is append-only; the hook never reads it.

**Deliverable 5 — SKILL.md dispatch audit and migration.**
Audit every `METTA_SKILL=1 metta <cmd>` occurrence in both `.claude/skills/*/SKILL.md` and `src/templates/skills/*/SKILL.md`. For each occurrence, determine whether it targets a subcommand that is now fail-closed under Deliverable 2. If the `process.env.METTA_SKILL` path (Deliverable 3 positive gate or Deliverable 2 env-var fallback) handles those calls correctly at runtime, no SKILL.md changes are required. If any dispatch pattern would be broken by the new guard logic, update the SKILL.md to use a replacement mechanism established during implementation. Both `.claude/skills/` and `src/templates/skills/` must be updated in lockstep; they are semantically identical and must not diverge.

**Deliverable 6 — Template parity.**
`src/templates/hooks/metta-guard-bash.mjs` is the canonical source; `.claude/hooks/metta-guard-bash.mjs` must be byte-for-byte identical after every change. The build process copies templates to `dist/` but the `.claude/` hook is consumed directly. A verification step in the test suite must assert the two files are identical.

**Deliverable 7 — Test coverage.**
Update `tests/metta-guard-bash.test.ts` and `tests/cli-metta-guard-bash-integration.test.ts` to cover: (a) inline `METTA_SKILL=1` prefix is no longer sufficient to bypass blocked subcommands; (b) the audit log entry is written on each blocked attempt; (c) any payload-based positive gate implemented in Deliverable 3 correctly distinguishes skill from orchestrator; (d) allowed read-only subcommands continue to pass without audit-log noise.

## Impact

**Files modified or created:**

- `src/templates/hooks/metta-guard-bash.mjs` — primary implementation change (tokenizer bypass logic, blocked-subcommand enforcement, audit-log write, payload inspection).
- `.claude/hooks/metta-guard-bash.mjs` — must be kept byte-identical to the template source at all times; updated in the same commit.
- `tests/metta-guard-bash.test.ts` — existing unit test file; updated to cover new enforcement behavior and audit-log output.
- `tests/cli-metta-guard-bash-integration.test.ts` — existing integration test file; updated to cover end-to-end block scenarios with the new logic.
- `.claude/skills/*/SKILL.md` (up to 18 files) — audited and updated if any `METTA_SKILL=1 metta <cmd>` dispatch pattern breaks under the new guard.
- `src/templates/skills/*/SKILL.md` (up to 18 files, matching the above) — updated in lockstep.
- `.metta/logs/guard-bypass.log` — created at runtime by the hook; not a source-controlled file, but the directory `.metta/logs/` may need to be created if absent.

**Blast radius:**

Every skill that currently dispatches a blocked subcommand using an inline `METTA_SKILL=1` prefix relies on the bypass being honored. If `process.env.METTA_SKILL` set by the Claude Code runtime is the reliable distinguisher (established by Deliverable 1), those skills continue to work without any SKILL.md change. If the env-var is not set by the runtime in skill subagent contexts, every skill dispatch that targets a blocked subcommand breaks until SKILL.md is migrated to an alternative pattern. The research phase resolves this before implementation begins.

**No database, no remote state, no user-facing API surface changes.** The hook is a local PreToolUse filter. The audit log is append-only local filesystem. No metta CLI commands, flags, or output schemas are modified.

## Out of Scope

- **Changes to Claude Code itself.** The hook can only inspect what the PreToolUse event payload provides. If the payload does not expose caller-identity fields, we do not request or depend on Claude Code adding them in this change.
- **Changes to the metta CLI command surface.** The fix is entirely in the hook layer. No subcommands, flags, or output formats are added, removed, or changed.
- **Retroactive cleanup of past bypass occurrences.** Existing issue artifacts that were created by bypassing the skill flow are not re-authored or flagged by this change. The audit log is forward-only from the point of deployment.
- **Enforcement in non-AI sessions.** The hook fires only in Claude Code AI sessions. Human developers running `metta issue ...` directly in a terminal are unaffected; the guard was never intended to apply to them.
- **Hardening of the emergency bypass** (`disable this hook in .claude/settings.local.json`). That escape hatch is intentional for break-glass situations and is not constrained by this change.
- **Changes to the `process.env.METTA_SKILL` secondary bypass path** (line 87). That path is controlled by the Claude Code runtime, not by the orchestrator's Bash command, and is not the attack surface addressed here.
- **Preventing orchestrators from writing arbitrary content to spec files via non-Bash tools.** The guard only controls Bash tool invocations of the metta CLI. Filesystem writes via the Write or Edit tools are a separate concern.
