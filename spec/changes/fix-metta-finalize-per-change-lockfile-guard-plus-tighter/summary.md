# Verification: per-change finalize lockfile guard + tighter test gate

Resolves issue `metta-finalize-hangs-on-the-vitest-pre-merge-gate-and-has-no`.

Verdict: **PASS**. Both solutions (lockfile guard + tightened test gate) are
implemented as specified, all gates are green, and the 10 finalize-lock unit
tests pass.

## Verification strategy

No `context.verification_strategy` was supplied in the invocation payload. This
verification was explicitly scoped by the orchestrator to a one-pass artifact
authoring with concrete checks and gates, so it proceeds against the existing
test/tsc/build gates as directed. No strategy-specific execution
(tmux/playwright/cli) applies; the touched surface is a CLI lock module and a
YAML gate template, both covered by unit tests + static gates.

## Scenario / check evidence

### Check 1 — test gate tightened (Solution 2)
PASS.
- Source: `src/templates/gates/tests.yaml:4` `timeout: 300000` (was 1500000),
  `src/templates/gates/tests.yaml:6` `on_failure: stop` (was retry_once).
  `name`/`description`/`command: npm test`/`required: true` unchanged
  (`tests.yaml:1-3,5`).
- Built artifact after `npm run build`: `dist/templates/gates/tests.yaml:4`
  `timeout: 300000`, `dist/templates/gates/tests.yaml:6` `on_failure: stop`.
  Confirms the template is copied to `dist/` (no inlined string literal).

### Check 2 — lock module: refuse on live PID, reclaim stale, exit-handler cleanup
PASS.
- Refuse on a LIVE pid: `src/finalize/finalize-lock.ts:64-69` reads + JSON.parse
  + `FinalizeLockSchema.parse` the existing lock, and if `isPidAlive(existing.pid)`
  it `throw new FinalizeLockError(change, existing.pid, lockPath)`.
- Reclaim stale/dead/corrupt locks: `src/finalize/finalize-lock.ts:70-75` — a
  dead PID falls through to reclaim; the `catch` block reclaims on ENOENT
  (missing), JSON parse error (corrupt), or zod-invalid, while re-throwing a real
  `FinalizeLockError` (`finalize-lock.ts:72-73`) so a genuine conflict is never
  misclassified as "corrupt". Reclaim then overwrites via
  `writeFile(lockPath, ...)` at `finalize-lock.ts:77-78`.
- `isPidAlive`: `src/finalize/finalize-lock.ts:33-41` uses `process.kill(pid, 0)`
  (existence probe, no signal), returns `true` on success, `true` for `EPERM`
  (alive, other user), `false` otherwise (ESRCH → dead).
- Exit-handler cleanup: `src/finalize/finalize-lock.ts:80-87` registers
  `process.once('exit', cleanup)` where `cleanup` does a `try/catch`
  `unlinkSync(lockPath)`. Critical correctness point confirmed: `finalize.ts`
  calls `process.exit()` on the gate-failure (exit 1), spec-conflict (exit 2),
  generic-error (exit 4), and lock-conflict (exit 5) branches
  (`finalize.ts:96,114,175,179`). A `finally`-only release would NOT run on any
  `process.exit()` path, leaking the lock and permanently wedging future
  finalizes for that change; the `process.once('exit', cleanup)` handler removes
  it synchronously at teardown. Because a live PID is never reclaimed (Check 2
  refuse path), the only process that ever deletes a given lock is its own
  still-alive owner, so the unconditional `unlinkSync` cannot stomp a lock held
  by a different live finalize (`finalize-lock.ts:49-53` documents this
  invariant).
- Returned release: `src/finalize/finalize-lock.ts:89-92` detaches the exit
  listener (`removeListener('exit', cleanup)`) then `await unlink(lockPath)`
  with errors ignored.

### Check 3 — finalize.ts: lock acquired before gates; FinalizeLockError -> exit 5
PASS.
- Imports: `src/cli/commands/finalize.ts:8`
  `import { acquireFinalizeLock, FinalizeLockError } from '../../finalize/finalize-lock.js'`.
- Acquired AFTER the change name is resolved and BEFORE gates load:
  `src/cli/commands/finalize.ts:32` `await acquireFinalizeLock(ctx.projectRoot, name)`,
  which sits after the `name` resolution (`finalize.ts:26-27`) and before the
  gate `loadFromDirectory` calls (`finalize.ts:38-40`) and the `Finalizer`
  run (`finalize.ts:56`). The returned release fn is intentionally ignored —
  release is delegated to the lock's exit handler (commented `finalize.ts:29-31`).
- Catch branch: `src/cli/commands/finalize.ts:173-176` — first branch is
  `if (err instanceof FinalizeLockError)`, emitting JSON
  `{ error: { code: 5, type: 'finalize_locked', message } }` (or a red console
  error) then `process.exit(5)` — distinct from the generic exit-4 path
  (`finalize.ts:177-179`) so callers can tell "locked" from "failed".

### Check 4 — schema strict + Zod-validated; FinalizeLockError is a proper custom class
PASS.
- Schema: `src/schemas/finalize-lock.ts:3-7` — `FinalizeLockSchema` is a
  `z.object({ pid: z.number().int().positive(), startedAt: z.string(),
  change: z.string() }).strict()`. `.strict()` rejects unknown keys; inferred
  `FinalizeLock` type at `finalize-lock.ts:9`. Validation is applied on every
  lock read via `FinalizeLockSchema.parse(...)` (`finalize-lock.ts:66`) — no
  unvalidated state read.
- Error class: `src/finalize/finalize-lock.ts:11-26` —
  `class FinalizeLockError extends Error` with `readonly change/pid/lockPath`,
  sets `this.name = 'FinalizeLockError'`, and builds an actionable message.

### Check 5 — barrel exports
PASS.
- `src/schemas/index.ts:14` `export * from './finalize-lock.js'`.
- `src/index.ts:25` `export * from './finalize/finalize-lock.js'`.

## Gates run

| Gate | Command | Result |
|------|---------|--------|
| Build | `npm run build` (tsc + copy-templates) | PASS (exit 0) |
| Typecheck | `npx tsc --noEmit` | PASS (exit 0, no type errors) |
| Targeted tests | `npx vitest run src/finalize/ src/gates/` | PASS (1 file, 10 tests, 0 failures) |

Targeted test detail: the run collected `src/finalize/finalize-lock.test.ts`
(10 tests) — all green. `src/gates/` contains no `*.test.ts` files, which is
correct: the gate-registry kill/timeout mechanism is explicitly Out of Scope for
this change (intent.md "Out of Scope" — runner kill mechanism left as-is), so
the only new/touched test surface is the finalize-lock module. The 10 tests
cover: valid-lock write, live-PID refuse, error field carriage
(change/pid/lockPath), dead-PID stale reclaim, corrupt-file reclaim,
zod-invalid reclaim, release-removes-lock, post-release re-acquire, and
`isPidAlive` true/false.

## Full-suite (`npm test`) — deliberately N/A

The full `npm test` suite (~55-worker vitest pool) was NOT run. This is a
deliberate, scoped decision: this very change exists to stop finalize from
OOM-thrashing a resource-constrained host by spawning unbounded vitest pools,
and the orchestrator's hard constraints prohibit running the full suite here
(host OOM risk). Verification was instead scoped to the touched directories
(`src/finalize/`, `src/gates/`) plus build and typecheck, which exercise every
file this change creates or modifies. Static gates (build + tsc) cover the
whole codebase for type/compile regressions; no regression risk outside the
touched areas was introduced (the change adds a new module + two YAML value
edits + barrel/CLI wiring).
