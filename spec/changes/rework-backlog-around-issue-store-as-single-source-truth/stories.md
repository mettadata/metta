<!--
User stories for this change.

Format: one `## US-N:` block per story with six bold-label fields
(**As a**, **I want to**, **So that**, **Priority:**, **Independent Test Criteria:**,
**Acceptance Criteria:**) followed by one or more Given/When/Then bullets.
Story IDs MUST be monotonic starting at US-1.
-->

# rework-backlog-around-issue-store-as-single-source-truth — User Stories

## US-1: Backlog an existing issue without duplicating it

**As a** developer triaging logged issues on a metta project
**I want to** add an already-logged issue to the backlog by its slug, flipping frontmatter on the existing file
**So that** the issue file stays the single source of truth and later updates (like RCA notes) never drift from a stale backlog copy

**Priority:** P1
**Independent Test Criteria:** Running backlog add with an existing issue slug sets `backlog: true` in that issue's frontmatter without creating any new file under spec/backlog/ or spec/issues/, and the issue body is byte-identical afterward.

**Acceptance Criteria:**
- **Given** an issue exists at `spec/issues/<slug>.md` with no frontmatter `backlog` field **When** the user runs the backlog-add flow with that slug **Then** the same file gains `backlog: true` in its frontmatter and no second file is minted anywhere
- **Given** an issue already has `backlog: true` **When** the user backlogs it again **Then** the operation succeeds idempotently with no content change and a message noting it was already backlogged
- **Given** a backlogged issue later receives body edits (e.g. RCA findings) **When** the backlog is listed **Then** the listing reflects the single up-to-date issue file — there is no parallel copy to go stale

---

## US-2: Capture a new idea as a typed issue entry

**As a** developer capturing future work that is not yet a defect
**I want to** add a brand-new idea to the backlog and have it minted as a `type: idea` entry in the issue store
**So that** all work items — bugs and ideas alike — live in one store with one lifecycle instead of a parallel spec/backlog/ directory

**Priority:** P1
**Independent Test Criteria:** Adding a non-issue idea via the backlog flow creates a file in spec/issues/ with frontmatter `type: idea` and `backlog: true`, and creates nothing under spec/backlog/.

**Acceptance Criteria:**
- **Given** no issue exists for a piece of future work **When** the user adds it through the backlog flow with a title and description **Then** a new entry is created in the issue store with `type: idea` and `backlog: true` frontmatter
- **Given** the new idea entry exists **When** the issue store is listed **Then** the idea appears alongside `type: issue` entries and is distinguishable by its type

---

## US-3: Create milestones and assign issues to them

**As a** project maintainer planning a release
**I want to** create a milestone file and assign issues to it via their frontmatter
**So that** I can express "these issues make up v0.6" as first-class, versionable data

**Priority:** P1
**Independent Test Criteria:** Creating a milestone produces `spec/milestones/<slug>.md` with Zod-validated name/target/status frontmatter, and assigning an issue writes `milestone: <slug>` into that issue's frontmatter.

**Acceptance Criteria:**
- **Given** no milestone named v0.6 exists **When** the user creates milestone `v0-6` with a name and target **Then** `spec/milestones/v0-6.md` is written with `status: open` frontmatter and the description as body
- **Given** milestone `v0-6` exists and issue `<slug>` exists **When** the user assigns the issue to the milestone **Then** the issue's frontmatter gains `milestone: v0-6` and no content is copied between files
- **Given** an issue references a milestone slug that has no file **When** milestones or issues are listed **Then** a warning is emitted about the dangling reference and the command still succeeds

---

## US-4: View milestone progress as resolved-vs-open rollup

**As a** project maintainer tracking a release
**I want to** view a milestone's issues with a resolved-vs-open progress rollup, surfaced in milestone view, status, and progress commands
**So that** I can see at a glance how close a release is to done without manually counting files

**Priority:** P2
**Independent Test Criteria:** With N issues assigned to a milestone of which K live in spec/issues/resolved/, the milestone view and status/progress surfaces report K resolved of N total for that milestone.

**Acceptance Criteria:**
- **Given** a milestone with three assigned issues, one of which is in `spec/issues/resolved/` **When** the user views that milestone **Then** the output lists all three issues and reports 1 resolved / 2 open
- **Given** milestones with assigned issues exist **When** the user runs the status or progress skill **Then** per-milestone open/resolved rollups appear in the output
- **Given** a milestone with zero assigned issues **When** it is viewed **Then** the command succeeds and reports an empty issue list rather than failing

---

## US-5: Backlog list as a sorted view over issue frontmatter

**As a** developer deciding what to work on next
**I want to** list the backlog as a computed view over issue frontmatter, sorted by priority, then order, then captured date
**So that** prioritization is a property of the one true issue record and the list is always consistent with reality

**Priority:** P1
**Independent Test Criteria:** Backlog list output contains exactly the issues with `backlog: true`, ordered by priority (high > medium > low), then numeric `order`, then captured date, and reads nothing from spec/backlog/.

**Acceptance Criteria:**
- **Given** issues with `backlog: true` carrying mixed priorities and order values **When** the user lists the backlog **Then** items appear sorted by priority first, order second, captured date third
- **Given** an issue with `backlog: true` and another without the field **When** the backlog is listed **Then** only the flagged issue appears
- **Given** a backlogged issue missing optional fields like priority or order **When** the backlog is listed **Then** the item still renders using sensible defaults instead of erroring

---

## US-6: Promote a backlog item straight into fix-issues

**As a** developer ready to act on a backlog item
**I want to** promote it and be handed off to the /metta-fix-issues flow, and mark items done through spec/issues/resolved/
**So that** backlog items follow the same single lifecycle as every other issue instead of a parallel promote/done machinery

**Priority:** P2
**Independent Test Criteria:** Promoting a backlogged issue routes into the fix-issues flow for that slug, and marking one done moves the file to spec/issues/resolved/ using the standard issue-resolution path.

**Acceptance Criteria:**
- **Given** a backlogged issue exists **When** the user promotes it **Then** the flow hands off to /metta-fix-issues with that issue slug and no duplicate change-tracking file is created
- **Given** a backlogged issue is finished outside a change **When** the user marks it done via the backlog flow **Then** the issue file is moved to `spec/issues/resolved/` and it disappears from the backlog list

---

## US-7: Log an issue with milestone and priority in one step

**As a** developer logging a freshly discovered issue
**I want to** pass --milestone and --priority when logging it
**So that** triage metadata is captured at the moment of discovery instead of requiring a second editing pass

**Priority:** P2
**Independent Test Criteria:** Logging an issue with --milestone and --priority produces an issue file whose frontmatter contains the given milestone slug and priority, validated by the Zod schema.

**Acceptance Criteria:**
- **Given** milestone `v0-6` exists **When** the user logs an issue with `--milestone v0-6 --priority high` **Then** the new issue file's frontmatter contains `milestone: v0-6` and `priority: high`
- **Given** the user passes an invalid priority value **When** the issue is logged **Then** validation rejects it with a clear error naming the allowed values (high|medium|low)

---

## US-8: Migrate legacy backlog data idempotently

**As a** maintainer of an existing metta project (zeus, or the metta repo itself)
**I want to** run a migration that converts all spec/backlog/ items — including done/ archives — into frontmattered issue entries and retires the old directory
**So that** existing projects land on the single-store model without losing any captured work or history

**Priority:** P1
**Independent Test Criteria:** After running the migration twice on a repo with active and done backlog items, every active item exists once as a `type: idea` issue with `backlog: true`, every done item exists once under spec/issues/resolved/, original content is preserved, spec/backlog/ is archived, and the second run makes zero changes.

**Acceptance Criteria:**
- **Given** a repo with items in `spec/backlog/` and `spec/backlog/done/` **When** the migration runs **Then** active items become `type: idea` issues with `backlog: true`, done items land in `spec/issues/resolved/`, and each file's descriptive content is preserved
- **Given** the migration has already run **When** it runs again **Then** no duplicate entries are created and the run reports nothing to do
- **Given** the migration completes **When** the user inspects the repo **Then** the old `spec/backlog/` directory is archived rather than silently deleted

---

## US-9: Plain issues keep working unchanged

**As a** developer with existing issues that use bold-label metadata and no frontmatter
**I want to** have all new frontmatter fields be optional with safe defaults
**So that** adopting the new backlog/milestone model never breaks parsing or workflows for the issue files I already have

**Priority:** P1
**Independent Test Criteria:** An existing frontmatter-less issue file parses, lists, and resolves exactly as before the change, defaulting to `type: issue` and appearing in no backlog or milestone view.

**Acceptance Criteria:**
- **Given** a pre-existing issue file with only bold-label metadata and no YAML frontmatter **When** issues are listed or the issue is resolved **Then** the file is parsed successfully and treated as `type: issue` with no backlog or milestone membership
- **Given** frontmatter with only a subset of the new optional fields **When** the file is validated **Then** the Zod schema accepts it and fills documented defaults for the rest
