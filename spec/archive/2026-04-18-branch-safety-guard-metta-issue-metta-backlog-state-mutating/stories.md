# branch-safety-guard-metta-issue-metta-backlog-state-mutating — User Stories

## US-1: Blocks state-mutating writes on feature branches

**As a** metta user who is mid-change on a feature branch
**I want to** `metta issue`, `metta backlog add`, and `metta backlog done` to refuse to run when HEAD is not the configured main branch
**So that** main-branch artifacts (issues, backlog) cannot silently contaminate an unrelated feature branch
**Priority:** P1
**Independent Test Criteria:** With HEAD on `metta/fix-foo`, `metta issue "x"` exits non-zero with a message naming both the current branch and the expected main branch.

**Acceptance Criteria:**
- **Given** HEAD is on a non-main branch **When** `metta issue "x"` is invoked **Then** the command exits with code 4 and stderr contains `Refusing to write` and both the current branch name and the main branch name
- **Given** HEAD is on a non-main branch **When** `metta backlog add "y"` is invoked **Then** same refusal behavior
- **Given** HEAD is on a non-main branch **When** `metta backlog done <slug>` is invoked **Then** same refusal behavior

---

## US-2: `--on-branch <name>` override

**As a** metta user who deliberately wants to log an issue on the current feature branch
**I want to** pass `--on-branch <name>` to acknowledge the cross-branch write
**So that** I can opt out of the guard when the non-default case is intentional
**Priority:** P2
**Independent Test Criteria:** With HEAD on `metta/fix-foo`, `metta issue "x" --on-branch metta/fix-foo` exits 0 and creates the issue on that branch.

**Acceptance Criteria:**
- **Given** HEAD is on a feature branch and `--on-branch <that-branch>` is supplied **When** any of the three commands is invoked **Then** the command proceeds normally and exits 0
- **Given** `--on-branch` is supplied with a mismatched name **Then** the guard still refuses (override must name the actual current branch)

---

## US-3: Guard is a no-op on main

**As a** metta user running commands on the main branch
**I want to** the guard to pass silently
**So that** the default workflow is unchanged and the guard only fires when it matters
**Priority:** P1
**Independent Test Criteria:** With HEAD on `main`, all three commands exit 0 without invoking the guard's error path.

**Acceptance Criteria:**
- **Given** HEAD is on `main` (or whatever `pr_base` configures) **When** any of the three commands is invoked **Then** the guard passes and the command proceeds normally
