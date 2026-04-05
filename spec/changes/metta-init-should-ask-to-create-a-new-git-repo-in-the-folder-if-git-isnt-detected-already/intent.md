# metta init should ask to create a new git repo if git isn't detected

## Problem
Running `metta init` in a directory without a git repo silently proceeds. Since Metta relies on git for change tracking and atomic commits, this creates a broken setup.

## Proposal
During `metta init`, check for a `.git` directory. If absent, prompt the user (via stdout message + exit with a specific code) or, in JSON mode, return a `git_missing` status so the calling AI agent can ask the user. Add a `--git-init` flag to auto-initialize git without prompting.

## Impact
Only affects the `metta init` command. No changes to existing workflows once git is present.

## Out of Scope
- Detecting remote git configuration
- Setting up git hooks
- Configuring git user identity
