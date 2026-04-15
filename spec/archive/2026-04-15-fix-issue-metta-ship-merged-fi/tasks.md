# Tasks: fix-issue-metta-ship-merged-fi

### [x] Task 1.1 — Add finalize-check step to MergeSafetyPipeline.run()
- **Files**: `src/ship/merge-safety.ts`
- **Action**: Add new step at top of `run()`. Strip `metta/` prefix from sourceBranch; if no prefix, push `{step: 'finalize-check', status: 'skip'}` and continue. Else `readdir(join(cwd, 'spec/archive'))` and look for any entry matching `*-<change>$`. Zero matches → return `{status: 'failure', steps: [{step: 'finalize-check', status: 'fail', detail: '...'}]}`. Match → push pass step and continue.
- **Verify**: `npm run build` clean.
- **Done**: New step executes before any git operations.

### [x] Task 1.2 — Add 3 test cases to tests/merge-safety.test.ts
- **Files**: `tests/merge-safety.test.ts`
- **Action**: 
  1. `'fails when source is metta/* branch with no archive'` — set up tmp git repo, source branch `metta/foo`, NO `spec/archive/2026-XX-XX-foo/`. Expect status='failure', step finalize-check fails, target HEAD unchanged.
  2. `'passes finalize-check when archive exists'` — same but create `spec/archive/2026-04-15-foo/`. Expect step pass; pipeline proceeds (may fail later steps, that's fine).
  3. `'skips finalize-check on non-metta branches'` — source branch `feature` (no metta/ prefix). Expect step skip; pipeline proceeds.
- **Verify**: `npx vitest run tests/merge-safety.test.ts`.
- **Done**: 3 new tests pass; existing tests still pass.

### [x] Task 1.3 — Full suite verification
- **Files**: none
- **Action**: `npm run build && npx vitest run`. Check no regressions.
- **Done**: All tests green.

## Scenario Coverage
- Spec scenario 1 (no archive → failure) → Task 1.2 case 1
- Spec scenario 2 (archive exists → pass) → Task 1.2 case 2
- Spec scenario 3 (non-metta branch → skip) → Task 1.2 case 3
- Spec scenario 4 (full happy path) → Existing happy-path test in merge-safety.test.ts (after archive setup)
