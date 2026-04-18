# surface-blocking-file-list-autocommitfile-skip-reason

## Problem

`autoCommitFile` in `src/cli/helpers.ts` refuses to commit when the working tree has other tracked-and-dirty files. It returns `reason: 'working tree has other uncommitted tracked changes'` — no file names. Users hitting this skip have to run `git status` manually to discover what's blocking. Every state-mutating CLI command that uses the helper (`metta issue`, `metta backlog add`, `metta refresh`, etc.) inherits the ergonomic gap.

Tracked as issue `metta-backlog-add-and-likely-other-state-mutating-cli-comman` (minor).

## Proposal

In `src/cli/helpers.ts`, when the "other tracked files dirty" branch fires, collect the blocking file paths from the already-fetched `git status --porcelain` output and include them in the reason. New format:
`working tree has N uncommitted tracked changes (path/a, path/b, path/c)`

Keep the reason truncated to ~200 chars if the list is very long (unlikely but defensive): `... (path/a, path/b, path/c, ...and N more)`.

Update `tests/auto-commit.test.ts` to assert the new format in the existing dirty-tracked-files scenario.

## Impact

- `src/cli/helpers.ts` — one function (~10 line diff).
- `tests/auto-commit.test.ts` — existing test's assertion tightened.
- No API change: `reason` remains a free-form string. Consumers that matched the old substring will still match "working tree has" prefix.

## Out of Scope

- Changing the `AutoCommitResult` shape.
- Truncation beyond ~200 chars.
- Surfacing blocking files to callers as a structured field.
- Any other auto-commit skip reasons.
