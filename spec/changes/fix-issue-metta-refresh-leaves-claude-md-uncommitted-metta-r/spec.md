# Spec: fix-issue-metta-refresh-leaves-claude-md-uncommitted-metta-r

## ADDED: Requirement: refresh-auto-commits-regenerated-claude-md

**Fulfills:** US-1, US-4

When `runRefresh` writes `CLAUDE.md` to disk, `metta refresh` MUST subsequently stage only `CLAUDE.md` via `git add -- CLAUDE.md` and attempt to commit it with the exact message `chore(refresh): regenerate CLAUDE.md`. The commit MUST be skipped when `git diff --cached --quiet` reports no staged changes (i.e., the file was already up to date or unchanged). The commit logic MUST be wrapped in a try/catch so that a git failure does not cause the command to exit non-zero; git unavailability MUST be handled silently. This behavior applies whenever `git.enabled` is true and the `--no-commit` flag is absent. Only `CLAUDE.md` MUST be staged; no other working-tree files MAY be swept into this commit.

The `runRefresh` function signature MUST gain a `noCommit: boolean` parameter. The `registerRefreshCommand` action MUST pass `options.noCommit ?? false` to `runRefresh`. The returned `{ diff, written, filePath }` object is unchanged.

### Scenario: happy path — CLAUDE.md changed and committed

- GIVEN a git-enabled repository where the regenerated `CLAUDE.md` differs from the version on disk
- WHEN `metta refresh` is invoked without `--no-commit`
- THEN `CLAUDE.md` is written to disk, `git add -- CLAUDE.md` is executed, `git diff --cached --quiet` detects staged changes, and `git commit -m "chore(refresh): regenerate CLAUDE.md"` is executed
- AND `git status` subsequently shows `CLAUDE.md` is not modified or untracked
- AND `git log -1 --pretty=%s` outputs exactly `chore(refresh): regenerate CLAUDE.md`

### Scenario: no empty commit when CLAUDE.md is unchanged

- GIVEN a git-enabled repository where the regenerated `CLAUDE.md` is identical to the current on-disk content
- WHEN `metta refresh` is invoked without `--no-commit`
- THEN `CLAUDE.md` is not written (written === false), `git add -- CLAUDE.md` is executed, `git diff --cached --quiet` exits 0 (no staged changes), and no `git commit` command is issued
- AND running `metta refresh` a second time immediately after a successful auto-commit produces no additional `chore(refresh): regenerate CLAUDE.md` entry in `git log`

---

## ADDED: Requirement: refresh-no-commit-flag

**Fulfills:** US-2

`registerRefreshCommand` MUST register a `--no-commit` boolean option on the `refresh` Commander command. When `--no-commit` is supplied, `runRefresh` MUST write `CLAUDE.md` to disk (if content changed) but MUST NOT invoke any `git` commands. The working-tree modification MUST be left for the user to stage and commit manually. The `--no-commit` flag MUST be independent of `--dry-run`; combining them MUST result in no write and no commit.

### Scenario: --no-commit skips staging and commit

- GIVEN a git-enabled repository where the regenerated `CLAUDE.md` differs from the on-disk version
- WHEN `metta refresh --no-commit` is invoked
- THEN `CLAUDE.md` is written to disk and `git status` shows it as modified
- AND no `git add` or `git commit` command is invoked
- AND `git log -1 --pretty=%s` does NOT output `chore(refresh): regenerate CLAUDE.md`

---

## ADDED: Requirement: refresh-respects-git-disabled

**Fulfills:** US-3

When `git.enabled` is false in the metta config, or when the current working directory is not inside a git working tree, `metta refresh` MUST write `CLAUDE.md` normally and MUST NOT attempt any `git` subprocess calls. The command MUST exit with code 0. A git error thrown during the commit step (e.g., `git` binary not on PATH, repository corruption) MUST be caught by the try/catch block and suppressed; the write result MUST still be reported as successful.

### Scenario: git.enabled false — no git calls, clean exit

- GIVEN a metta project where `git.enabled` is false in config
- WHEN `metta refresh` is invoked
- THEN `CLAUDE.md` is written to disk and the command exits with code 0
- AND no `git` subprocess is spawned

### Scenario: not a git repo — commit step silently skipped

- GIVEN the current working directory is not inside a git working tree (no `.git` ancestry)
- WHEN `metta refresh` is invoked
- THEN `CLAUDE.md` is written to disk, the git commit block throws, the error is caught and discarded, and the command exits with code 0

### Scenario: git subprocess fails mid-commit — write still succeeds

- GIVEN `git.enabled` is true but `git commit` throws an unexpected error after `git add` succeeds
- WHEN `metta refresh` is invoked
- THEN the write is reported as successful (written === true) and the process exits with code 0 without surfacing the git error to the user

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
