# Summary: fix-issue-metta-refresh-leaves-claude-md-uncommitted-metta-r

## Problem

`metta refresh` regenerated `CLAUDE.md` and left it uncommitted in the working
tree. Because the file sits at the repo root and is tracked by git, subsequent
unrelated commits silently absorbed the regenerated content into their diffs —
contaminating history and making it hard to audit when and why the instruction
file actually changed.

## Solution

Wire the existing `autoCommitFile` helper into `registerRefreshCommand`'s
Commander action handler so a successful write is followed by a discrete
`chore(refresh): regenerate CLAUDE.md` commit. Added a `--no-commit` opt-out
flag for users who want to inspect or stage the diff themselves. Updated the
`metta-refresh` skill to document the auto-commit behaviour and the
`--no-commit` escape hatch, and updated the `metta-init` skill to pass
`--no-commit` so init's own `chore: generate CLAUDE.md from discovery` commit
is not preempted by refresh's auto-commit.

## Files touched

- `src/cli/commands/refresh.ts` — import `autoCommitFile`, register
  `--no-commit`, call helper after `runRefresh`, surface commit result in both
  JSON and console output paths.
- `src/templates/skills/metta-refresh/SKILL.md` — documented auto-commit and
  `--no-commit` flag.
- `src/templates/skills/metta-init/SKILL.md` — init flow now invokes
  `metta refresh --no-commit` so its own commit line owns the first CLAUDE.md
  commit.
- `tests/refresh-commit.test.ts` — new integration test file.

## Test coverage added

Five integration scenarios using a real `git` binary and `mkdtemp` sandboxes:
happy path (commit created, tree clean), `--no-commit` skips commit, non-git
directory returns `{ committed: false, reason: 'not a git repository' }`
without throwing, no second commit on unchanged content, and dirty unrelated
tracked file causes commit to be refused while the write still succeeds.

## Notes on related API shape

`runRefresh`'s signature is unchanged — the `--no-commit` flag and the
`autoCommitFile` call live only in the CLI action handler. Existing
programmatic callers of `runRefresh` are not broken by this change.
