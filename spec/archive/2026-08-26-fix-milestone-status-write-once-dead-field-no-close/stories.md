# fix-milestone-status-write-once-dead-field-no-close — User Stories

## US-1: Close a completed milestone from the CLI

**As a** developer using metta milestones as a system of record
**I want to** run `metta milestone close <slug>` when a milestone's work has shipped
**So that** the milestone stops reporting a stale `open` status and my project's recorded state matches reality

**Priority:** P1
**Independent Test Criteria:** Running `metta milestone close <slug>` against an open milestone transitions its frontmatter to `status: closed` on disk via a validated write, and the transition is auto-committed with a conventional `chore:` message.

**Acceptance Criteria:**
- **Given** a milestone file with `status: open` **When** the user runs `metta milestone close <slug>` **Then** the file's frontmatter is rewritten to `status: closed`, the result passes `MilestoneFrontmatterSchema` validation before write, and the change is auto-committed with a conventional `chore:` message
- **Given** a milestone that is already `closed` **When** the user runs `metta milestone close <slug>` **Then** the command fails with a clear conflict error using the standard JSON error envelope and the file is not modified
- **Given** a slug with no matching milestone file **When** the user runs `metta milestone close <slug>` **Then** the command fails with a clear not-found error and no file is created or modified
- **Given** the repository is on the main branch **When** the user runs `metta milestone close <slug>` without `--on-branch` acknowledgment **Then** the command respects the same main-branch guard behavior as `metta milestone create`

---

## US-2: Update a milestone's mutable fields without hand-editing YAML

**As a** developer maintaining milestone descriptions and targets
**I want to** run `metta milestone update <slug>` with options like `--name`, `--target`, `--clear-target`, and `--description`
**So that** I can correct stale bodies (e.g. "In flight as PR #24") and outdated targets through a validated, auto-committed path instead of hand-editing frontmatter that bypasses Zod validation

**Priority:** P1
**Independent Test Criteria:** Running `metta milestone update <slug>` with field options patches exactly the specified fields, re-validates the full frontmatter before write, auto-commits, and leaves unspecified fields untouched.

**Acceptance Criteria:**
- **Given** an existing milestone **When** the user runs `metta milestone update <slug> --description "<new body>"` **Then** the description body is replaced, all other fields are unchanged, and the write is validated and auto-committed
- **Given** an existing milestone with a `target` set **When** the user runs `metta milestone update <slug> --clear-target` **Then** the target is removed and the resulting frontmatter still passes schema validation
- **Given** a closed milestone that was closed by mistake **When** the user explicitly requests a status change via `metta milestone update <slug>` **Then** the milestone is reopened through the same validated update path
- **Given** an update whose resulting frontmatter would fail `MilestoneFrontmatterSchema` **When** the command runs **Then** the write is rejected with a clear validation error and no unvalidated state reaches disk
- **Given** a slug with no matching milestone file **When** the user runs `metta milestone update <slug>` **Then** the command fails with a clear not-found error

---

## US-3: Distinguish abandoned milestones from completed ones

**As a** developer whose plans change
**I want to** mark a dropped milestone as `abandoned` (e.g. `metta milestone close <slug> --abandoned`)
**So that** milestones that were scrapped are recorded distinctly from milestones that were achieved, keeping the project history honest

**Priority:** P2
**Independent Test Criteria:** Closing a milestone with the abandoned flag writes `status: abandoned`, which the schema accepts, and existing files with `open`/`closed` continue to validate unchanged.

**Acceptance Criteria:**
- **Given** an open milestone **When** the user runs `metta milestone close <slug> --abandoned` **Then** the frontmatter is written as `status: abandoned` and passes validation
- **Given** existing milestone files carrying `status: open` or `status: closed` **When** any milestone command reads them **Then** they validate and behave exactly as before this change
- **Given** an `abandoned` milestone **When** the user views it via `milestone show` **Then** the status line clearly reports the abandoned state rather than mislabeling it as open or closed

---

## US-4: Accurate milestone status in dashboards and lists

**As a** developer (or AI orchestrator) checking project state via `metta status`, `metta progress`, or `metta milestone list`
**I want to** see closed and abandoned milestones rendered with correct markers and ordered after open milestones
**So that** dashboards reflect shipped and dropped work truthfully instead of reporting everything as forever open

**Priority:** P2
**Independent Test Criteria:** `milestone list`, `milestone show`, and the `status`/`progress` milestone sections render `closed` and `abandoned` states with distinct, sensible output, with terminal-state milestones sorted after open ones, and byte-identical output for `open`/`closed` milestones compared to the prior release.

**Acceptance Criteria:**
- **Given** milestones in `open`, `closed`, and `abandoned` states **When** the user runs `metta milestone list` **Then** each state renders a sensible marker and terminal-state milestones (closed and abandoned) sort after open ones
- **Given** an `abandoned` milestone **When** `metta status` or `metta progress` renders the milestone section **Then** the rollup renders the state without crashing or mislabeling it
- **Given** only `open` and `closed` milestones **When** any milestone rendering runs **Then** human and `--json` output is unchanged from pre-change behavior

---

## US-5: New milestone verbs usable from authorized AI sessions

**As an** AI orchestrator session working through metta skills
**I want to** invoke `milestone close` and `milestone update` from authorized skill contexts without the guard hook blocking them
**So that** milestone lifecycle maintenance can happen inside the normal AI-driven workflow rather than requiring a human to drop to a terminal

**Priority:** P2
**Independent Test Criteria:** The `metta-guard-bash` allow-list authorizes `milestone close` and `milestone update` under the same trust rules as existing milestone verbs, with no change to the trust-tier model.

**Acceptance Criteria:**
- **Given** an authorized skill context that can already invoke existing milestone verbs **When** it invokes `metta milestone close <slug>` or `metta milestone update <slug>` **Then** the guard hook permits the command
- **Given** an unauthorized context **When** it attempts the new verbs **Then** the guard blocks them exactly as it blocks existing milestone verbs
