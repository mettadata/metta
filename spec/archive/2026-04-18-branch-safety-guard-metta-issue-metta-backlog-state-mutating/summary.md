# Summary: branch-safety-guard-metta-issue-metta-backlog-state-mutating

## Problem

`metta issue`, `metta backlog add`, and `metta backlog done` wrote to whatever branch was checked out. Pausing mid-change to log something silently contaminated the feature branch.

## Solution

- New `assertOnMainBranch(projectRoot, mainBranchName, overrideBranch?)` helper in `src/cli/helpers.ts` refuses with exit 4 when HEAD is not the configured main branch.
- Each of the three commands registers a `--on-branch <name>` override flag.
- Config-aware: reads `pr_base` from project config, defaults to `main`.
- Non-git projects pass silently.

## Files touched

- `src/cli/helpers.ts` (new helper)
- `src/cli/commands/issue.ts` (guard + --on-branch)
- `src/cli/commands/backlog.ts` (guard + --on-branch on add and done)
- `tests/cli.test.ts` (4 new branch-safety tests)

## Resolves

- `metta-issue-metta-backlog-add-and-other-cli-state-mutating-c` (major)
