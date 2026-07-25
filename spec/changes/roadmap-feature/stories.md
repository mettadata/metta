<!--
User stories for this change.

Format: one `## US-N:` block per story with six bold-label fields
(**As a**, **I want to**, **So that**, **Priority:**, **Independent Test Criteria:**,
**Acceptance Criteria:**) followed by one or more Given/When/Then bullets.
Story IDs MUST be monotonic starting at US-1.
-->

# roadmap-feature — User Stories

## US-1: View the ordered roadmap

**As a** developer using metta on my project
**I want to** run `metta roadmap` and see the ordered list of planned features — position, backlog slug, resolved title, and note
**So that** the intended build sequence lives in project state instead of my head, memory files, or ad-hoc notes

**Priority:** P1
**Independent Test Criteria:** Running `metta roadmap` (with and without `--json`) against a populated `spec/roadmap.md` prints every entry in order with position, slug, resolved backlog title, and note, performs no writes, and exits 0.

**Acceptance Criteria:**
- **Given** a `spec/roadmap.md` with three entries referencing existing backlog items **When** I run `metta roadmap` **Then** the entries are listed in roadmap order with position, slug, title resolved from the backlog item, and note, and no file is modified.
- **Given** the same roadmap **When** I run `metta roadmap --json` **Then** the same ordered data is emitted as JSON, consistent with the global `--json` flag behavior of other commands.
- **Given** a roadmap entry whose backlog item was deleted from `spec/backlog/` after being added **When** I run `metta roadmap` **Then** the entry is surfaced as dangling in the view and the command does not crash.
- **Given** I am on a non-main branch **When** I run the read-only `metta roadmap` view **Then** no branch guard fires and no write occurs.

## US-2: Add a backlog item to the roadmap

**As a** developer using metta on my project
**I want to** run `metta roadmap add <backlog-slug>` (optionally with `--note <text>`) to append an existing backlog item to the end of the roadmap
**So that** I can grow the execution queue from the backlog pool without duplicating item content — the roadmap stays a thin ordered layer of slug references

**Priority:** P1
**Independent Test Criteria:** `metta roadmap add` appends a valid backlog slug (with optional note) to the end of `spec/roadmap.md` and auto-commits it, while unknown slugs and duplicates are rejected with the standard JSON error envelope and exit code 4.

**Acceptance Criteria:**
- **Given** a backlog item `spec/backlog/foo.md` exists and is not on the roadmap **When** I run `metta roadmap add foo --note "after auth"` **Then** the entry is appended at the end of the roadmap with its note, and `spec/roadmap.md` is auto-committed.
- **Given** the slug `nope` does not exist in `spec/backlog/` (checked via `BacklogStore.exists`) **When** I run `metta roadmap add nope` **Then** the command fails with the JSON envelope `{error: {code, type, message}}` with `type: 'not_found'` and exit code 4, and the roadmap file is unchanged.
- **Given** slug `foo` is already on the roadmap **When** I run `metta roadmap add foo` **Then** the command is rejected as a duplicate (`type: 'duplicate_entry'`, exit code 4) and the roadmap is unchanged.
- **Given** I am on a branch other than main and do not pass `--on-branch` **When** I run `metta roadmap add foo` **Then** the branch guard rejects the operation (`type: 'branch_guard'`), matching `backlog add` behavior.

## US-3: Reorder the roadmap non-interactively

**As a** developer using metta on my project
**I want to** run `metta roadmap reorder <slug...>` with the complete new order as positional arguments
**So that** I can re-sequence upcoming work deterministically from a script or an AI session, with no interactive TTY prompts and no risk of a half-applied ordering

**Priority:** P2
**Independent Test Criteria:** `metta roadmap reorder` rewrites `spec/roadmap.md` only when the arguments are an exact permutation of the current roadmap slugs; any missing, extra, or duplicated slug is rejected with exit code 4 and the file is left byte-for-byte untouched.

**Acceptance Criteria:**
- **Given** the roadmap contains slugs `a`, `b`, `c` in that order **When** I run `metta roadmap reorder c a b` **Then** the roadmap is rewritten in the new order and auto-committed.
- **Given** the roadmap contains `a`, `b`, `c` **When** I run `metta roadmap reorder c a` (an omission) or `metta roadmap reorder c a b d` (an addition) or `metta roadmap reorder a a b` (a duplicate) **Then** each invocation fails with the JSON error envelope (`type: 'invalid_reorder'`) and exit code 4, and no partial write occurs — `spec/roadmap.md` is unchanged.
- **Given** I am on a non-main branch without `--on-branch` **When** I run `metta roadmap reorder ...` **Then** the branch guard rejects the mutation before any validation or write.

## US-4: Activate the next roadmap item into a change

**As a** developer using metta on my project
**I want to** run `metta roadmap next` to activate the top roadmap entry into `spec/changes/` and pop it off the roadmap
**So that** "start the next planned feature" is a single take-the-top-of-the-queue operation instead of me remembering which slug to `backlog promote`

**Priority:** P1
**Independent Test Criteria:** `metta roadmap next` resolves the top entry's backlog item, hands off through the same activation path as `backlog promote` (the `metta propose "<title>"` handoff), removes the entry from the roadmap, and auto-commits the updated `spec/roadmap.md`.

**Acceptance Criteria:**
- **Given** a roadmap whose top entry references an existing backlog item **When** I run `metta roadmap next` **Then** the backlog item is resolved and activated via the exact same path `backlog promote` uses, and the entry is removed from the roadmap so the second entry becomes the new top.
- **Given** the roadmap is empty **When** I run `metta roadmap next` **Then** the command is a friendly no-op: `{"next": null}` in JSON mode, an informative message in text mode, and exit code 0.
- **Given** I am on a non-main branch without `--on-branch` **When** I run `metta roadmap next` **Then** the branch guard rejects the mutation and the roadmap is unchanged.

## US-5: AI orchestrator answers "what next?" from the roadmap

**As an** AI orchestrator session driving `/metta-next`
**I want to** fall through to the roadmap's top entry when no change is currently active
**So that** sequencing decisions are answered from durable project state instead of being re-litigated with the user every session

**Priority:** P1
**Independent Test Criteria:** With no active change and a populated roadmap, an orchestrator session can read the ordered queue via the unguarded `metta roadmap` view and drive activation of the top entry through the `/metta-roadmap` skill without ever invoking a mutating CLI form directly.

**Acceptance Criteria:**
- **Given** no change is active in `spec/changes/` and the roadmap has entries **When** the orchestrator routes via `/metta-next` **Then** it can determine the next feature from the roadmap's top entry (via the read-only `metta roadmap` view, which is on the unguarded read-only pattern) rather than asking the user to pick from the unordered backlog.
- **Given** the orchestrator decides to activate the top entry **When** it proceeds **Then** it does so through the `/metta-roadmap` skill (which mints the session credential), never by calling `metta roadmap next` directly.
- **Given** the roadmap is empty and no change is active **When** the orchestrator checks the roadmap **Then** it receives `{"next": null}` / an empty ordered list and can cleanly fall back to other routing (e.g. backlog or user input) with exit code 0.

## US-6: Mutating roadmap operations are guard-protected for AI sessions

**As a** developer relying on metta's skill-authorization guard
**I want to** have `roadmap add`, `roadmap reorder`, and `roadmap next` enforced as Tier 2 session-tier operations in the guard hook, with a `/metta-roadmap` skill that wraps them
**So that** AI sessions can only mutate the roadmap through the sanctioned skill path — the same defense that already protects `backlog add/done/promote` — while the read-only view stays freely available

**Priority:** P2
**Independent Test Criteria:** From an AI session without a valid session credential, the guard hook blocks `metta roadmap add/reorder/next` Bash calls, while bare `metta roadmap` passes the unguarded read-only pattern; invoking `/metta-roadmap` mints the credential and permits the wrapped mutation.

**Acceptance Criteria:**
- **Given** an AI orchestrator session with no valid credential at `.metta/scratch/skill-session.token` **When** it attempts a direct Bash call to `metta roadmap add`, `metta roadmap reorder`, or `metta roadmap next` **Then** the `metta-guard-bash` hook blocks the call via the Tier 2 allowlist entries.
- **Given** the same session **When** it runs the bare read-only `metta roadmap` view **Then** the call is permitted under the unguarded read-only pattern (like `backlog list/show`).
- **Given** the `/metta-roadmap` skill is invoked **When** the skill mints the session credential and issues the wrapped mutating command **Then** the guard authorizes it, mirroring the existing `metta-backlog` skill flow, and existing backlog/changes guard entries remain untouched.
