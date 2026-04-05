# Summary

## What changed

**File:** `src/cli/commands/init.ts`

1. **Interactive git init prompt** — When no git repo is detected and `--git-init` is not passed, the command now prompts `No git repository detected. Initialize one? [Y/n]` instead of exiting with an error. Pressing Enter or typing anything other than "n" confirms. JSON mode still exits non-interactively with `git_missing` status.

2. **Auto-commit setup files** — After creating `.metta/`, `spec/`, `.claude/` and slash commands, the command runs `git add` + `git commit -m "chore: initialize metta"` to commit all setup files. The JSON output includes a new `committed: boolean` field. Console output shows `Committed: initial metta setup` when successful.

## How to test

1. Create an empty directory, `cd` into it
2. Run `metta install` — should prompt to init git, then create and commit all files
3. Run `git log` — should see the "chore: initialize metta" commit
4. In a directory with git already init'd, run `metta install` — should skip the prompt, still commit setup files
5. Run `metta install --json` in a non-git directory — should return `git_missing` JSON (no prompt)
