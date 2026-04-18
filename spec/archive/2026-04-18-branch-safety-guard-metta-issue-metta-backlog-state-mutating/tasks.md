# Tasks: branch-safety-guard-metta-issue-metta-backlog-state-mutating

## Batch 1 (parallel, different files)

### Task 1.1: Add assertOnMainBranch helper
- **Files:** `src/cli/helpers.ts`
- **Action:** Export new async function `assertOnMainBranch(projectRoot, mainBranchName, overrideBranch?)`. See research.md sketch. Guard non-git projects via `git rev-parse --is-inside-work-tree` try/catch. Read current branch via `git branch --show-current`. Pass on match OR override-equals-current. Throw Error with the exact format in spec.md.
- **Verify:** `grep 'export async function assertOnMainBranch' src/cli/helpers.ts` returns 1; `npx tsc --noEmit` clean.
- **Done:** helper exported and typechecks.

### Task 1.2: Wire guard into metta issue
- **Files:** `src/cli/commands/issue.ts`
- **Action:** Import `assertOnMainBranch`. Add `.option('--on-branch <name>', 'Acknowledge non-main branch and proceed')`. In the action handler, right after `createCliContext()`, call `await assertOnMainBranch(ctx.projectRoot, ctx.config.git?.pr_base ?? 'main', options.onBranch)`. Wrap in try/catch; on throw, set exit code 4 with the error message surfaced via stderr or JSON output (match existing error-output pattern in this file).
- **Verify:** `grep 'assertOnMainBranch' src/cli/commands/issue.ts` returns 1; `grep -- '--on-branch' src/cli/commands/issue.ts` returns 1.
- **Done:** guard wired; --on-branch registered.

### Task 1.3: Wire guard into metta backlog add + done
- **Files:** `src/cli/commands/backlog.ts`
- **Action:** Same guard wiring as Task 1.2, applied to BOTH the `add` subcommand and the `done` subcommand. Each gets its own `--on-branch <name>` option.
- **Verify:** `grep -c 'assertOnMainBranch' src/cli/commands/backlog.ts` returns 2 (one per subcommand); `grep -c -- '--on-branch' src/cli/commands/backlog.ts` returns 2.
- **Done:** both subcommands guarded; flags registered.

## Batch 2 (sequential, depends on Batch 1)

### Task 2.1: Branch-safety tests
- **Files:** `tests/cli.test.ts`
- **Action:** Add a new describe block `'metta branch-safety guard'` with tests:
  - `metta issue "x"` on main exits 0
  - `metta issue "x"` on feature branch exits 4 with "Refusing to write"
  - `metta issue "x" --on-branch <feature>` on feature branch exits 0
  - `metta backlog add "y"` on feature branch exits 4
  - `metta backlog done <slug> --on-branch <feature>` on feature branch exits 0 (create slug on main first, checkout feature, then done)
- **Verify:** new cases pass; existing 88 tests still green.
- **Done:** 5 new tests green.

### Task 2.2: summary + gate suite
- **Files:** `spec/changes/branch-safety-guard-metta-issue-metta-backlog-state-mutating/summary.md`
- **Action:** summary + gates (tsc, test, lint, build).
- **Done:** all gates green.
