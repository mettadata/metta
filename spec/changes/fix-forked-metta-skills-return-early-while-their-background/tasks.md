<!--
Requirement -> Task coverage:
- Finalize Lock Contention Error Message: 1.1, 1.2
- Finalize Lock Staleness Fallback Via Mtime: 1.1, 1.2
- Stale Finalize Lock Surfaced In Status: 2.1
- Stale Finalize Lock Surfaced In Next Routing: 2.2
- US-1 (forked skills never end their turn on unfinished background work — contract): 3.1
- US-2 (metta-guard-bash rejects Bash run_in_background from a forked metta agent): 3.2, 3.3
-->

# Tasks: fix-forked-metta-skills-return-early-while-their-background

## Batch 1: Finalize lock core

- [x] **Task 1.1: `checkFinalizeLockStale`, mtime fallback, and reworded `FinalizeLockError`**
  - Files: src/finalize/finalize-lock.ts
  - Action: Per design.md's "3. `src/finalize/finalize-lock.ts`" section: (a) reword `FinalizeLockError`'s constructor message verbatim to `` `A finalize is already running for "${change}" (PID ${pid}). Re-run metta finalize once it finishes — a dead-pid lock is reclaimed automatically. Do not delete the lock file manually.` `` (removes the "remove the stale lock at" manual-deletion instruction). (b) Add `export async function checkFinalizeLockStale(projectRoot: string, change: string): Promise<{ stale: boolean; reason?: 'dead-pid' | 'mtime-expired'; pid?: number; ageMs?: number }>` co-located below `isPidAlive`, computing `lockPath` the same way `acquireFinalizeLock` does (`join(projectRoot, '.metta', 'locks', `finalize-${change}.lock`)`). Logic: read+parse the lock file; missing (`ENOENT`) → `{ stale: false }`; unreadable/corrupt/zod-invalid → `{ stale: true, reason: 'dead-pid' }`; otherwise probe pid liveness directly with `process.kill(pid, 0)` in its own try/catch (do not reuse `isPidAlive`'s boolean-only return, since it collapses the EPERM-vs-clean-alive distinction this function needs) — `ESRCH` (or any non-EPERM throw) → `{ stale: true, reason: 'dead-pid', pid }`; a clean, no-throw probe (unambiguously alive) → `{ stale: false }` regardless of lock age; `EPERM` (ambiguous) → `fs.stat(lockPath)` (import `stat` from `node:fs/promises`) and check `Date.now() - stat.mtimeMs > 60_000` — over threshold → `{ stale: true, reason: 'mtime-expired', pid, ageMs: Date.now() - stat.mtimeMs }`, else → `{ stale: false }`. Define a local `const FINALIZE_LOCK_STALE_MS = 60_000` (matching `STALE_LOCK_THRESHOLD_MS`'s value/convention from `src/state/state-store.ts:24`; no cross-module import required). Do not change `isPidAlive` or `acquireFinalizeLock`'s existing reclaim logic. Fulfills "Finalize Lock Contention Error Message", "Finalize Lock Staleness Fallback Via Mtime".
  - Verify: npx tsc --noEmit
  - Done: `finalize-lock.ts` compiles; `FinalizeLockError` message no longer contains "remove the stale lock at"; `checkFinalizeLockStale` is exported with the signature above and does not alter `acquireFinalizeLock`'s existing dead-pid/corrupt-lock reclaim behavior.

- [x] **Task 1.2: Unit tests for `checkFinalizeLockStale` and the reworded error message**
  - Files: src/finalize/finalize-lock.test.ts
  - Action: Extend the existing `describe('finalize-lock', ...)` suite (reuse its `beforeEach`/`afterEach` tempdir fixture and `DEAD_PID` constant). Update the existing "throws FinalizeLockError when the lock is held by a live pid" / "FinalizeLockError carries change, pid, and lockPath" tests' assertions (or add a new assertion) to confirm the message contains "Re-run metta finalize" and does NOT contain "remove the stale lock at" or any manual-deletion instruction. Add a new `describe('checkFinalizeLockStale', ...)` block covering: (1) no lock file present → `{ stale: false }`; (2) a lock file with `DEAD_PID` (any mtime) → `{ stale: true, reason: 'dead-pid' }`, proving the dead-pid path is preserved regardless of mtime age (write the fixture with an explicitly old mtime via `utimesSync` to prove mtime is irrelevant here); (3) a lock file owned by `process.pid` (unambiguously alive, no EPERM) with an old mtime (backdate via `utimesSync` to more than 60s in the past) → `{ stale: false }`, proving a confirmed-live owner is respected regardless of age; (4) simulate the EPERM-ambiguous branch by monkey-patching/mocking `process.kill` (vi.spyOn) to throw an `EPERM`-coded error for a chosen pid, with the lock file's mtime backdated past 60s via `utimesSync` → `{ stale: true, reason: 'mtime-expired' }`; (5) same EPERM mock but with a fresh (not backdated) mtime → `{ stale: false }`. Restore the `process.kill` spy after each EPERM test. Fulfills "Finalize Lock Contention Error Message", "Finalize Lock Staleness Fallback Via Mtime".
  - Verify: npx vitest run src/finalize/finalize-lock.test.ts
  - Done: all new and updated assertions pass, including the dead-pid-preserved-regardless-of-mtime case, the fresh-live-lock-not-stale case, and both EPERM-ambiguous cases (mtime-expired reclaimed, mtime-fresh respected).

## Batch 2: Surfacing in status and next

- [ ] **Task 2.1: Surface stale finalize lock in `metta status`**
  - Files: src/cli/commands/status.ts, tests/cli-status.test.ts
  - Action: Import `checkFinalizeLockStale` from `../../finalize/finalize-lock.js`. Widen `ChangeStatusJson` to add `finalize_lock_stale: boolean` and `finalize_lock_reason?: 'dead-pid' | 'mtime-expired'`. Make `toChangeJson` and `printChangeStatus` `async`, each taking an added `projectRoot: string` parameter, and `await checkFinalizeLockStale(projectRoot, name)` inside both. In `toChangeJson`, always set `finalize_lock_stale` (true/false) and `finalize_lock_reason` only when present. In `printChangeStatus`, append a new conditional block after the existing iteration-counters block (end of the function, currently the last statement before the closing brace) that prints `Finalize lock: stale finalize lock detected, safe to retry` only when `stale === true`; print nothing otherwise. Update all four call sites (the single-change JSON/human branches, the single-remaining-change JSON/human branches, and the multi-change JSON `.map`/human loop) to `await` both functions and pass `ctx.projectRoot`. Add a new `describe('metta status stale finalize lock', ...)` block in tests/cli-status.test.ts following the existing `describe('metta status escalation surface', ...)` pattern (propose a change via `runCli`, then directly write a lock file at `.metta/locks/finalize-<change>.lock` under `tempDir` — construct paths with `join`/`writeFile`/`mkdir` from `node:fs/promises`) covering: (a) a lock file with a dead pid → human output contains `Finalize lock: stale finalize lock detected, safe to retry` and `--json` output has `finalize_lock_stale: true`, `finalize_lock_reason: 'dead-pid'`; (b) a lock file with `pid: process.pid` and a fresh mtime → human output does NOT contain "Finalize lock:" and `--json` has `finalize_lock_stale: false`; (c) no lock file at all → human output unchanged (no "Finalize lock:" line) and `--json` has `finalize_lock_stale: false` present as a field (not absent). Fulfills "Stale Finalize Lock Surfaced In Status".
  - Verify: npx vitest run tests/cli-status.test.ts && npx tsc --noEmit
  - Done: all three new scenarios pass; existing `cli-status.test.ts` assertions (escalation, complexity, stop_after) remain green with no output regressions.

- [ ] **Task 2.2: Surface stale finalize lock in `metta next` routing**
  - Files: src/cli/commands/next.ts, tests/cli-status.test.ts
  - Action: Import `checkFinalizeLockStale` from `../finalize/finalize-lock.js`. Inside the `allComplete` branch (the block that currently emits `next: 'finalize'`), call `const lockStatus = await checkFinalizeLockStale(ctx.projectRoot, changeName)` before constructing output. In the `json` branch, add `finalize_lock_stale: true, finalize_lock_reason: lockStatus.reason` to the existing `outputJson({...})` call only when `lockStatus.stale` is true (omit both fields entirely when `false`, so a non-stale/no-lock `metta next --json` payload is byte-identical to today's three-field shape). In the human branch, when `lockStatus.stale` is true, print `Stale finalize lock detected for ${changeName} — safe to retry.` as a new line immediately before the existing `All artifacts complete for ${changeName}.` line; when not stale, print nothing extra (existing two lines unchanged). The route stays `next: 'finalize'` in both stale and non-stale cases — this is a warning annotation, not a reroute. Add a new `describe('metta next stale finalize lock', ...)` block in tests/cli-status.test.ts (reuse the git/propose helpers already in the file — advance a change through completion via the existing `metta next post-finalize`/`metta status after propose` fixtures, or directly write a fully-complete `.metta.yaml` artifacts map plus a lock file under `.metta/locks/`) covering: (a) dead-pid lock present → human output contains the "Stale finalize lock detected" line and `--json` includes `finalize_lock_stale: true`, `finalize_lock_reason: 'dead-pid'`, with `next` still `'finalize'`; (b) fresh live-owned lock (or no lock) → human output has no stale-lock line and `--json` has neither `finalize_lock_stale` nor `finalize_lock_reason` keys. Fulfills "Stale Finalize Lock Surfaced In Next Routing".
  - Verify: npx vitest run tests/cli-status.test.ts && npx tsc --noEmit
  - Done: both new scenarios pass; `next: 'finalize'` routing is preserved in both cases; existing `metta next post-finalize` tests in the file remain green.

## Batch 3: Orchestration contract and hook enforcement

- [ ] **Task 3.1: Synchronous-completion hard rule in `metta-skill-host.md` + `metta-ship` blocking clarification**
  - Files: .claude/agents/metta-skill-host.md, src/templates/agents/metta-skill-host.md, .claude/skills/metta-ship/SKILL.md, src/templates/skills/metta-ship/SKILL.md
  - Action: In both `metta-skill-host.md` copies (currently byte-identical), insert the following new subsection immediately after the existing `## Rules` list (after the "return a short summary..." line), identically in both files: `\n### Synchronous completion (hard rule)\nYou MUST NOT invoke \`Bash\` with \`run_in_background: true\`. You MUST NOT dispatch an \`Agent\` call and end your turn before that agent returns a result. Your final message MUST NOT describe any launched work as still "in progress," "running," or "in the background" — it MUST report only outcomes that have already completed or definitively failed, with evidence (exit code, file written, pid confirmed dead). If a step would normally be backgroundable, run it in the foreground and wait for it to return before proceeding.\n` (verbatim per design.md's "API Design" section). In both `metta-ship/SKILL.md` copies (currently byte-identical), add one clarifying line to Step 1 (the finalize dry-run step) noting it blocks and must not be treated as backgrounded, e.g. change `1. \`METTA_SKILL=1 metta finalize --dry-run --json --change <name>\` → preview what will change` to `1. \`METTA_SKILL=1 metta finalize --dry-run --json --change <name>\` → preview what will change. This call blocks; wait for it to exit before proceeding — do not treat it as backgrounded.` — apply the identical text to both files. Fulfills US-1.
  - Verify: npx vitest run tests/template-deploy-sync.test.ts tests/agents-byte-identity.test.ts
  - Done: both `metta-skill-host.md` copies and both `metta-ship/SKILL.md` copies are byte-identical pairs (per `template-deploy-sync.test.ts`); the new `### Synchronous completion (hard rule)` heading is grep-discoverable in both host files.

- [ ] **Task 3.2: `metta-guard-bash.mjs` hook branch rejecting background Bash from forked metta agents**
  - Files: .claude/hooks/metta-guard-bash.mjs, src/templates/hooks/metta-guard-bash.mjs
  - Action: In both copies (currently byte-identical), add a new check in `main()` immediately after the existing `if (event.tool_name !== 'Bash') process.exit(0);` guard and the `METTA_SKILL` env-var bypass check, and before `const command = event.tool_input?.command ?? ''; const invocations = tokenize(command);`, per design.md's "2. `.claude/hooks/metta-guard-bash.mjs`" section verbatim:
    ```js
    if (event.tool_input?.run_in_background === true && isTrustedSkillCaller(event)) {
      appendAuditLog(event, 'block', { sub: null, third: null }, 'background-bash-from-fork');
      process.stderr.write(
        `metta-guard-bash: Blocked Bash run_in_background from a forked metta agent (${event.agent_type}).\n` +
        `Forked skills MUST NOT end their turn with background work in flight — see the ` +
        `Synchronous completion rule in .claude/agents/metta-skill-host.md.\n` +
        `Run the command in the foreground and wait for it to complete before reporting.\n` +
        `Emergency bypass: disable this hook in .claude/settings.local.json.\n`
      );
      process.exit(2);
    }
    ```
    Apply the identical branch to both files. Do not restructure `classify()`, `tokenize()`, or `SKILL_ENFORCED_SUBCOMMANDS` handling. Fulfills US-2.
  - Verify: npx vitest run tests/template-deploy-sync.test.ts
  - Done: both `metta-guard-bash.mjs` copies are byte-identical (per `template-deploy-sync.test.ts`); the new branch exits with code 2 and writes the audit-log entry with reason `background-bash-from-fork` before any existing `classify()`/`offender` logic runs.

- [ ] **Task 3.3: Hook tests for the background-Bash rejection branch**
  - Files: tests/metta-guard-bash.test.ts, tests/cli-metta-guard-bash-integration.test.ts
  - Action: Add test cases (reusing each file's existing `runHook`/event-payload helper and the `HOOK_SOURCES` byte-identical-pair loop already present in `cli-metta-guard-bash-integration.test.ts`, so every case runs against both the template and deployed copies) covering: (1) a `Bash` PreToolUse event with `tool_input: { command: 'sleep 100', run_in_background: true }` and `agent_type: 'metta-skill-host'` → hook exits with code `2` and stderr contains "Blocked Bash run_in_background"; (2) the same event but with `agent_type` absent (or a non-`metta-` value, e.g. `'orchestrator'`) → hook allows it (exit `0`), matching today's non-trusted-caller behavior — this is the same-command, different-caller control case proving the block is caller-scoped, not command-scoped; (3) a `Bash` event with `agent_type: 'metta-executor'` (any `metta-`-prefixed agent, not just `metta-skill-host`) and `run_in_background: true` → also blocked (exit `2`), confirming the broad `isTrustedSkillCaller` prefix match design.md's Risk (a) documents; (4) a non-background `Bash` event (`run_in_background` absent or `false`) from a trusted `metta-` agent, with a command that would normally classify via `classify()`/`offender` (e.g. `metta issue ...` with the `METTA_SKILL=1` bypass) → existing classify/allow/block behavior is unchanged (same result as before this change, proving the new branch is additive and does not shadow the existing pipeline). Fulfills US-2.
  - Verify: npx vitest run tests/metta-guard-bash.test.ts tests/cli-metta-guard-bash-integration.test.ts
  - Done: all four cases pass against both hook copies; no existing test in either file regresses.

## Batch 4: Full gate sweep

- [ ] **Task 4.1: Full test suite, type-check, and build across all batches**
  - Files: (none — whole-repo verification)
  - Action: Run the full test suite, the TypeScript type checker, and the production build to confirm no regressions were introduced by Batches 1-3.
  - Verify: npx vitest run && npx tsc --noEmit && npm run build
  - Done: all three commands exit 0 with no failing tests, no type errors, and a successful build.
