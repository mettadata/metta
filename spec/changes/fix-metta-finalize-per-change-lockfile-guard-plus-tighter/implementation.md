# Implementation: per-change finalize lockfile guard + tighter test gate

Resolves issue `metta-finalize-hangs-on-the-vitest-pre-merge-gate-and-has-no`.

Two independent root causes: (1) the pre-merge `tests` gate could hang for up to
25 minutes and then retry, doubling the wall-clock cost; (2) concurrent or
re-entrant `metta finalize` runs for the same change had no mutual exclusion, so
overlapping runs could race on archive/spec-merge/git.

## Files changed / created

### Changed
- `src/templates/gates/tests.yaml` — tightened the gate (Solution 2):
  - `timeout: 1500000` → `300000` (25 min → 5 min)
  - `on_failure: retry_once` → `stop` (no automatic re-run that doubles a hang)
  - `name`, `description`, `command`, `required` unchanged.
- `src/cli/commands/finalize.ts` — wired in the lock (Solution 1):
  - Imports `acquireFinalizeLock` and `FinalizeLockError` from
    `../../finalize/finalize-lock.js`.
  - After `name` is resolved and before gates load, calls
    `await acquireFinalizeLock(ctx.projectRoot, name)`. The returned release fn
    is intentionally ignored — release is handled by the lock's `process.exit`
    handler (see rationale below).
  - The `catch (err)` block gained a first branch for `FinalizeLockError`:
    emits JSON `{ error: { code: 5, type: 'finalize_locked', message } }` or a
    red console error, then `process.exit(5)` — distinct from the generic
    exit-4 path so callers/scripts can tell "locked" from "failed".
- `src/schemas/index.ts` — barrel export `./finalize-lock.js`.
- `src/index.ts` — barrel export `./finalize/finalize-lock.js`.

### Created
- `src/schemas/finalize-lock.ts` — `FinalizeLockSchema` (strict Zod object:
  `pid` positive int, `startedAt` string, `change` string) + inferred
  `FinalizeLock` type. Mirrors `src/schemas/gate-result.ts`.
- `src/finalize/finalize-lock.ts` — the lock module (see design below).
- `src/finalize/finalize-lock.test.ts` — vitest coverage (see below).

## Lock design

Lock path: `.metta/locks/finalize-<change>.lock` under the project root, JSON
content validated by `FinalizeLockSchema`.

- `FinalizeLockError extends Error` (typed hierarchy, `name = 'FinalizeLockError'`)
  carries `change`, `pid`, `lockPath` and produces an actionable message:
  `A finalize is already running for "<change>" (PID <pid>). Wait for it to
  finish, or remove the stale lock at <lockPath>.`
- `isPidAlive(pid)` uses `process.kill(pid, 0)` (sends no signal — existence
  probe only). Returns `true` on success; in the catch, `true` when
  `err.code === 'EPERM'` (alive but owned by another user), otherwise `false`
  (`ESRCH` → dead).
- `acquireFinalizeLock(projectRoot, change)`:
  - `mkdir(dirname(lockPath), { recursive: true })`.
  - Reads + `JSON.parse` + `FinalizeLockSchema.parse` any existing lock. If it
    parses AND the PID is alive → `throw new FinalizeLockError(...)`. Missing
    (`ENOENT`), corrupt (parse error), zod-invalid, or dead-PID locks fall
    through to **stale-reclaim**. A caught `FinalizeLockError` is re-thrown so a
    genuine conflict is never misclassified as "corrupt".
  - Writes `{ pid: process.pid, startedAt: new Date().toISOString(), change }`
    as pretty JSON.
  - Registers `process.once('exit', cleanup)` where
    `cleanup = () => { try { unlinkSync(lockPath) } catch {} }`.
  - Returns an async release: `removeListener('exit', cleanup)` then
    `await unlink(lockPath)` (errors ignored).

### Exit-handler cleanup rationale
`finalize.ts` calls `process.exit()` on multiple branches (gate failure → exit 1,
spec conflict → exit 2, generic error → exit 4, and now lock conflict → exit 5).
A `finally`-only release would never run on those `process.exit()` paths, leaking
the lock and blocking all future finalizes for that change. Registering cleanup
on `process.once('exit', ...)` guarantees the lock is removed synchronously as
the process tears down. Because a **live** PID is never reclaimed, only the
owning (still-alive) process ever deletes its own lock — so the unconditional
`unlinkSync` in cleanup cannot stomp a lock held by a different live finalize.

## Test coverage (`src/finalize/finalize-lock.test.ts`)
Uses `mkdtempSync` under `os.tmpdir()` as `projectRoot`, cleaned up in
`afterEach`. Does not touch real finalize.
- acquire writes a valid lock file containing `process.pid`, the change, and a
  string `startedAt`.
- a second acquire while held by a live PID (`process.pid`) throws
  `FinalizeLockError`.
- the thrown `FinalizeLockError` carries the correct `change`, `pid`, `lockPath`.
- a stale lock (dead PID `2147483646`) is reclaimed and overwritten with the
  current PID.
- a corrupt (non-JSON) lock file is reclaimed.
- a structurally-invalid (zod-failing) lock file is reclaimed.
- the returned release removes the lock file.
- after release, a subsequent acquire succeeds.
- `isPidAlive` returns `true` for the current process and `false` for the dead PID.

10 tests total.

## Build / verification (LIGHT only)
- `npm run build` (tsc + copy-templates) — passed. `dist/templates/gates/tests.yaml`
  confirms `timeout: 300000` and `on_failure: stop`.
- `npx vitest run src/finalize/finalize-lock.test.ts` — 10 passed (1 file).
- `npx tsc --noEmit` — exit 0, no type errors.

Per host constraints, the full `npm test` suite was not run (55-worker pool / OOM risk).
