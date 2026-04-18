# Design: branch-safety-guard-metta-issue-metta-backlog-state-mutating

## Approach

Add shared `assertOnMainBranch` helper in `src/cli/helpers.ts`. Wire into three commands with a matching `--on-branch <name>` option. No schema changes.

## Components

- `src/cli/helpers.ts` — new `assertOnMainBranch(projectRoot, mainBranchName, overrideBranch?)` async function
- `src/cli/commands/issue.ts` — call guard + register `--on-branch` option
- `src/cli/commands/backlog.ts` — call guard + register `--on-branch` on `add` and `done` subcommands
- `tests/cli.test.ts` — branch-safety describe block with 5+ cases

## Data Model

None.

## API Design

```typescript
export async function assertOnMainBranch(
  projectRoot: string,
  mainBranchName: string,
  overrideBranch?: string,
): Promise<void>
```

Throws `Error` with message beginning `Refusing to write: current branch '<x>' is not the main branch '<main>'...` when guard fails.

Each command gains `.option('--on-branch <name>', 'Acknowledge non-main branch and proceed')`.

## Dependencies

None added.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Non-git projects inadvertently blocked | Helper returns silently when `git rev-parse --is-inside-work-tree` fails. |
| `pr_base` hardcoded | Read from `ctx.config.git?.pr_base ?? 'main'`. |
| Detached HEAD returns empty branch name | Falls into the "not main" path → refuse; user opts out with `--on-branch ''` or via a proper checkout. |
| Breaks existing tests that don't sit on main | Review: existing tests use temp repos with `git init --initial-branch=main` → land on main by default, no change needed. |
