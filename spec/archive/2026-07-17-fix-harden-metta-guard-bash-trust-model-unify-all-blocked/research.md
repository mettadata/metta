# Research: Tier-2 session-credential mechanism for metta-guard-bash

## Decision

**Mechanism: a skill-frontmatter-scoped `PreToolUse` hook that mints/rotates a filesystem
session token, validated by `metta-guard-bash.mjs`.**

Each Tier-2-driving `SKILL.md` (the 8 main-session lifecycle skills, plus the pre/post-fork body
of the 6 Tier-1 skills) declares a `hooks.PreToolUse` entry in its own YAML frontmatter, matched
on `Bash`, running a new script `.claude/hooks/metta-session-mint.mjs`. Skill-scoped hooks are a
documented Claude Code feature: "hooks can be defined directly in skills … scoped to the
component's lifecycle and only run when that component is active … cleaned up when it
finishes."[^1] This is the runtime signal the intent's option (ii) asked planning to find: a
credential minted by a mechanism the orchestrator cannot invoke by typing text, because the hook
registration itself only exists while the runtime has that specific skill active.

**Lifecycle:**
- **Issue**: on every Bash call while the skill is active, the mint hook runs before
  `metta-guard-bash.mjs` evaluates the same call (both are `PreToolUse` hooks and Claude Code runs
  all matching hooks in parallel[^2]). It reads `.metta/scratch/skill-session.token`; if absent or
  within its last 20% of TTL, it writes a fresh `{ value: crypto.randomUUID(), skill:
  "<hard-coded-skill-name>", mintedAt, ttlMs }` (Node ≥22, the project's runtime floor, has had
  `crypto.randomUUID` stable since Node 16 — no compatibility risk). The skill name is a static
  string written into the hook's own `command` line by us at ship time (e.g. `metta-session-mint.mjs
  metta-verify`), never orchestrator-authored, so it is safe to trust.
- **Validate**: `metta-guard-bash.mjs`, for any `SKILL_ENFORCED_SUBCOMMANDS`-equivalent Tier-2
  match, reads the same file, checks `Date.now() - mintedAt < ttlMs` and (recommended refinement,
  decide in planning) that the invoked subcommand is permitted for `token.skill`.
- **Rotate**: sliding-window — every Bash call while the skill remains active re-primes the TTL, so
  a long-running skill body never goes stale mid-flight.
- **Expire/Revoke**: no further Bash calls from that skill → no further rotation → the token decays
  past its TTL on its own. There is no dedicated `Stop`-equivalent for plain (non-subagent) skills
  in the documented event set (only `SubagentStop`, which fires for forked agents)[^1], so decay is
  time-bounded, not event-bounded — this is the one place the design accepts a bounded window of
  staleness rather than instant revocation.

**Race handling**: because hooks matching the same event run in parallel, the mint hook is not
guaranteed to finish writing before `metta-guard-bash.mjs` reads on the *same* call. Migration
therefore keeps (or, for `metta-next`, adds) an already-allow-listed Bash call — `metta status
--json` / `metta next --json` pattern already present in `metta-execute`, `metta-plan`, etc. — as
the practical first Bash action of every Tier-2 skill body, so the mint hook completes on a call
`metta-guard-bash.mjs` doesn't need to gate, before any Tier-2 subcommand is reached on a
subsequent, sequential call. Sequential PreToolUse cycles are not racy — only concurrent hooks on
the *same* call are.

### Approaches Considered

**(a) Nonce file issued by an allow-listed CLI subcommand** (`metta session-token issue`), typed by
the orchestrator per skill instructions. Rejected as insufficiently different from status quo: the
credential's *value* is server-generated, but its *invocation* is still orchestrator-authored text
— nothing stops the orchestrator from running `metta session-token issue` standalone, with no real
skill active, then using the resulting token to authorize any Tier-2 call. It fails spec property
(c) ("absent or invalid whenever no sanctioned skill is currently driving the main session")
structurally, not just in edge cases. Its one advantage — issuance is loggable/auditable — is
retained for free by mechanism (b), since the mint hook can append the same audit line.

**(b) Skill-invocation hook mint (chosen)**. Verified against Claude Code's docs: skill frontmatter
hooks are real, fire only while the declaring skill is active, and are cleaned up when it
finishes.[^1] There is no dedicated "Skill" tool name or "skill launch" event for a *settings-level*
hook to match on[^1][^2] — WebFetch of the hooks reference confirms "no documented evidence that
PreToolUse can match on a 'Skill' tool name" and "the documentation does not provide any field …
to determine whether a skill is currently invoked."[^2] That rules out a simpler design where a
single global hook keys off `event.agent_type`-style caller identity for Tier 2 the way Tier 1
does — no such signal exists for unforked skills. Skill-scoped frontmatter hooks are the only
documented mechanism that ties a runtime-controlled action to "this specific skill is active,"
which is exactly the property Tier 2 needs.

**(c) `session_id` binding**. `session_id` is present on every hook event (common field across all
hook types)[^1], but it identifies the *Claude Code session*, not "a skill is active within it" —
the same `session_id` covers idle time, other skills, and raw orchestrator activity. Binding to
`session_id` alone would satisfy "not file-derivable" but not "absent when no skill active"; it
would need to be combined with (b) anyway (i.e., the mint hook could additionally record
`session_id` for defense in depth), so it is folded into the chosen design as an optional
refinement, not a standalone mechanism.

**(d) `transcript_path` tail inspection**. The hook would parse the session's JSONL transcript to
detect an "active skill frame." Rejected: transcripts are large and grow continuously, requiring
tail-parsing heuristics to identify skill boundaries with no documented schema guarantee for doing
so reliably; it is strictly more fragile than (b) for the same result, and (b) is already grounded
in a documented, purpose-built feature.

### Rationale

Mechanism (b) is the only candidate that satisfies all three spec properties by construction rather
than by convention: **not file-derivable** (value is `crypto.randomUUID()`, minted server-side);
**bounded lifetime** (sliding TTL, no infinite replay); **absent when no skill active** (the hook
that mints it is registered only while that skill's frontmatter is loaded and active — an idle or
skill-less session has no such hook running, so the file simply stops being refreshed and expires).
It also requires zero settings.json changes (already-wired hooks are untouched) and, notably,
removes the need for any typed instruction in skill bodies at all — Tier-2 `SKILL.md` text drops
the `METTA_SKILL=1` prefix outright rather than replacing it with a different typed step, which is
the strongest form of compliance with the spec's "no skill contract instructs typing a self-authored
token" requirement.

**Residual threat, accepted**: a token minted for skill A is only scoped to `A`'s hard-coded skill
name if planning adopts the per-skill subcommand-scoping refinement; the base design authorizes
*any* Tier-2 subcommand once *any* Tier-2 skill's hook has minted a fresh token. An orchestrator
that legitimately invokes `/metta-verify` could, within the TTL window, also slip in `metta
finalize` unrelated to that skill's contract. This is logged (every Tier-2 acceptance is an audit
record per the spec's logging requirement) and bounded by TTL, and is a materially smaller surface
than today's unconditional forgeable prefix — but planning should decide whether to close it fully
via per-skill subcommand scoping (cheap: the hard-coded skill-name argument already flows into the
token) or accept it as documented residual risk.

### Artifacts Produced

- `.claude/hooks/metta-session-mint.mjs` + `src/templates/hooks/metta-session-mint.mjs` (new,
  byte-identical pair) — mints/rotates `.metta/scratch/skill-session.token`.
- `metta-guard-bash.mjs` (both copies) — Tier-2 branch reads and validates the token in place of
  `!inv.skillBypass`.
- 15 `SKILL.md` pairs (30 files) — frontmatter `hooks:` block added; `METTA_SKILL=1` prefix text
  removed from all 154 matched call-site lines; the 10 comment/message lines per hook copy (20
  total) rewritten to describe the two-tier model instead of the retired inline prefix.
- `src/config/config-loader.ts` — the `METTA_SKILL` `RESERVED` entry (line 77) becomes dead code
  once the env-var prefix is fully retired and should be removed with its comment, not kept.
- `CLAUDE.md` "How to work" — new subsection describing both tiers and the emergency bypass.
- Test harness: `tests/metta-guard-bash.test.ts` and
  `tests/cli-metta-guard-bash-integration.test.ts` already inject synthetic `PreToolUse` JSON via
  stdin with a `bashEvent()` helper and a sandboxed `cwd`; Tier-2 coverage extends this by writing
  a token file into `<sandboxCwd>/.metta/scratch/` before invoking `runHook`, covering fresh,
  expired, and fabricated-value cases — no new harness needed.

[^1]: https://code.claude.com/docs/en/hooks — accessed 2026-07-17 (fields table, "Hooks in skills and agents" section, `once` field semantics, parallel-hook-execution note)
[^2]: https://code.claude.com/docs/en/skills — accessed 2026-07-17 (frontmatter `hooks` field table entry, confirms skill-scoped hook declaration format)
