# Summary: surface-blocking-file-list-autocommitfile-skip-reason

## Problem

`autoCommitFile` returned `reason: 'working tree has other uncommitted tracked changes'` without naming the files — users had to run `git status` manually to diagnose every skip.

## Solution

Collect the blocking paths from the already-fetched `git status --porcelain` output and include them in the reason. New format:
`working tree has N uncommitted tracked change(s) (path/a, path/b, path/c)`

Long lists truncated to ~200 chars with `...and K more` suffix.

## Files touched

- `src/cli/helpers.ts` — expanded the skip-reason branch
- `tests/auto-commit.test.ts` — assertion tightened to cover the new format with two blocking files

## Resolves

- `metta-backlog-add-and-likely-other-state-mutating-cli-comman` (minor)

## Out of scope (left)

- Exposing blocking files as a structured field on `AutoCommitResult`
- Any other skip-reason strings
