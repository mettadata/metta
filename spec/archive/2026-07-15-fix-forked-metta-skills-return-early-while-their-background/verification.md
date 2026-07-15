# Verification: fix-forked-metta-skills-return-early-while-their-background

Verified 2026-07-15 by live-exercising built `dist/` code, the deployed hook, and the CLI in a
temp scaffolded project — not just by reading tests. Initial verification ran at HEAD
`4fcd709d1` and failed Requirement 2; re-verified 2026-07-15 at HEAD `18fbda0bd` after the
acquire-path fix (`fix(...): acquireFinalizeLock reclaims mtime-expired ambiguous locks`),
repeating the exact live scenario that produced the FAIL.

**Overall verdict: PASS** — all 4 spec requirements pass with live evidence. The previously
failing "Ambiguous pid liveness with an expired mtime is reclaimed" scenario now passes:
commit `18fbda0bd` routes `acquireFinalizeLock` staleness through `checkFinalizeLockStale`,
so a lock `status`/`next` report as `mtime-expired` is actually reclaimed on retry. The
original FAIL finding is preserved below as a resolved audit note.

---

## Requirement 1: Finalize Lock Contention Error Message — PASS

Live exercise (node script against `dist/finalize/finalize-lock.js`, lock owned by a live
`sleep 30` child pid):

- Threw `FinalizeLockError` with message:
  `A finalize is already running for "verify-change" (PID 3716946). Re-run metta finalize once it finishes — a dead-pid lock is reclaimed automatically. Do not delete the lock file manually.`
- Recommends re-running `metta finalize`: yes. Instructs manual deletion: no — explicitly
  forbids it.
- Dead-pid reclaim intact: a lock with pid `2147483646` (and a 5-minute-old mtime) was reclaimed
  by `acquireFinalizeLock` without error; the lock file's owner pid was rewritten to the caller's
  pid. Implementation: `src/finalize/finalize-lock.ts:16-27` (message), `:126-135` (reclaim).
- Unit coverage: `src/finalize/finalize-lock.test.ts:55-63` (message), `:75-87` (dead-pid reclaim).

Both scenarios pass. Re-confirmed live at `18fbda0bd`: fresh live-owned lock (`sleep 30` child)
still throws `FinalizeLockError` with the same message shape; dead-pid lock (pid `2147483646`,
5-minute-old mtime) still reclaimed, lock pid rewritten to caller's pid.

## Requirement 2: Finalize Lock Staleness Fallback Via Mtime — PASS

### Scenario "Ambiguous pid liveness with an expired mtime is reclaimed" — PASS (fixed by `18fbda0bd`)

Spec (spec.md:34-48): when pid liveness is ambiguous (recycled pid or EPERM), **`acquireFinalizeLock`**
MUST check mtime against the 60s threshold and MUST reclaim; the scenario's THEN is "the lock is
reclaimed without throwing `FinalizeLockError`."

Fix: commit `18fbda0bd` replaces the boolean `isPidAlive` check inside `acquireFinalizeLock`
with a delegation to `checkFinalizeLockStale` (`src/finalize/finalize-lock.ts:126-135`), so
acquisition and read-only reporting (`metta status` / `metta next`) share one staleness verdict
and cannot diverge. A stale lock (`dead-pid` or `mtime-expired`) is unlinked and reclaimed;
only a non-stale lock (confirmed-live owner, or EPERM-ambiguous owner with fresh mtime) throws.

Live re-verification at `18fbda0bd` (real EPERM — lock written with `pid: 1`, probed as EPERM
by an unprivileged user; mtime backdated 5 minutes; `npm run build` run first so `dist/` was
current):

- `checkFinalizeLockStale` → `{"stale":true,"reason":"mtime-expired","pid":1,"ageMs":331406}`.
- `acquireFinalizeLock` on the same lock (node `--input-type=module` against
  `dist/finalize/finalize-lock.js`) → **reclaimed without throwing**: lock file content went
  from `{"pid":1,...}` to `{"pid":4137888,...}` — the caller's pid — before release.
- End-to-end in the scaffolded temp project: `metta status <change> --json` reported
  `finalize_lock_stale: true`, `finalize_lock_reason: "mtime-expired"` and the human line
  `Finalize lock: stale finalize lock detected, safe to retry`; `metta next` printed
  `Stale finalize lock detected for reverify-stale-lock — safe to retry.` with
  `next: "finalize"`; and `metta finalize --change <name>` on that exact pid-1/expired-mtime
  lock proceeded **past the lock** into quality gates (it failed only on the fixture's missing
  `stories.md` — a fixture artifact gap, not `FinalizeLockError`). The retry the CLI recommends
  is now actually possible.
- Unit coverage added by the fix commit: `src/finalize/finalize-lock.test.ts:106-166`
  ("acquire mtime fallback for EPERM-ambiguous owners") — reclaim on expired mtime (`:131`),
  throw on fresh mtime (`:142`), dead-pid reclaim regardless of mtime (`:156`).

<details>
<summary>Resolved audit note — original FAIL finding (2026-07-15, pre-fix HEAD 4fcd709d1)</summary>

Original verdict: **FAIL**. Live evidence (real EPERM — lock written with `pid: 1`, probed as
EPERM by an unprivileged user; mtime backdated 5 minutes):

- `checkFinalizeLockStale` → `{"stale":true,"reason":"mtime-expired","pid":1,"ageMs":300002}` — the
  fallback existed, but only in this read-only helper.
- `acquireFinalizeLock` on the same lock → **threw `FinalizeLockError`**. The acquire path
  (then `src/finalize/finalize-lock.ts:115-133`) used only boolean `isPidAlive`, which returns
  `true` on EPERM (`:39`), and never consulted mtime. `src/cli/commands/finalize.ts` had no
  compensating pre-check (only the `FinalizeLockError` catch at `:173`).
- End-to-end consequence, demonstrated live in a scaffolded project with a pid-1/expired-mtime
  lock: `metta status` and `metta next` printed "stale finalize lock detected, safe to retry" /
  `finalize_lock_reason: "mtime-expired"`, but `metta finalize --change <name>` on that exact
  lock exited 5 with `FinalizeLockError`. The retry the CLI recommended was not in fact possible
  for the mtime-expired case — the lock was never reclaimable through the supported path.

Root cause was a tasks-vs-spec divergence: tasks.md Task 1.1 explicitly instructed
"Do not change `isPidAlive` or `acquireFinalizeLock`'s existing reclaim logic" while claiming to
fulfill this requirement; the implementation followed tasks.md, not spec.md's scenario.

**Resolution:** fixed by commit `18fbda0bd` (acquire delegates staleness to
`checkFinalizeLockStale`); re-verified live above.

</details>

(Sub-note, still accurate post-fix: the scenario's other GIVEN alternative — pid recycled by an
unrelated live process that probes *cleanly* — is deliberately not reclaimed; design.md Risk (c)
respects a clean-alive probe regardless of age to avoid mis-reclaiming a slow finalize. That
documented trade-off is unchanged; the detectable EPERM alternative is now honored by acquire.)

### Scenario "Fresh lock with a confirmed live owner is respected" — PASS

Live: fresh lock owned by a live pid → `checkFinalizeLockStale` `{"stale":false}`;
`acquireFinalizeLock` throws `FinalizeLockError`. Re-confirmed live at `18fbda0bd` (fresh
`sleep 30`-owned lock → threw; **EPERM pid-1 lock with a fresh mtime → also threw**, confirming
the fix did not over-reclaim). Also unit-covered including the old-mtime + confirmed-live case
(`finalize-lock.test.ts:226-234`) and EPERM + fresh mtime on both the check path (`:254-270`)
and the new acquire path (`:142-154`).

### Scenario "Dead-pid reclaim path is preserved alongside the mtime fallback" — PASS

Live: dead-pid lock (pid `2147483646`) with a 5-minute-old mtime reclaimed by
`acquireFinalizeLock` (re-confirmed at `18fbda0bd`: lock pid rewritten to caller's pid);
`checkFinalizeLockStale` reports `{"stale":true,"reason":"dead-pid","pid":2147483646}` regardless
of mtime (unit: `finalize-lock.test.ts:204-214`; post-fix `:156-166` covers the same on the
acquire path too).

## Requirement 3: Stale Finalize Lock Surfaced In Status — PASS

Live in a temp project (`metta install --git-init` + `propose`, all artifacts marked complete):

- Dead-pid lock: human `metta status` prints
  `Finalize lock: stale finalize lock detected, safe to retry`; `--json` has
  `finalize_lock_stale: true`, `finalize_lock_reason: "dead-pid"`.
- Mtime-expired lock (pid 1, backdated): same human line; `--json` reason `"mtime-expired"`
  (re-confirmed live at `18fbda0bd`).
- No lock: no `Finalize lock:` line; `--json` `finalize_lock_stale: false`, no reason key.
- Fresh live-pid lock (this shell's pid): no line; `finalize_lock_stale: false`.

Implementation: `src/cli/commands/status.ts:94-105,166-170`. Tests:
`tests/cli-status.test.ts:454-512`.

## Requirement 4: Stale Finalize Lock Surfaced In Next Routing — PASS

Live, same fixture:

- Dead-pid lock: human `metta next` prints
  `Stale finalize lock detected for <change> — safe to retry.` before the existing two lines;
  `--json` keeps `next: "finalize"` and adds `finalize_lock_stale: true`,
  `finalize_lock_reason: "dead-pid"` (mtime-expired variant re-verified live at `18fbda0bd`).
  It does not route into an immediate failing call — the warning is surfaced in the routing
  output.
- No lock / fresh live lock: output byte-identical to the pre-change three-field shape (no
  stale keys, no warning line).

Implementation: `src/cli/commands/next.ts:96-116`. Tests: `tests/cli-status.test.ts:515+`.

The earlier caveat ("safe to retry" wording was inaccurate for `mtime-expired` because the
retry threw) is **resolved** by `18fbda0bd`: the retry now reclaims the lock, so the wording
is accurate.

## US-2: Background Bash mechanically blocked — PASS

Synthetic PreToolUse events piped to `node .claude/hooks/metta-guard-bash.mjs`:

- `run_in_background: true` + `agent_type: metta-skill-host` → **exit 2**, stderr names the
  contract: "see the Synchronous completion rule in .claude/agents/metta-skill-host.md"; audit
  log line written with `reason: "background-bash-from-fork"`.
- Same event, no `agent_type` → exit 0. `agent_type: general-purpose` → exit 0.
- Foreground behavior unchanged: safe command from `metta-executor` → exit 0;
  `METTA_SKILL=1 metta propose` from `metta-skill-host` → exit 0 (pre-existing trusted path);
  `metta propose` without inline bypass → exit 2 via the pre-existing skill-enforcement branch.
- Commit `eb1cc8509` is purely additive to both hook copies (30 insertions, 0 deletions);
  deployed and template copies are byte-identical (`diff` clean).
- Incidental live confirmation during re-verification: the deployed hook blocked this
  verifier's own `run_in_background` vitest invocation with the expected contract message.

## US-1: Synchronous-completion contract — PASS

- `### Synchronous completion (hard rule)` present at `.claude/agents/metta-skill-host.md:23-24`;
  byte-identical to `src/templates/agents/metta-skill-host.md` (`diff` clean). Rule forbids
  background Bash, ending the turn with a pending Agent, and in-progress narration.
- All six `context: fork` skills (`metta-issue`, `metta-fix-issues`, `metta-propose`,
  `metta-quick`, `metta-auto`, `metta-ship`) declare `agent: metta-skill-host` and inherit the
  rule (design.md's recorded single-source decision); grep finds no "wait for it to complete" /
  "in the background" narration in any of the six SKILL.md files.
- `metta-ship` blocking clarification present at `.claude/skills/metta-ship/SKILL.md:13`
  ("This call blocks; wait for it to exit before proceeding — do not treat it as backgrounded"),
  byte-identical to the template copy.

## Gates

Re-run in full at HEAD `18fbda0bd` (2026-07-15):

| Gate | Result |
|------|--------|
| `npx vitest run src/finalize/finalize-lock.test.ts tests/cli-status.test.ts` | PASS — 54/54 tests, 2 files |
| `npx vitest run` | PASS — 1077/1077 tests, 80 files |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS (tsc-based) |
| `npm run build` | PASS (incl. template copy step) |

## Required follow-up

None. The follow-up from the initial verification (wire the mtime fallback into the acquire
path) was completed by commit `18fbda0bd` and re-verified live above.
