# Research: fix-metta-guard-bash-blocks-main-session-tier-2-lifecycle

## Decision: Guard-integrated deterministic re-prime (session-bound), with a bounded grace horizon and a seam integration test suite

### Approaches Considered

1. **Guard-integrated re-prime — deterministic mint-before-validate** (selected, primary) — Move Tier-2 freshness resolution entirely inside the guard. The mint hook stamps the runtime-supplied `event.session_id` into each per-slug token; the guard treats an expired-but-valid, in-scope token as re-primable when `token.sessionId === event.session_id` and `now - mintedAt < ttlMs + GRACE_MS`, rewrites the token itself (temp+rename, best-effort), authorizes, and logs a distinct `session-credential-reprimed` reason. Freshness becomes a pure function of (token file, event fields, clock) — ordering-invariant by construction. Grounded facts: Claude Code runs all matching hooks in parallel with no ordering mechanism, and skill-frontmatter hooks stay registered for the rest of the session (https://code.claude.com/docs/en/hooks, accessed 2026-08-18) — so a sequencing fix is impossible, and token+sessionId deterministically proves genuine in-session skill invocation to the same trust standard as Tier 1's `agent_type`. See `research-guard-integrated-reprime.md`.

2. **Lifecycle-aware TTL / guard-side grace window** (adopted as the bounded horizon inside approach 1, not standalone) — Keep split hooks; guard accepts a second band `ttlMs <= age < ttlMs + GRACE_MS` with a distinct audit reason and `staleness_ms`. Log evidence (17 `credential-expired` blocks / 11 incidents over 32 days): median gap ~8 min, 10/11 incidents ≤ ~26 min, one ~75-min outlier; a 45s-gap incident is direct in-the-wild proof of the same-event race. A wall-clock band alone leaves the ordering race at its boundary and cannot cover unbounded delegation tails, so it fails the spec's ordering-invariance requirement standing alone. Verdict: recommend-with-caveats as defense in depth; if only one mechanism ships, drop this one, not approach 1. See `research-lifecycle-ttl-grace.md`.

3. **Seam integration repro tests** (selected, mandatory companion) — New `tests/metta-guard-mint-seam.test.ts` using the repo's established subprocess harness (`spawnSync` + synthetic PreToolUse JSON + temp-cwd + backdated `mintedAt` + audit-log parsing). Time control via fixture backdating (a `METTA_GUARD_NOW_MS` clock override was evaluated and REJECTED — it would add a clock-forgery bypass primitive to a security hook). Race determinism via enumerating interleavings as fixtures (guard-first vs mint-first), justified by documented parallel unordered hook execution. Bug-pinning red cases: B1 (delegation-window expiry) and C1 (guard-first race); A/E cases are regression armor including the split-cwd `missing-credential` sentinel and the genuinely-dead fail-closed complement. See `research-seam-repro-tests.md`.

### Rationale

The selected combination discharges every requirement in this change's spec delta:

- **Ordering invariance:** only the guard-integrated re-prime makes the verdict independent of mint/guard scheduling — no branch references the mint hook's same-event write. The platform offers no hook ordering, so this is the only deterministic shape available.
- **Delegation-window survival:** session binding + `GRACE_MS` covers the observed incident distribution. `GRACE_MS` sizing is a bounded-exposure judgment call — the re-prime researcher recommends 60 min (covers the 75-min-class tails via re-prime-on-use), the grace researcher recommends 30 min for a pure band; the design phase fixes the constant and records the tradeoff. Session binding makes this strictly tighter than a raw TTL raise: a leftover token from a crashed/previous session authorizes nothing (session_id mismatch → fail-closed).
- **Trust model preserved:** re-prime contributes freshness only, never scope (`SKILL_SCOPES` remains sole scope truth); every degradation path (missing `session_id`, torn write, failed re-prime write, resume/fork session-id change) fails closed to today's behavior; the pre-existing forged-token-file residual is unchanged and stated honestly.
- **Auditability:** distinct `session-credential-reprimed` acceptance reason plus `staleness_ms`; `credential-expired` now written only for genuinely dead credentials.
- **Testability:** every seam scenario is a deterministic filesystem fixture; the suite lands red-first (B1/C1) in the same change.

Required companion hardening carried into design: temp-file+rename atomic writes in both hooks; mint's `cleanupSiblings` threshold extended to `ttlMs + GRACE_MS` so housekeeping cannot delete re-primable tokens; byte-identical mirrors in `src/templates/hooks/` (enforced by `tests/hooks-byte-identity.test.ts`); two existing expiry seeds in `tests/metta-guard-bash.test.ts` (~lines 830, 904) deepened to DEAD deltas (outcome-preserving fixture change); hook headers + CLAUDE.md Tier-2 wording updated (currently cites the retired single-file `skill-session.token`).

Open items for UAT: `session_id` stability across `--resume`/`--fork` is undocumented — both outcomes are fail-closed-safe, but the post-resume UX should be confirmed empirically.

### Artifacts Produced

- [Research: guard-integrated re-prime](research-guard-integrated-reprime.md)
- [Research: lifecycle TTL / grace window (with log-evidence staleness table)](research-lifecycle-ttl-grace.md)
- [Research: seam repro test harness (with test case matrix)](research-seam-repro-tests.md)
