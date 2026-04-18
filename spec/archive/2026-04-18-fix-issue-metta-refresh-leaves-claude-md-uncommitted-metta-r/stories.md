# User Stories: fix-issue-metta-refresh-leaves-claude-md-uncommitted-metta-r

## US-1: Auto-commit regenerated CLAUDE.md

**As a** metta user running `metta refresh`
**I want to** have the regenerated `CLAUDE.md` automatically committed
**So that** my working tree stays clean and CLAUDE.md changes do not silently contaminate an unrelated next commit
**Priority:** P1
**Independent Test Criteria:** After running `metta refresh` in a git-enabled repo where CLAUDE.md content changes, `git log -1` shows a commit with message `chore(refresh): regenerate CLAUDE.md` and `git status` reports a clean working tree for `CLAUDE.md`.

**Acceptance Criteria:**
- **Given** `git.enabled` is true and the regenerated CLAUDE.md differs from the on-disk version **When** I run `metta refresh` **Then** CLAUDE.md is written to disk, staged, and committed with the message `chore(refresh): regenerate CLAUDE.md`
- **Given** a successful refresh commit **When** I run `git status` **Then** CLAUDE.md is not listed as modified or untracked
- **Given** a successful refresh commit **When** I run `git log -1 --pretty=%s` **Then** the subject line is exactly `chore(refresh): regenerate CLAUDE.md`

## US-2: Opt out with `--no-commit` to inspect the diff first

**As a** metta user who wants to review the CLAUDE.md diff before committing
**I want to** pass `--no-commit` to `metta refresh`
**So that** I can stage and commit CLAUDE.md manually on my own terms
**Priority:** P2
**Independent Test Criteria:** Running `metta refresh --no-commit` in a git-enabled repo writes CLAUDE.md but creates no commit, and `git status` shows CLAUDE.md as modified.

**Acceptance Criteria:**
- **Given** `git.enabled` is true and the regenerated CLAUDE.md differs from disk **When** I run `metta refresh --no-commit` **Then** CLAUDE.md is written to disk but not staged or committed
- **Given** I ran `metta refresh --no-commit` **When** I run `git status` **Then** CLAUDE.md appears in the modified list
- **Given** I ran `metta refresh --no-commit` **When** I run `git log -1 --pretty=%s` **Then** the latest commit subject is NOT `chore(refresh): regenerate CLAUDE.md`

## US-3: Skip commit gracefully when git is unavailable

**As a** user with `git.enabled = false` or running outside a git repository
**I want to** have `metta refresh` skip the commit step without error
**So that** refresh still works in non-git contexts and degrades gracefully
**Priority:** P2
**Independent Test Criteria:** Running `metta refresh` with git disabled or outside a repo writes CLAUDE.md and exits successfully with no commit attempted and no error raised.

**Acceptance Criteria:**
- **Given** `git.enabled` is false **When** I run `metta refresh` **Then** CLAUDE.md is written, no `git` commands are invoked, and the command exits successfully
- **Given** the current directory is not a git working tree **When** I run `metta refresh` **Then** the commit step is silently skipped and the command exits successfully
- **Given** a git failure during the commit step **When** `metta refresh` runs **Then** the write still succeeds and the failure is handled without crashing the command

## US-4: No empty commit when CLAUDE.md is unchanged

**As a** user running `metta refresh` when CLAUDE.md is already up to date
**I want to** have refresh skip creating an empty commit
**So that** my git history is not polluted with no-op `chore(refresh)` commits
**Priority:** P3
**Independent Test Criteria:** Running `metta refresh` twice in a row produces exactly one `chore(refresh): regenerate CLAUDE.md` commit (from the first run); the second run creates no new commit.

**Acceptance Criteria:**
- **Given** the regenerated CLAUDE.md content equals the current on-disk content **When** I run `metta refresh` **Then** no commit is created
- **Given** CLAUDE.md was just committed by a prior `metta refresh` **When** I run `metta refresh` again immediately **Then** `git log` shows no additional `chore(refresh): regenerate CLAUDE.md` commit from the second run
- **Given** `git diff --cached --quiet` reports no staged changes after `git add CLAUDE.md` **When** refresh evaluates whether to commit **Then** the commit step is skipped
