# Research: Integration Repro Tests for the Mint/Validate Seam

Candidate 3 from intent.md — the mandatory test companion to whichever freshness fix lands
(deterministic re-prime and/or lifecycle-aware window). This document designs the harness that
deterministically reproduces the defect states and pins both the bug and the fail-closed
complement.

## Approach

Spawn both hooks as real subprocesses — `node <mint-hook> <slug>` and `node <guard-hook>` — feeding
synthetic PreToolUse JSON events on stdin, exactly as the Claude Code runtime does. Control time by
**backdating filesystem state** (rewriting `mintedAt`/marker timestamps in the files the mint hook
actually wrote), not by injecting a clock. Make the same-event race deterministic by **materializing
each interleaving as a filesystem fixture** (guard-reads-before-mint-wrote vs. mint-wrote-first) and
asserting the guard's verdict is identical in both, rather than trying to win real scheduling races.

This is grounded in the platform's documented behavior: all matching hooks for an event run in
parallel with no ordering guarantee[^1], so the only thing the guard can ever observe is a
filesystem state — which means the full interleaving space is enumerable as fixtures.

[^1]: https://code.claude.com/docs/en/hooks accessed 2026-08-18 — "All matching hooks run in parallel."

## Existing Test Infrastructure

The repo already has strong subprocess-based hook coverage; the seam suite composes established
patterns rather than inventing a harness:

| File | What it covers today | Reusable pattern |
|------|---------------------|------------------|
| `tests/metta-session-mint.test.ts` | Mint hook alone: token payload/mode/scope table, 80% sliding rotation, sibling hygiene, legacy-file removal. Runs against BOTH `src/templates/hooks/` and `.claude/hooks/` copies. | `runHook(hookPath, slug, event, {cwd})` via `spawnSync('node', [hookPath, slug], {input: JSON.stringify(event), cwd})`; `seedToken()` writes token files with arbitrary `mintedAt` — this is the existing time-control idiom. |
| `tests/metta-guard-bash.test.ts` (1206 lines) | Guard alone: classification lists, Tier-1 fork identity, background-Bash, and a full Tier-2 section (fresh token allowed, expired blocked `credential-expired`, missing-credential, out-of-scope, any-valid-token union, retired single-file ignored). | `seedToken(cwd, overrides)` with backdated `mintedAt` (e.g. line ~832 `Date.now() - TTL_MS - 1000`); `readAuditEntries(cwd)` parses `.metta/logs/guard-bypass.log`; per-test `mkdtempSync` cwd isolation with `afterEach` cleanup. |
| `tests/cli-metta-guard-bash-integration.test.ts` | End-to-end hook + install wiring; contains the ONLY existing mint→guard seam tests (lines ~416, ~506, ~588): run mint subprocess for a slug, then run guard against the freshly minted token. Fresh-token happy path only, template copies only. | The exact mint-then-guard composition the seam suite generalizes. |
| `tests/hooks-byte-identity.test.ts` | Pins `.claude/hooks/*.mjs` byte-identical to `src/templates/hooks/*.mjs`, data-driven over the directory listing. | Guarantees testing either copy tests both — but existing convention still loops over both, which the seam suite follows. |

**Coverage gap the seam suite fills:** no existing test exercises (1) time advancement between mint
and guard (the delegation window), (2) the expired-but-refreshable race state, (3) any worktree-cwd
event, or (4) mint+guard firing on the *same* event. Both hooks read bare `Date.now()` with no
clock override (`metta-session-mint.mjs` lines 97/100, `metta-guard-bash.mjs` line 402) — confirmed
by reading both files in full.

Conventions to honor: Vitest, `kebab-case` test filename in `tests/`, temp-dir isolation, run
against both hook copies, near 1:1 test-to-source ratio (the seam file is the "integration seam"
counterpart, matching the `cli-metta-guard-bash-integration.test.ts` precedent).

## Harness Design

New file: `tests/metta-guard-mint-seam.test.ts`.

### 1. Hook invocation

Follow the existing spawn pattern, paired per tier so source-mint runs with source-guard and
deployed-mint with deployed-guard (never cross-tier):

```ts
const PAIRS = [
  { label: 'source',
    mint:  join(ROOT, 'src', 'templates', 'hooks', 'metta-session-mint.mjs'),
    guard: join(ROOT, 'src', 'templates', 'hooks', 'metta-guard-bash.mjs') },
  { label: 'deployed',
    mint:  join(ROOT, '.claude', 'hooks', 'metta-session-mint.mjs'),
    guard: join(ROOT, '.claude', 'hooks', 'metta-guard-bash.mjs') },
]

function bashEvent(command: string, cwd: string, extra: {agent_type?: string} = {}) {
  return { tool_name: 'Bash', tool_input: { command }, cwd, ...extra }
}

// Warm-up: run the REAL mint hook, not a hand-seeded token. This is the load-bearing
// harness decision: whatever activity marker / token metadata the fix's mint half
// writes, the seam tests exercise the genuine artifact — hand-seeded fixtures would
// silently diverge from the fix's marker design.
function runMint(mintPath: string, slug: string, eventCwd: string, procCwd = eventCwd) {
  return spawnSync('node', [mintPath, slug],
    { input: JSON.stringify(bashEvent('metta status --json', eventCwd)),
      encoding: 'utf8', timeout: 10_000, cwd: procCwd })
}

function runGuard(guardPath: string, command: string, eventCwd: string, procCwd = eventCwd) {
  const r = spawnSync('node', [guardPath],
    { input: JSON.stringify(bashEvent(command, eventCwd)),
      encoding: 'utf8', timeout: 10_000, cwd: procCwd })
  return { code: r.status ?? -1, stderr: r.stderr ?? '' }
}
```

Setting `procCwd` separately from `eventCwd` lets one test pin that `event.cwd` (not the hook
process cwd) drives token-store resolution in both hooks — both prefer `event.cwd ?? process.cwd()`.

### 2. Time control: fixture backdating (recommended), not a clock env var

Three options evaluated:

1. **Backdate filesystem state (RECOMMENDED).** After a real mint, rewrite the timestamp fields in
   every file under `<cwd>/.metta/scratch/skill-session/` (and any marker location the fix adds),
   subtracting a delta; also `utimesSync` each file's mtime back by the same delta in case the fix
   uses mtime-based freshness. One helper, one choke point to update when the fix's marker design
   lands:

   ```ts
   const TIMESTAMP_FIELDS = ['mintedAt' /* + fix's marker fields, e.g. 'lastActivityAt' */]

   function backdate(cwd: string, deltaMs: number) {
     const dir = join(cwd, '.metta', 'scratch', 'skill-session')
     for (const name of readdirSync(dir)) {
       const p = join(dir, name)
       try {
         const obj = JSON.parse(readFileSync(p, 'utf8'))
         for (const f of TIMESTAMP_FIELDS)
           if (Number.isFinite(obj[f])) obj[f] -= deltaMs
         writeFileSync(p, JSON.stringify(obj), { mode: 0o600 })
       } catch { /* non-JSON marker files: fall through to mtime */ }
       const st = statSync(p)
       utimesSync(p, new Date(st.atimeMs - deltaMs), new Date(st.mtimeMs - deltaMs))
     }
   }
   ```

   Pros: zero production-code change; already the established idiom (`seedToken` with backdated
   `mintedAt` in both existing hook test files); works for JSON-field and mtime-based marker
   designs. Cons: helper must learn the fix's marker field names/paths (single-line update).

2. **`METTA_GUARD_NOW_MS` test-only env override in the hooks — REJECTED.** It would add a
   time-forgery knob to a security-critical authorization hook: setting the clock backward revives
   expired credentials, so any path that lets the override reach the hook's process env (settings
   edits, shell profile, CI config) becomes a bypass primitive. It also violates the change's own
   trust-model preservation constraint (intent Impact) for zero determinism gain over option 1.

3. **Vitest fake timers — INAPPLICABLE.** `vi.useFakeTimers()` patches the test process's clock;
   the hooks run as child processes with their own real `Date.now()`.

### 3. Race determinism: enumerate interleavings as fixtures

The guard's only interaction with the mint half is reading the token dir (`readSessionTokens`,
guard line 314); the mint's only effect is writing its own token file. Under parallel unordered
scheduling[^1] there are exactly two coarse observable orderings, both expressible as fixtures with
no real concurrency:

- **Guard-first (mint refresh has NOT landed):** real mint warm-up → `backdate(cwd, delta)` with
  `rawTTL < delta < effectiveLifetime` → run guard alone. This IS the lost race, materialized.
- **Mint-first (refresh landed):** same backdated state → run mint (which re-mints, since
  `delta > 80%·TTL`) → run guard.

Ordering invariance = both cases yield the same guard verdict (spec: "Authorization outcome is
invariant under mint/guard hook ordering"). A supplementary stochastic stress case (spawn mint and
guard concurrently with `Promise.all` × ~25 iterations, assert guard exit 0 every time) can be
added as a smoke test but must not be load-bearing — scheduling is not controllable, and the two
fixture cases already cover the full observable state space (modulo torn reads, see Risks).

### 4. Worktree-cwd topology

Mirror the real layout so the repro matches the field report (change hosted under
`.metta/worktrees/<slug>`):

```ts
function makeMainAndWorktree() {
  const main = mkdtempSync(join(tmpdir(), 'metta-seam-'))
  const worktree = join(main, '.metta', 'worktrees', 'fix-some-change')
  mkdirSync(worktree, { recursive: true })
  return { main, worktree }
}
```

Two sub-cases: consistent cwd (mint event.cwd = guard event.cwd = worktree) and split cwd (mint at
main, guard at worktree) — the latter pins the cwd-asymmetry as a *sentinel*, per intent Out of
Scope: its expected outcome stays `missing-credential` under the established per-cwd resolution,
and any deeper defect it reveals is logged as a separate issue, not patched here.

### 5. Audit assertions

Reuse the `readAuditEntries(cwd)` pattern from `tests/metta-guard-bash.test.ts` (~line 799).
Seam-specific assertions: (i) acceptances via the new re-prime/grace path carry a reason
**distinct** from `session-credential-verified` (spec: "New acceptance paths are recorded
distinctly" — exact string fixed by the design phase); (ii) `credential-expired` appears only in
the genuinely-dead case; (iii) live-session cases produce zero `credential-expired` entries.

## Test Case Matrix

`rawTTL` = 300 000 ms (mint hook line 36). `DELEGATION` = a delta with
`rawTTL < DELEGATION < effectiveLifetime` (e.g. rawTTL + 10 min if the design lands a ≥20 min
effective lifetime — parameterize off the design's constant). `DEAD` = a delta past every avenue
(raw TTL + grace + re-prime eligibility).

| ID | Setup | Action | Expected (post-fix) | Pre-fix (current code) |
|----|-------|--------|---------------------|------------------------|
| A1 | `runMint(metta-next, main)` — fresh token | `runGuard('metta complete research --change c', main)` | exit 0, audit `session-credential-verified` | **passes** (regression guard) |
| A2 | `runMint(metta-next, worktree)`, consistent cwd | `runGuard('metta complete research --change c', worktree)` | exit 0 | **passes** (expected; if it fails, that itself is new signal for the separate cwd issue) |
| A3 | Split cwd: `runMint(metta-next, main)` only | `runGuard('metta complete …', worktree)` | exit 2, `missing-credential` — sentinel pinning the documented per-cwd resolution; any change here is a deliberate design decision, not drift | **passes** (documents current behavior) |
| A4 | As A1 but `procCwd` ≠ `eventCwd` for both hooks | guard | exit 0 — proves `event.cwd` drives resolution | **passes** |
| B1 | `runMint` → `backdate(cwd, DELEGATION)` — the post-subagent gap | `runGuard('metta complete implementation', cwd)` | exit 0, audit reason = new re-prime/grace acceptance (≠ `session-credential-verified`), zero `credential-expired` entries | **FAILS** — exit 2, `credential-expired` (pins bug 1, intent Problem item 1) |
| C1 | Same state as B1: expired-but-eligible, **no mint refresh landed** (guard-first ordering) | `runGuard` alone | exit 0 | **FAILS** — exit 2 (pins bug 2, the same-event race, guard line 403) |
| C2 | Same backdated state, mint-first ordering: `runMint` (re-mints, past 80%) then `runGuard` | guard | exit 0, and verdict identical to C1 — ordering invariance | **passes** (mint-wins ordering already worked; invariance as a pair fails pre-fix because C1 fails) |
| C3 (smoke, optional) | Backdated state; spawn mint+guard concurrently ×25 | assert guard exit 0 every iteration | all-pass | flaky pre-fix (sometimes 0, sometimes 2) — exactly the field symptom; non-load-bearing |
| B2 | `runMint` → `backdate(cwd, 0.9 · rawTTL)` | `runMint` again, read token | token rotated (new `token`, fresh `mintedAt`) — sliding refresh retained | **passes** (already covered in mint unit tests; kept as seam sanity) |
| E1 | No mint ever ran | `runGuard('metta complete intent', cwd)` | exit 2, `missing-credential`, message names the skill entry point | **passes** — must keep passing |
| E2 | `runMint` → `backdate(cwd, DEAD)` — all avenues lapsed, no active session | `runGuard('metta complete intent', cwd)` | exit 2, audit `credential-expired` — guards against the fix over-widening into standing authorization | **passes** — must keep passing |
| E3 | `runMint(metta-refresh, cwd)` (fresh, but scope = `['refresh']`) | `runGuard('metta complete intent', cwd)` | exit 2, `subcommand-not-in-scope` — activity signal never widens scope | **passes** — must keep passing |
| E4 | Well-formed credential written at retired `<cwd>/.metta/scratch/skill-session.token` only | `runGuard('metta complete intent', cwd)` | exit 2, `missing-credential` | **passes** — must keep passing |
| E5 | Hand-fabricated activity signal (orchestrator-authorable content: wrong shape, or value copied from a skill file) + expired/absent token | `runGuard('metta complete intent', cwd)` | exit 2 via existing fail-closed paths | design-dependent — concrete fixture written once the fix's marker format is fixed; the case slot is reserved now |

**Bug-pinning cases (must be red against current code, green after the fix): B1 and C1** — plus
C2's invariance pairing and B1's audit-reason assertion. Everything else is green-before-and-after
regression armor, satisfying the spec requirement that each seam test be "demonstrably capable of
failing against the pre-fix behavior" (the suite should be committed with B1/C1 verified red
against the unfixed hooks first).

Pre-existing suites (`metta-guard-bash.test.ts`, `metta-session-mint.test.ts`,
`cli-metta-guard-bash-integration.test.ts`, `hooks-byte-identity.test.ts`) must pass unmodified —
except the two existing expiry tests in `metta-guard-bash.test.ts` (~lines 830, 904) that seed a
token at `Date.now() - TTL_MS - 1000` and expect `credential-expired`: under a lifecycle-aware
window that delta may fall inside the new effective lifetime. Those seeds must be updated to `DEAD`
deltas — a semantics-preserving fixture change ("genuinely dead still blocks"), which the spec's
"every pre-existing test passes without modification to its expected outcomes" wording permits
(outcomes unchanged; only the fixture's notion of "expired" deepens). This is the one pre-existing
touchpoint; flag it in the design so it is not mistaken for weakened coverage.

## Risks & Limitations

- **Marker-design coupling.** `backdate()` and case E5 depend on the fix's activity-signal format
  (field names, file paths, JSON vs. mtime). Mitigated by funneling all knowledge into
  `TIMESTAMP_FIELDS` + one helper, and by using the real mint hook for warm-up so tests never
  hand-model the marker. The seam suite should land in the same commits as the fix, not before.
- **Parallel scheduling cannot be truly reproduced.** The fixture-interleaving argument covers the
  observable state space only at file granularity. `writeFileSync` in the mint hook is not atomic
  (no temp-file + rename), so a guard read concurrent with a mint write could in principle see a
  torn/partial JSON → parse failure → token skipped → fail closed. No deterministic test can force
  a torn read; C3's stress smoke gives probabilistic coverage only. Recommend the fix approaches
  consider write-temp-then-`renameSync` in the mint hook (atomic on POSIX same-dir rename); that
  hardening is their scope, but the seam suite should note the residual either way.
- **Effective-lifetime constants are design outputs.** `DELEGATION` and `DEAD` deltas must be
  derived from the landed constants (import/mirror them the way `TTL_MS` is mirrored today in both
  existing test files). Mirroring risks drift; acceptable because the mint payload test already
  pins `ttlMs` byte-for-byte, and a drifted mirror fails loudly.
- **Runtime cost.** Each case spawns 1–3 node processes; ×2 hook-copy pairs ≈ 30–45 spawns, ~5–10 s
  wall time based on the existing suites' 30 s timeouts. Acceptable; keep C3 at N=25 max or gate it
  behind an env flag if CI time matters.
- **E5 is not fully mechanizable.** "Value not derivable from skill files" is a property of the
  design, not something a test can prove; the test can only pin that a structurally
  wrong/hand-written signal fails closed. The non-forgeability scenario remains partly a
  design-inspection requirement (spec acknowledges this: "WHEN its write path is inspected").

## Effort

- New file `tests/metta-guard-mint-seam.test.ts`: ~350–450 lines including helpers and the matrix
  above — roughly one focused day, including the red-first verification of B1/C1 against the
  unfixed hooks.
- Fixture-deepening touch-up to two expiry seeds in `tests/metta-guard-bash.test.ts`: ~15 minutes.
- Helper update when the fix's marker design lands (`TIMESTAMP_FIELDS`, E5 fixture): ~30 minutes.
- No production code changes required by this approach itself (the temp+rename atomicity
  suggestion belongs to the fix approaches).

## Verdict

**Recommended, as specified — with the fixture-backdating + interleaving-enumeration harness, and
explicitly without a clock env override.** The repo's existing subprocess hook harness
(`spawnSync` + synthetic event JSON + temp-cwd + backdated `mintedAt` + audit-log parsing) already
contains every primitive the seam suite needs; the only genuinely new pieces are the `backdate()`
helper, the main/worktree topology builder, and the paired-ordering race cases. The deterministic
core is B1 + C1/C2: they pin both root-cause branches from the intent (delegation-window expiry and
the same-event race) as red tests against current code, while E1–E5 lock the fail-closed boundary
so the freshness fix cannot silently widen authorization. Land the suite in the same change as the
fix, red-first, in `tests/metta-guard-mint-seam.test.ts`, following the source+deployed dual-run
convention.
