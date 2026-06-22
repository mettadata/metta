# metta finalize hangs on the vitest pre-merge gate and has no concurrency guard (OOM/respawn loop)

**Captured**: 2026-06-19
**Status**: resolved
**Severity**: major
**Resolved by**: change `fix-metta-finalize-per-change-lockfile-guard-plus-tighter` (2026-06-22) — solutions 1+2: added a per-change PID lockfile guard in `metta finalize` (refuses concurrent runs, auto-reclaims stale locks) and tightened the test gate (`tests.yaml` timeout 25min→5min, `on_failure` retry_once→stop). Solution 3 (worker-count pinning) intentionally out of scope.

## Symptom
`metta finalize` runs the full vitest suite (~55 workers) as a pre-merge gate and frequently sits idle (load near 0, no progress) for 10-15+ minutes instead of completing or failing fast — it appears to hang. Some runs exited 144 (signal/OOM). Separately, there is no concurrency guard: re-invoking `metta finalize` for the same change while a prior run is in flight spawns additional full vitest pools. Three to four concurrent finalizes (165+ node test workers) OOM-thrashed the machine, and finalize agents' monitors kept respawning finalize whenever one was killed, creating a respawn loop that only stopped once the change was manually merged and archived out of `spec/changes/`. Finalize was effectively unusable on a resource-constrained host; the change had to be completed manually via git merge + manual archive.

## Root Cause Analysis
Two independent defects converge. First, the built-in test gate (`tests.yaml`) is configured with `timeout: 1500000` (25 minutes) and `on_failure: retry_once`. A 25-minute window is long enough to look like an indefinite hang, and when the run is killed or OOMs, `retry_once` re-spawns the entire vitest pool a second time — doubling load on an already-saturated host instead of failing fast. The gate runner does propagate `detached: true` and kill the process group on timeout, so the kill mechanism itself is sound, but the timeout is far too generous and the retry policy amplifies resource pressure. Second, neither `src/cli/commands/finalize.ts` nor `src/finalize/finalizer.ts` takes any lockfile/PID lock keyed on the change before running gates — there is no guard in the finalize path at all (a repo-wide search for lockfile/PID-guard patterns matches only unrelated modules: state-store, install, slug). So concurrent or monitor-driven re-invocations each spawn their own full vitest pool unchecked, producing the 165+ worker OOM and the respawn loop.

### Evidence
- `src/templates/gates/tests.yaml:4` — `timeout: 1500000` (25 min) plus `on_failure: retry_once` (line 6) explains the multi-minute apparent hang and the load doubling on retry after a killed/OOMed run.
- `src/cli/commands/finalize.ts:18-50` — the finalize action runs gates via the Finalizer with no lockfile/PID acquisition keyed on the change, so re-invocations are unserialized.
- `src/gates/gate-registry.ts:68-73` — the timeout fires SIGTERM to the process group then SIGKILL after 1s, but only after the gate's full `timeout` (25 min for tests) elapses, so there is no fast-fail path.

## Candidate Solutions
1. **Per-change finalize lockfile/PID guard** — On entry, `finalize.ts` writes a lock file (e.g. `.metta/locks/finalize-<change>.lock`) containing the PID and start time; a second invocation detects the live lock and either refuses with a clear message or attaches to the existing run, and the lock is released in a `finally`/exit handler. Stale-lock detection (PID not alive) lets a crashed run recover. Tradeoff: filesystem locks are not bulletproof across NFS/containers and need careful stale-lock handling to avoid permanently wedging a change after a hard kill.
2. **Tighten the test-gate timeout and drop retry on the heavy gate** — Lower `tests.yaml` `timeout` to a realistic ceiling (e.g. 3-5 min) and change `on_failure` to `stop` so a killed/slow suite fails fast with a clear "Gate timed out" message instead of re-spawning a second full pool. Tradeoff: a legitimately slow suite on a slow host could hit the ceiling and require a project-local `.metta/gates/tests.yaml` override, pushing tuning onto the user.
3. **Bound vitest worker count during the gate** — Pin the gate command to a low pool size (e.g. `npm test -- --pool=forks --maxWorkers=2` or via a metta-managed env var) so even concurrent runs cannot saturate the host. Tradeoff: hard-coding worker count in the template command is project-specific and slows the suite on capable CI machines; it also does not by itself stop the respawn loop, so it must be combined with solution 1.

