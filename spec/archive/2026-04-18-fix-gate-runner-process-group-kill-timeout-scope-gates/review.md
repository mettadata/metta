# Review: fix-gate-runner-process-group-kill-timeout-scope-gates

Three parallel reviewers.

## Combined verdict: PASS_WITH_WARNINGS

No critical issues. Minor timer-cleanup improvement applied during review. Non-blocking follow-ups noted below.

## Findings

### Correctness — PASS_WITH_WARNINGS
- Spawn/PGID kill correct: `child.pid` null guard, Windows `child.kill()` fallback, SIGKILL-after-exit guarded by `exited` flag, try/catch swallows ESRCH.
- Finalizer scoping correct: fallback to `gateRegistry.list()` when workflowEngine absent; `loadWorkflow` failure caught silently.
- Workflow YAMLs both updated with `build` on implementation.
- **Warning:** `runWithPolicy` retry relies implicitly on prior-run SIGKILL to reap PGID before retry spawns. Works but not explicit. Consider a code comment at `gate-registry.ts:196` noting the dependency. Not blocking.
- **Gap:** no regression test for US-4 (retry-once + grandchild reap). Covered by sequential-await logic + existing retry tests, but not end-to-end.

### Security — PASS_WITH_WARNINGS
- `spawn(..., { shell: true })` is author-trusted input (gate YAMLs); not a new attack surface.
- `process.kill(-pid)` race guarded by `exited` + `clearTimeout`.
- **Warning (pre-existing, out of scope):** `ChangeMetadataSchema.workflow` is `z.string()` with no slug constraint. `loadWorkflow(metadata.workflow, paths)` joins the string into a path — theoretical path traversal. Recommend a follow-up to tighten the schema to `/^[a-z0-9-]+$/`.
- **Suggestion:** `{ ...process.env }` leaks all secrets to gate subprocesses. Pre-existing, out of scope.

### Quality — PASS_WITH_WARNINGS
- TypeScript hygiene clean, no `any`, typed return shape.
- **Warning:** `Finalizer` constructor now has 7 positional params (4 optional). Crosses the "options object" threshold vs other constructors in the codebase (most top out at 4-5). Recommend a future refactor to group into `{ gateRegistry?, projectRoot?, workflow?: { engine, searchPaths } }`. Non-blocking.
- **Minor cleanup (APPLIED)**: the SIGKILL fallback timer wasn't cleared on clean exit. Added `sigkillTimer` tracker + shared `cleanup()` helper. 10-line fix to `gate-registry.ts`.
- Test naming descriptive, no unused imports, commit messages conventional.

## Fixes applied during review

| Finding | Resolution | File |
|---|---|---|
| SIGKILL setTimeout never cleared on clean exit (Quality) | Track `sigkillTimer`; shared `cleanup()` called from both `close` and `error` handlers | `src/gates/gate-registry.ts:68-95` |

## Deferred

- Comment on `runWithPolicy:196` explaining implicit PGID reap via prior-run SIGKILL
- Slug-regex constraint on `ChangeMetadataSchema.workflow` (security hardening, pre-existing)
- Consider `Finalizer` options-object refactor
- US-4 end-to-end retry+grandchild regression test
- Env-allowlist for gate subprocesses (security hardening, pre-existing)
