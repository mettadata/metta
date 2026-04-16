# custom-claude-statusline-conte — User Stories

## US-1: Ambient metta artifact indicator in statusline
**As a** developer running a Claude Code session on a metta-managed project
**I want to** see the current metta change's in-progress artifact in the Claude Code statusline
**So that** I always know which step of the change lifecycle I am on without running `metta status`
**Priority:** P1
**Independent Test Criteria:** With an active change whose current artifact is `spec`, running the statusline script with valid stdin JSON prints a line containing `[metta: spec]`.

**Acceptance Criteria:**
- **Given** a metta change is active with current artifact `stories` **When** Claude Code invokes the statusline script after a turn **Then** the printed statusline contains the substring `[metta: stories]`
- **Given** `metta status --json` reports a different artifact on the next turn **When** the statusline script runs again **Then** the new artifact name replaces the old one in the output

---

## US-2: Context window utilization percentage
**As a** developer in a long, nested Claude Code session
**I want to** see the percentage of the model's context window currently consumed
**So that** I can pace my session and start a fresh one before hitting a hard context failure
**Priority:** P1
**Independent Test Criteria:** Given a stdin payload reporting 100,000 used tokens and a model id not containing `[1m]`, the statusline output contains `50%`.

**Acceptance Criteria:**
- **Given** stdin JSON reports 50,000 used tokens and the model id is `claude-opus-4-6` **When** the statusline script runs **Then** the printed line contains `25%` (50,000 / 200,000)
- **Given** stdin JSON reports 500,000 used tokens and the model id is `claude-opus-4-6[1m]` **When** the statusline script runs **Then** the printed line contains `50%` (500,000 / 1,000,000)
- **Given** stdin JSON is missing token counts **When** the statusline script runs **Then** the script exits 0 and prints `[metta: unknown]`

---

## US-3: `metta install` auto-registers the statusline
**As a** developer adopting metta on a new project
**I want to** `metta install` to copy the statusline script and wire it into `.claude/settings.json`
**So that** I get the statusline for free without hand-editing Claude Code config
**Priority:** P2
**Independent Test Criteria:** After running `metta install` in a fresh project, `.claude/statusline/statusline.mjs` exists with mode 0o755 and `.claude/settings.json` contains a `statusLine` entry pointing at it.

**Acceptance Criteria:**
- **Given** a project without `.claude/statusline/statusline.mjs` **When** `metta install` runs **Then** the file is written from `src/templates/statusline/statusline.mjs` with permissions `0o755`
- **Given** `.claude/settings.json` already exists with unrelated keys **When** `metta install` runs **Then** the file is rewritten preserving existing keys and adding/updating only the `statusLine` field
- **Given** `metta install` has already been run once **When** it is run a second time **Then** `.claude/settings.json` is not duplicated or corrupted and the `statusLine` field remains a single valid entry

---

## US-4: Graceful degradation on any failure
**As a** developer relying on Claude Code for daily work
**I want to** the statusline script never to crash the UI or surface a noisy error
**So that** a broken metta state or missing binary cannot disrupt my coding session
**Priority:** P2
**Independent Test Criteria:** Invoking the statusline script with malformed stdin JSON exits with code 0 and prints exactly `[metta: unknown]`.

**Acceptance Criteria:**
- **Given** `metta status --json` is not on PATH **When** the statusline script runs **Then** the script exits 0 and prints a line containing `[metta: unknown]`
- **Given** stdin JSON is truncated or malformed **When** the statusline script runs **Then** the script exits 0 and prints `[metta: unknown]`
- **Given** there is no active metta change **When** the statusline script runs **Then** the script prints `[metta: idle]` and exits 0

---

## US-5: Deterministic per-change color for the artifact label
**As a** developer juggling multiple terminals across concurrent metta changes
**I want to** each change slug to colorize its artifact label with a stable ANSI color
**So that** I can visually distinguish sessions at a glance without reading the slug
**Priority:** P3
**Independent Test Criteria:** Running the statusline script twice against the same change slug produces the same ANSI color escape code around the artifact label on both runs.

**Acceptance Criteria:**
- **Given** change slug `custom-claude-statusline-conte` **When** the statusline script prints the artifact label **Then** the label is wrapped in an ANSI color escape derived deterministically from a hash of the slug
- **Given** two different change slugs `foo` and `bar` **When** each is rendered **Then** the two labels use different ANSI color codes (assuming the hash space is wider than the palette and the slugs map to distinct buckets)
- **Given** the idle state `[metta: idle]` **When** rendered **Then** no change-slug-derived color is applied

---
