# Tasks: t8-post-merge-gate-re-run-afte

### Task 1.1 — Inject GateRegistry into MergeSafetyPipeline + execute gates
- **Files**: `src/ship/merge-safety.ts`
- **Action**: Add optional `gateRegistry?: GateRegistry` constructor param. Replace post-merge-gates stub with execution logic per design.md. On any gate fail, run `git reset --hard <snapshotTag>` and add a `rollback` step. On rollback fail, mark rollback step fail.
- **Verify**: `npm run build`.
- **Done**: pipeline runs gates, rolls back on fail, preserves snapshot tag.

### Task 1.2 — Wire registry into ship CLI
- **Files**: `src/cli/commands/ship.ts`
- **Action**: Before constructing the pipeline, call `await ctx.gateRegistry.loadFromDirectory(...)` (whatever path the gates live in — check helpers.ts for builtins). Pass the registry as the second constructor arg.
- **Verify**: `npm run build`. Smoke `metta ship --branch <some metta/* branch>` doesn't error pre-merge.
- **Done**: ship now runs real post-merge gates.

### Task 1.3 — Add 3 test cases to tests/merge-safety.test.ts
- **Files**: `tests/merge-safety.test.ts`
- **Action**:
  1. `'post-merge gates pass when all gates report pass'` — mock registry returning all-pass; verify success status and merge commit landed.
  2. `'rolls back to snapshot when a gate fails'` — mock registry returning one fail; verify failure status, rollback step pass, HEAD reset to snapshot SHA, snapshot tag still exists.
  3. `'passes with no-gates-configured detail when registry has no gates'` — mock registry with empty list; step pass with detail.
- **Verify**: `npx vitest run tests/merge-safety.test.ts`.
- **Done**: 3 new tests pass; existing tests pass (need to be updated to construct pipeline with optional registry — back-compat path).

### Task 1.4 — Full suite
- **Files**: none
- **Action**: `npm run build && npx vitest run`.
- **Done**: All tests green.

## Scenario Coverage
- Spec scenario 1 (all pass) → 1.3 case 1
- Spec scenario 2 (gate fail → rollback) → 1.3 case 2
- Spec scenario 3 (rollback failure) → impl path; manual verification (mocking git error is brittle).
- Spec scenario 4 (no registry) → 1.3 case 3
- ship-cli-passes-gate-registry → 1.2
