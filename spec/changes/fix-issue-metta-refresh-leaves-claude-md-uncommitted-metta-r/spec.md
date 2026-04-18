# Spec: fix-issue-metta-refresh-leaves-claude-md-uncommitted-metta-r

## ADDED: Requirement: refresh-auto-commits-regenerated-claude-md

**Fulfills:** US-1, US-4

When `metta refresh` writes `CLAUDE.md` to disk, it MUST subsequently commit the file with the exact message `chore(refresh): regenerate CLAUDE.md`, using the project's existing single-file auto-commit primitive (`autoCommitFile` in `src/cli/helpers.ts`). Only `CLAUDE.md` MUST be staged; no other tracked or untracked files MAY be swept into this commit. The command MUST skip the commit step when `CLAUDE.md` was not written (content unchanged, or `--dry-run` was set), and MUST NOT produce empty commits. Git subprocess failures (git binary missing, not a git repo, other tracked files dirty) MUST NOT cause the command to exit non-zero; the write result MUST still be reported as successful.

### Scenario: happy path — CLAUDE.md changed and committed

- GIVEN a git-enabled repository where the regenerated `CLAUDE.md` differs from the version on disk
- WHEN `metta refresh` is invoked without `--no-commit`
- THEN `CLAUDE.md` is written to disk and auto-committed with message `chore(refresh): regenerate CLAUDE.md`
- AND `git status` subsequently shows `CLAUDE.md` is not modified or untracked
- AND `git log -1 --pretty=%s` outputs exactly `chore(refresh): regenerate CLAUDE.md`

### Scenario: no empty commit when CLAUDE.md is unchanged

- GIVEN a git-enabled repository where the regenerated `CLAUDE.md` is identical to the current on-disk content
- WHEN `metta refresh` is invoked without `--no-commit`
- THEN `CLAUDE.md` is not written (written === false) and no auto-commit is produced
- AND running `metta refresh` a second time immediately after a successful auto-commit produces no additional `chore(refresh): regenerate CLAUDE.md` entry in `git log`

---

## ADDED: Requirement: refresh-no-commit-flag

**Fulfills:** US-2

`metta refresh` MUST accept a `--no-commit` boolean flag. When `--no-commit` is supplied, `CLAUDE.md` MUST be written to disk (if content changed) but the auto-commit step MUST be skipped, leaving the working-tree modification for the user to stage and commit manually. The `--no-commit` flag MUST be independent of `--dry-run`; combining them MUST result in no write and no commit.

### Scenario: --no-commit skips staging and commit

- GIVEN a git-enabled repository where the regenerated `CLAUDE.md` differs from the on-disk version
- WHEN `metta refresh --no-commit` is invoked
- THEN `CLAUDE.md` is written to disk and `git status` shows it as modified
- AND no `git add` or `git commit` command is invoked
- AND `git log -1 --pretty=%s` does NOT output `chore(refresh): regenerate CLAUDE.md`

---

## ADDED: Requirement: refresh-respects-git-disabled

**Fulfills:** US-3

When the current working directory is not inside a git working tree, or when `git` is unavailable, `metta refresh` MUST write `CLAUDE.md` normally and MUST exit with code 0. Any git error during the commit step MUST be suppressed; the write result MUST still be reported as successful.

### Scenario: not a git repo — commit step silently skipped

- GIVEN the current working directory is not inside a git working tree (no `.git` ancestry)
- WHEN `metta refresh` is invoked
- THEN `CLAUDE.md` is written to disk, the commit step is skipped without error, and the command exits with code 0

### Scenario: other tracked files are dirty — commit refused but refresh succeeds

- GIVEN a git-enabled repository where unrelated tracked files are modified in the working tree
- WHEN `metta refresh` is invoked
- THEN `CLAUDE.md` is written to disk, the auto-commit step is refused (to avoid sweeping unrelated changes into the commit), and the command exits with code 0

---

## ADDED: Requirement: refresh-skill-documents-commit-behavior

**Fulfills:** US-1, US-2

`src/templates/skills/metta-refresh/SKILL.md` MUST be updated to document that `metta refresh` automatically commits `CLAUDE.md` after writing it, using the message `chore(refresh): regenerate CLAUDE.md`. The file MUST also document the `--no-commit` flag and describe it as the opt-out escape hatch for users who wish to inspect the diff or commit manually. The existing description of the command's purpose and invocation MUST be preserved.

### Scenario: skill file contains auto-commit documentation

- GIVEN the `metta-refresh` skill file at `src/templates/skills/metta-refresh/SKILL.md`
- WHEN its contents are read
- THEN the file contains the string `chore(refresh): regenerate CLAUDE.md`
- AND the file contains the string `--no-commit`
- AND the file contains text explaining that the commit step is automatic by default
