# Research: Lifecycle-Aware TTL / Guard-Side Grace Window

Approach evaluated: keep the split mint/guard hook architecture, but stop keying Tier-2
freshness to a bare 5-minute wall-clock TTL — raise the effective credential lifetime via a
raised TTL and/or a guard-side grace window sized to observed subagent delegation windows,
retaining the 80% sliding refresh for active sessions.

## Approach

Two hooks stay exactly as architected today:

- `.claude/hooks/metta-session-mint.mjs` — mints/slide-refreshes per-slug tokens
  (`TTL_MS = 300000`, line 36; 80% staleness check, line 97).
- `.claude/hooks/metta-guard-bash.mjs` — validates Tier-2 calls with the strict filter
  `now - tok.mintedAt < tok.ttlMs` (line 403).

The change under this approach is purely a freshness-policy change, in one of three shapes:

1. **Option A — pure TTL raise.** `TTL_MS` 300000 → 1.8–3.6 M (30–60 min). Guard untouched.
2. **Option B — guard-side grace window (preferred within this approach).** `TTL_MS` stays
   300000; the guard accepts tokens in a second band `ttlMs <= age < ttlMs + GRACE_MS` and
   logs that acceptance distinctly.
3. **Option C — hybrid activity-gated grace.** Short hard TTL plus a grace band that applies
   only when there is evidence of ongoing session activity. Evaluated and rejected below:
   with only the existing two hooks, every guard-visible "activity" signal (token file
   mtime, sibling token freshness, log recency) is producible by ordinary orchestrator Bash
   (`touch`, file writes), which violates the spec requirement that the activity signal not
   be derivable from orchestrator command text. A trustworthy activity signal requires the
   mint-side skill-activity marker — that is the deterministic re-prime approach (intent
   Proposal item 1), a different candidate, not this one.

This approach maps to **intent Proposal item 2** ("Lifecycle-aware freshness window,
candidate 2, as defense in depth") and to the spec requirement "Credential Freshness
Survives Subagent Delegation Windows". It does **not** by itself implement the spec's
"Deterministic Tier-2 Freshness Resolution" or "Skill-Activity Signal" requirements — see
Failure Modes.

## Evidence From Logs (actual staleness numbers)

Source: `/home/utx0/Code/metta/.metta/logs/guard-bypass.log` (797 entries, 2026-07-17 →
2026-08-18; the worktree has no copy). Reason distribution: 386 `session-credential-verified`
allows, 17 `credential-expired` blocks, 4 `missing-credential`, 1 `subcommand-not-in-scope`
(remainder are fork-tier/tokenizer categories out of scope here). All 17 false blocks in the
intent's incident class are `credential-expired`, `tier:"session"` — confirming the intent's
diagnosis.

The log does not record `mintedAt` at block time, so exact staleness is not directly
observable. Best available proxy: elapsed time from the previous `session-credential-verified`
acceptance (which proves a fresh token existed at that moment) to the block. True staleness
at block time is bounded by `[TTL, gap + TTL]` = `[300s, gap + 300s]` — the token seen at the
prior allow could have been minted up to one TTL earlier, and unlogged re-mints on
intervening non-metta Bash calls could make true staleness smaller than the gap.

All 17 `credential-expired` blocks, deduplicated into 11 incidents (retry bursts collapsed):

| Incident (UTC) | Blocked call | Gap since prev allow | Staleness upper bound |
|---|---|---|---|
| 2026-07-17 01:26 + 01:31 retry | `finalize` | 245s / 494s | ~549–794s |
| 2026-07-17 01:38 | `complete verification` | 969s | ~1269s |
| 2026-07-17 02:29 | `complete research` | 407s | ~707s |
| 2026-07-17 02:36 | `complete tasks` | 265s | ~565s |
| 2026-07-17 03:16 | `complete verification` | 493s | ~793s |
| 2026-07-17 04:47 | `complete spec` | 245s | ~545s |
| 2026-07-17 06:02 | `finalize --change` | 4511s | ~4811s (~80 min) |
| 2026-07-18 00:35 | `complete intent` | 713s | ~1013s |
| 2026-07-25 07:01 (+15s retry) | `complete intent` | 1159s | ~1459s |
| 2026-07-26 04:46 | `refresh` | **45s** | ~345s |
| 2026-08-17 22:30 (5 blocks in 2s) | `finalize` x4, `backlog add` | 1544–1547s | ~1847s (~31 min) |

Key readings:

- **Distribution:** median gap ~493s (~8 min); 10 of 11 incidents ≤ 1547s (~26 min); one
  outlier at 4511s (~75 min).
- **The 45s incident is direct race evidence.** A token was verified fresh 45 seconds before
  the block, so staleness at block was at most ~345s — barely past the 300s TTL. The mint
  hook firing on that same event would have re-minted it (staleness ≥ 80% threshold), but
  the guard's read won the race. This is the same-event mint/validate race in the wild, and
  no TTL/grace value eliminates that class — it only moves the boundary (see Failure Modes).
- **The 2026-08-17 cluster is the delegation-window pattern.** ~26 minutes of subagent
  delegation with no main-session refresh, then 5 Tier-2 calls blocked within 2 seconds —
  exactly intent Problem item 1.
- **The 4511s outlier shows the tail is unbounded.** Delegation windows are as long as the
  longest subagent chain; no fixed wall-clock window provably covers them all.

Sizing conclusion: an effective lifetime of **35 min** (5 min TTL + 30 min grace) covers 10
of 11 observed incidents by gap, 9 of 11 by worst-case upper bound. **65 min** effective
(60 min grace) covers everything except the 4511s outlier's worst case (~80 min). Chasing
the outlier with wall clock alone (~90 min effective) starts approximating "no expiry."

## How It Works (concrete values, code touch points)

Recommended concrete shape — **Option B, grace window with distinct audit reason**:

- **`GRACE_MS = 1_800_000` (30 min)**, a new constant in `metta-guard-bash.mjs` next to the
  allow/block lists. Justification: covers the ≤26-min band containing 10/11 observed
  incidents; keeps the post-idle exposure bounded at 35 min effective; deliberately does NOT
  chase the 75-min outlier, whose class (arbitrarily long delegation) is the deterministic
  re-prime path's job.
- **`TTL_MS` in `metta-session-mint.mjs` stays 300000, unchanged.** Rationale for grace over
  a raised TTL: (a) the 80% sliding refresh keeps re-priming every ≤4 min of active use, so
  `mintedAt` remains a meaningful recent-activity timestamp instead of going stale for
  48 min between refreshes (80% of a 60-min TTL); (b) the freshness *policy* lives in the
  validating half where it is judged, not baked into token files (`tok.ttlMs`) where
  already-minted tokens would carry the old value across an upgrade; (c) the ordinary-vs-
  grace acceptance distinction stays observable in the audit log — a pure TTL raise makes
  every late acceptance indistinguishable from a fresh one.
- **Guard change is confined to the Tier-2 branch of the offender predicate**
  (`metta-guard-bash.mjs` ~lines 400–417). Replace the single `fresh` filter with two bands:

  - `fresh`: `now - tok.mintedAt < tok.ttlMs` (unchanged semantics)
  - `graced`: `now - tok.mintedAt < tok.ttlMs + GRACE_MS`

  Evaluation order: if no `graced` token exists → `credential-expired` (unchanged reason,
  now written only for genuinely dead credentials ≥35 min stale). Scope check runs over
  `graced`; if an in-scope token is `fresh`, log acceptance as today
  (`session-credential-verified`); if in-scope only via the grace band, log a **distinct
  reason** — e.g. `session-credential-grace-window` — with a `staleness_ms` field added to
  the audit entry. Distinct logging is mandatory: the spec's audit-fidelity requirement
  ("New acceptance paths are recorded distinctly") demands it, and it is also what makes the
  grace window tunable from future log evidence (this research was hampered by the log not
  recording staleness — fix that here).
- **`missing-credential` and `subcommand-not-in-scope` paths unchanged** (spec:
  "Freshness Fix Leaves All Other Guard Behavior Unchanged").
- **Template mirrors:** `src/templates/hooks/metta-guard-bash.mjs` and
  `src/templates/hooks/metta-session-mint.mjs` must stay byte-identical to the `.claude/hooks/`
  copies — `tests/metta-guard-bash.test.ts` already runs every case against both paths
  (`HOOK_SOURCES` array, lines 12–15), so the mirror is test-enforced.
- **Tests:** the existing harness seeds tokens with backdated `mintedAt`
  (e.g. `mintedAt: Date.now() - TTL_MS - 1000`, test lines 832, 891, 909) and spawns the
  hook as a subprocess — no fake timers needed. New cases slot directly in: backdated
  within grace → exit 0 + `session-credential-grace-window` audit entry; backdated past
  `TTL + GRACE` → exit 2 + `credential-expired`; grace token out of scope → exit 2 +
  `subcommand-not-in-scope`. Existing expired-token tests at `TTL + 1000ms` staleness will
  now expect *allow* — those expectations move to the new dead-credential boundary
  (`TTL + GRACE + 1000ms`), which is a legitimate spec-driven expectation change, not a
  regression.
- **Docs:** header comments in both hooks, `docs/internals/guard-hooks.md`, and the CLAUDE.md
  Tier-2 wording (which still describes the retired single-file `skill-session.token`)
  per the spec's documentation requirement.

Sliding refresh interaction: unchanged. Active sessions re-mint at ≥240s staleness on any
main-session Bash call; the grace band only matters when no such call happened for >5 min —
precisely the delegation window.

## Trust-Model Analysis

**What widens:** the post-activity authorization tail. Today a token authorizes Tier-2 calls
for ≤5 min after the last mint; with a 30-min grace, ≤35 min. Note the *active-session*
exposure does not change at all: while the session keeps issuing Bash calls, the mint hook
re-primes indefinitely, so an active session's session-tier authority was already
session-lifetime (this is the explicitly accepted tradeoff in the spec's modified
credential requirement). The grace window only extends the idle tail from one raw TTL to
one raw TTL plus grace — exactly the "bounded effective lifetime" formulation the spec
already codifies.

**Threat actor and marginal attack window:** the adversary here is an off-script or
prompt-injected orchestrator running `metta complete`/`finalize` directly instead of via
skills. With 5-min TTL it must strike within 5 min of the last legitimate skill activity;
with 35-min effective, within 35 min. In practice the orchestrator that would abuse the
window is the same orchestrator whose session activity keeps the token perpetually fresh
anyway — so the marginal widening is small in real terms.

**Compensating controls that remain fully in force:**

- **Per-slug scope lists** (`SKILL_SCOPES`, mint hook lines 22–34): a graced `metta-plan`
  token still only authorizes `complete`; scope never widens with freshness.
- **Fail-closed on missing/malformed:** `missing-credential`, structural validation
  (`validateToken`), the unhonored retired single-file credential, and `--` operand
  fail-closed handling are all untouched.
- **Audit trail:** every session-tier acceptance is logged; grace acceptances gain their own
  reason plus staleness, so post-hoc review can spot anomalous late usage.
- **Forgery calculus unchanged:** the guard already trusts `tok.ttlMs` read from a file an
  orchestrator could in principle write via Bash — the accepted residual is that fabricating
  a token is an audit-visible act equivalent to disabling the guard. A guard-side grace
  constant adds zero new forgeable surface; it is a hardcoded policy value, not file input.
- **Tier-1 untouched:** fork-identity checks, `SKILL_ENFORCED_SUBCOMMANDS`, background-Bash
  rejection.

**Rejected within this approach:** activity-gated grace (Option C). Every activity signal
the guard alone can observe is writable by ordinary orchestrator Bash, so gating grace on it
adds forgeable complexity without adding trust. Non-forgeable activity evidence is exactly
the deterministic re-prime candidate's mint-side marker.

## Failure Modes (including the residual race)

1. **The residual race — honest accounting.** A wall-clock band, at any width, has a
   boundary; at that boundary the same-event mint/guard race still decides the outcome.
   With mint-first ordering a token of *any* staleness gets re-minted and authorized (the
   mint hook re-mints unconditionally when stale, mint hook lines 93–98); with guard-first
   ordering a token past `TTL + GRACE` is blocked. So for any token older than 35 min whose
   skill session is still live (mint hook registered on the event), the outcome remains
   ordering-dependent — this approach **violates the spec's ordering-invariance scenario
   for that state class** ("Authorization outcome is invariant under mint/guard hook
   ordering"). Claude Code's documented behavior is that all matching hooks run in parallel
   with non-deterministic order, and the platform explicitly declines ordering guarantees
   (open feature request for sequential execution)[^1][^2]. Grace shrinks the probability
   mass at the boundary from "every delegation >5 min" (11 incidents in 32 days) to
   "every delegation >35 min" (≤1 observed incident in 32 days) — a large practical
   reduction, but not elimination.
2. **Unbounded delegation tails.** The 4511s incident shows real windows exceed any sane
   grace. Long-running subagent chains (full-workflow executes, large verify loops) will
   still trip `credential-expired`. Only the deterministic re-prime path (or an on-demand
   mint at validation time) closes this.
3. **Boundary flap on retries.** A block at the grace boundary followed by an immediate
   retry can succeed if the mint hook's rewrite from the first (blocked) event landed —
   the 2026-07-25 pair (block, retry-block 15s later) shows retries do not reliably help
   today; under grace the same nondeterminism persists at the new boundary.
4. **Stale-token honoring after genuine abandonment.** A session that invoked a Tier-2
   skill and then idled 20 min retains authorization it would previously have lost. This is
   the accepted tradeoff, but it is a behavior change reviewers should see called out.
5. **`credential-expired` semantics shift.** The reason now means "≥35 min dead," not
   "≥5 min dead." Any tooling/dashboards reading the log keep working (same reason string),
   but interpretation changes; the added `staleness_ms` field mitigates.
6. **Sibling cleanup interaction (minor).** The mint hook's `cleanupSiblings` deletes
   sibling tokens past raw TTL (`now - tok.mintedAt >= tok.ttlMs`, mint hook line 59) —
   under a guard-side grace, a *different* skill's mint event can delete a token the guard
   would still have graced. Concurrent-skill delegation windows would silently lose their
   grace eligibility. Fix in the same change: cleanup threshold must become
   `ttlMs + GRACE_MS` (requires the grace constant to be shared or duplicated across the
   two hooks — a real, if small, coupling cost of the split-hook design).

[^1]: https://code.claude.com/docs/en/hooks-guide accessed 2026-08-18
[^2]: https://github.com/anthropics/claude-code/issues/21533 accessed 2026-08-18

## Effort & Blast Radius

- **Code:** ~20–30 changed lines in `metta-guard-bash.mjs` (two-band filter, distinct audit
  reason, `staleness_ms` field, `GRACE_MS` constant), ~2 lines in `metta-session-mint.mjs`
  (sibling-cleanup threshold; TTL unchanged), mirrored byte-identically into the two
  `src/templates/hooks/` copies. No TypeScript source, no schema, no CLI changes.
- **Tests:** additive cases in `tests/metta-guard-bash.test.ts` using the existing
  backdated-`mintedAt` seeding pattern; ~4 existing expired-token expectations move to the
  new dead boundary. `tests/metta-session-mint.test.ts` gains one sibling-cleanup-threshold
  case. No new harness machinery.
- **Docs:** hook headers, `docs/internals/guard-hooks.md`, CLAUDE.md Tier-2 wording.
- **Blast radius:** confined to Tier-2 freshness evaluation and one mint-side cleanup
  threshold. Tier-1, classification lists, tokenizer, `--` handling, missing/malformed/
  out-of-scope paths untouched — matching the spec's behavior-preservation requirement.
  Effort estimate: small (single sitting including tests).

## Verdict

**Recommend-with-caveats — as the defense-in-depth layer (intent candidate 2), not as the
standalone fix.**

For it: the log evidence shows a 30-min guard-side grace window would have eliminated 10 of
11 real incidents over 32 days; the change is tiny, wholly inside the existing two-hook
architecture, trivially testable with the existing harness, and its trust cost (idle tail
5 → 35 min) is small, explicitly bounded, and already codified as accepted in this change's
spec. Option B (grace in the guard, TTL unchanged) is strictly better than Option A (raw
TTL raise): it preserves the frequent sliding refresh, keeps freshness policy in the
validating half, and makes late acceptances distinctly auditable.

Against it standing alone: it cannot satisfy two spec requirements this change carries —
deterministic ordering-invariant freshness resolution (the race survives at the grace
boundary; the 45s-gap incident proves the race class is real) and coverage of unbounded
delegation windows (the 4511s incident exceeds any defensible grace). A pure TTL/grace
change would ship with the spec's "Same-event race test proves ordering independence"
scenario unsatisfiable for beyond-grace states.

Bottom line: adopt Option B with `GRACE_MS = 1_800_000`, distinct `session-credential-grace-window`
audit reason with `staleness_ms`, and the sibling-cleanup threshold fix — **paired with the
deterministic re-prime path from the companion research** as the primary mechanism. If the
change were forced to pick exactly one mechanism, the deterministic re-prime path should win
and this one should be dropped, not the reverse.
