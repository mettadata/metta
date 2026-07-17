# fix-harden-metta-guard-bash-trust-model-unify-all-blocked

## Problem

`metta-guard-bash` (the PreToolUse hook at `.claude/hooks/metta-guard-bash.mjs`,
byte-identical to `src/templates/hooks/metta-guard-bash.mjs`) is supposed to stop
an AI orchestrator session from calling state-mutating `metta` subcommands
directly, forcing it through the matching `/metta-*` skill instead. Today it only
half does that.

The hook splits the twelve blocked subcommands into two trust tiers:

- **SKILL_ENFORCED_SUBCOMMANDS** (`propose`, `quick`, `auto`, `ship`, `issue`,
  `fix-issue`) require BOTH the inline `METTA_SKILL=1` command prefix AND a
  trusted `event.agent_type` starting with `metta-` — a signal the Claude Code
  runtime sets only when the call originates from a forked subagent, and which
  cannot be typed into a command string.
- **Every other blocked subcommand** (`complete`, `finalize`, `refresh`,
  `import`, `init`, `fix-gap`) is gated by the inline `METTA_SKILL=1` prefix
  alone (`metta-guard-bash.mjs:170`: `return !inv.skillBypass;`).

`METTA_SKILL=1` is plain text in the Bash command string. Nothing stops an AI
orchestrator from typing `METTA_SKILL=1 metta finalize` (or `refresh`,
`import`, `init`, `fix-gap`) directly and walking straight past the guard for
six of the twelve blocked subcommands — the exact class of privilege
escalation the archived change
`fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill` closed for the
enforced tier, left open here. Anyone driving metta as an AI orchestrator (the
primary supported usage pattern per `CLAUDE.md`'s "How to work" section) is
exposed: a forged prefix can trigger `metta complete`, `metta finalize`,
`metta refresh`, `metta import`, `metta init`, or `metta fix-gap` outside their
skill-authored contract, mutating `.metta/` state or spec files without the
artifact-authoring, review, and verification guarantees those skills wrap
around the CLI call.

A second, lower-severity symptom rides the same env var: `applyEnvOverrides`
in `src/config/config-loader.ts` strips the `METTA_` prefix from every
`process.env` key and maps the remainder into a config key
(`config-loader.ts:70-108`). `METTA_SKILL` is special-cased into a `RESERVED`
set (`config-loader.ts:77`) specifically to suppress the resulting
"Unrecognized key(s) in object: 'skill'" warning — a workaround for the same
forgeable token this change is retiring, not a fix in its own right.

Two complications, discovered since the issue was first logged, make the
"just fork everything and require `agent_type` everywhere" fix unsafe to ship
as originally scoped:

1. Forked skills are known to orphan their dispatched agents
   (`forked-skill-agent-dispatch-orphaning-recurred-after-the`); the
   2026-07-15 contract rule reduces but does not mechanically prevent this.
   Forcing `complete`, `finalize`, `refresh`, `import`, `init`, and `fix-gap`
   into fork mode multiplies that failure surface across every non-forked
   lifecycle skill that currently calls them.
2. `metta-next`, `metta-plan`, `metta-execute`, and `metta-verify` run in the
   **main orchestrator session by design** — they are not forked, so
   `event.agent_type` is absent for them structurally, not accidentally.
   Their skill contracts instruct the orchestrator to run
   `METTA_SKILL=1 metta complete` / `metta finalize` / `metta instructions`
   directly from that main session. An `agent_type`-only trust model for
   those subcommands would permanently lock out the main-session
   orchestration pattern that five changes shipped against this week.

So the real problem is not "pick one trust signal and apply it everywhere" —
it's that metta currently has no non-forgeable trust signal for main-session,
skill-driven CLI calls at all, and is silently relying on a token any
orchestrator can retype.

## Proposal

Replace the single forgeable `METTA_SKILL=1` inline-prefix bypass with an
explicit, honestly two-tier trust model, applied uniformly across all twelve
currently-blocked subcommands, and document that model in both the guard hook
header and `CLAUDE.md`'s workflow section.

**Tier 1 — fork-dispatched destructive commands** (`propose`, `quick`, `auto`,
`ship`, `issue`, `fix-issue`): unchanged. These already run inside a forked
`metta-skill-host` subagent per `SKILL.md` frontmatter (`context: fork`,
`agent: metta-skill-host`), so `isTrustedSkillCaller(event)` (checking
`event.agent_type.startsWith('metta-')`) remains sufficient and authoritative.
No forking changes for this tier.

**Tier 2 — main-session lifecycle commands** (`complete`, `finalize`,
`refresh`, `import`, `init`, `fix-gap`, and any Tier-1 subcommand invoked from
inside a Tier-1 skill's own body before/after the fork boundary): replace the
forgeable inline `METTA_SKILL=1` env-var prefix with a hardened,
session-scoped bypass token — a nonce file under `.metta/scratch/` (e.g.
`.metta/scratch/skill-session.token`) written at skill-launch time by the
invoking skill (or by a `metta` CLI subcommand the skill calls at start, e.g.
`metta skill-session start`) and read + rotated by the guard hook on each
matched call. The token is:
  - generated server-side (by the `metta` CLI, not authored by the
    orchestrator's command text),
  - single-use or short-TTL (rotated on each successful match, or expired
    after a bounded window) so a stale or leaked token cannot be replayed
    indefinitely,
  - filesystem-scoped to the current change's `.metta/` directory, so it
    cannot be forged by typing text into a Bash command — the orchestrator
    would have to fabricate a file with the exact rotating value, which the
    hook can detect and reject on mismatch.

This closes the "plain text in a command string is a security boundary" gap
for Tier 2 while preserving the main-session orchestration pattern that
`metta-next`, `metta-plan`, `metta-execute`, and `metta-verify` depend on —
those skills request/consume the token instead of typing `METTA_SKILL=1`.

**Scope of work:**
1. Design and implement the nonce-file token mechanism (issuance CLI hook or
   skill-launch step, storage location, rotation/expiry rule, hook-side
   verification) — replacing `isTrustedSkillCaller`'s Tier-1-only role with a
   two-branch check: Tier 1 → `agent_type`; Tier 2 → session token match.
2. Update `metta-guard-bash.mjs` (both `.claude/hooks/` and
   `src/templates/hooks/` copies, kept byte-identical) to: remove the
   `!inv.skillBypass` legacy fallback for non-enforced subcommands; validate
   the session token for Tier 2 subcommands; keep the existing audit-log
   (`guard-bypass.log`), `SKILL_ENFORCED_SUBCOMMANDS` set, and the
   `run_in_background`-from-fork rejection introduced this week untouched.
3. Migrate all ~77 `METTA_SKILL=1` call sites (times two for the
   `.claude/skills/` deployed copies and `src/templates/skills/` template
   copies — roughly 154 lines total across 15 `SKILL.md` files) to issue/use
   the session token instead of the inline env-var prefix, in the same
   change (no dangling migration).
4. Patch `ProjectConfigSchema` / `config-loader.ts` to drop the now-unused
   `METTA_SKILL` special case once the inline prefix is retired, or confirm
   it is still needed for a documented transitional period and leave it with
   an updated comment — decided during planning based on whether any
   call site still needs the legacy prefix as a fallback.
5. Document the two-tier trust model in the `metta-guard-bash.mjs` file
   header comment (replacing the current "Primary/Secondary/Emergency
   bypass" comment block) and in `CLAUDE.md`'s "How to work" / workflow
   section, so the model's rationale (why two tiers, why each is
   non-forgeable) is discoverable without reading the hook source.
6. Every hook edit MUST be validated with `node --check
   .claude/hooks/metta-guard-bash.mjs` (and the template copy) before any
   other Bash call is issued in the executing session, since the hook gates
   its own author's future calls.

Whether the exact token mechanism is a `.metta/scratch/` nonce file (option
(i) from the issue) or an alternative non-forgeable signal discovered during
planning-phase research into Claude Code hook event fields (option (ii)) is a
planning decision, not fixed here — but the intent commits to: no
plain-text-forgeable token grants state-mutating access once this change
ships, for any of the twelve blocked subcommands.

## Impact

- **`metta-guard-bash.mjs`** (`.claude/hooks/` and `src/templates/hooks/`):
  offender predicate, `isTrustedSkillCaller`, and the audit-log reason
  strings change to reflect the new two-tier check. The
  `SKILL_ENFORCED_SUBCOMMANDS` set, `SKILL_HINT_MAP`, `BLOCKED_SUBCOMMANDS`,
  `BLOCKED_TWO_WORD`, `ALLOWED_SUBCOMMANDS`, the background-Bash-from-fork
  rejection, and the JSON-line audit log format are preserved as-is (or
  extended, not removed).
- **All 15 `SKILL.md` files** that currently reference `METTA_SKILL=1`
  (`metta-auto`, `metta-backlog`, `metta-execute`, `metta-refresh`,
  `metta-ship`, `metta-issue`, `metta-quick`, `metta-next`, `metta-import`,
  `metta-plan`, `metta-propose`, `metta-fix-issues`, `metta-init`,
  `metta-verify`, `metta-fix-gap`) in both `.claude/skills/` and
  `src/templates/skills/` — each call site that currently does
  `METTA_SKILL=1 metta <cmd>` must be rewritten to acquire/pass the new
  session token.
- **`src/config/config-loader.ts`** (`applyEnvOverrides`, the `RESERVED` set,
  and the env-override-caused-validation-error warning path) may lose the
  `METTA_SKILL` special case, or keep it with updated documentation — final
  shape decided in planning.
- **CLAUDE.md** "How to work" section gets a new subsection (or expanded
  existing text) documenting the two-tier trust model, so future readers
  understand why fork-dispatched and main-session commands are authorized
  differently.
- **No change** to `metta-skill-host` agent behavior, the fork-dispatch
  contract rule shipped 2026-07-15, or which skills declare `context: fork`
  — this change deliberately does NOT add forking to any currently
  non-forked skill.
- **Existing users / CI**: any script or human workflow that currently relies
  on typing `METTA_SKILL=1 metta <blocked-subcommand>` directly (outside a
  skill) will stop working once Tier 2 enforcement lands; the emergency
  bypass (`disable this hook in .claude/settings.local.json`) remains the
  documented escape hatch for that case, unchanged.

## Out of Scope

- Forking `metta-next`, `metta-plan`, `metta-execute`, `metta-verify`,
  `metta-refresh`, `metta-import`, `metta-init`, or `metta-fix-gap` into
  `context: fork` subagents. Explicitly rejected per the user's constraint:
  it multiplies the known agent-dispatch-orphaning failure surface
  (`forked-skill-agent-dispatch-orphaning-recurred-after-the`) and breaks the
  main-session orchestration pattern those skills depend on.
- Fixing or mitigating `forked-skill-agent-dispatch-orphaning-recurred-after-
  the` itself. That is a separate logged issue; this change only avoids
  making it worse by declining to add new forks.
- Narrowing `BLOCKED_SUBCOMMANDS` (candidate direction (iii) — re-evaluating
  whether any currently-blocked subcommand is no longer state-dangerous now
  that 4b has shipped). This change unifies the trust model for the
  existing blocked set; it does not re-audit which subcommands belong on
  that list.
- Changing the Tier 1 (`agent_type`) mechanism itself, the
  `SKILL_ENFORCED_SUBCOMMANDS` membership, or the `run_in_background`-from-
  fork rejection — all shipped this week and preserved unmodified per the
  user's constraint.
- Rewriting the `guard-bypass.log` audit format or adding new audit tooling
  beyond what's needed to log Tier 2 token verification outcomes.
- Any change to `ALLOWED_SUBCOMMANDS`, `ALLOWED_TWO_WORD`, or `install`'s
  intentional human/CI pass-through status.
- Retrofitting a session-token mechanism for use cases outside the metta
  guard hook (e.g. general-purpose secret storage, cross-session auth) — the
  token is purpose-built for this hook's Tier 2 check only.
