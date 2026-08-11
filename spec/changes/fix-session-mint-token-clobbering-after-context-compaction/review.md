# Review: fix-session-mint-token-clobbering-after-context-compaction

Three parallel reviewers (correctness, security, quality). Iteration 1.

## Verdicts

| Reviewer | Verdict |
|----------|---------|
| Correctness | PASS_WITH_WARNINGS |
| Security | PASS_WITH_WARNINGS |
| Quality | PASS |

No critical findings. One major (documentation/threat-model) finding — fixed in this change (see Resolution). All other findings are minor and recorded below as accepted warnings.

## Major finding (fixed)

- **Security — inaccurate tradeoff record + spec contradiction** (`spec/changes/.../summary.md`, `spec/specs/orchestration-guard/spec.md:53-56`): the recorded tradeoff ("every recently invoked skill's scope stays live for its full TTL") understates exposure. Because accumulated mint hooks fire on every Bash call and re-mint at 80% TTL, standing Tier-2 authorization in an active session is the **union of all Tier-2 skills invoked during the session, for the session's lifetime** — not one TTL window. The pre-existing clause "idle sessions carry no standing authorization" remains true only for idle sessions and needed explicit reconciliation with the per-skill clause. Resolution: spec and summary wording corrected to document session-lifetime union scope explicitly as the accepted tradeoff.

## Minor findings (accepted, not blocking)

1. Correctness — `metta-session-mint.mjs` `cleanupSiblings`: non-atomic `writeFileSync` means a concurrent sibling mint can momentarily see a mid-write token as malformed and unlink it; self-healing on next call. Hardening option: temp-file + `renameSync`, or delete only tokens that parse AND are expired.
2. Correctness — guard can transiently skip a partially written token during concurrent mint (pre-existing behavior class, not a regression).
3. Correctness — legacy-file removal runs only when a mint occurs; a lingering legacy token survives until next rotation. Inert (never honored).
4. Security (pre-existing) — guard trusts each token's self-declared `subcommands` and doesn't cross-check filename vs `tok.skill` or clamp scopes to a guard-side table. Requires filesystem write to abuse (outside the command-text threat model). Cheap hardening available.
5. Security — own-token staleness check validates only timestamps; a guard-invalid file at the own path suppresses re-mint up to 80% TTL (availability-only, requires local tampering).
6. Quality — `cleanupSiblings` shape check weaker than guard's `validateToken`; fresh-but-invalid sibling survives as dead weight.
7. Quality — expiry/shape logic duplicated between mint and guard (accepted: dependency-free single-file hooks).
8. Quality — staleness check doesn't compare `existing.subcommands` to `SKILL_SCOPES[slug]`; after a future scope-table change an old-scope token persists up to one TTL window.
9. Quality/Security — sibling expiry uses full TTL vs own-staleness 80%; and denial precedence reports `subcommand-not-in-scope` over `credential-expired` in mixed cases — both deliberate, test-pinned.

## Clean bill

- No path traversal via slug (SKILL_SCOPES allowlist gate) or via directory scan; cleanup cannot delete outside the directory.
- Token validation strictness preserved verbatim; fail-closed on malformed files; denial reasons correct per class.
- No forgeability from command text; Tier-1 (`agent_type`) path untouched.
- Template, installed, and dist hook copies byte-identical.
- 229 tests across the three affected suites pass; regression (different-skill fresh token no longer blocks) pinned.
