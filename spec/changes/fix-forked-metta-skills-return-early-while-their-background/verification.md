# Verification: fix-forked-metta-skills-return-early-while-their-background

Verified 2026-07-15 by live-exercising built `dist/` code, the deployed hook, and the CLI in a
temp scaffolded project — not just by reading tests. All gates run at HEAD `4fcd709d1`.

**Overall verdict: FAIL** — 3 of 4 spec requirements pass with live evidence; the
"Finalize Lock Staleness Fallback Via Mtime" requirement has one unimplemented scenario:
`acquireFinalizeLock` never applies the mtime fallback, so an EPERM-ambiguous lock with an
expired mtime still throws `FinalizeLockError` on retry, while `status`/`next` simultaneously
report it "safe to retry."

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
  pid. Implementation: `src/finalize/finalize-lock.ts:16-27` (message), `:122-133` (reclaim).
- Unit coverage: `src/finalize/finalize-lock.test.ts:55-63` (message), `:75-87` (dead-pid reclaim).

Both scenarios pass.

## Requirement 2: Finalize Lock Staleness Fallback Via Mtime — FAIL

### Scenario "Ambiguous pid liveness with an expired mtime is reclaimed" — FAIL

Spec (spec.md:34-48): when pid liveness is ambiguous (recycled pid or EPERM), **`acquireFinalizeLock`**
MUST check mtime against the 60s threshold and MUST reclaim; the scenario's THEN is "the lock is
reclaimed without throwing `FinalizeLockError`."

Live evidence (real EPERM — lock written with `pid: 1`, probed as EPERM by an unprivileged user;
mtime backdated 5 minutes):

- `checkFinalizeLockStale` → `{"stale":true,"reason":"mtime-expired","pid":1,"ageMs":300002}` — the
  fallback exists, but only in this read-only helper.
- `acquireFinalizeLock` on the same lock → **threw `FinalizeLockError`**. The acquire path
  (`src/finalize/finalize-lock.ts:115-133`) uses only boolean `isPidAlive`, which returns `true`
  on EPERM (`:39`), and never consults mtime. `src/cli/commands/finalize.ts` has no compensating
  pre-check (only the `FinalizeLockError` catch at `:173`).
- End-to-end consequence, demonstrated live in a scaffolded project with a pid-1/expired-mtime
  lock: `metta status` and `metta next` print "stale finalize lock detected, safe to retry" /
  `finalize_lock_reason: "mtime-expired"`, but `metta finalize --change <name>` on that exact
  lock exits 5 with `FinalizeLockError`. The retry the CLI recommends is not in fact possible
  for the mtime-expired case — the lock is never reclaimable through the supported path.

Root cause is a tasks-vs-spec divergence: tasks.md Task 1.1 explicitly instructed
"Do not change `isPidAlive` or `acquireFinalizeLock`'s existing reclaim logic" while claiming to
fulfill this requirement; the implementation follows tasks.md, not spec.md's scenario.

(Sub-note: the scenario's other GIVEN alternative — pid recycled by an unrelated live process
that probes *cleanly* — is also not reclaimed anywhere; design.md Risk (c) deliberately respects
a clean-alive probe regardless of age to avoid mis-reclaiming a slow finalize. That trade-off is
documented, but the EPERM alternative is detectable and still not honored by acquire.)

### Scenario "Fresh lock with a confirmed live owner is respected" — PASS

Live: fresh lock owned by a live pid → `checkFinalizeLockStale` `{"stale":false}`;
`acquireFinalizeLock` throws `FinalizeLockError`. Also unit-covered including the
old-mtime + confirmed-live case (`finalize-lock.test.ts:165-173`) and EPERM + fresh mtime
(`:193-207`).

### Scenario "Dead-pid reclaim path is preserved alongside the mtime fallback" — PASS

Live: dead-pid lock with a 5-minute-old mtime reclaimed by `acquireFinalizeLock`;
`checkFinalizeLockStale` reports `{"stale":true,"reason":"dead-pid","pid":2147483646}` regardless
of mtime (unit: `finalize-lock.test.ts:143-153`).

## Requirement 3: Stale Finalize Lock Surfaced In Status — PASS

Live in a temp project (`metta install --git-init` + `propose`, all artifacts marked complete):

- Dead-pid lock: human `metta status` prints
  `Finalize lock: stale finalize lock detected, safe to retry`; `--json` has
  `finalize_lock_stale: true`, `finalize_lock_reason: "dead-pid"`.
- Mtime-expired lock (pid 1, backdated): same human line; `--json` reason `"mtime-expired"`.
- No lock: no `Finalize lock:` line; `--json` `finalize_lock_stale: false`, no reason key.
- Fresh live-pid lock (this shell's pid): no line; `finalize_lock_stale: false`.

Implementation: `src/cli/commands/status.ts:94-105,166-170`. Tests:
`tests/cli-status.test.ts:454-512`.

## Requirement 4: Stale Finalize Lock Surfaced In Next Routing — PASS

Live, same fixture:

- Dead-pid lock: human `metta next` prints
  `Stale finalize lock detected for <change> — safe to retry.` before the existing two lines;
  `--json` keeps `next: "finalize"` and adds `finalize_lock_stale: true`,
  `finalize_lock_reason: "dead-pid"` (mtime-expired variant verified too). It does not route
  into an immediate failing call — the warning is surfaced in the routing output.
- No lock / fresh live lock: output byte-identical to the pre-change three-field shape (no
  stale keys, no warning line).

Implementation: `src/cli/commands/next.ts:96-116`. Tests: `tests/cli-status.test.ts:515+`.

Caveat (consequence of the Requirement 2 gap, not a Requirement 3/4 failure as written): for the
`mtime-expired` reason, the "safe to retry" wording is currently inaccurate — the retry throws.

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

| Gate | Result |
|------|--------|
| `npx vitest run` | PASS — 1074/1074 tests, 80 files |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS (tsc-based) |
| `npm run build` | PASS (incl. template copy step) |

## Required follow-up

Wire the mtime fallback into the acquire path so the "Ambiguous pid liveness with an expired
mtime is reclaimed" scenario holds: e.g. have `acquireFinalizeLock` consult
`checkFinalizeLockStale` (or replicate its EPERM+mtime branch) before throwing, so a lock that
`status`/`next` report as `mtime-expired` is actually reclaimed by `metta finalize`. Until then,
an EPERM-ambiguous stale lock is permanently unrecoverable through the supported retry path.
