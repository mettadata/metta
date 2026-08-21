# fix-metta-propose-runs-entire-lifecycle-through-finalize — User Stories

## US-1: Propose stops at an open PR by default

**As a** developer running `/metta-propose` in an AI orchestrator session
**I want to** the pipeline to run end-to-end through finalize, push, and PR creation, then stop and report the PR URL
**So that** I get a reviewable pull request without metta merging code to main that I never consented to land
**Priority:** P1
**Independent Test Criteria:** A default `/metta-propose` run (no stop-after flag) ends with `gh pr create` and a reported PR URL, and no `gh pr merge` is executed.

**Acceptance Criteria:**
- **Given** `/metta-propose <description>` is invoked with no stop-after flag **When** the change completes verification and finalize **Then** the skill pushes the branch, creates the PR, reports the PR URL, and stops without running `gh pr merge`
- **Given** a completed default propose run **When** the user inspects the repository **Then** the change branch's PR is open and main does not contain the merge
- **Given** a default propose run has stopped at PR-open **When** the user wants to land it **Then** `/metta-ship` (or an explicit merge) completes the change without rework

## US-2: Explicit ship opt-in restores run-to-merge

**As a** developer who wants a change landed autonomously
**I want to** pass an explicit `--ship` / `stop-after=ship` opt-in on `/metta-propose`
**So that** I can still get the old run-to-merge behavior when I have deliberately chosen it
**Priority:** P1
**Independent Test Criteria:** A propose run with the ship opt-in proceeds past PR creation to CI watch and merge, using the existing propose-stop-after machinery.

**Acceptance Criteria:**
- **Given** `/metta-propose` is invoked with the ship opt-in **When** the PR is created **Then** the skill continues through `gh pr checks --watch` and `gh pr merge` as before
- **Given** the ship opt-in is recorded via the propose-stop-after machinery **When** `.metta.yaml` is inspected **Then** the recorded stop-after value validates against the existing schema and drives the boundary check

## US-3: Existing stop-after values keep their semantics

**As a** developer already using `--stop-after` values (`intent`, `tasks`, etc.)
**I want to** all currently accepted stop-after values to keep working unchanged
**So that** the default flip does not break my existing workflows or scripts
**Priority:** P2
**Independent Test Criteria:** Each previously accepted stop-after value still validates and stops the propose pipeline at the same boundary as before the change.

**Acceptance Criteria:**
- **Given** `/metta-propose` is invoked with an existing stop-after value such as `tasks` **When** that artifact completes **Then** the pipeline stops at the same boundary it did before this change
- **Given** the `propose-stop-after` spec delta is applied **When** the value set is reviewed **Then** no existing value is removed or renamed, and only the absent-flag default semantics change
- **Given** `/metta-auto` or `/metta-fix-issues` is invoked **When** their lifecycles complete **Then** they still run to merge exactly as before

## US-4: Instructions and docs cannot silently restore auto-merge

**As a** metta maintainer
**I want to** both propose SKILL.md copies and the CLAUDE.md workflow wording updated to match the PR-open default, guarded by grep-assert regression tests
**So that** the skill instructions, docs, and behavior stay consistent and a future skill edit cannot quietly reintroduce unconditional merge
**Priority:** P2
**Independent Test Criteria:** Grep-assert tests over both SKILL.md copies fail if an unconditional merge instruction is present, and pass on the updated files.

**Acceptance Criteria:**
- **Given** the installed skill (`.claude/skills/metta-propose/SKILL.md`) and the template (`src/templates/skills/metta-propose/SKILL.md`) **When** their default-path instructions are read **Then** the terminal action is `gh pr create` + report, with merge conditional on the explicit ship opt-in and no "must ship" mandate on the default path
- **Given** the grep-assert regression tests **When** an unconditional `gh pr merge` instruction is added back to either SKILL.md copy **Then** the test suite fails
- **Given** the CLAUDE.md workflow section **When** a reader checks `/metta-propose`'s described behavior **Then** it states the run ends at an open PR unless ship is explicitly requested
