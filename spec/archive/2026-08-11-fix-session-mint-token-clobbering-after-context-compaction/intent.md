# fix-session-mint-token-clobbering-after-context-compaction

## Problem

The Tier-2 trust model authorizes main-session lifecycle subcommands (`complete`, `verify`, `finalize`, `refresh`, `import`, `init`, `fix-gap`, scoped `backlog`/`roadmap`/`release` forms) via a single session credential at `.metta/scratch/skill-session.token`, minted by `.claude/hooks/metta-session-mint.mjs` and validated by `.claude/hooks/metta-guard-bash.mjs`. Each of the 11 Tier-2 skills registers the mint script as a PreToolUse Bash hook in its frontmatter, parameterized with its own slug.

Two properties of the runtime interact badly:

1. **Hook accumulation.** Skill-frontmatter PreToolUse hooks persist for the entire Claude Code session — surviving context compaction — so once `/metta-refresh` (or any Tier-2 skill) has been invoked, its mint hook fires on every subsequent Bash call for the rest of the session, alongside the mint hooks of every Tier-2 skill invoked since.
2. **Skill-agnostic staleness check.** The mint script's sliding-TTL freshness check (`metta-session-mint.mjs:58-63`) skips the write whenever the existing token is under 80% of its TTL, without ever comparing the existing token's `skill` field to the hook's own slug.

The result is a first-firing-hook-wins race on every rotation window: whichever accumulated hook fires first when the token crosses the 80% staleness threshold re-mints the token for *its* slug and scope, and every later-firing hook — including the one belonging to the skill actually being executed — sees a "fresh" token and declines to write. `metta-guard-bash` then enforces the token's `subcommands` scope strictly (`metta-guard-bash.mjs:237`), so a token stamped `metta-refresh` / `[refresh]` blocks `complete` and `verify` for the genuinely active skill with `subcommand-not-in-scope`.

**Who is affected:** any AI-orchestrated session that invokes more than one Tier-2 skill over its lifetime — which is the normal shape of a lifecycle session (`/metta-plan` → `/metta-execute` → `/metta-verify` all mint). Observed concretely: with an active change worktree, `/metta-verify` and `/metta-execute` were repeatedly blocked from running `metta complete implementation` because the token remained scoped to a `/metta-refresh` invocation from before a context compaction, forcing the orchestrator to hand the remaining lifecycle to a Tier-1 ship fork as a workaround. This is a major reliability defect in the guard system: correct skill invocations are denied, and the workaround (routing around Tier-2 via forks) erodes the trust model the guard exists to enforce.

## Proposal

Change the Tier-2 credential mint/validate mechanism so that **a correctly invoked Tier-2 skill is always able to authorize the subcommands in its own scope, regardless of which other Tier-2 skills were invoked earlier in the session.** This intent deliberately does not pick the mechanism — research/design will select among (at least) these candidate approaches, or a justified combination:

1. **Skill-aware staleness (prefer-own-slug re-mint):** treat the existing token as stale when `existing.skill !== slug`, so the active skill's hook reclaims the token. Smallest change; narrows but does not fully eliminate the multi-stale-hook race, so design must analyze the residual failure window.
2. **Scope merging on re-mint:** union the existing token's `subcommands` with the minting skill's scope instead of replacing. Guard unchanged; tradeoff is scope ratchet — least-privilege weakens over a long session.
3. **Per-skill token files:** each hook writes only its own token (e.g. `.metta/scratch/skill-session/<slug>.token`); the guard authorizes if any unexpired token's scope covers the subcommand. Eliminates clobbering structurally; largest change surface (both hooks, orchestration-guard spec, tests), and any recently invoked skill's scope stays live for its full TTL.

Whatever mechanism is chosen, the change MUST cover:

- The mint script (`.claude/hooks/metta-session-mint.mjs`) and, if the token layout or validation semantics change, the guard (`.claude/hooks/metta-guard-bash.mjs`), keeping the guard's audit logging (accept and reject reasons) coherent with the new semantics.
- The design's explicit treatment of hook accumulation across context compaction as the operating environment — the fix must be correct when N stale Tier-2 mint hooks fire in arbitrary order on the same Bash call.
- A security review of the chosen mechanism against the existing threat model: the token must remain non-forgeable from command text, and any scope broadening (options 2/3) must be an explicit, justified tradeoff recorded in the design.
- Updates to the `orchestration-guard` capability spec so the documented two-tier trust model matches the shipped behavior.
- Tests covering the regression scenario: token minted by skill A earlier in the session, skill B invoked later, skill B's in-scope subcommand is authorized (and A-only subcommands are still rejected when only B is active, to the extent the chosen mechanism preserves that property).
- The CLAUDE.md workflow-section description of the Tier-2 credential, if the mechanism's observable behavior (token path, rotation semantics) changes.

Acceptance shape (regression scenario): Given a session in which `/metta-refresh` was invoked and a context compaction occurred, when `/metta-verify` or `/metta-execute` is subsequently invoked and its body runs `metta complete implementation` (or `metta verify`), then `metta-guard-bash` authorizes the call without `subcommand-not-in-scope`, and no Tier-1 fork workaround is needed.

## Impact

- **Guard hooks:** `metta-session-mint.mjs` changes in all cases; `metta-guard-bash.mjs` changes if token layout or lookup semantics change. Both are session-critical — a defect here either blocks all Tier-2 lifecycle commands or silently weakens the trust boundary.
- **All 11 Tier-2 skills** (`metta-next`, `metta-plan`, `metta-execute`, `metta-verify`, `metta-refresh`, `metta-import`, `metta-init`, `metta-backlog`, `metta-fix-gap`, `metta-roadmap`, `metta-release`): their frontmatter hook registrations are the callers of the mint script. Frontmatter edits are only needed if the script's CLI contract changes; behavior changes affect them all either way.
- **`orchestration-guard` spec** (40 requirements): the sections describing single-token minting, sliding-TTL rotation, and scope validation must be updated to match the fix.
- **Audit trail:** accept/reject reason strings and the `session` tier annotations in the audit log may change; downstream consumers of the log format (if any) are the design's responsibility to confirm.
- **Security posture:** options that broaden effective scope (merge, per-skill multi-token) trade some least-privilege for availability; the design must state and justify the chosen point on that tradeoff.
- **Emergency bypass path** (`.claude/settings.local.json`) is unaffected and remains the human/CI escape hatch.

## Out of Scope

- **Tier-1 (fork-tier) authorization** — `agent_type`-based trust for `propose`, `quick`, `auto`, `ship`, `issue`, `fix-issue` is untouched.
- **Changing the set of Tier-2 skills or their per-skill subcommand scopes** — `SKILL_SCOPES` membership stays as-is except as mechanically required by the chosen token layout.
- **Fixing or working around Claude Code's hook-accumulation behavior itself** — hooks persisting across compaction is treated as a fixed property of the runtime, not something this change attempts to alter or file upstream.
- **Redesigning the two-tier trust model** — no new tiers, no move away from filesystem credentials, no cryptographic signing schemes beyond the existing random-value token.
- **The TTL value (5 min) and the 80% sliding-rotation threshold** — retained unless the chosen mechanism makes them meaningless, in which case design documents the replacement.
- **Retroactive cleanup of sessions already in the broken state** — no migration tooling for stale tokens beyond what normal rotation/expiry already handles.
- **Broader guard hardening** (e.g. new blocked subcommands, tokenizer changes, audit-log format overhaul) — only changes required by the clobbering fix.
