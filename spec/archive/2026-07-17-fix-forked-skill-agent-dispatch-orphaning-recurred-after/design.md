# Design: fix-forked-skill-agent-dispatch-orphaning-recurred-after

## Approach

Per research.md's decision, this change ships two layers, not three:

1. **Primary (US-1, US-2 / Fork Dispatch Completion Guarantee, mechanism-(b) forced-synchronous branch):** a new `PreToolUse` hook, `metta-guard-agent-dispatch.mjs`, matcher `Agent`, declared **in `metta-skill-host.md`'s own `hooks:` frontmatter** — not in the global `.claude/settings.json` where `metta-guard-bash.mjs` lives today. Agent frontmatter carries "Lifecycle hooks scoped to this subagent" that apply "while the agent is active" (research.md:17, code.claude.com/docs/en/sub-agents). This is the same frontmatter-scoping pattern already used for Tier-2 credential minting (`.claude/skills/metta-refresh/SKILL.md:4-9` wires `metta-session-mint.mjs` identically). Because the hook only ever runs while `metta-skill-host` is the active agent, **`event.agent_type` identity checking is redundant for scope** — frontmatter registration is itself the caller-identity boundary, unlike `metta-guard-bash.mjs`'s global registration which must self-filter via `isTrustedSkillCaller()` (`metta-guard-bash.mjs:109-114`). The hook still records `event.agent_type` in its audit entry for forensic value, but does not branch on it.
2. **Floor (US-3 / Residual Orphaning Recovery Protocol, always lands):** a recovery-protocol section added to `metta-skill-host.md`, referenced by a one-line pointer in each of the six fork skills — the same structural pattern the existing "Synchronous completion (hard rule)" section already uses (`metta-skill-host.md:23-24`), which every fork skill relies on by inheritance rather than restating.

The `SubagentStop`-ledger design (Approach A) is **not built in this change**: its clearing signal (`PostToolUse` timing for `Agent` calls) is unverified against public docs (research.md:7,19). This design specifies the live experiment as an implementation task (below); the ledger becomes a follow-up only if it is trivially green.

## Components

**New hook pair** (template + deployed, byte-identical, per `metta-guard-bash.mjs`'s existing discipline):
- `src/templates/hooks/metta-guard-agent-dispatch.mjs` (template)
- `.claude/hooks/metta-guard-agent-dispatch.mjs` (deployed)

Behavior: on `PreToolUse` where `event.tool_name === 'Agent'`, reject (exit 2, stderr reason) when `event.tool_input?.run_in_background === true` — the field name research.md:9 confirms exists on the `Agent` tool's `tool_input` by documentary inference from `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` disabling "the `run_in_background` parameter on Bash and subagent tools." This mirrors `metta-guard-bash.mjs:170-180`'s Bash `run_in_background` block structurally. All other shapes (flag absent, `false`, anything else) pass through unmodified.

**Reject, not rewrite.** Research's doc findings document only `PreToolUse` block/allow decisions (exit code, or `{"decision":"block","reason":...}`) — no `tool_input`-mutation output is documented anywhere in the hooks reference, so rewrite-to-foreground is not an available mechanism. Even if it were, reject is preferred: it produces an observable, audit-logged event (US-4) and gives the fork an explicit `reason` to retry synchronously, rather than silently mutating a tool call the fork never authored.

**Audit logging: duplicate, don't extract a shared helper.** `metta-guard-agent-dispatch.mjs` reimplements `appendAuditLog()` (~15 lines, cf. `metta-guard-bash.mjs:139-158`) inline rather than importing a shared module. Each deployed hook must stay independently `node --check`-able and byte-identical to its own template, with no cross-file import graph — `metta-session-mint.mjs` sets the same no-shared-module precedent despite overlapping I/O with `metta-guard-bash.mjs`. A shared `.claude/hooks/lib/` module would add a second artifact that must stay template/deployed-identical plus a runtime path dependency between two independently-registered hooks; duplication is simpler and more auditable, per "prefer composition over inheritance" / "no singletons." Log record: `{ts, verdict: 'block', tool_name: 'Agent', agent_type, subagent_type, reason: 'rejected-async-agent-dispatch', tier: 'fork'}`, appended to the same `.metta/logs/guard-bypass.log` `metta-guard-bash.mjs` already writes — one shared audit trail, two hook implementations.

## Data Model

No new persisted state. The audit-log line is additive to the existing `.metta/logs/guard-bypass.log` JSONL schema (`metta-guard-bash.mjs:143-152`), adding no new required fields — `subcommand`/`third` are `null` for this hook's entries since it does not classify CLI subcommands.

## API Design

**Frontmatter wiring**, added to both the template and deployed copy of `metta-skill-host.md`:

```yaml
hooks:
  PreToolUse:
    - matcher: Agent
      hooks:
        - type: command
          command: .claude/hooks/metta-guard-agent-dispatch.mjs
```

**Live experiment (implementation task, not production code, US-1 mechanism verification):** in a real session, dispatch a `metta-*`-fork `Agent` call with `run_in_background` unset and time `PostToolUse` for that call against the child's actual completion. Pass = timing matches real elapsed child work (ledger-clearing sound). Fail = `PostToolUse` fires near-instantly at dispatch (ledger-clearing unsound, as research.md:7,19 predicts). Record the observed outcome in this change's verification artifact. If pass, log a follow-up issue via `/metta-issue` scoping the ledger as a future Approach-A build — do not build it here. If fail (expected), no follow-up: the ledger is a closed dead end.

**Recovery protocol text (Layer 3, US-3):** full text lands in `metta-skill-host.md` as `### Residual orphaning recovery protocol`, immediately after "Synchronous completion (hard rule)" (`metta-skill-host.md:23-24`), covering: (a) detection — any summary narrating in-progress/background work is a failed, non-terminal result; (b) wait/attach — check for and wait on or attach to the still-running orphan, never dispatch a duplicate of in-flight work; (c) confirmed-dead re-dispatch — only once the orphan is confirmed dead or complete, re-dispatch fresh work from the change's persisted state. Each of the six fork skills (`.claude/skills/metta-{issue,fix-issues,propose,quick,auto,ship}/SKILL.md`) gets a one-line pointer under `## Rules` (placement precedent: `metta-ship/SKILL.md:20-26`) — e.g. "If a dispatched step appears orphaned, follow the residual orphaning recovery protocol in metta-skill-host.md." — not duplicated text, matching how the synchronous-completion rule is inherited today.

**Observability for recovery invocations (US-4, "Fork-Dispatch Enforcement Events Are Recorded"):** recovery is orchestrator prose-following behavior — no tool call a hook can intercept. The protocol text contractually instructs the orchestrator to note the recovery invocation and the orphaned agent's identity in the change's commit message or artifact trail (e.g. its `metta issue` log entry or the fork's summary to the orchestrator) when it invokes the protocol. This is honestly scoped as **contractually required, not mechanically enforced**: only the blocked-dispatch and blocked-stop paths are mechanically logged; recovery invocations are best-effort discernible from the resulting commit/artifact trail a maintainer can inspect afterward.

## Risks & Mitigations

- **Harness version drift** (the `run_in_background` field is renamed/reshaped later): the hook checks one field name; an unrecognized shape passes through undetected — structurally fail-open. This weakens "MUST NOT be able to silently end its turn" to "best-effort against the currently-documented field shape." Fail-open with audit-log noise is the deliberate choice over fail-closed, because fail-closed (reject every `Agent` dispatch when the field can't be confirmed) would break all legitimate synchronous dispatches to guard an edge case. The residual gap is exactly what Layer 3 exists to catch, matching research.md's own "Residual threat" analysis (research.md:21).
- **Double-enforcement interplay with `metta-guard-bash.mjs`:** no overlap — that hook matches `Bash` only (`metta-guard-bash.mjs:165`); the new hook matches `Agent` only. Both write the same audit log with distinct `reason` values, so overlapping activity stays individually attributable.
- **Fork skills becoming slower:** accepted by design — forced-synchronous dispatch serializes parent/child turns, which is the point of the fix (US-1/US-2). No mitigation proposed; this is the intended tradeoff research.md selected Approach B for.
