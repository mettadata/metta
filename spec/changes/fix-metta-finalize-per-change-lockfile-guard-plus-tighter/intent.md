# fix-metta-finalize-per-change-lockfile-guard-plus-tighter

## Problem
`metta finalize` is effectively unusable on a resource-constrained host. Two
independent defects converge to produce hangs and OOM thrash:

1. **Apparent hang and load doubling on the heavy test gate.** The built-in
   test gate (`src/templates/gates/tests.yaml`) is configured with
   `timeout: 1500000` (25 minutes) and `on_failure: retry_once`. A 25-minute
   window is long enough that a stalled/idle vitest run looks like an
   indefinite hang. When the run is killed or OOMs, `retry_once` re-spawns the
   entire vitest pool a second time, doubling load on an already-saturated host
   instead of failing fast. Some runs exited 144 (signal/OOM).

2. **No concurrency guard in the finalize path.** Neither
   `src/cli/commands/finalize.ts` nor `src/finalize/finalizer.ts` takes any
   lock keyed on the change before running gates. Re-invoking `metta finalize`
   for the same change while a prior run is in flight spawns additional full
   vitest pools. Three to four concurrent finalizes (165+ node test workers)
   OOM-thrashed the machine, and finalize agents' monitors kept respawning
   finalize whenever one was killed, creating a respawn loop that only stopped
   once the change was manually merged and archived out of `spec/changes/`.

Who is affected: any developer running `metta finalize` on a constrained host,
and any AI-driven session whose monitor can re-invoke finalize.

Tracked by issue
`spec/issues/metta-finalize-hangs-on-the-vitest-pre-merge-gate-and-has-no.md`.

## Proposal
Two coordinated fixes (the approved design, decided with the user):

### Solution 1 — per-change finalize lock (refuse on conflict)
`metta finalize` acquires a PID-based lock file before running gates:

- **Location:** `.metta/locks/finalize-<change>.lock`.
- **Contents:** JSON `{ pid, startedAt, change }`, validated on read with a
  dedicated Zod schema (no unvalidated state reads/writes).
- **Conflict behavior:** if a live lock exists (the recorded PID is still
  alive), finalize **REFUSES** with a clear message and a non-zero exit, e.g.
  `A finalize is already running for <change> (PID N). Wait for it to finish
  or remove .metta/locks/finalize-<change>.lock if stale.` This is surfaced via
  a custom error class in the typed error hierarchy for the lock-conflict case.
- **Stale-lock recovery:** if the recorded PID is **not** alive, the lock is
  auto-reclaimed (treated as stale) and finalize proceeds, overwriting it.
- **Release:** the lock is released in a `finally`/exit path so a normal or
  errored run always cleans up after itself.

This serializes finalize per change, stopping both the multi-pool OOM and the
monitor-driven respawn loop (a respawned finalize hits the live lock and
refuses rather than spawning another vitest pool).

### Solution 2 — tighten the heavy test gate
In `src/templates/gates/tests.yaml`:

- Lower `timeout` from `1500000` (25 min) to `300000` (5 min).
- Change `on_failure` from `retry_once` to `stop`.

A slow or killed suite then fails fast with a clear gate-timeout result instead
of re-spawning a second full vitest pool, removing the apparent hang and the
load-doubling-on-retry behavior.

## Impact
- `src/cli/commands/finalize.ts` and/or `src/finalize/finalizer.ts` — add lock
  acquisition before gates and release in a `finally`/exit path.
- New lock module + Zod schema for the lock file shape, plus a custom
  lock-conflict error class added to the typed error hierarchy.
- New runtime artifact directory/file `.metta/locks/finalize-<change>.lock`
  (created/removed during finalize; should be git-ignored as runtime state).
- `src/templates/gates/tests.yaml` — `timeout` and `on_failure` values change;
  template is copied to `dist/` at build time (no inlined string literals).
- Behavioral change: concurrent `metta finalize` invocations for the same
  change now refuse (non-zero exit) instead of running in parallel; the heavy
  test gate now fails fast at 5 min with no retry. Projects that legitimately
  need a longer suite can add a project-local `.metta/gates/tests.yaml`
  override.
- Near 1:1 test-to-source ratio: new lock module and schema get matching tests.

## Out of Scope
- **Solution 3 — bounding vitest worker count during the gate** (e.g. pinning
  `--pool=forks --maxWorkers=2` or a metta-managed env var in the gate command).
  Explicitly NOT done here: hard-coding worker count in the template command is
  project-specific, slows the suite on capable CI machines, and does not by
  itself stop the respawn loop. The lock (Solution 1) is the mechanism that
  stops unbounded concurrent pools.
- Changing the gate runner's kill mechanism. The runner already propagates
  `detached: true` and kills the process group on timeout
  (`src/gates/gate-registry.ts`); that mechanism is sound and is left as-is.
