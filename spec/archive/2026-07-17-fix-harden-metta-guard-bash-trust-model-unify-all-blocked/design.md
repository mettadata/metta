# Design: fix-harden-metta-guard-bash-trust-model-unify-all-blocked

Implements research.md's chosen mechanism (skill-frontmatter-scoped `PreToolUse` mint hook,
filesystem token, `METTA_SKILL` retired) against spec `orchestration-guard`'s requirements and
stories US-1..US-5.

## Approach

Two non-forgeable authorization tiers replace the single inline `METTA_SKILL=1` prefix:

- **Tier 1 (fork-tier)** — unchanged. `isTrustedSkillCaller(event)`
  (`metta-guard-bash.mjs:105-107`) stays the sole check for `SKILL_ENFORCED_SUBCOMMANDS` (`propose,
  quick, auto, ship, issue, fix-issue`). Satisfies *Fork-Dispatched Subcommands Require Verified
  Caller Identity* / US-3.
- **Tier 2 (session-tier)** — every other blocked form (`complete, finalize, refresh, import,
  init, fix-gap`, and two-word `backlog add/done/promote`, `changes abandon`) is authorized by
  `.metta/scratch/skill-session.token`, minted by a new skill-frontmatter `PreToolUse` hook,
  `.claude/hooks/metta-session-mint.mjs` (+ `src/templates/hooks/` mirror). Satisfies *Main-Session
  Lifecycle Subcommands Require a Non-Forgeable Session Credential* / US-2.

**Key decision (resolves research's open "8 vs. pre/post-fork" question):** the six Tier-1
`SKILL.md` files declare `context: fork` / `agent: metta-skill-host` at the whole-skill frontmatter
level (verified: `metta-ship/SKILL.md:5-6`, `metta-propose/SKILL.md:6-7`), so `event.agent_type` is
trusted for *every* Bash call the skill body issues, not only its own named subcommand —
`metta-ship` calling `finalize` (Tier-2 by name) already carries a Tier-1-strength signal. The
Tier-2 branch therefore accepts `isTrustedSkillCaller OR validSessionToken`, so no mint hook is
needed on any of the 6 fork skills; their `METTA_SKILL=1` prefixes are just deleted. Satisfies (a)
not text-derivable and (b) fork-bounded lifetime by construction, at lower cost than research's
pre/post-fork-body hook.

**Mint hooks go on the 9 non-forked skills** driving Tier-2 subcommands: `metta-next, metta-plan,
metta-execute, metta-verify, metta-refresh, metta-import, metta-init, metta-backlog,
metta-fix-gap`. `metta-status`, `metta-progress`, `metta-check-constitution` drive no blocked
subcommand (absent from the 15-file grep of `METTA_SKILL=1`) and are untouched.

## Components

| Component | Path | Change |
|---|---|---|
| Mint hook (new) | `.claude/hooks/metta-session-mint.mjs` + `src/templates/hooks/` mirror | New, byte-identical pair |
| Guard hook | `.claude/hooks/metta-guard-bash.mjs` + template mirror | Replace `!inv.skillBypass` (`:170`) with Tier-2 branch |
| 9 Tier-2 `SKILL.md` ×2 copies | `.claude/skills/`, `src/templates/skills/` | Add `hooks:` frontmatter; strip `METTA_SKILL=1` |
| 6 Tier-1 `SKILL.md` ×2 copies | same | Strip `METTA_SKILL=1` only, no frontmatter change |
| Config loader | `src/config/config-loader.ts:77` | Delete `RESERVED` entry + comment (`:73-77`) |
| CLAUDE.md primer | `src/delivery/workflow-primer.ts:23,36` | Rewrite "How to work" text (two-tier model) |

## Data Model

Token file `.metta/scratch/skill-session.token`, mode `0600` (`.metta/scratch/` already gitignored
— orphaned files are harmless, see Risks):

```json
{ "token": "b3f1...uuid", "skill": "metta-next",
  "subcommands": ["complete", "finalize"], "mintedAt": 1752739200000, "ttlMs": 300000 }
```

- `token` — `crypto.randomUUID()`, server-minted, never appears in orchestrator-authored text.
- `skill` — the hard-coded slug in the mint hook's `command` line (ship-time authored, not an
  orchestrator-variable argument) — used for audit readability.
- `subcommands` — **per-skill scoping refinement, included** (cheap: a lookup, not a new
  invocation). Rather than pass scope as a frontmatter argument, the mint script hard-codes a
  `SKILL_SCOPES` map keyed by the one slug argument it receives:
  ```js
  const SKILL_SCOPES = {
    'metta-next': ['complete', 'finalize'], 'metta-plan': ['complete'],
    'metta-execute': ['complete'], 'metta-verify': ['complete'],
    'metta-refresh': ['refresh'], 'metta-import': ['import'],
    'metta-init': ['init', 'refresh'],
    'metta-backlog': ['backlog:add', 'backlog:done', 'backlog:promote'],
    'metta-fix-gap': ['fix-gap', 'complete', 'finalize'],
  };
  ```
  Two-word forms are keyed `"<sub>:<third>"`. Closes research's flagged residual threat (a token
  minted for `/metta-verify` authorizing unrelated `metta finalize`) at zero extra invocation cost.
- `mintedAt` / `ttlMs` — sliding TTL, **300000ms (5 min)**: long enough to cover the gap between
  consecutive Bash calls in a skill body with margin for a slow subagent turn; short enough that a
  leaked/stale file decays within one skill-invocation cycle. Rotated on every Bash call while the
  skill is active. A long gate run does not starve it — **the token is validated once, at call
  START**, not held for the call's duration; `metta finalize`'s ~4min tests gate runs after the
  guard has already allowed the call.

## API Design

**Mint hook** (`metta-session-mint.mjs <skill-slug>`): on each matching `PreToolUse Bash` event,
read the token file; if absent or past 80% of `ttlMs`, write a fresh one (`mkdirSync` recursive,
`writeFileSync(..., { mode: 0o600 })`). Frontmatter addition per Tier-2 skill (slug varies):

```yaml
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: .claude/hooks/metta-session-mint.mjs metta-next
```

**Guard Tier-2 branch** — placed immediately after the existing Tier-1
`SKILL_ENFORCED_SUBCOMMANDS` branch (`metta-guard-bash.mjs:190-200`), inside the `offender`
predicate (`:163-171`); `classify()` (`:91-100`) runs first, unchanged:

```js
if (SKILL_ENFORCED_SUBCOMMANDS.has(inv.sub)) { /* Tier 1, unchanged */ }
if (isTrustedSkillCaller(event)) return false;          // fork body calling a Tier-2 sub
const tok = readSessionToken(event.cwd);                // parses JSON, I/O errors -> null
if (!tok) return { offender: true, reason: 'missing-credential' };
if (Date.now() - tok.mintedAt >= tok.ttlMs) return { offender: true, reason: 'credential-expired' };
const key = inv.third ? `${inv.sub}:${inv.third}` : inv.sub;
if (!tok.subcommands.includes(key)) return { offender: true, reason: 'subcommand-not-in-scope' };
return false; // accepted
```

Reject-reason mapping: `missing-credential` → *"No credential present is rejected"* scenario;
`credential-expired` and `subcommand-not-in-scope` are both sub-cases of *"Fabricated or expired
credential... distinguishes mismatch from missing"* — logged distinctly, both surfaced to the user
as "credential mismatch," matching the spec's two-way (missing vs. mismatch) distinction while
keeping three-way granularity in the audit log.

**Audit log** (`appendAuditLog`, `:111-130`) — add `tier: 'fork' | 'session' | null`; log every
rejection (unchanged) and now every Tier-2 acceptance (new — Tier-1 accepts stay unlogged per
spec's *"Fork-tier accepted calls MAY continue to be unlogged"*), `reason:
'session-credential-verified'` on accept.

## Migration Map

| File class | Action |
|---|---|
| 6 Tier-1 `SKILL.md` (12 files) | Delete `METTA_SKILL=1 ` text only. No frontmatter change. |
| 9 Tier-2 `SKILL.md` (18 files) | Delete `METTA_SKILL=1 ` text; add the `hooks:` block above. |
| `metta-guard-bash.mjs` (×2) | Tier-2 branch above; header rewritten per US-5 / *Trust Model Is Documented*. |
| `config-loader.ts:70-111` | Delete `RESERVED` set (`:77`) and comment (`:73-76`). |
| `workflow-primer.ts:23,36` | Rewrite "How to work" text (two tiers + emergency bypass, US-5); regenerate `CLAUDE.md` via `/metta-refresh` after this change's own frontmatter lands (see Ordering). |
| Tests | Extend `tests/metta-guard-bash.test.ts` / `cli-metta-guard-bash-integration.test.ts` — write token files (fresh/expired/fabricated-scope) into `<sandboxCwd>/.metta/scratch/` before `runHook`. |

## Ordering Constraint (the guard gates its own author)

This change's own `metta-next` / `metta-plan` / `metta-execute` invocations predate the migration —
launched under the old frontmatter (no mint hook), so mid-body they cannot mint a Tier-2 token even
after the executor edits their `SKILL.md`, because frontmatter hooks are read at skill-invocation
time, not hot-reloaded mid-body. Sequence:

1. Add the mint hook file (new, inert) and the frontmatter/prefix-deletion edits to all 30 skill
   files first — no functional risk yet, guard still runs old logic.
2. Edit `metta-guard-bash.mjs` (both copies) to accept **both** the legacy `METTA_SKILL=1` check
   and the new Tier-2 branch, guarded by an inline `// REMOVE-AFTER-SHIP:` comment on the legacy
   branch. Run `node --check` on both copies before any further Bash call (intent scope item 6,
   US-4).
3. This session's remaining `metta complete` / `metta finalize` calls for *this* change succeed
   under the dual-accept window via the old prefix (still in the executor's in-flight
   instructions), while tests exercise the new token path in parallel.
4. Once tests confirm the Tier-2 path (fresh/expired/fabricated/scope-mismatch) and fork-body
   pass-through, the final implementation task deletes the `REMOVE-AFTER-SHIP` branch and reruns
   `node --check`. This change's subsequent `/metta-ship` / `/metta-next` calls are fresh skill
   invocations that pick up the new frontmatter, so they run under the pure new mechanism — no
   dual-accept code ships.

## Risks & Mitigations

- **Skill-frontmatter hooks unsupported in an older Claude Code build** — guard's Tier-2 rejection
  names the emergency bypass (`.claude/settings.local.json`); `CLAUDE.md` states the minimum
  Claude Code version required. *Vendor lock-in flag*: this mechanism is Claude-Code-specific
  (skill-frontmatter hooks); acceptable since metta's guard hooks already couple to Claude Code's
  `PreToolUse` contract.
- **Shared/networked filesystem token visibility** — single-host, per-change scratch; same trust
  boundary as the rest of `.metta/`.
- **TTL vs. long gate runs** — validated at call start, not held for call duration (see Data Model).
- **Orphaned token files** — `.metta/scratch/` gitignored; stale files decay silently and are
  harmless (scope mismatch ⇒ inert, or overwritten on next mint).
- **Pre-existing gap, out of scope**: `metta-fix-gap` (unforked) calls `METTA_SKILL=1 metta
  propose` (`fix-gap/SKILL.md:29`) — a Tier-1 subcommand it structurally cannot authorize even
  before this change (Tier 1 needs `agent_type`, unavailable outside a fork). Predates this
  change; flagged for a follow-up issue, not fixed (Out of Scope: no new forking).
