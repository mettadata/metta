# UAT: fix-milestone-status-write-once-dead-field-no-close

- **Change**: fix-milestone-status-write-once-dead-field-no-close
- **Generated**: 2026-08-26
- **Source**: user stories (stories.md)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

### US-1: Close a completed milestone from the CLI

*Independent test:* Running `metta milestone close <slug>` against an open milestone transitions its frontmatter to `status: closed` on disk via a validated write, and the transition is auto-committed with a conventional `chore:` message.

#### Step 1.1
- **Setup**: a milestone file with `status: open`
- **Do**: the user runs `metta milestone close <slug>`
- **Observe**: the file's frontmatter is rewritten to `status: closed`, the result passes `MilestoneFrontmatterSchema` validation before write, and the change is auto-committed with a conventional `chore:` message
- [ ] Pass

#### Step 1.2
- **Setup**: a milestone that is already `closed`
- **Do**: the user runs `metta milestone close <slug>`
- **Observe**: the command fails with a clear conflict error using the standard JSON error envelope and the file is not modified
- [ ] Pass

#### Step 1.3
- **Setup**: a slug with no matching milestone file
- **Do**: the user runs `metta milestone close <slug>`
- **Observe**: the command fails with a clear not-found error and no file is created or modified
- [ ] Pass

#### Step 1.4
- **Setup**: the repository is on the main branch
- **Do**: the user runs `metta milestone close <slug>` without `--on-branch` acknowledgment (Run: `metta milestone create`)
- **Observe**: the command respects the same main-branch guard behavior as `metta milestone create`
- [ ] Pass

### US-2: Update a milestone's mutable fields without hand-editing YAML

*Independent test:* Running `metta milestone update <slug>` with field options patches exactly the specified fields, re-validates the full frontmatter before write, auto-commits, and leaves unspecified fields untouched.

#### Step 2.1
- **Setup**: an existing milestone
- **Do**: the user runs `metta milestone update <slug> --description "<new body>"`
- **Observe**: the description body is replaced, all other fields are unchanged, and the write is validated and auto-committed
- [ ] Pass

#### Step 2.2
- **Setup**: an existing milestone with a `target` set
- **Do**: the user runs `metta milestone update <slug> --clear-target`
- **Observe**: the target is removed and the resulting frontmatter still passes schema validation
- [ ] Pass

#### Step 2.3
- **Setup**: a closed milestone that was closed by mistake
- **Do**: the user explicitly requests a status change via `metta milestone update <slug>`
- **Observe**: the milestone is reopened through the same validated update path
- [ ] Pass

#### Step 2.4
- **Setup**: an update whose resulting frontmatter would fail `MilestoneFrontmatterSchema`
- **Do**: the command runs
- **Observe**: the write is rejected with a clear validation error and no unvalidated state reaches disk
- [ ] Pass

#### Step 2.5
- **Setup**: a slug with no matching milestone file
- **Do**: the user runs `metta milestone update <slug>`
- **Observe**: the command fails with a clear not-found error
- [ ] Pass

### US-3: Distinguish abandoned milestones from completed ones

*Independent test:* Closing a milestone with the abandoned flag writes `status: abandoned`, which the schema accepts, and existing files with `open`/`closed` continue to validate unchanged.

#### Step 3.1
- **Setup**: an open milestone
- **Do**: the user runs `metta milestone close <slug> --abandoned`
- **Observe**: the frontmatter is written as `status: abandoned` and passes validation
- [ ] Pass

#### Step 3.2
- **Setup**: existing milestone files carrying `status: open` or `status: closed`
- **Do**: any milestone command reads them
- **Observe**: they validate and behave exactly as before this change
- [ ] Pass

#### Step 3.3
- **Setup**: an `abandoned` milestone
- **Do**: the user views it via `milestone show` (Run: `milestone show`)
- **Observe**: the status line clearly reports the abandoned state rather than mislabeling it as open or closed
- [ ] Pass

### US-4: Accurate milestone status in dashboards and lists

*Independent test:* `milestone list`, `milestone show`, and the `status`/`progress` milestone sections render `closed` and `abandoned` states with distinct, sensible output, with terminal-state milestones sorted after open ones, and byte-identical output for `open`/`closed` milestones compared to the prior release.

#### Step 4.1
- **Setup**: milestones in `open`, `closed`, and `abandoned` states
- **Do**: the user runs `metta milestone list` (Run: `metta milestone list`)
- **Observe**: each state renders a sensible marker and terminal-state milestones (closed and abandoned) sort after open ones
- [ ] Pass

#### Step 4.2
- **Setup**: an `abandoned` milestone
- **Do**: `metta status` or `metta progress` renders the milestone section (Run: `metta status`, `metta progress`)
- **Observe**: the rollup renders the state without crashing or mislabeling it
- [ ] Pass

#### Step 4.3
- **Setup**: only `open` and `closed` milestones
- **Do**: any milestone rendering runs
- **Observe**: human and `--json` output is unchanged from pre-change behavior
- [ ] Pass

### US-5: New milestone verbs usable from authorized AI sessions

*Independent test:* The `metta-guard-bash` allow-list authorizes `milestone close` and `milestone update` under the same trust rules as existing milestone verbs, with no change to the trust-tier model.

#### Step 5.1
- **Setup**: an authorized skill context that can already invoke existing milestone verbs
- **Do**: it invokes `metta milestone close <slug>` or `metta milestone update <slug>` (Run: `milestone close`, `milestone update`)
- **Observe**: the guard hook permits the command
- [ ] Pass

#### Step 5.2
- **Setup**: an unauthorized context
- **Do**: it attempts the new verbs
- **Observe**: the guard blocks them exactly as it blocks existing milestone verbs
- [ ] Pass

## Additional scenarios

#### Step 6.1: Milestone created with defaults
- **Setup**: no milestone `v0-6` exists
- **Do**: the user runs `metta milestone create v0-6 --name "v0.6" --target 2026-09-30 --description "Backlog/milestone unification release"` (Run: `metta milestone create v0-6 --name "v0.6" --target 2026-09-30 --description "Backlog/milestone unification release"`, `metta milestone list`)
- **Observe**: `spec/milestones/v0-6.md` is written with frontmatter `name: v0.6`, `target: 2026-09-30`, `status: open`, the description as body, and `metta milestone list` includes `v0-6`
- [ ] Pass

#### Step 6.2: Creating a duplicate milestone is refused
- **Setup**: `spec/milestones/v0-6.md` already exists
- **Do**: the user runs `metta milestone create v0-6 --name "v0.6 again"` (Run: `metta milestone create v0-6 --name "v0.6 again"`)
- **Observe**: the command exits non-zero with an error stating the milestone already exists, and the existing file is unmodified
- [ ] Pass

#### Step 6.3: Invalid milestone status is rejected
- **Setup**: a milestone file whose frontmatter contains `status: shipped`
- **Do**: the milestone store reads the file
- **Observe**: validation fails with an error naming the `status` field and the allowed values `open`, `closed`, `abandoned`
- [ ] Pass

#### Step 6.4: Abandoned status validates through the schema
- **Setup**: a milestone file whose frontmatter contains `status: abandoned`
- **Do**: the milestone store reads the file
- **Observe**: validation succeeds and the parsed milestone reports status `abandoned`
- [ ] Pass

#### Step 6.5: Pre-existing open and closed files are unaffected
- **Setup**: milestone files on disk carrying `status: open` and `status: closed` written before the enum extension
- **Do**: any milestone command reads them
- **Observe**: both files validate without error and produce the same parsed status values as before the change
- [ ] Pass

#### Step 6.6: Status patch preserves untouched fields
- **Setup**: `spec/milestones/m1.md` with frontmatter `name: M1`, `target: 2026-09-30`, `status: open` and a non-empty description body
- **Do**: `update('m1', { status: 'closed' })` is called
- **Observe**: the rewritten file carries `status: closed`, retains `name: M1`, `target: 2026-09-30`, and the identical description body, and the written frontmatter passed `MilestoneFrontmatterSchema` validation before the write
- [ ] Pass

#### Step 6.7: Target is cleared from frontmatter
- **Setup**: a milestone whose frontmatter includes a `target` field
- **Do**: `update` is called with a patch that clears the target
- **Observe**: the rewritten frontmatter contains no `target` key (not `target: null`) and still passes schema validation
- [ ] Pass

#### Step 6.8: Invalid patch is rejected and the file is untouched
- **Setup**: an existing milestone file and a byte snapshot of its content
- **Do**: `update` is called with a patch producing invalid frontmatter (e.g. `target: '2026-02-30'` or an empty `name`)
- **Observe**: the call throws a validation error identifying the offending field, and the file on disk is byte-identical to the snapshot
- [ ] Pass

#### Step 6.9: Updating a missing milestone fails without side effects
- **Setup**: no file exists at `spec/milestones/ghost.md`
- **Do**: `update('ghost', { status: 'closed' })` is called
- **Observe**: the call throws an error stating milestone `ghost` was not found, and no file is created under `spec/milestones/`
- [ ] Pass

#### Step 6.10: Open milestone is closed and auto-committed
- **Setup**: `spec/milestones/m1.md` with `status: open` in a git repository on the main branch
- **Do**: the user runs `metta milestone close m1` (Run: `metta milestone close m1`)
- **Observe**: the file's frontmatter reads `status: closed`, a commit exists with message `chore: close milestone m1`, and the command exits 0 reporting the closure
- [ ] Pass

#### Step 6.11: Abandoned flag writes the abandoned state
- **Setup**: `spec/milestones/m6.md` with `status: open`
- **Do**: the user runs `metta milestone close m6 --abandoned` (Run: `metta milestone close m6 --abandoned`)
- **Observe**: the file's frontmatter reads `status: abandoned`, the result passed schema validation before write, and the transition is auto-committed with `chore: close milestone m6`
- [ ] Pass

#### Step 6.12: Closing an already-terminal milestone is a conflict
- **Setup**: `spec/milestones/m1.md` with `status: closed` and a byte snapshot of the file
- **Do**: the user runs `metta milestone close m1 --json` (Run: `metta milestone close m1 --json`)
- **Observe**: the command exits 4, stdout carries a JSON error envelope with a conflict-typed error naming the milestone's current status, and the file is byte-identical to the snapshot
- [ ] Pass

#### Step 6.13: Closing a missing milestone reports not found
- **Setup**: no file exists at `spec/milestones/ghost.md`
- **Do**: the user runs `metta milestone close ghost --json` (Run: `metta milestone close ghost --json`)
- **Observe**: the command exits 4 with a JSON error envelope of type `not_found`, and no file is created or modified
- [ ] Pass

#### Step 6.14: Main-branch guard applies to close
- **Setup**: the repository checkout is on a branch other than the configured main branch
- **Do**: the user runs `metta milestone close m1` without `--on-branch` (Run: `metta milestone close m1`, `metta milestone create`)
- **Observe**: the command refuses with the same branch-guard error behavior as `metta milestone create`, and the milestone file is unmodified
- [ ] Pass

#### Step 6.15: Description is replaced without touching other fields
- **Setup**: `spec/milestones/m1.md` with `status: open`, a `target`, and a stale body reading "In flight as PR #24"
- **Do**: the user runs `metta milestone update m1 --description "Shipped in v0.5.0"` (Run: `metta milestone update m1 --description "Shipped in v0.5.0"`)
- **Observe**: the body reads "Shipped in v0.5.0", the frontmatter `name`, `target`, and `status` values are unchanged, and the change is auto-committed with `chore: update milestone m1`
- [ ] Pass

#### Step 6.16: Clear-target removes the field
- **Setup**: a milestone with `target: 2026-09-30`
- **Do**: the user runs `metta milestone update <slug> --clear-target`
- **Observe**: the rewritten frontmatter contains no `target` key and passes schema validation
- [ ] Pass

#### Step 6.17: A mistakenly closed milestone is reopened
- **Setup**: a milestone with `status: closed`
- **Do**: the user runs `metta milestone update <slug> --status open`
- **Observe**: the frontmatter reads `status: open`, the write passed validation, and the change is auto-committed
- [ ] Pass

#### Step 6.18: Invalid field value fails validation and leaves the file untouched
- **Setup**: an existing milestone and a byte snapshot of its file
- **Do**: the user runs `metta milestone update <slug> --target 2026-02-30 --json`
- **Observe**: the command exits 4, stdout carries a JSON error envelope with a validation message naming `target`, and the file is byte-identical to the snapshot
- [ ] Pass

#### Step 6.19: Updating a missing milestone reports not found
- **Setup**: no file exists at `spec/milestones/ghost.md`
- **Do**: the user runs `metta milestone update ghost --name "Ghost"` (Run: `metta milestone update ghost --name "Ghost"`)
- **Observe**: the command exits 4 with a not-found error, and no file is created
- [ ] Pass

#### Step 6.20: No field options is an error
- **Setup**: an existing milestone
- **Do**: the user runs `metta milestone update <slug>` with no field options
- **Observe**: the command exits non-zero with an error stating at least one field option is required, and the file is unmodified
- [ ] Pass

#### Step 6.21: List sorts terminal states after open with distinct markers
- **Setup**: milestones in `open`, `closed`, and `abandoned` states
- **Do**: the user runs `metta milestone list` (Run: `metta milestone list`)
- **Observe**: open milestones appear before both terminal milestones, each of the three states renders its own marker, and the `abandoned` row's marker differs from `▸` and `✓`
- [ ] Pass

#### Step 6.22: Show reports the abandoned state accurately
- **Setup**: an `abandoned` milestone
- **Do**: the user runs `metta milestone show <slug>` (human and `--json`)
- **Observe**: the human output contains `Status: abandoned` and the JSON output carries `"status": "abandoned"`
- [ ] Pass

#### Step 6.23: Status and progress render abandoned without crashing
- **Setup**: at least one `abandoned` milestone exists alongside open milestones
- **Do**: `metta status` or `metta progress` renders its milestone section (Run: `metta status`, `metta progress`)
- **Observe**: the command exits 0 and the abandoned milestone appears in the rollup sorted after open milestones, labeled with its abandoned state
- [ ] Pass

#### Step 6.24: Open and closed output stays byte-compatible
- **Setup**: a project containing only `open` and `closed` milestones
- **Do**: `metta milestone list`, `metta milestone show`, `metta status`, and `metta progress` run in both human and `--json` modes (Run: `metta milestone list`, `metta milestone show`)
- **Observe**: the output of each is byte-identical to the output produced before this change
- [ ] Pass

#### Step 6.25: Authorized skill context may invoke the new verbs
- **Setup**: a skill context holding a valid session credential that authorizes `metta milestone create`
- **Do**: it invokes `metta milestone close <slug>` or `metta milestone update <slug>` (Run: `metta milestone create`)
- **Observe**: the guard hook permits both commands
- [ ] Pass

#### Step 6.26: Unauthorized context is blocked identically
- **Setup**: a context without a valid session credential
- **Do**: it attempts `metta milestone close <slug>` or `metta milestone update <slug>` (Run: `metta milestone create`)
- **Observe**: the guard blocks the commands with the same denial behavior it applies to `metta milestone create`
- [ ] Pass
