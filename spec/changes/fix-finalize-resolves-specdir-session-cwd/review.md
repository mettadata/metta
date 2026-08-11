# Code Review: fix-finalize-resolves-specdir-session-cwd

## Summary

The core fix is correct and well-tested: `specDir` now comes from `ArtifactStore.specDirFor(change)`, gates.yaml is staged pre-archive so no code path can strand a half-archived change, and the auto-commit runs against the host root. However, the migration is incomplete — the CLI still hands the Finalizer a `SpecLockManager` rooted at the session-cwd spec dir, so a worktree-hosted change **with spec deltas** merges `spec.md` into the worktree while writing `spec.lock` into the main checkout. That is a new split-root inconsistency introduced by this change (before, both were consistently session-rooted), and neither regression test covers it because neither test change carries a spec delta.

## Issues Found

### Critical (must fix)

- `src/cli/commands/finalize.ts:55` — **SpecLockManager root disagrees with the resolved specDir.** The Finalizer receives `ctx.specLockManager`, which `createCliContext` roots at `join(root, 'spec')` from the session cwd (`src/cli/helpers.ts:124`). Inside `Finalizer.finalize`, `SpecMerger` is constructed with the worktree `specDir` but this session-rooted lock manager (`src/finalize/finalizer.ts:107`). For a worktree-hosted change with spec deltas finalized from the main checkout:
  - `applyDelta`/`createCapabilitySpec` write the merged `spec.md` into the **worktree's** `spec/specs/<cap>/` but `specLockManager.update()` writes `spec.lock` into the **main checkout's** `spec/specs/<cap>/` (`src/finalize/spec-merger.ts:157`, `:261`) — dirtying the main checkout (contradicting the change's own "main checkout untouched" guarantee) and leaving the worktree's `spec.md` with a stale (or missing, for new capabilities) `spec.lock`. The auto-commit then stages `spec/specs/<cap>` in `hostRoot`, committing the mismatched pair onto the branch.
  - Conflict detection (`getBaseVersion`/`read` at `spec-merger.ts:101-105`) reads the main checkout's lock, which can diverge from the worktree's.

  **Fix:** construct the lock manager from the resolved specDir in `finalize.ts` (e.g. `new SpecLockManager(specDir)`), exactly as the unit test already wires it (`tests/finalizer.test.ts:427`) — the test comment "what the CLI now does" is currently inaccurate. Update the `Finalizer` constructor doc (`src/finalize/finalizer.ts:43-49`) to state the lock manager must be rooted at the same specDir.
- `tests/cli-finalize.test.ts:403` (test gap for the above) — neither the CLI regression test nor the unit worktree test gives the change a `spec.md` delta, so the spec-merge path (`merged` non-empty, lock writes) is never exercised cross-checkout. Add a delta to one regression test and assert `spec.md` **and** `spec.lock` land in the worktree's `spec/specs/<cap>/` with the main checkout's `spec/specs/` untouched.

### Warnings (should fix)

- `src/cli/commands/finalize.ts:33` — the concurrency lock is still session-rooted: `acquireFinalizeLock(ctx.projectRoot, name)`. Two finalizes for the same worktree-hosted change — one from the main checkout, one from inside the worktree — acquire locks in different roots and do not mutually exclude, while both now mutate the same worktree. Resolve `specDir`/`hostRoot` first and lock against `hostRoot` (resolution is cheap and read-only, so reordering is safe).
- `src/finalize/finalizer.ts:280` — `DocGenerator(this.specDir, this.projectRoot, ...)` now reads specs from the worktree but still writes docs into the session `projectRoot`. With the schema default `generate_on: 'finalize'` (`src/schemas/project-config.ts:39`), a worktree finalize from main regenerates the **main checkout's** `docs/` from not-yet-shipped worktree specs — an unasserted cross-checkout write. The CLI test's "main checkout untouched" claim (`tests/cli-finalize.test.ts:403`) does not check `docs/`. At minimum document the intended docs behavior for worktree-hosted changes; ideally align the docs output root with `hostRoot` or assert the current behavior explicitly.

### Suggestions (nice to have)

- `src/cli/commands/finalize.ts:50` — `hostRoot = dirname(specDir)` bakes in the invariant that the spec dir is literally `<root>/spec`. True for both branches of `specDirFor` today, but the invariant lives at the call site; a `hostRootFor(name)` (or returning `{ specDir, hostRoot }`) on `ArtifactStore` would keep it in one place next to `specDirFor`.
- `src/finalize/finalizer.ts:131` — gates still run with `cwd: this.projectRoot` (session checkout), so quality gates validate the main checkout's code rather than the worktree's. Pre-existing and explicitly out of scope per the intent's class-audit exclusion, but worth logging as an issue so the worktree-blind-commands audit picks it up.
- `tests/finalizer.test.ts:302-311` — `passingRegistry()` duplicates the registry setup already present at `tests/finalizer.test.ts:180` area; a shared helper would trim the duplication. Cosmetic.

## Conventions check

`.js` import extensions present; kebab-case filenames; no string-literal template files introduced (the YAML is data serialization via `YAML.stringify`, not a template); tests added to the existing 1:1 counterpart files; `specDirFor` visibility change is documented with a clear doc comment; dead `writeFile` dynamic import correctly removed with the reordering. The `Finalizer` constructor contract comment is good but incomplete (lock manager rooting — see critical issue).

## Verdict

NEEDS_CHANGES

---

## Merged verdicts (orchestrator)

| Reviewer | Verdict |
|----------|---------|
| Correctness | FAIL (1 critical) |
| Security | PASS_WITH_WARNINGS |
| Quality | NEEDS_CHANGES (same critical) |

### Critical (consensus, must fix this iteration)
- `src/cli/commands/finalize.ts:55` — session-rooted `ctx.specLockManager` passed into a Finalizer whose specDir is per-change/worktree. `SpecMerger` writes merged `spec.md` into the worktree but `spec.lock` into the main checkout (spec-merger.ts:101,105,157,261): dirty main checkout, stale lock committed on the worktree branch, conflict detection against the wrong lock. Fix: construct `new SpecLockManager(specDir)` from the per-change spec dir in finalize.ts, plus a spec-delta regression test for the worktree-hosted finalize path.

### Warnings (non-blocking, candidates for follow-up issues)
- Gates run with cwd = session projectRoot; for worktree-hosted changes gates attest main-checkout code into the worktree archive (finalize.ts:57 / finalizer.ts:131). Deferred per intent Out of Scope — log follow-up issue.
- Finalize lock rooted at session projectRoot (finalize.ts:33); main-cwd and worktree-cwd finalizes of the same change do not mutually exclude.
- DocGenerator mixes roots (finalizer.ts:280): worktree specs in, session-root docs out, docs never auto-committed.

### Suggestions (minor)
- Slug validation on CLI change name; `cap.split('/')[0]` pathspec trust; archive-name collision uniquifier; TOCTOU single-resolution of host root; test-helper duplication.
