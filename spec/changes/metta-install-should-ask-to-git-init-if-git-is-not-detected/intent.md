# metta-install-should-ask-to-git-init-if-git-is-not-detected

## Problem
When `metta install` runs without a git repo, it exits with an error and tells the user to re-run with `--git-init` or run `git init` manually. This is a poor UX — the tool should offer to fix the situation interactively. Additionally, after creating all setup files (.metta/, spec/, slash commands), the command does not commit them, leaving the user with untracked files.

## Proposal
1. When no git repo is detected and `--git-init` is not passed, prompt the user interactively ("No git repo detected. Initialize one? [Y/n]"). If they confirm, run `git init`. If they decline, exit gracefully.
2. After all setup files are created, automatically run `git add` and `git commit` to commit the initial metta setup.
3. In JSON mode, keep the current non-interactive behavior (exit with `git_missing` status).

## Impact
- Changes the `metta install` command behavior when no git repo exists (interactive prompt instead of hard exit)
- Adds an initial commit of setup files after installation

## Out of Scope
- Changing the `--git-init` flag behavior (it still works as a non-interactive override)
- Any changes to other commands
