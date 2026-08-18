# Design: fix-metta-guard-bash-blocks-main-session-tier-2-lifecycle

Follows the research decision in `research.md`: **guard-integrated deterministic re-prime,
session-bound, with a bounded grace horizon, plus the seam integration test suite.** This
document turns that decision into concrete file-level changes. It does not re-litigate the
approach; alternatives and their rejection rationale live in the three research artifacts.

## Approach

Tier-2 freshness resolution moves entirely inside `metta-guard-bash.mjs`. The guard's verdict
becomes a pure function of **(token file state, event fields, clock)** — no branch references
the separately scheduled mint hook, so the outcome is invariant under Claude Code's documented
parallel, unordered PreToolUse execution (spec: "Deterministic Tier-2 Freshness Resolution").

Mechanism in one paragraph: the mint hook stamps the runtime-supplied `event.session_id` into
every per-slug token it writes. The guard replaces its single strict freshness filter
(`now - tok.mintedAt < tok.ttlMs`, guard line 403) with two bands — a **fresh band**
(unchanged predicate) and a session-bound **re-primable band**
(`tok.sessionId === event.session_id && now - tok.mintedAt < tok.ttlMs + GRACE_MS`). A call
authorized only via the re-primable band causes the guard to rewrite that token itself
(new random `token` value, `mintedAt = now`, temp-file+rename, best-effort) and to log the
distinct audit reason `session-credential-reprimed`. `credential-expired` is thereafter
written only for genuinely dead tokens — no fresh token AND no re-primable token.

The token file is the skill-activity signal (spec: "Skill-Activity Signal Is Non-Forgeable"):
it is written only by the mint hook, whose slug argument is a ship-time-authored frontmatter
string (mint lines 9–12, 77–78), and its `sessionId` comes from the runtime's event JSON —
the same trust class as the `agent_type` field Tier 1 already relies on. Nothing in the
re-prime path reads authorization from command text, and the re-prime path contributes
**freshness only, never scope**: scope filtering still runs over the token's `subcommands`
array exactly as today (guard lines 405–415), with `SKILL_SCOPES` in the mint hook as the
sole scope truth.

### Architecture Decision Records

**ADR-1: Guard-integrated re-prime rather than hook ordering, TTL raise, or a separate
marker file.**
Decision: adopt research approach 1 (`research-guard-integrated-reprime.md`).
Rationale: the platform documents parallel, unordered hook execution with no sequencing
mechanism (https://code.claude.com/docs/en/hooks, accessed 2026-08-18), so no split-hook
design can satisfy the spec's ordering-invariance scenario; a pure TTL/grace band leaves the
race alive at its boundary and cannot cover unbounded delegation tails
(`research-lifecycle-ttl-grace.md`, Failure Modes 1–2); a separate `.active` marker file
would be written by the same machinery with identical trust properties and identical
delegation-window staleness, for one more file to validate and clean up. The token itself,
plus a `sessionId` binding, is the simplest sufficient signal. Status: accepted.

**ADR-2: `GRACE_MS = 3_600_000` (60 minutes), one shared value for both hooks.**
Decision: the guard's re-prime horizon AND the mint hook's sibling-cleanup threshold both use
`ttlMs + GRACE_MS` with `GRACE_MS = 3_600_000`. Effective idle lifetime: 65 min from the last
mint or re-prime.
Rationale: the grace researcher's 30-min figure was sized for a **pure, session-unbound**
wall-clock band, where every extra minute widens exposure for any leftover token file. Our
band is session-bound: a token from a crashed or previous session matches no current
`session_id` and authorizes nothing, so the marginal exposure of a wider horizon is confined
to the live minting session — which, while active, already holds union-of-invoked-scopes
authority under the accepted threat model. Against the log evidence (11 incidents / 32 days:
median gap ~8 min, 10/11 ≤ ~26 min, one outlier ~75 min with a ~80 min worst-case bound):
30 min covers 10/11 incidents; 60 min covers the outlier class too, because re-prime-on-use
resets `mintedAt` on every authorized Tier-2 call — a long lifecycle with any mid-window
Tier-2 activity keeps extending its own horizon, so only a **pure idle** gap must fit inside
65 min, and even the pure-idle outlier's bound (~80 min) is within one retry-after-re-invoke
of coverage. Choosing 30 min would leave the observed outlier class blocked and reintroduce
the "hand the lifecycle to a ship fork" workaround this change exists to kill. Tradeoffs
recorded in Risks & Mitigations (threat model). Status: accepted.

**ADR-3: Time control in tests via fixture backdating; no clock override in the hooks.**
Decision: the seam suite backdates `mintedAt` in real mint-written files; a
`METTA_GUARD_NOW_MS`-style env override is rejected.
Rationale: an env-reachable clock override in a security hook is a bypass primitive (set the
clock back, revive dead credentials) and violates the intent's trust-model preservation
constraint, for zero determinism gain — backdating is already the established idiom in both
existing hook suites (`research-seam-repro-tests.md`, Harness Design §2). Status: accepted.

**ADR-4: `GRACE_MS` is duplicated in both hook files, with a test-enforced equality pin.**
Decision: each hook defines its own `GRACE_MS = 3_600_000` constant (cross-referencing
comment in both), and the seam suite asserts the literal is identical across all four hook
copies (both hooks × `.claude/hooks/` + `src/templates/hooks/`).
Rationale: the hooks are standalone zero-dependency scripts copied byte-identically to
templates and `dist/`; a shared import module would complicate the copy mechanism for one
constant. Duplication-plus-loud-test matches the existing convention of mirroring `TTL_MS`
into the test files. Status: accepted.

**ADR-5: The guard's re-prime write is best-effort, atomic, and never load-bearing for
authorization.**
Decision: the authorize decision precedes the write; write failure (read-only fs,
permissions, bad slug shape) is swallowed and the call still passes. Both hooks adopt
temp-file+rename writes.
Rationale: fail-closed posture must never invert into fail-blocked-on-housekeeping; atomic
rename removes the torn-read window between the guard's rewrite and a concurrently firing
mint hook (POSIX same-directory rename). Status: accepted.

No decision in this change creates vendor lock-in beyond what already exists: the hooks
depend on Claude Code's documented PreToolUse event shape (`session_id`, `cwd`,
`agent_type`), which is the pre-existing platform coupling of the whole guard layer, not a
new one.

## Components

All paths relative to the change root
`/home/utx0/Code/metta/.metta/worktrees/fix-metta-guard-bash-blocks-main-session-tier-2-lifecycle/`.

### 1. `.claude/hooks/metta-session-mint.mjs` (minting half)

- **`GRACE_MS = 3_600_000`** constant added next to `TTL_MS` (line 36), with a comment:
  "MUST equal GRACE_MS in metta-guard-bash.mjs — the guard's re-prime horizon and this
  hook's sibling-cleanup threshold are one policy; seam tests pin the equality."
- **Session stamping** — the token object (lines 101–107) gains one field:
  `sessionId: event.session_id ?? null`. The mint hook does not type-check it; the guard's
  strict `===` comparison against a known-string `session_id` makes any non-string value
  inert (never re-primable, fail-closed).
- **Cleanup horizon** — `cleanupSiblings` (expiry predicate, line 59) changes from
  `now - tok.mintedAt >= tok.ttlMs` to `now - tok.mintedAt >= tok.ttlMs + GRACE_MS`, so
  housekeeping on an unrelated skill's mint event can no longer delete a sibling token the
  guard would still re-prime (research failure mode 8: starving the re-prime path is a
  fail-closed nuisance, but a real recurrence vector for this exact bug).
- **Atomic write** — the mint write (line 112) becomes write-to
  `${tokenPath}.${randomUUID()}.tmp` (mode 0o600) then `renameSync` onto `tokenPath`, inside
  the existing swallow-all try/catch. `cleanupSiblings` additionally unlinks `*.tmp` files
  in the token dir whose mtime is older than `TTL_MS` (orphans from a crashed writer;
  best-effort). The `.token` suffix filters in both hooks (mint line 50, guard line 320)
  already ignore in-flight `.tmp` files.
- **Header comment** (lines 2–13) updated: describes the two-band freshness model, the
  `sessionId` binding, and that the guard is now the re-priming half during delegation
  windows while this hook remains the sole *minting* half.

### 2. `.claude/hooks/metta-guard-bash.mjs` (validating half)

- **Imports** — add `writeFileSync`, `renameSync`, `unlinkSync` to the `node:fs` import
  (line 18) and `randomUUID` from `node:crypto` (new import).
- **`GRACE_MS = 3_600_000`** constant added with the mirror comment (place after
  `SKILL_HINT_MAP`, i.e. after line 97, in the constants region).
- **`validateToken` (lines 297–304): unchanged.** `sessionId` is deliberately not a
  structural requirement — old-format tokens (pre-fix, no `sessionId`) still validate and
  work in the fresh band; they are simply never re-primable. Fail-closed degradation, no
  migration step.
- **`readSessionTokens` (lines 314–329)** — each returned token is annotated with the source
  filename it was read from (e.g. push `{ tok, file: name }` pairs, or attach a parallel
  field consumed only by the re-prime writer). The re-prime write targets exactly the path
  the token was read from — read-path/write-path symmetry by construction, no second
  resolution scheme.
- **Tier-2 evaluation (offender predicate, lines 400–417)** — the core change. Replace the
  single fresh filter with:

  ```js
  const tokens = readSessionTokens(event.cwd);
  if (tokens.length === 0) { tier2Reason = 'missing-credential'; return true; }
  const now = Date.now();
  const sessionId = typeof event.session_id === 'string' ? event.session_id : null;
  const fresh = tokens.filter((t) => now - t.tok.mintedAt < t.tok.ttlMs);
  // Deterministic re-prime band: same live session (runtime-supplied session_id,
  // never command text) AND within the bounded effective lifetime.
  const reprimable = tokens.filter((t) =>
    sessionId !== null &&
    t.tok.sessionId === sessionId &&
    now - t.tok.mintedAt < t.tok.ttlMs + GRACE_MS);
  const eligible = dedupe([...fresh, ...reprimable]);
  if (eligible.length === 0) { tier2Reason = 'credential-expired'; /* staleness_ms threaded */ return true; }
  const key = /* unchanged scope-key derivation, lines 408–411 */;
  const inScope = eligible.filter((t) => t.tok.subcommands.includes(key));
  if (inScope.length === 0) { tier2Reason = 'subcommand-not-in-scope'; return true; }
  // Accept. If NO in-scope token is fresh, authorization came via re-prime only:
  // rewrite that token (best-effort — failure never revokes the authorization).
  const viaFresh = inScope.some((t) => fresh.includes(t));
  if (!viaFresh) reprimeToken(event.cwd, inScope[0], now);
  tier2Accepted.push({ inv, reason: viaFresh ? 'session-credential-verified'
                                             : 'session-credential-reprimed',
                       staleness_ms: now - inScope[0].tok.mintedAt });
  return false;
  ```

  Ordering invariance holds by construction: mint-wrote-first → fresh-band acceptance;
  guard-read-first → re-prime acceptance; mint never fires → re-prime is self-sufficient.
  No branch consults anything the mint hook may or may not have done on this event.

- **`reprimeToken(cwd, entry, now)`** (new function): builds
  `{ ...entry.tok, token: randomUUID(), mintedAt: now }`, strips any annotation fields,
  validates the target filename shape before writing (defense against a forged token
  steering the write path — see Risks R6), writes temp+rename with mode 0o600 into the same
  `skill-session` directory `readSessionTokens` resolved from `event.cwd`, and swallows all
  errors.
- **Audit logging** — `appendAuditLog` (lines 333–352) gains an optional trailing
  `extra = {}` parameter spread into the entry. Uses:
  - Acceptance loop (lines 420–427): logs each `tier2Accepted` entry with its per-call
    reason (`session-credential-verified` or `session-credential-reprimed`) and
    `staleness_ms`. The fork-caller Tier-2 acceptance path (lines 396–398) keeps its
    current `session-credential-verified` reason with `staleness_ms: null`
    (behavior-preserving per the spec's unchanged-surfaces requirement).
  - `credential-expired` blocks: `staleness_ms` = age of the youngest structurally valid
    token considered (aids future horizon tuning — the grace research was hampered by the
    log lacking exactly this field).
- **Header comment** (lines 2–16) updated: two-band freshness model, `sessionId` binding,
  distinct audit reasons, emergency bypass unchanged.
- **Everything else unchanged**: Tier-1 fork identity (lines 289–291, 392–394),
  `SKILL_ENFORCED_SUBCOMMANDS`, background-Bash rejection (lines 364–374), allow/block/bare
  lists, tokenizer, chain-separator segmentation, quote handling, `--` operand-terminator
  fail-closed path (lines 435–447), `missing-credential` and `subcommand-not-in-scope`
  reasons, retired single-file credential remains unhonored.

### 3. Template mirrors

`src/templates/hooks/metta-session-mint.mjs` and `src/templates/hooks/metta-guard-bash.mjs`
updated to remain byte-identical to the `.claude/hooks/` copies. Enforced automatically by
`tests/hooks-byte-identity.test.ts` (data-driven over the directory listing); no test change
needed there. Templates flow to `dist/` at build time per the existing copy step.

### 4. Tests

- **New: `tests/metta-guard-mint-seam.test.ts`** — per `research-seam-repro-tests.md`:
  - Harness: `PAIRS` (source + deployed, mint always paired with same-tier guard),
    `bashEvent(command, cwd, extra)` **extended to carry `session_id`** (the research
    snippet predates the session-binding decision — both mint warm-up and guard events must
    carry the same `session_id` for the re-prime band to engage), `runMint`/`runGuard` via
    `spawnSync` with separate `procCwd` vs `eventCwd`, `makeMainAndWorktree()` topology
    builder, `readAuditEntries` reuse.
  - Time control: `backdate(cwd, deltaMs)` helper with `TIMESTAMP_FIELDS = ['mintedAt']`
    (must NOT touch `sessionId`), plus `utimesSync` mtime backdating. Constants:
    `RAW_TTL = 300_000`, `GRACE_MS = 3_600_000` mirrored;
    `DELEGATION = 900_000` (15 min — inside the band, matches the 2026-08-17 incident
    class), `DEAD = RAW_TTL + GRACE_MS + 60_000`.
  - Constant-drift pin (ADR-4): one test reads all four hook files and asserts each
    contains the identical `GRACE_MS = 3_600_000` literal.
  - Case matrix (IDs from the research): regression armor A1–A4 (fresh-token main cwd,
    consistent worktree cwd, split-cwd `missing-credential` sentinel, event.cwd-drives-
    resolution); **red-first bug pins B1** (delegation-window backdate → post-fix exit 0
    with audit reason `session-credential-reprimed`, zero `credential-expired` entries;
    pre-fix exit 2) and **C1** (guard-first ordering, same state → post-fix exit 0;
    pre-fix exit 2); C2 (mint-first ordering → same verdict as C1, invariance pair);
    optional C3 stress smoke (concurrent mint+guard ×25, non-load-bearing, gated behind an
    env flag if CI time matters); B2 sliding-refresh sanity; fail-closed armor E1–E5
    (no-mint `missing-credential` with skill hint, `DEAD` backdate → `credential-expired`,
    fresh out-of-scope → `subcommand-not-in-scope`, retired single-file ignored,
    hand-fabricated signal fails closed). Two session-binding additions beyond the research
    matrix: **E6** — token minted under `session_id: A`, guard event carries `B`, backdated
    `DELEGATION` → exit 2 `credential-expired` (stale-token-from-previous-session is dead);
    **E7** — guard event carries no `session_id`, backdated `DELEGATION` → exit 2
    (re-prime disabled, degrades to pre-fix behavior, fail-closed).
  - B1/C1 must be committed verified-red against the unfixed hooks first, per the spec's
    "demonstrably capable of failing" requirement.
- **`tests/metta-guard-bash.test.ts`** — deepen the expiry seeds in the two
  `credential-expired` tests (test at line 830, seed at line 832; test at line 904, seeds at
  lines 909 and 914) from `Date.now() - TTL_MS - 1000` to `DEAD` deltas
  (`Date.now() - TTL_MS - GRACE_MS - 60_000`). Outcome-preserving fixture change: "expired"
  now unambiguously means genuinely dead regardless of whether future harness changes stamp
  `sessionId`. Flag for reviewers: this is a fixture deepening, not weakened coverage.
  **Deliberately untouched:** the third old-format expiry seed at line 891 (inside the
  `subcommand-not-in-scope` test) — it seeds no `sessionId` and its event carries no
  `session_id`, so the expired in-scope token stays ineligible and the expected
  `subcommand-not-in-scope` outcome is unchanged. This suite's `seedToken` must NOT gain
  automatic `sessionId` stamping; old-format seeds are load-bearing legacy-token coverage.
- **`tests/metta-session-mint.test.ts`** — extend: (a) token payload test (~line 140)
  asserts the new `sessionId` field equals the event's `session_id`, and equals `null` when
  the event omits it; (b) sibling-cleanup test (line 235) gains cases pinning the new
  horizon — a sibling backdated between `ttlMs` and `ttlMs + GRACE_MS` is KEPT, one past
  `ttlMs + GRACE_MS` is deleted; (c) atomic-write sanity — after mint, no `*.tmp` residue
  remains and the token parses.
- **Unmodified suites that must stay green:** `tests/cli-metta-guard-bash-integration.test.ts`,
  `tests/hooks-byte-identity.test.ts`, `tests/metta-guard-agent-dispatch.test.ts`,
  `tests/metta-guard-edit.test.ts`, and every other case in the two extended suites.

### 5. Documentation

- Hook header comments (both hooks) — described above.
- **`CLAUDE.md` (root, workflow section)** — the Tier-2 bullet currently cites the retired
  single-file `.metta/scratch/skill-session.token`; rewrite to: per-skill credentials at
  `.metta/scratch/skill-session/<slug>.token`, minted at skill invocation, slide-rotated on
  active use, session-bound re-prime by the guard across delegation windows, bounded
  effective lifetime of `TTL + GRACE` after the last activity. (Workflow-section edits are
  an allowed exception per that section's own rules.)
- **`docs/internals/guard-hooks.md`** — exists; update the Tier-2 credential lifecycle
  description to the two-band model, the new audit reasons (`session-credential-reprimed`,
  `staleness_ms` field), and the corrected meaning of `credential-expired` (genuinely dead:
  ≥ `TTL + GRACE` stale, or session mismatch, with no fresh token).

## Data Model

### Per-slug session token — `<cwd>/.metta/scratch/skill-session/<slug>.token` (mode 0o600)

```json
{
  "token": "<randomUUID — rotated on every mint AND every guard re-prime>",
  "skill": "metta-next",
  "subcommands": ["complete", "finalize"],
  "mintedAt": 1755500000000,
  "ttlMs": 300000,
  "sessionId": "<event.session_id at mint time, or null>"
}
```

Additive, backward-compatible: `validateToken` requires only the original five fields.
Old-format tokens validate, work in the fresh band, and are never re-primable (fail-closed).
`sessionId: null` (runtime omitted the field) behaves identically to old-format.

### Freshness bands (guard-side policy, judged at validation time)

| Band | Predicate | Audit reason on acceptance |
|---|---|---|
| Fresh | `now - mintedAt < ttlMs` | `session-credential-verified` |
| Re-primable | `sessionId === event.session_id (string) && now - mintedAt < ttlMs + GRACE_MS` | `session-credential-reprimed` (token rewritten: new `token`, `mintedAt = now`) |
| Dead | neither band | `credential-expired` block |

Constants: `TTL_MS = 300_000` (unchanged, mint line 36); `GRACE_MS = 3_600_000` (new, both
hooks, ADR-2/ADR-4). Mint sliding refresh at 80% of TTL (mint line 97) unchanged. Mint
sibling cleanup threshold: `ttlMs + GRACE_MS`.

### Audit log entry — `<cwd>/.metta/logs/guard-bypass.log` (JSONL, append-only)

Existing fields unchanged (`ts`, `verdict`, `subcommand`, `third`, `agent_type`, `reason`,
`tier`, `event_keys`). New optional field:

- `staleness_ms` (number | null) — on session-tier acceptances: age of the authorizing
  token at evaluation; on `credential-expired` blocks: age of the youngest structurally
  valid token considered; `null`/absent on entries where it does not apply (e.g.
  fork-caller Tier-2 acceptances).

New `reason` value: `session-credential-reprimed`. Existing values keep their strings;
`credential-expired` narrows in meaning to genuinely-dead-only (log consumers see the same
string with a stricter semantic — called out in `guard-hooks.md`).

## API Design

The hooks' public surface is the Claude Code PreToolUse contract plus the audit log. No
TypeScript `src/` API, no CLI surface, and no schema module changes.

### Mint hook: `node metta-session-mint.mjs <slug>` — stdin: PreToolUse event JSON

- Consumes: `tool_name` (must be `Bash`), `cwd`, `session_id` (new). Slug from argv only.
- Effect: mints/rotates `<event.cwd>/.metta/scratch/skill-session/<slug>.token` when absent,
  malformed, or ≥80% TTL stale; stamps `sessionId`; cleans siblings past `ttlMs + GRACE_MS`
  and stale `*.tmp` orphans; removes the retired single-file credential.
- Exit: always 0. Never blocks, never writes stderr guidance.

### Guard hook: `node metta-guard-bash.mjs` — stdin: PreToolUse event JSON

- Consumes: `tool_name`, `tool_input.command`, `tool_input.run_in_background`, `cwd`,
  `agent_type` (Tier 1), `session_id` (new, Tier 2 re-prime band only).
- Exit 0: allow. Exit 2 + stderr guidance: block. Unchanged codes and message shapes for
  all pre-existing paths; the generic Tier-2 block message (lines 479–484) already
  describes the per-slug credential and needs no change.
- Missing/non-string `session_id`: re-prime band disabled; guard behaves exactly as
  pre-fix (fresh band only). Fail-closed degradation, never fail-open.
- Side effect (new): best-effort atomic rewrite of the authorizing token on
  re-prime-band-only acceptances. Write failure is invisible to the caller.

### Compatibility matrix (mixed versions during rollout)

| Mint version | Guard version | Behavior |
|---|---|---|
| old | old | status quo (bug present) |
| new | old | `sessionId` field ignored by old `validateToken`? — no: old guard's `validateToken` checks only its five fields and ignores extras → status quo, safe |
| old | new | tokens lack `sessionId` → never re-primable → status quo, safe |
| new | new | fixed behavior |

Both hooks ship in one commit and are copied together; the matrix only matters for stale
`dist/` deployments and is safe in every cell.

## Dependencies

- **No new packages.** Both hooks remain zero-dependency Node scripts. New imports are
  node builtins only: `randomUUID` from `node:crypto` (guard; mint already imports it),
  `renameSync`/`unlinkSync`/`writeFileSync` additions to existing `node:fs` imports,
  `utimesSync`/`statSync` in the test helper.
- **Platform (pre-existing, verified):** Claude Code PreToolUse event fields `session_id`,
  `cwd`, `agent_type` (documented common input fields — https://code.claude.com/docs/en/hooks,
  accessed 2026-08-18); parallel unordered hook execution; skill-frontmatter hooks persist
  for the session. One documented-behavior gap: `session_id` stability across
  `--resume`/`--fork` is not specified — both outcomes are fail-closed-safe (see R4) and it
  is flagged as a UAT item.
- **Internal:** `tests/hooks-byte-identity.test.ts` (mirror enforcement, unchanged);
  existing build-time template copy step (unchanged); Vitest + `spawnSync` harness patterns
  from the three existing hook suites.
- **Ordering within the change:** seam suite lands with B1/C1 verified red against the
  unfixed hooks first, then the hook fix turns them green — same change, red-first commits.

## Risks & Mitigations

### Threat model (recorded per the MODIFIED credential requirement)

- **R1 — Widened idle exposure (accepted tradeoff).** Post-activity authorization tail
  grows from ≤5 min to ≤65 min (`TTL + GRACE`) within the minting session. Bounded by:
  session binding (a new/other session gets nothing), scope confinement (`SKILL_SCOPES`
  unchanged — re-prime never widens scope), and hard death past the horizon. Explicit
  property, by design: **each authorized Tier-2 call re-primes the token, so active
  lifecycle use extends the window** — this is skill-session activity per the spec's "while
  skill-session activity continues" wording, and it is what covers the ~75-min outlier
  class. Consequence: effective session-tier authority during a live session is the union
  of invoked skills' scopes for up to `TTL + GRACE` after the *last* mint or re-prime, not
  after the first. Once activity ceases, all credentials die within one bounded effective
  lifetime — the idle-session no-standing-authorization property holds.
- **R2 — Pre-existing forged-token residual: unchanged, stated honestly.** The guard
  validates token structure, never a server-side secret. An orchestrator that deliberately
  writes a well-formed token file (Write tool / unscanned heredoc) — including copying its
  own `session_id` — could self-authorize before this change and still can. Accepted in the
  capability's threat model as audit-visible and capability-equivalent to disabling the
  guard. This change neither narrows nor widens it.
- **R3 — Guard becomes a state writer for the first time.** New failure surface: partial
  writes, permission errors, concurrent mint writes. Mitigations: authorize-then-write
  ordering (write failure never revokes, ADR-5); temp+rename atomicity in both hooks (a
  torn read anywhere degrades to `validateToken → null` → fail-closed re-block, never a
  breach); same-path-as-read targeting via the `readSessionTokens` filename annotation;
  mode 0o600.
- **R4 — `session_id` semantics across `--resume`/`--fork` undocumented.** If resume
  changes the id: pre-resume tokens become non-re-primable; user re-invokes the skill once
  (fail-closed, minor UX cost). If resume preserves the id but drops frontmatter hooks: the
  guard re-prime is self-sufficient and the lifecycle keeps working. **UAT item:** confirm
  post-resume behavior empirically; neither outcome is unsafe.
- **R5 — Missing/non-string `event.session_id`** (older runtime, unexpected event shape):
  re-prime band disabled entirely → exact pre-fix behavior. Fail-closed; covered by seam
  case E7. Old-format tokens without `sessionId`: never re-primable, same degradation.
- **R6 — Path steering of the re-prime write.** A forged token with a hostile `skill`/
  filename (e.g. `../../x`) could otherwise aim the guard's new write outside the token
  dir. Mitigations: the write targets the annotated filename actually read from the token
  dir (already `.token`-suffixed directory entries, not token-content-derived paths), plus
  a defensive filename shape check in `reprimeToken` before writing; on mismatch the write
  is skipped and authorization is unaffected.
- **R7 — Sibling cleanup starving re-prime.** If the mint cleanup horizon were not
  extended in lockstep, another skill's mint event could delete a re-primable token →
  `missing-credential` recurrence of the original symptom. Mitigation: the shared
  `GRACE_MS` (ADR-2) applied to `cleanupSiblings` in the same commit, pinned by the new
  mint test cases and the ADR-4 constant-equality test.
- **R8 — Constant drift between the two hooks / four copies.** Mitigation: ADR-4 equality
  test plus byte-identity suite; drift fails loudly in CI.
- **R9 — Audit-consumer semantic shift.** `credential-expired` now means "genuinely dead"
  (≥65 min stale or session-mismatched), not "≥5 min stale". Same reason string, so
  existing tooling keeps parsing; new `staleness_ms` field makes the shift observable and
  future horizon tuning evidence-based. Documented in `guard-hooks.md`.
- **R10 — Test-harness coupling to the marker design.** `backdate()` and case E5 depend on
  the token field layout. Mitigation: all knowledge funneled into `TIMESTAMP_FIELDS` + one
  helper; warm-up always uses the real mint hook, never hand-modeled tokens; seam suite
  lands in the same change as the fix.
- **R11 — Residual torn-read window under true concurrency.** No deterministic test can
  force a mid-write read; C3 gives probabilistic smoke coverage only. With temp+rename in
  both hooks the window is closed by construction on POSIX; the residual on exotic
  filesystems degrades fail-closed (parse failure → token skipped).

### Explicitly unchanged surfaces (spec: "Freshness Fix Leaves All Other Guard Behavior Unchanged")

Tier-1 fork identity and `SKILL_ENFORCED_SUBCOMMANDS`; background-Bash rejection;
allow/block/bare classification lists; tokenizer, chain-separator segmentation, quote
handling, and `--` operand-terminator fail-closed path; `missing-credential` and
`subcommand-not-in-scope` reasons and messages; the retired single-file credential remains
unhonored; no subcommand moves between tiers or lists. The split-cwd asymmetry stays a
documented sentinel (`missing-credential`, seam case A3) — any deeper defect it reveals is
logged as a separate issue, not patched here.
