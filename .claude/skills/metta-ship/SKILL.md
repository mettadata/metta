---
name: metta:ship
description: Finalize and ship the active change
allowed-tools: [Read, Write, Bash, Grep, Glob]
context: fork
agent: metta-skill-host
---

Two-step process: **finalize** (archive + merge specs on branch) then **ship** (push branch, open a PR, land it via PR merge).

## Steps

1. `metta finalize --dry-run --json --change <name>` → preview what will change. This call blocks; wait for it to exit before proceeding — do not treat it as backgrounded.
2. If clean: `metta finalize --json --change <name>` → archives change to spec/archive/, merges delta specs into living specs
3. If spec conflicts: stop and tell the user to resolve them
4. `git push -u origin metta/<change-name>` → push the feature branch to the remote
5. `gh pr create --title "<conventional-commit-style title from the change>" --body "<summary from summary.md or intent.md highlights>"` → open a PR. The body MUST end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
6. `gh pr merge <pr-number> --merge` → land the PR immediately, unless the user asked to leave it open for review — in that case stop here and report the PR URL instead of merging
7. Back on `main`: `git pull --ff-only`, then clean up the change branch and worktree
8. Report result to user

## Rules

- ALWAYS dry-run finalize before the real operation
- Finalize happens on the feature branch (metta/<change-name>)
- Ship pushes the feature branch and lands it via a GitHub PR
- If spec conflicts are found, do NOT proceed — tell the user
- Do not force-push or skip any steps
- Direct local merge of the change branch into main (`git merge`) is forbidden — every change ships through a pushed branch and a GitHub PR
- If a dispatched step appears orphaned, follow the residual orphaning recovery protocol in metta-skill-host.md.
