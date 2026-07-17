# Implementation Summary: fix-harden-metta-guard-bash-trust-model-unify-all-blocked

## What changed

The guard hook's forgeable inline token is gone. Authorization is now a two-tier trust model where no plain-text signal grants state-mutating access:

- **Tier 1 (fork-dispatched)**: propose, quick, auto, ship, issue, fix-issue require `event.agent_type` (runtime-verified fork identity) — now the *sole* check; the redundant prefix conjunct was removed with the prefixes.
- **Tier 2 (main-session lifecycle)**: complete, finalize, refresh, import, init, fix-gap (+ blocked two-word forms) require a session credential minted by a **skill-frontmatter-scoped PreToolUse hook** (`metta-session-mint.mjs`, new) — the token (`crypto.randomUUID()`, 0600, gitignored scratch, 300s sliding TTL, per-skill subcommand scopes baked in) exists only while a sanctioned skill is genuinely active, is rotated on use, and decays at idle. Fabricated/expired/out-of-scope credentials are rejected with distinct reasons; wrong-shape JSON fails closed.
- **`METTA_SKILL=1` is extinct**: all 154 call sites across 15 skill pairs deleted (no replacement step — the credential requires zero orchestrator action), config-loader's RESERVED special-case removed, skill-host agent instructions cleaned, guard tokenize/bypass machinery deleted. Repo-wide grep: zero matches.
- **Audit trail extended**: every rejection and every Tier-2 acceptance is logged with tier + reason; fork-tier accepts stay unlogged (unchanged).
- **Documented**: guard header, workflow primer (CLAUDE.md), and skill contracts describe the two tiers and the emergency bypass.
- **Collateral fix**: `next` added to the read-only allowlist (the metta-next contract's first call had no authorization path post-retirement; it bit this session live on day one).

## Transition engineering

The guard gates its own migration: a REMOVE-AFTER-SHIP dual-accept window carried the session through batches 1–3, then Batch 4 deleted it after the token path was test-proven. Two executor-caught defects fixed mid-flight: the design's scope-key pseudocode broke `complete <artifact>` scoping, and Tier-1's retained prefix-conjunct would have broken all fork bodies post-migration (resolved per design's "sole check" statement).

## Requirement coverage

All 8 requirements of the new `orchestration-guard` capability. US-1..US-5 live-proven with synthetic PreToolUse events (legacy prefix → exit 2 credited with nothing; fresh in-scope token → exit 0 logged; bare agent_type fork call → exit 0; full Tier-2 reject matrix).

## Verification

Suite 1131/1131 (83 files, +25 net new tests); tsc/build clean; byte-identity on all three hook/agent pairs; zero METTA_SKILL/REMOVE-AFTER-SHIP references repo-wide.

## Commits

`ea089c4b2` (mint hook), `cfb52bb95` (mint tests), `1e484961f` (Tier-2 branch), `34aab1f44` (scope-key fix), `1c5682da3` (credential matrix), `77596bfbe` (15-skill migration), `a155faf7f` (test sync), `376c6a810` (config cleanup), `03f8181bf` (docs), `d1e9fcdab` (test sync), `e421aa930` (legacy retirement), `8a7b9cabd` (identity matrix).

## Follow-ups to log

- Allowlist review for `verify`/`gaps` subcommands (currently fail-closed unknown; deferred from this change).
- metta-fix-gap (unforked) calls `metta propose` (Tier-1) — pre-existing authorization gap under old and new models alike (design-flagged).
- Residual threats (accepted, documented): (1) within a token's TTL, the orchestrator can call any subcommand in that skill's scope, not only the one the skill intended at that moment — bounded by per-skill scoping + TTL + audit logging; (2) a deliberately hand-written well-formed token file passes validation — the guard is stateless and cannot distinguish issuers; this act is not expressible as command text, is audit-visible on use, and is capability-equivalent to disabling the hook itself (spec scenario amended post-verification to state this honestly; verifier's fabrication analysis in verification.md).
