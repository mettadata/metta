# Session-mint token clobbering after context compaction blocks Tier-2 lifecycle commands in the main session

**Captured**: 2026-08-10
**Status**: logged
**Severity**: major

## Symptom

With an active change in `.metta/worktrees/fix-automatic-versioning-release-capability-metta` (observed 2026-08-11), invoking `/metta-verify` and then `/metta-execute` should mint a session token scoped to those skills, but every Bash call left `.metta/scratch/skill-session.token` scoped to `metta-refresh` / `[refresh]` — a skill invoked much earlier in the session, before a context compaction. As a result `metta complete implementation` was repeatedly blocked by `metta-guard-bash` (`subcommand-not-in-scope`) despite a correct skill invocation, and the orchestrator had to hand the remaining lifecycle to a Tier-1 ship fork as a workaround.

## Root Cause Analysis

Skill-frontmatter PreToolUse hooks accumulate for the whole Claude Code session and survive context compaction: once `/metta-refresh` has been invoked, its `metta-session-mint.mjs metta-refresh` hook keeps firing on every subsequent Bash call for the rest of the session, alongside the mint hooks of every other Tier-2 skill invoked since. The mint script is not strictly last-writer-wins — it has a sliding-TTL freshness check (skip write if the existing token is under 80% of its TTL) — but that check is skill-agnostic: it never compares the existing token's `skill` field to its own slug. So each time the token crosses the 80% staleness threshold, whichever accumulated hook happens to fire first re-mints the token for its own slug, and all later-firing hooks (including the one belonging to the skill actually being executed) see a "fresh" token and decline to write. The winner is determined by hook registration/firing order, not by which skill is currently active — effectively first-firing-hook-wins per rotation window. `metta-guard-bash` then validates the token strictly against its `subcommands` scope, so a token stamped `metta-refresh [refresh]` blocks `complete`/`verify`/`finalize` for the genuinely active skill. Fix directions: the mint hook should not suppress its own write when the fresh token belongs to a different skill (prefer-own-slug re-mint), or merge scopes of all currently-firing mints, or key tokens per skill slug with the guard accepting any valid one.

### Evidence

- `.claude/hooks/metta-session-mint.mjs:58` — the staleness check (`existing === null || … || past 80% TTL`) never inspects `existing.skill`, so a fresh token minted by a stale skill's hook suppresses the active skill's mint (`if (!stale) process.exit(0)` at line 63), and the overwrite at lines 65–76 lets whichever hook fires first at rotation time claim the token for its own slug.
- `.claude/hooks/metta-guard-bash.mjs:237` — `if (!tok.subcommands.includes(key)) { tier2Reason = 'subcommand-not-in-scope'; return true; }` — the guard enforces the single token's scope strictly, so a `metta-refresh [refresh]` token blocks `complete` even when `/metta-execute` or `/metta-verify` was correctly invoked.
- `.claude/skills/metta-refresh/SKILL.md:10` — frontmatter registers `metta-session-mint.mjs metta-refresh` as a PreToolUse Bash hook; ten other Tier-2 skills register the same script with their own slug, and all previously-invoked ones fire on every Bash call for the rest of the session.

## Candidate Solutions

1. **Skill-aware staleness check (prefer-own-slug re-mint)** — In `metta-session-mint.mjs`, treat an existing token as stale whenever `existing.skill !== slug` in addition to the TTL test, but only overwrite a different skill's token if it is past its 80% threshold; alternatively, always let a hook re-mint over a token owned by a different skill. The most recently invoked skill's hook fires on the Bash calls its own skill body issues, so its mint lands closest to actual use. Tradeoff: with multiple stale hooks still firing per Bash call, hooks would fight — every call could rotate the token between slugs, and the ordering problem (which hook fires last) remains nondeterministic, so this only narrows the race rather than eliminating it.

2. **Merge scopes instead of replacing** — On re-mint, if a valid unexpired token exists for a different skill, write a token whose `subcommands` is the union of the existing scope and the new slug's scope (keeping the fresher `mintedAt`). The guard needs no changes. Tradeoff: scopes ratchet upward over a long session — after several skills have run, the token authorizes the union of all their subcommands, weakening the per-skill least-privilege property the two-tier trust model was designed for.

3. **Per-skill token files, guard accepts any valid one** — Key the token path per slug (e.g. `.metta/scratch/skill-session/<slug>.token`); each hook only ever writes its own file, eliminating cross-skill clobbering entirely, and `metta-guard-bash` scans the directory and authorizes a subcommand if any unexpired token's scope covers it. Tradeoff: largest change surface — both hooks plus the orchestration-guard spec and tests must be updated, and expired-token files need cleanup; it also slightly broadens authority in that any recently-invoked skill's scope stays live for its full TTL alongside the active skill's.
