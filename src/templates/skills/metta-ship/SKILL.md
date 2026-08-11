---
name: metta:ship
description: Finalize and ship the active change
allowed-tools: [Read, Write, Bash, Grep, Glob]
context: fork
agent: metta-skill-host
---

Two-step process: **finalize** (archive + merge specs on branch) then **ship** (push branch, open a PR, land it via PR merge).

## Steps

Resolve `{change_root}` first: `metta status --json --change <name>` returns `worktree` — when non-null, that value is `{change_root}`; when null, the main checkout root is. Every git command below runs as `git -C "{change_root}"` — never plain git from the session cwd, which for a worktree-hosted change targets the wrong checkout.

1. `metta finalize --dry-run --json --change <name>` → preview what will change. This call blocks; wait for it to exit before proceeding — do not treat it as backgrounded.
2. If clean: `metta finalize --json --change <name>` → archives change to spec/archive/, merges delta specs into living specs
3. If spec conflicts: stop and tell the user to resolve them
4. `git -C "{change_root}" push -u origin metta/<change-name>` → push the feature branch to the remote
5. `gh pr create --title "<conventional-commit-style title from the change>" --body "<summary from summary.md or intent.md highlights>"` → open a PR. The body MUST end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
6. `gh pr checks <pr-number> --watch --fail-fast` → wait for all CI checks on the PR to complete before merging. If any check fails or is cancelled, do NOT merge — report the failing check(s) and the PR URL to the user and stop. If gh reports that no checks are reported yet (checks can lag PR creation by a few seconds), wait ~10s and retry the command
7. `gh pr merge <pr-number> --merge` → land the PR immediately, unless the user asked to leave it open for review — in that case stop here and report the PR URL instead of merging
8. Back on `main`: `git pull --ff-only`, then clean up the change branch and worktree
9. Rebuild the main checkout's dist so the globally-linked CLI (hooks, statusline) serves the just-merged code: run `npm run build` from the main checkout root. If the build fails or cannot run, do NOT undo the merge — report loudly to the user that main's dist is stale/partially built and they must run `npm run build` manually, including the build error output. Never swallow this failure silently
10. Report result to user, including the dist rebuild outcome

## Rules

- ALWAYS dry-run finalize before the real operation
- Finalize happens on the feature branch (metta/<change-name>)
- Ship pushes the feature branch and lands it via a GitHub PR
- If spec conflicts are found, do NOT proceed — tell the user
- Do not force-push or skip any steps
- Direct local merge of the change branch into main (`git merge`) is forbidden — every change ships through a pushed branch and a GitHub PR
- If a dispatched step appears orphaned, follow the residual orphaning recovery protocol in metta-skill-host.md.
