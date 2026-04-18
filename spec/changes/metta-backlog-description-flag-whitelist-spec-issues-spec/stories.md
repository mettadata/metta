# metta-backlog-description-flag-whitelist-spec-issues-spec — User Stories

## US-1: Backlog add accepts description at create time

**As a** AI orchestrator running `/metta-backlog add`
**I want to** pass `--description <text>` in the same CLI call as the title
**So that** the backlog entry carries the full body without a follow-up Edit that the guard hook blocks
**Priority:** P1
**Independent Test Criteria:** `metta backlog add "Title" --description "Body text" --json` creates `spec/backlog/<slug>.md` whose parsed `description` field equals `"Body text"`.

**Acceptance Criteria:**
- **Given** a clean metta project **When** `metta backlog add "Dark mode" --description "Toggle in settings"` is invoked **Then** `spec/backlog/dark-mode.md` body contains `Toggle in settings`
- **Given** the flag is omitted **When** `metta backlog add "Dark mode"` is invoked **Then** the description defaults to the title (backward compatible)

---

## US-2: Guard hook allows enriching issue and backlog bodies

**As a** metta user who just logged an issue via `metta issue "..."`
**I want to** Edit or Write the created `spec/issues/<slug>.md` to flesh out its body
**So that** I do not need to start a no-op metta change just to add detail to an issue
**Priority:** P2
**Independent Test Criteria:** With no active metta change, a Write to `spec/issues/foo.md` or `spec/backlog/foo.md` passes the guard hook with exit 0.

**Acceptance Criteria:**
- **Given** no active change **When** an Edit targets `spec/issues/<slug>.md` **Then** `metta-guard-edit.mjs` exits 0
- **Given** no active change **When** an Edit targets `spec/backlog/<slug>.md` **Then** `metta-guard-edit.mjs` exits 0
- **Given** no active change **When** an Edit targets `src/foo.ts` **Then** the hook still blocks (unchanged)

---

## US-3: `/metta-backlog` skill uses the new flag

**As a** AI orchestrator invoking `/metta-backlog add`
**I want to** the skill template to pass `--description` in the CLI call instead of post-Edit'ing the file
**So that** the skill stops fighting the guard hook and the description actually lands
**Priority:** P2
**Independent Test Criteria:** `src/templates/skills/metta-backlog/SKILL.md` contains `metta backlog add ... --description` and no post-Edit instruction on backlog files.

**Acceptance Criteria:**
- **Given** the skill file **When** grep'd for `Edit spec/backlog` **Then** zero matches (the post-Edit workaround is gone)
- **Given** the skill file **When** grep'd for `--description` **Then** the new flag usage is shown
- **Given** the deployed mirror **When** diffed against source **Then** byte-identical
