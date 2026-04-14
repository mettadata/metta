# auto-commit-spec-issues-md-spe

## Problem
`metta issue <desc>` and `metta backlog add <title>` write files to `spec/issues/` and `spec/backlog/` respectively but leave them untracked. This is inconsistent with `metta install` (which writes `.metta/`, `spec/project.md`, and commits them as `chore: initialize metta`). Consequences:

1. Users invoking `/metta-issue` or `/metta-backlog` get a written file but must remember to `git add && git commit` separately to track it.
2. During an in-flight change, these untracked files can be accidentally swept up in the next `git commit -A` or lost to `git clean`.
3. The just-shipped workflow where mid-change issue logging happens (e.g. logging the task-checkbox bug mid-implementation) produces orphan files requiring manual cleanup.

## Proposal
Add auto-commit to `metta issue` and `metta backlog add` at the CLI level. After the file is written:

1. Run `git add <path>` for the new file.
2. Run `git commit -m "<conventional message>"` — e.g. `chore: log issue <slug>` and `chore: add backlog item <slug>`.
3. If git is unavailable or the working tree has uncommitted changes to *other* files, fall back gracefully: print a warning and skip the commit without erroring. The user can commit manually. This prevents the issue/backlog capture from blocking or entangling with in-flight work.
4. Respect `--json` output mode: include `committed: true|false` and `commit_sha` fields in the JSON response so skills can report back.

Skill bodies do not change — they continue to call the CLI, and the CLI is now responsible for the commit.

## Impact
- **CLI**: `metta issue` and `metta backlog add` gain post-write commit behavior. Silent addition for CLI direct users; observable because `git log` will show the commit.
- **Tests**: existing tests for these commands run in tmp-dir git repos; they may need adjustment if they assert on working-tree state post-run (probably they don't, but verify).
- **Skills**: no body change. `/metta-issue` and `/metta-backlog` keep working; their CLI wrappee now commits.
- **Downstream**: no migration. Pre-existing untracked issue/backlog files stay untracked until the user commits manually.

## Out of Scope
- Auto-commit for other CLI commands (`metta doctor`, `metta config set`, etc.).
- `metta backlog promote` — already runs `metta propose` which commits its own scaffold.
- Changing the commit message format or making it user-configurable.
- A global `--no-commit` opt-out flag (YAGNI — can add later if someone asks).
- Handling detached HEAD or no-branch cases beyond "skip and warn."
- Auto-pushing anything.
