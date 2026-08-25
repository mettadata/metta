# issue-logging

## MODIFIED: Requirement: Milestone store with Zod-validated frontmatter and CLI

Milestones MUST be stored as one markdown file per milestone at `spec/milestones/<slug>.md`. Each file MUST carry YAML frontmatter validated by a Zod schema with fields: `name` (string, required), `target` (ISO 8601 date string `YYYY-MM-DD`, optional), and `status` (enum `open` | `closed` | `abandoned`, defaulting to `open`); the body below the frontmatter is the free-form description. The CLI MUST provide `metta milestone create <slug> --name <name> [--target <date>] [--description <text>]`, `metta milestone list`, `metta milestone show <slug>`, `metta milestone close <slug>`, and `metta milestone update <slug>`. `create` MUST refuse to overwrite an existing milestone file. Invalid frontmatter values (e.g., a malformed `target` date or unknown `status`) MUST produce a clear validation error on read or write. Existing milestone files carrying `status: open` or `status: closed` MUST continue to validate and behave exactly as before the enum extension. The mutating subcommands `milestone create`, `milestone close`, and `milestone update` MUST be registered with the orchestration guard as Tier 2 (session-tier) scoped two-word forms, consistent with `backlog add/done/promote`; the read-only `milestone list` and `milestone show` subcommands MUST be permitted without a session credential, consistent with other read-only commands. (Traces: US-3, US-5; intent proposal §2, §6.)

### Scenario: Milestone created with defaults
- GIVEN no milestone `v0-6` exists
- WHEN the user runs `metta milestone create v0-6 --name "v0.6" --target 2026-09-30 --description "Backlog/milestone unification release"`
- THEN `spec/milestones/v0-6.md` is written with frontmatter `name: v0.6`, `target: 2026-09-30`, `status: open`, the description as body, and `metta milestone list` includes `v0-6`

### Scenario: Creating a duplicate milestone is refused
- GIVEN `spec/milestones/v0-6.md` already exists
- WHEN the user runs `metta milestone create v0-6 --name "v0.6 again"`
- THEN the command exits non-zero with an error stating the milestone already exists, and the existing file is unmodified

### Scenario: Invalid milestone status is rejected
- GIVEN a milestone file whose frontmatter contains `status: shipped`
- WHEN the milestone store reads the file
- THEN validation fails with an error naming the `status` field and the allowed values `open`, `closed`, `abandoned`

### Scenario: Abandoned status validates through the schema
- GIVEN a milestone file whose frontmatter contains `status: abandoned`
- WHEN the milestone store reads the file
- THEN validation succeeds and the parsed milestone reports status `abandoned`

### Scenario: Pre-existing open and closed files are unaffected
- GIVEN milestone files on disk carrying `status: open` and `status: closed` written before the enum extension
- WHEN any milestone command reads them
- THEN both files validate without error and produce the same parsed status values as before the change


## ADDED: Requirement: Milestone store update applies validated patches

`MilestonesStore` MUST expose an `update(slug, patch)` method that reads the existing milestone file at `spec/milestones/<slug>.md`, applies the patch, and writes the result back through the state store. The patch MUST support: changing `name`, setting or changing `target`, clearing `target` (removing the field from frontmatter), replacing the description body, and setting `status` to any value in the enum. Fields absent from the patch MUST be preserved unchanged. Before any write, the full resulting frontmatter MUST be re-validated through `MilestoneFrontmatterSchema`; a patch whose result fails validation MUST be rejected with a clear validation error and MUST leave the file on disk byte-identical to its pre-call state — no unvalidated state may reach disk. Updating a slug with no matching milestone file MUST fail with a clear not-found error naming the slug, and MUST NOT create a file. The existing `create`, `list`, `show`, and `exists` behaviors MUST be unchanged. (Traces: US-1, US-2; intent proposal §1.)

### Scenario: Status patch preserves untouched fields
- GIVEN `spec/milestones/m1.md` with frontmatter `name: M1`, `target: 2026-09-30`, `status: open` and a non-empty description body
- WHEN `update('m1', { status: 'closed' })` is called
- THEN the rewritten file carries `status: closed`, retains `name: M1`, `target: 2026-09-30`, and the identical description body, and the written frontmatter passed `MilestoneFrontmatterSchema` validation before the write

### Scenario: Target is cleared from frontmatter
- GIVEN a milestone whose frontmatter includes a `target` field
- WHEN `update` is called with a patch that clears the target
- THEN the rewritten frontmatter contains no `target` key (not `target: null`) and still passes schema validation

### Scenario: Invalid patch is rejected and the file is untouched
- GIVEN an existing milestone file and a byte snapshot of its content
- WHEN `update` is called with a patch producing invalid frontmatter (e.g. `target: '2026-02-30'` or an empty `name`)
- THEN the call throws a validation error identifying the offending field, and the file on disk is byte-identical to the snapshot

### Scenario: Updating a missing milestone fails without side effects
- GIVEN no file exists at `spec/milestones/ghost.md`
- WHEN `update('ghost', { status: 'closed' })` is called
- THEN the call throws an error stating milestone `ghost` was not found, and no file is created under `spec/milestones/`


## ADDED: Requirement: Milestone close CLI verb transitions to a terminal state

The CLI MUST provide `metta milestone close <slug>`, which transitions an `open` milestone to `status: closed`, or to `status: abandoned` when the `--abandoned` flag is passed. The write MUST go through the validated store update path. On success the command MUST auto-commit the milestone file with the conventional message `chore: close milestone <slug>`, following the `milestone create` commit pattern (git failure is swallowed, reported as uncommitted). The command MUST respect the same main-branch guard as `milestone create` (`--on-branch <name>` acknowledgment required off the configured main branch). Closing a milestone that is already `closed` or `abandoned` MUST fail with exit code 4 and a clear conflict error — rendered via the standard JSON error envelope (`{ error: { code, type, message } }`) under `--json`, plain stderr otherwise — leaving the file unmodified. Closing a slug with no matching milestone file MUST fail with exit code 4 and a not-found error, creating no file. Under `--json`, a successful close MUST emit a JSON result object including the slug, the resulting status, and commit information, consistent with `milestone create` output conventions. (Traces: US-1, US-3; intent proposal §3.)

### Scenario: Open milestone is closed and auto-committed
- GIVEN `spec/milestones/m1.md` with `status: open` in a git repository on the main branch
- WHEN the user runs `metta milestone close m1`
- THEN the file's frontmatter reads `status: closed`, a commit exists with message `chore: close milestone m1`, and the command exits 0 reporting the closure

### Scenario: Abandoned flag writes the abandoned state
- GIVEN `spec/milestones/m6.md` with `status: open`
- WHEN the user runs `metta milestone close m6 --abandoned`
- THEN the file's frontmatter reads `status: abandoned`, the result passed schema validation before write, and the transition is auto-committed with `chore: close milestone m6`

### Scenario: Closing an already-terminal milestone is a conflict
- GIVEN `spec/milestones/m1.md` with `status: closed` and a byte snapshot of the file
- WHEN the user runs `metta milestone close m1 --json`
- THEN the command exits 4, stdout carries a JSON error envelope with a conflict-typed error naming the milestone's current status, and the file is byte-identical to the snapshot

### Scenario: Closing a missing milestone reports not found
- GIVEN no file exists at `spec/milestones/ghost.md`
- WHEN the user runs `metta milestone close ghost --json`
- THEN the command exits 4 with a JSON error envelope of type `not_found`, and no file is created or modified

### Scenario: Main-branch guard applies to close
- GIVEN the repository checkout is on a branch other than the configured main branch
- WHEN the user runs `metta milestone close m1` without `--on-branch`
- THEN the command refuses with the same branch-guard error behavior as `metta milestone create`, and the milestone file is unmodified


## ADDED: Requirement: Milestone update CLI verb edits mutable fields

The CLI MUST provide `metta milestone update <slug>`, which patches a milestone's mutable fields via options: `--name <name>` (rename display name), `--target <date>` (set or change target), `--clear-target` (remove target), `--description <text>` (replace the description body), and `--status <open|closed|abandoned>` (explicitly set status, including reopening a terminal milestone). Only fields named by the provided options may change; all other fields MUST be preserved. Invoking the command with no field options MUST fail with a clear error stating that at least one field option is required, leaving the file untouched. The write MUST go through the validated store update path: an update whose resulting frontmatter fails `MilestoneFrontmatterSchema` MUST exit 4 with a clear validation error (standard JSON error envelope under `--json`) and leave the file byte-identical. Updating a slug with no matching milestone file MUST exit 4 with a not-found error. The command MUST respect the same main-branch guard as `milestone create` and MUST auto-commit successful updates with the conventional message `chore: update milestone <slug>`, following the `create` commit pattern. Under `--json`, success MUST emit a JSON result object including the slug, the fields changed, and commit information. (Traces: US-2; intent proposal §4.)

### Scenario: Description is replaced without touching other fields
- GIVEN `spec/milestones/m1.md` with `status: open`, a `target`, and a stale body reading "In flight as PR #24"
- WHEN the user runs `metta milestone update m1 --description "Shipped in v0.5.0"`
- THEN the body reads "Shipped in v0.5.0", the frontmatter `name`, `target`, and `status` values are unchanged, and the change is auto-committed with `chore: update milestone m1`

### Scenario: Clear-target removes the field
- GIVEN a milestone with `target: 2026-09-30`
- WHEN the user runs `metta milestone update <slug> --clear-target`
- THEN the rewritten frontmatter contains no `target` key and passes schema validation

### Scenario: A mistakenly closed milestone is reopened
- GIVEN a milestone with `status: closed`
- WHEN the user runs `metta milestone update <slug> --status open`
- THEN the frontmatter reads `status: open`, the write passed validation, and the change is auto-committed

### Scenario: Invalid field value fails validation and leaves the file untouched
- GIVEN an existing milestone and a byte snapshot of its file
- WHEN the user runs `metta milestone update <slug> --target 2026-02-30 --json`
- THEN the command exits 4, stdout carries a JSON error envelope with a validation message naming `target`, and the file is byte-identical to the snapshot

### Scenario: Updating a missing milestone reports not found
- GIVEN no file exists at `spec/milestones/ghost.md`
- WHEN the user runs `metta milestone update ghost --name "Ghost"`
- THEN the command exits 4 with a not-found error, and no file is created

### Scenario: No field options is an error
- GIVEN an existing milestone
- WHEN the user runs `metta milestone update <slug>` with no field options
- THEN the command exits non-zero with an error stating at least one field option is required, and the file is unmodified


## ADDED: Requirement: Renderers and rollups handle the abandoned state

Milestone rendering surfaces MUST handle `status: abandoned` as a terminal state grouped with `closed`. `computeMilestoneRollups` MUST sort open milestones first and terminal milestones (`closed` and `abandoned`) after them, slug-ascending within each group. `metta milestone list` MUST render a distinct marker for `abandoned` milestones (visually distinguishable from both the open marker `▸` and the closed marker `✓`). `metta milestone show` MUST report `Status: abandoned` (and the `--json` `status` field as `abandoned`) rather than mislabeling the state. The milestone sections of `metta status` and `metta progress`, which inherit the shared rollup path, MUST render `abandoned` milestones without crashing or mislabeling them. When only `open` and `closed` milestones exist, human and `--json` output of `milestone list`, `milestone show`, `metta status`, and `metta progress` MUST be byte-identical to pre-change behavior. (Traces: US-3, US-4; intent proposal §5.)

### Scenario: List sorts terminal states after open with distinct markers
- GIVEN milestones in `open`, `closed`, and `abandoned` states
- WHEN the user runs `metta milestone list`
- THEN open milestones appear before both terminal milestones, each of the three states renders its own marker, and the `abandoned` row's marker differs from `▸` and `✓`

### Scenario: Show reports the abandoned state accurately
- GIVEN an `abandoned` milestone
- WHEN the user runs `metta milestone show <slug>` (human and `--json`)
- THEN the human output contains `Status: abandoned` and the JSON output carries `"status": "abandoned"`

### Scenario: Status and progress render abandoned without crashing
- GIVEN at least one `abandoned` milestone exists alongside open milestones
- WHEN `metta status` or `metta progress` renders its milestone section
- THEN the command exits 0 and the abandoned milestone appears in the rollup sorted after open milestones, labeled with its abandoned state

### Scenario: Open and closed output stays byte-compatible
- GIVEN a project containing only `open` and `closed` milestones
- WHEN `metta milestone list`, `metta milestone show`, `metta status`, and `metta progress` run in both human and `--json` modes
- THEN the output of each is byte-identical to the output produced before this change


## ADDED: Requirement: Guard authorization for milestone close and update

The `metta-guard-bash` hook's allow-list MUST authorize the scoped two-word forms `milestone close` and `milestone update` under the same Tier 2 (session-tier) trust rules as the existing `milestone create` verb, with no change to the two-tier trust model itself. Contexts not authorized for existing milestone mutating verbs MUST be blocked from the new verbs identically. (Traces: US-5; intent proposal §6.)

### Scenario: Authorized skill context may invoke the new verbs
- GIVEN a skill context holding a valid session credential that authorizes `metta milestone create`
- WHEN it invokes `metta milestone close <slug>` or `metta milestone update <slug>`
- THEN the guard hook permits both commands

### Scenario: Unauthorized context is blocked identically
- GIVEN a context without a valid session credential
- WHEN it attempts `metta milestone close <slug>` or `metta milestone update <slug>`
- THEN the guard blocks the commands with the same denial behavior it applies to `metta milestone create`
