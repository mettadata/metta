# branch-safety-guard-metta-issue-metta-backlog-state-mutating

## Problem

`metta issue`, `metta backlog add`, and `metta backlog done` write to whatever branch is currently checked out. When a user is mid-change on a feature branch (e.g. `metta/fix-some-issue`) and pauses to log an unrelated issue or backlog item, the new file lands on that feature branch — silently. The issue file rides along with the PR and may be lost on branch abandonment or cause merge conflicts.

Tracked as `metta-issue-metta-backlog-add-and-other-cli-state-mutating-c` (major).

## Proposal

Add a shared pre-action branch guard in `src/cli/helpers.ts`:
```typescript
async function assertOnMainBranch(projectRoot, mainBranchName, overrideBranch?): Promise<void>
```

- Reads the current branch (`git branch --show-current`)
- Uses the project's configured main branch (`pr_base` in `ProjectConfig`, defaults to `main`)
- If current branch doesn't match and no override is passed, throws with a clear error:
  `"Refusing to write: current branch '<x>' is not the main branch '<main>'. Switch branches or use --on-branch <x> to override."`

Wire the guard into:
- `src/cli/commands/issue.ts` — `.action()` handler
- `src/cli/commands/backlog.ts` — `add` and `done` subcommands

Add a shared `--on-branch <name>` option on each command; when supplied, the guard accepts any branch matching the name (user acknowledges).

## Impact

- `src/cli/helpers.ts` — new `assertOnMainBranch` helper (~20 lines)
- `src/cli/commands/issue.ts` — guard call + `--on-branch` option
- `src/cli/commands/backlog.ts` — guard call + `--on-branch` option on `add` and `done`
- `tests/cli.test.ts` — coverage: blocks on feature branch, allows with override, allows on main
- Not touching `metta propose`/`quick` (they create feature branches intentionally), nor `metta finalize`/`ship` (they run on the change's own branch).

## Out of Scope

- Auto-stash-checkout-restore pattern (too much magic; user must manually switch)
- Branch safety for other commands not in the scope list
- Changing the default main branch name (`pr_base` default stays `main`)
