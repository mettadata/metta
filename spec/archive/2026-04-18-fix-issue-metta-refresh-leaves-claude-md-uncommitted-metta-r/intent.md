# fix-issue-metta-refresh-leaves-claude-md-uncommitted-metta-r

## Problem

Any metta user who runs `metta refresh` or `/metta-refresh` ends up with a
modified `CLAUDE.md` sitting in the working tree with no corresponding commit.
Observed on 2026-04-18: 68 lines changed but never staged. This has two
concrete harms: (1) the dirty file contaminates the diff of whatever unrelated
commit comes next, silently bundling CLAUDE.md changes into an unrelated
conventional commit; and (2) it breaks the contract that every metta artifact
mutation lands as its own discrete, traceable commit. Neither `refresh.ts` nor
the `SKILL.md` contains any mention of committing after the write, so the drift
is silent and reproducible.

## Proposal

After `runRefresh` writes CLAUDE.md, auto-commit it with the conventional
message `chore(refresh): regenerate CLAUDE.md`, following the same try/catch
pattern used in `finalize.ts` and `complete.ts`: `git add` the specific file,
then `git diff --cached --quiet` to detect staged changes, then `git commit`.
If git is unavailable or CLAUDE.md was already up to date, the commit step is
silently skipped. Add a `--no-commit` flag to `registerRefreshCommand` for
users who want to inspect the diff before committing. The default behavior
(auto-commit on write) is opt-out, not opt-in. The `SKILL.md` is updated to
document that refresh commits automatically and to advertise the `--no-commit`
escape hatch.

## Impact

- `src/cli/commands/refresh.ts` — add post-write commit block and `--no-commit`
  option to `registerRefreshCommand`; `runRefresh` signature gains a
  `noCommit` boolean parameter
- `src/templates/skills/metta-refresh/SKILL.md` — document auto-commit
  behavior and `--no-commit` flag
- Any unit tests covering `runRefresh` or the refresh command action — must
  assert the git add/commit calls fire when `written === true` and are
  suppressed under `--no-commit` or `--dry-run`

## Out of Scope

- Changing commit behavior of any other command (`finalize`, `complete`, `ship`,
  `issue`, etc.)
- Refactoring the shared git helper or extracting a new commit utility
- Adding `--commit` / `--no-commit` flags to commands other than `refresh`
- Changes to how the diff summary is computed or displayed
- Any modification to `spec/project.md` or the constitution parsing logic
