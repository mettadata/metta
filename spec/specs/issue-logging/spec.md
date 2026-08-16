# issue-logging

## Requirement: Metta-issue skill performs root cause analysis before writing the ticket

By default, when an AI orchestrator invokes `/metta-issue "<description>"`, the skill MUST run a structured debugging session before writing the ticket. The session MUST: read the source files most relevant to the symptom (using `Read`, `Grep`, and `Glob`); inspect recent git history around those files (using `Bash` with `git log -20 --oneline -- <path>`); trace the call path from the entry point to the failure site; and produce a structured analysis identifying the most probable root cause with supporting file-and-line evidence. The skill MUST then write the issue body as three H2 sections in the following fixed order: `## Symptom`, `## Root Cause Analysis`, `## Candidate Solutions`. The RCA section MUST contain an `### Evidence` subsection citing at least one reference in the form `path/to/file.ts:LINE`. The Candidate Solutions section MUST list between one and three options, each paired with a concise tradeoff note. The skill MUST pass the full structured body to the CLI via stdin pipe (not as a CLI argument) so that `src/cli/commands/issue.ts` auto-detects it. The `allowed-tools` list for the skill MUST include `Read`, `Grep`, `Glob`, and `Bash` in addition to `AskUserQuestion`.

### Scenario: Happy path — structured ticket written after RCA
- GIVEN an AI orchestrator has just observed a failure (e.g., the workflow engine crashes when `tasks.md` is empty) and the relevant source files are in context
- WHEN the orchestrator invokes `/metta-issue "workflow engine crashes on empty tasks.md"`
- THEN the skill reads `src/workflow/workflow-engine.ts` and related files, checks recent git history for that path, traces the call path to the crash site, and only then writes `spec/issues/workflow-engine-crashes-on-empty-tasks-md.md`; the resulting file contains `## Symptom`, `## Root Cause Analysis` (with `### Evidence` citing at least one `src/workflow/workflow-engine.ts:LINE` reference), and `## Candidate Solutions` listing 1–3 options with tradeoffs, in that exact order

### Scenario: Interactive path — description not provided as argument
- GIVEN an orchestrator invokes `/metta-issue` with no description argument
- WHEN the skill executes
- THEN it uses `AskUserQuestion` to collect the description before starting the RCA session; after the user provides "state store silently drops empty YAML writes", the skill proceeds with the full RCA flow and writes `spec/issues/state-store-silently-drops-empty-yaml-writes.md` with all three H2 sections present


## Requirement: Metta-issue skill supports --quick escape hatch

When the orchestrator invokes `/metta-issue --quick "<description>"`, the skill MUST skip the RCA session entirely and write the issue immediately using only the symptom description as the body. The resulting issue file MUST NOT contain a `## Root Cause Analysis` section, a `### Evidence` subsection, or a `## Candidate Solutions` section. The skill MUST NOT invoke `Read`, `Grep`, `Glob`, or `Bash` for file or git history inspection in this code path. The `--quick` flag is a skill-level argument; it MUST NOT be passed through to the `metta issue` CLI command. Invocations without `--quick` MUST continue to run the full RCA flow defined in the preceding requirement.

### Scenario: --quick skips RCA and writes a shallow ticket
- GIVEN an orchestrator is logging a trivial cosmetic defect with no need for investigation
- WHEN the orchestrator invokes `/metta-issue --quick "status line color wrong on dark terminals"`
- THEN the skill immediately writes `spec/issues/status-line-color-wrong-on-dark-terminals.md` without reading any source files or git history; the resulting file body contains the symptom description only and does NOT contain any of the headings `## Root Cause Analysis`, `### Evidence`, or `## Candidate Solutions`


## Requirement: Metta-issue skill falls back to shallow log when RCA fails

If the RCA session fails for any reason — including a file read error, an inaccessible git repository, a tool call failure, or the agent aborting the session — the skill MUST NOT propagate the error or leave the issue unlogged. Instead, it MUST fall back to writing the ticket with the shallow symptom description as the body. The fallback body MUST begin with a blockquote in the exact form `> RCA skipped: <reason>` on the first line, where `<reason>` is a brief human-readable explanation of why RCA did not complete. The fallback body MUST NOT contain a `## Root Cause Analysis` section, a `### Evidence` subsection, or a `## Candidate Solutions` section, to avoid misleading partial analyses. Issue capture MUST succeed and the file MUST be committed regardless of RCA outcome.

### Scenario: RCA fails mid-session and fallback body is written
- GIVEN an orchestrator invokes `/metta-issue "context engine returns stale results after reload"` with no `--quick` flag
- WHEN the RCA session encounters a git command failure (e.g., `git log` returns a non-zero exit code) before producing Evidence
- THEN the skill writes `spec/issues/context-engine-returns-stale-results-after-reload.md` with a body that starts with `> RCA skipped: git log failed with exit code 128` followed by the symptom description, and the file does NOT contain `## Root Cause Analysis` or `## Candidate Solutions`; `metta issues show context-engine-returns-stale-results-after-reload` exits with code 0


## Requirement: Metta-issue skill writes a structured body with fixed section order

The issue body written by the default (non-`--quick`) flow MUST follow a fixed section schema. The body MUST open with `## Symptom` as the first H2, followed by `## Root Cause Analysis` as the second H2, followed by `## Candidate Solutions` as the third H2. No other ordering is permitted. The `## Root Cause Analysis` section MUST contain an `### Evidence` H3 subsection; that subsection MUST cite at least one file-and-line reference in the form `path/to/file.ts:LINE` (or `.js`, `.md`, etc.). The `## Candidate Solutions` section MUST list between one and three numbered or bulleted options; each option MUST include a tradeoff note describing a drawback, risk, or cost alongside the proposed approach. Sections that appear in the file before `## Symptom` (the metadata block: `**Captured**`, `**Status**`, `**Severity**`) are written by `formatIssue` and are not part of the body schema enforced here.

### Scenario: Full structured body validates section order and Evidence citation
- GIVEN the RCA session completes successfully for the symptom "IssuesStore.create silently truncates titles over 80 chars"
- WHEN the skill writes `spec/issues/issuesstore-create-silently-truncates-titles-over-80-chars.md`
- THEN reading the file produces content where `## Symptom` appears before `## Root Cause Analysis`, `## Root Cause Analysis` appears before `## Candidate Solutions`, the `### Evidence` subsection under `## Root Cause Analysis` contains at least one reference matching the pattern `src/issues/issues-store.ts:LINE`, and `## Candidate Solutions` lists at least one option with a tradeoff note; running `metta issues show issuesstore-create-silently-truncates-titles-over-80-chars --json` returns a JSON object whose `description` field contains all three H2 headings


## Requirement: Metta issue CLI auto-detects piped stdin as body

The `metta issue` CLI command MUST detect at process startup whether `process.stdin.isTTY` is falsy. When stdin is not a TTY, the command MUST read all bytes from `process.stdin` before proceeding and use the resulting string as the `description` argument passed to `IssuesStore.create()`, while the positional `[description]` CLI argument is used exclusively as the `title`. An empty or whitespace-only stdin payload (e.g., `echo -n '' | metta issue "<title>"`) MUST be treated as absent; in that case the CLI MUST fall back to using the description argument as both title and body, identical to today's behavior. No new CLI flag (`--stdin`, `--body`, `--body-file`) is introduced; auto-detection is the only mechanism. When `process.stdin.isTTY` is truthy (interactive terminal), the command MUST NOT attempt to read stdin and MUST behave identically to the pre-upgrade CLI in all respects.

### Scenario: Structured body piped via stdin becomes the issue body
- GIVEN stdin is a pipe (not a TTY)
- WHEN the shell runs `printf '## Symptom\nfoo hangs\n## Root Cause Analysis\nbar\n### Evidence\nsrc/foo.ts:42\n## Candidate Solutions\n1. fix bar' | metta issue "foo hangs on startup"`
- THEN `spec/issues/foo-hangs-on-startup.md` is created; running `metta issues show foo-hangs-on-startup --json` returns `"title": "foo hangs on startup"` and `"description"` containing `## Symptom`, `## Root Cause Analysis`, and `## Candidate Solutions`; the title `"foo hangs on startup"` does NOT appear in the `description` field

### Scenario: Interactive TTY stdin leaves behavior unchanged
- GIVEN stdin is an interactive TTY (no pipe)
- WHEN `metta issue "executor skips last task in batch"` runs in a terminal
- THEN the CLI does not read from stdin; it passes `"executor skips last task in batch"` as both title and description to `IssuesStore.create()`, producing `spec/issues/executor-skips-last-task-in-batch.md` with the description equal to the title, matching pre-upgrade behavior exactly


## Requirement: Issues-store parseIssue tolerates both freeform and structured bodies

The `parseIssue` function in `src/issues/issues-store.ts` MUST correctly extract the `description` field from both legacy freeform bodies and new structured bodies containing H2 sections. The function MUST split on the `**Severity**:` metadata line and return everything after it (trimmed) as `description`, regardless of whether that content begins with a plain paragraph or with `## Symptom`. The function MUST NOT throw, return an empty description, or misattribute any H2 heading line as a metadata field when structured sections are present. The `formatIssue` function MUST continue to write the `description` field verbatim after the `**Severity**:` line with no transformation; H2 headings inside the body MUST NOT be stripped or escaped. Existing `spec/issues/*.md` files with freeform bodies MUST parse without error and without requiring any file modification.

### Scenario: Both freeform and structured bodies round-trip through metta issues show
- GIVEN a legacy issue at `spec/issues/config-loader-ignores-env-overrides.md` with a freeform single-paragraph body (no H2 sections)
- AND a new issue at `spec/issues/workflow-engine-crashes-on-empty-tasks-md.md` with a body beginning with `## Symptom`
- WHEN `metta issues show config-loader-ignores-env-overrides --json` runs
- THEN it exits with code 0 and returns a JSON object with a non-empty `description` that does not contain any H2 heading; AND when `metta issues show workflow-engine-crashes-on-empty-tasks-md --json` runs it exits with code 0 and returns a JSON object whose `description` field contains `## Symptom`, `## Root Cause Analysis`, and `## Candidate Solutions` with none of those headings having been consumed as metadata fields


## Requirement: Metta-fix-issues skill surfaces structured issue sections at step 1

At step 1 (Validate) of the Single Issue Pipeline in `.claude/skills/metta-fix-issues/SKILL.md`, after `metta issues show <issue-slug> --json` confirms the issue exists and is open, the skill MUST display the content of the `## Symptom`, `## Root Cause Analysis` (including any `### Evidence` subsection), and `## Candidate Solutions` sections to the orchestrator before advancing to step 2 (Propose). When one or more of these sections are absent (e.g., for a legacy shallow issue), the skill MUST display whatever body content is present and MUST NOT error or refuse to continue. The subsequent fix flow — steps 2 through 11 (Propose, Per-Artifact Loop, Synthesize research, Implementation, Review, Review-Fix Loop, Verify, Finalize, Merge, Remove Issue) — MUST remain unchanged from the pre-upgrade skill definition. No new CLI invocation, no new flag, and no new subagent is introduced to implement this display; the orchestrator reads the sections directly from the JSON returned by `metta issues show --json`.

### Scenario: Structured sections displayed before fix planning begins
- GIVEN an issue at `spec/issues/state-store-silently-drops-empty-yaml-writes.md` whose `description` field contains `## Symptom`, `## Root Cause Analysis` (with `### Evidence` citing `src/state/state-store.ts:47`), and `## Candidate Solutions`
- WHEN a fixer invokes `/metta-fix-issues state-store-silently-drops-empty-yaml-writes`
- THEN step 1 outputs the Symptom, Root Cause Analysis, and Candidate Solutions sections (including the `src/state/state-store.ts:47` citation) to the orchestrator before any `metta propose` call is made; step 2 then runs `METTA_SKILL=1 metta propose "fix-state-store-silently-drops-empty-yaml-writes" --json` identically to the pre-upgrade flow; and all subsequent steps through Remove Issue (step 11) execute without modification


## Requirement: Issue frontmatter schema is Zod-validated and strict

Issue markdown files under `spec/issues/` (and `spec/issues/resolved/`) MAY carry a leading YAML frontmatter block delimited by `---` lines. When present, the frontmatter MUST be parsed with the existing `yaml` dependency and validated by a Zod schema on every read and every write. The schema MUST define exactly these fields, all optional: `type` (enum `issue` | `idea`, defaulting to `issue` when absent), `backlog` (boolean, treated as `false` when absent), `priority` (enum `high` | `medium` | `low`, unset when absent), `milestone` (slug string matching the project slug pattern, unset when absent), and `order` (number, unset when absent). The schema MUST be strict: unknown frontmatter keys MUST be rejected with a validation error. An invalid value for any known field MUST produce a clear validation error that names the offending field, the received value, and the allowed values; the store MUST NOT silently coerce or drop invalid values. (Traces: US-7, US-9; intent proposal §1.)

### Scenario: Partial frontmatter is accepted with documented defaults
- GIVEN an issue file whose frontmatter contains only `backlog: true`
- WHEN the issue store parses the file
- THEN validation succeeds and the parsed record reports `type: issue` (default), `backlog: true`, and no priority, milestone, or order values

### Scenario: Invalid priority value is rejected with a clear error
- GIVEN an issue file whose frontmatter contains `priority: urgent`
- WHEN the issue store parses the file
- THEN parsing fails with a validation error that names the `priority` field, cites the received value `urgent`, and lists the allowed values `high`, `medium`, `low`

### Scenario: Unknown frontmatter key is rejected
- GIVEN an issue file whose frontmatter contains an unrecognized key `assignee: alice` alongside valid fields
- WHEN the issue store parses the file
- THEN parsing fails with a validation error identifying `assignee` as an unknown field rather than silently ignoring or persisting it


## Requirement: Frontmatter-less issue files parse exactly as before

Issue files that carry no YAML frontmatter MUST continue to parse exactly as they do today via the bold-label metadata block (`**Captured**`, `**Context**`, `**Status**`, `**Severity**`) implemented in `src/issues/issues-store.ts`. Reading, listing, showing, archiving, and resolving such files MUST require no consumer action and no file modification. A frontmatter-less issue MUST be treated as `type: issue`, MUST NOT appear in any backlog view, and MUST NOT be counted toward any milestone. The 95 existing files in `spec/issues/resolved/` and all open plain issues MUST remain valid inputs without rewriting. (Traces: US-9; intent backward-compatibility guarantee.)

### Scenario: Legacy issue lists and resolves unchanged
- GIVEN a pre-existing issue file at `spec/issues/<slug>.md` containing only a title, bold-label metadata, and a body — no `---` frontmatter block
- WHEN issues are listed and the issue is subsequently resolved through the standard archive path
- THEN the file parses successfully with its title and severity intact, the resolve completes exactly as before this change, and no frontmatter is added to the file as a side effect

### Scenario: Legacy issue is excluded from backlog and milestone views
- GIVEN a frontmatter-less issue file exists alongside issues with `backlog: true` frontmatter
- WHEN the backlog is listed and milestone rollups are computed
- THEN the frontmatter-less issue appears in neither the backlog listing nor any milestone's issue set, and no warning or error is emitted for it


## Requirement: Backlogging an issue mutates the existing issue file in place

`metta backlog add <issue-slug>`, when `<issue-slug>` resolves to an existing file at `spec/issues/<slug>.md`, MUST set `backlog: true` in that file's YAML frontmatter (creating the frontmatter block if the file has none) and MUST NOT create any new file under `spec/backlog/`, `spec/issues/`, or anywhere else. The command MUST accept optional `--priority <high|medium|low>`, `--order <number>`, and `--milestone <slug>` options and write them into the same frontmatter block. The markdown content below the frontmatter MUST be byte-preserved by the write. Re-running the command on an already-backlogged issue MUST succeed idempotently, make no content change, and report that the issue was already backlogged. The `BacklogStore` standalone-file mint path (`spec/backlog/<slug>.md` creation from caller-supplied title/description) MUST be removed. (Traces: US-1; intent problem statement — zeus duplicate-data incident, `backlog-feature-duplicates-data-instead-of-referencing`.)

### Scenario: Existing issue gains backlog frontmatter with no new file
- GIVEN an issue exists at `spec/issues/gate-runner-swallows-timeout.md` with no `backlog` frontmatter field, and a snapshot of its body bytes is taken
- WHEN the user runs `metta backlog add gate-runner-swallows-timeout --priority high`
- THEN the same file's frontmatter now contains `backlog: true` and `priority: high`, the body below the frontmatter is byte-identical to the snapshot, and no file was created under `spec/backlog/` or as a second entry in `spec/issues/`

### Scenario: Re-backlogging is an idempotent no-op
- GIVEN an issue whose frontmatter already contains `backlog: true`
- WHEN the user runs `metta backlog add <slug>` for it again with no new option values
- THEN the command exits 0, the file content is unchanged, and the output states the issue was already backlogged

### Scenario: Later body edits never drift from the backlog
- GIVEN a backlogged issue whose body is later extended with RCA findings
- WHEN the backlog is listed
- THEN the listing is computed from the single up-to-date issue file — there is no parallel copy under `spec/backlog/` capable of going stale


## Requirement: New ideas are minted as typed entries in the issue store

`metta backlog add` MUST support capturing a brand-new non-issue idea via an explicit `--new` flag: `metta backlog add <title> --new [--description <text>] [--priority <level>] [--order <n>] [--milestone <slug>]`. In this mode the command MUST mint a new file in `spec/issues/` (via the issue store, slugged from the title) whose frontmatter contains `type: idea` and `backlog: true`, plus any provided priority/order/milestone values, with the description (defaulting to the title) as the body. The command MUST NOT create anything under `spec/backlog/`. When the positional argument does not resolve to an existing issue slug and `--new` was NOT passed, the command MUST fail with exit code 4 and an error message that names the unresolved slug and suggests `--new` for capturing a new idea — it MUST NOT silently mint an entry from a mistyped slug. Idea entries MUST appear in `metta issues list` output alongside `type: issue` entries, distinguishable by their type. (Traces: US-2; intent proposal §4 store unification.)

### Scenario: New idea minted with idea type and backlog flag
- GIVEN no issue exists for "dashboard status widget"
- WHEN the user runs `metta backlog add "dashboard status widget" --new --description "Build a status widget" --priority low`
- THEN a new file is created at `spec/issues/dashboard-status-widget.md` with frontmatter `type: idea`, `backlog: true`, `priority: low`, the description as body, and nothing is created under `spec/backlog/`

### Scenario: Mistyped slug without --new fails instead of minting
- GIVEN no issue exists with slug `gate-runner-swalows-timeout` (typo)
- WHEN the user runs `metta backlog add gate-runner-swalows-timeout` without `--new`
- THEN the command exits with code 4, names the unresolved slug, suggests passing `--new` to capture a new idea, and creates no file

### Scenario: Idea entries are distinguishable in issue listings
- GIVEN an idea entry and a plain issue both exist in `spec/issues/`
- WHEN the issue store is listed
- THEN both entries appear and the idea is identifiable as `type: idea` in the listing output


## Requirement: Backlog list is a sorted view over issue frontmatter

`metta backlog list` MUST be computed exclusively from `spec/issues/*.md` frontmatter: it MUST list every open issue-store entry (any `type`) whose frontmatter contains `backlog: true`, and MUST NOT read from `spec/backlog/` at all. Entries MUST be sorted by priority first (`high` before `medium` before `low`, entries with no priority last), then by numeric `order` ascending (entries with no order after those with one at the same priority), then by captured date ascending. Entries missing optional fields (priority, order) MUST still render using those defaults rather than erroring. Entries whose frontmatter lacks `backlog: true` — including frontmatter-less legacy issues — MUST NOT appear. (Traces: US-5; intent proposal §3.)

### Scenario: Mixed priorities and orders sort deterministically
- GIVEN backlogged issues A (`priority: low`, `order: 1`), B (`priority: high`, `order: 2`), C (`priority: high`, `order: 1`), and D (`backlog: true` with no priority or order)
- WHEN the user runs `metta backlog list`
- THEN the output order is C, B, A, D — priority buckets first, `order` ascending within a bucket, priority-less entries last

### Scenario: Only flagged issues appear and spec/backlog/ is never read
- GIVEN one issue with `backlog: true`, one issue with no `backlog` field, and a leftover legacy file under `spec/backlog/`
- WHEN the user runs `metta backlog list`
- THEN exactly the flagged issue appears; the unflagged issue is absent and the `spec/backlog/` file contributes nothing to the output

### Scenario: Missing optional fields render with defaults
- GIVEN a backlogged issue whose frontmatter is only `backlog: true`
- WHEN the backlog is listed
- THEN the entry renders successfully with a "no priority" presentation instead of erroring


## Requirement: Backlog promote hands off to fix-issues

`metta backlog promote <slug>` MUST resolve `<slug>` against the issue store and emit a handoff instruction targeting `/metta-fix-issues <slug>` for that issue, replacing the previous `buildPromoteHandoff` → `/metta-propose` path. The command MUST NOT create any change-tracking file, duplicate entry, or state mutation of its own — it only routes. Promoting a slug that does not exist in the issue store MUST fail with exit code 4 and a not-found error. (Traces: US-6; intent proposal §3.)

### Scenario: Promote emits a fix-issues handoff
- GIVEN a backlogged issue exists at `spec/issues/gate-runner-swallows-timeout.md`
- WHEN the user runs `metta backlog promote gate-runner-swallows-timeout`
- THEN the output (text and `--json`) instructs the caller to run `/metta-fix-issues gate-runner-swallows-timeout`, no reference to `/metta-propose` appears, and no file is created or modified

### Scenario: Promoting an unknown slug fails cleanly
- GIVEN no issue exists with slug `nonexistent-item`
- WHEN the user runs `metta backlog promote nonexistent-item`
- THEN the command exits with code 4 and reports the slug as not found


## Requirement: Backlog done resolves through the issue store archive

`metta backlog done <slug>` MUST archive the issue through the issue store's standard resolution path: the file MUST be copied to `spec/issues/resolved/<slug>.md` with its frontmatter preserved, and the open file at `spec/issues/<slug>.md` MUST be removed. The command MUST NOT write to `spec/backlog/done/`. The optional `--change <name>` stamp (`**Shipped-in**` metadata) MUST continue to be supported and appended to the archived copy. After completion the entry MUST no longer appear in `metta backlog list`. The auto-commit path MUST stage `spec/issues/` and `spec/issues/resolved/` rather than the retired backlog directories. (Traces: US-6; intent proposal §3.)

### Scenario: Done moves the issue to resolved and off the backlog
- GIVEN a backlogged issue exists at `spec/issues/<slug>.md` with frontmatter `backlog: true` and `type: idea`
- WHEN the user runs `metta backlog done <slug>`
- THEN `spec/issues/resolved/<slug>.md` exists with the frontmatter (`type: idea`, `backlog: true`) intact, `spec/issues/<slug>.md` is gone, nothing was written under `spec/backlog/done/`, and the slug no longer appears in `metta backlog list`

### Scenario: Shipped-in stamp survives the new archive path
- GIVEN a backlogged issue exists
- WHEN the user runs `metta backlog done <slug> --change some-shipped-change`
- THEN the archived copy at `spec/issues/resolved/<slug>.md` contains the `**Shipped-in**: some-shipped-change` stamp in addition to its preserved frontmatter


## Requirement: Milestone store with Zod-validated frontmatter and CLI

Milestones MUST be stored as one markdown file per milestone at `spec/milestones/<slug>.md`. Each file MUST carry YAML frontmatter validated by a Zod schema with fields: `name` (string, required), `target` (ISO 8601 date string `YYYY-MM-DD`, optional), and `status` (enum `open` | `closed`, defaulting to `open`); the body below the frontmatter is the free-form description. The CLI MUST provide `metta milestone create <slug> --name <name> [--target <date>] [--description <text>]`, `metta milestone list`, and `metta milestone show <slug>`. `create` MUST refuse to overwrite an existing milestone file. Invalid frontmatter values (e.g., a malformed `target` date or unknown `status`) MUST produce a clear validation error on read or write. The mutating subcommand `milestone create` MUST be registered with the orchestration guard as a Tier 2 (session-tier) scoped two-word form, consistent with `backlog add/done/promote`; the read-only `milestone list` and `milestone show` subcommands MUST be permitted without a session credential, consistent with other read-only commands. (Traces: US-3; intent proposal §2.)

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
- THEN validation fails with an error naming the `status` field and the allowed values `open`, `closed`


## Requirement: Milestone and priority assignment via issue frontmatter

Issues MUST be assigned to a milestone by writing `milestone: <slug>` into the issue file's frontmatter — never by copying content between files. `metta issue` MUST accept optional `--milestone <slug>` and `--priority <high|medium|low>` options at log time and write them as frontmatter on the newly created issue file, validated by the issue frontmatter schema. An issue that references a milestone slug for which no `spec/milestones/<slug>.md` file exists MUST cause commands that surface the reference (issue/milestone listings, milestone show, status rollups) to emit a warning about the dangling reference, but those commands MUST still succeed. An invalid `--priority` value MUST be rejected with an error naming the allowed values. (Traces: US-3, US-7; intent proposal §2 and §6.)

### Scenario: Log an issue with milestone and priority in one step
- GIVEN milestone `v0-6` exists
- WHEN the user logs an issue with `--milestone v0-6 --priority high`
- THEN the new issue file's frontmatter contains `milestone: v0-6` and `priority: high`, and the file passes issue frontmatter schema validation

### Scenario: Invalid priority at log time is rejected
- GIVEN the user passes `--priority urgent` when logging an issue
- WHEN the command validates its options
- THEN it exits non-zero with an error naming the allowed values `high`, `medium`, `low`, and no issue file is created

### Scenario: Dangling milestone reference warns but succeeds
- GIVEN an issue's frontmatter contains `milestone: v9-9` and no `spec/milestones/v9-9.md` exists
- WHEN milestones or issues are listed
- THEN a warning identifying the dangling `v9-9` reference is emitted and the command exits 0 with complete output


## Requirement: Milestone show reports resolved-vs-open progress

`metta milestone show <slug>` MUST list every issue assigned to the milestone — open issues found in `spec/issues/*.md` and resolved issues found in `spec/issues/resolved/*.md` whose frontmatter carries `milestone: <slug>` — and MUST report the resolved count, the open count, the total, and a completion percentage (resolved / total, rounded to a whole number). A milestone with zero assigned issues MUST render successfully with an empty issue list and a rollup of 0 resolved / 0 open rather than failing. Showing a milestone slug with no milestone file MUST fail with a not-found error. (Traces: US-4; intent proposal §2.)

### Scenario: Rollup counts resolved against open
- GIVEN milestone `v0-6` has three assigned issues, one of which lives in `spec/issues/resolved/`
- WHEN the user runs `metta milestone show v0-6`
- THEN the output lists all three issues, reports 1 resolved / 2 open of 3 total, and shows 33% complete

### Scenario: Empty milestone renders without failing
- GIVEN milestone `v0-7` exists with no issues assigned to it
- WHEN the user runs `metta milestone show v0-7`
- THEN the command exits 0 and reports an empty issue list with 0 resolved / 0 open


## Requirement: Status and progress surfaces include milestone rollups

When one or more milestone files exist under `spec/milestones/`, `metta status` and `metta progress` MUST include a per-milestone rollup section reporting each milestone's open and resolved issue counts (computed identically to `metta milestone show`). When no milestone files exist, both commands MUST produce output without a milestone section and otherwise identical in structure to their pre-change output. (Traces: US-4; intent proposal §6.)

### Scenario: Progress shows per-milestone counts
- GIVEN milestones `v0-6` (2 open, 1 resolved) and `v0-7` (1 open, 0 resolved) exist with assigned issues
- WHEN the user runs the status or progress surface
- THEN the output contains a milestone rollup listing `v0-6` with 2 open / 1 resolved and `v0-7` with 1 open / 0 resolved

### Scenario: No milestones means no milestone section
- GIVEN `spec/milestones/` does not exist or contains no milestone files
- WHEN the user runs `metta status`
- THEN the output contains no milestone rollup section and the remaining sections match pre-change behavior


## Requirement: Idempotent migration of legacy backlog data into the issue store

The CLI MUST provide `metta backlog migrate`, which converts a project's legacy `spec/backlog/` store into the issue store in a single idempotent pass. The migration MUST: convert each active item `spec/backlog/<slug>.md` into `spec/issues/<slug>.md` with frontmatter `type: idea` and `backlog: true`, carrying over the legacy `**Priority**` value into the `priority` frontmatter field when present; convert each archived item `spec/backlog/done/<slug>.md` into `spec/issues/resolved/<slug>.md` with frontmatter `type: idea`; preserve each file's descriptive body content without rewriting prose; and archive the old `spec/backlog/` directory (relocating it out of the active spec tree, e.g. under an archive location) rather than silently deleting it. The migration MUST NOT overwrite an existing `spec/issues/` or `spec/issues/resolved/` file bearing the same slug — on collision it MUST report the conflict and leave both files untouched. Running the migration a second time MUST make zero changes, report nothing to do, and exit 0. The migration MUST work on consumer projects with live data in both stores (zeus) and on the metta repo itself (8 archived items in `spec/backlog/done/`). `backlog migrate` MUST be registered with the orchestration guard as a Tier 2 (session-tier) scoped two-word form. (Traces: US-8; intent proposal §5.)

### Scenario: Active and done items convert with content preserved
- GIVEN a repo with two items in `spec/backlog/` (one carrying `**Priority**: high`) and one item in `spec/backlog/done/`
- WHEN the user runs `metta backlog migrate`
- THEN each active item exists as `spec/issues/<slug>.md` with frontmatter `type: idea`, `backlog: true` (and `priority: high` where the legacy priority was set), the done item exists as `spec/issues/resolved/<slug>.md` with `type: idea`, every file's descriptive body is preserved, and the old `spec/backlog/` directory is archived out of the active spec tree

### Scenario: Second run is a no-op
- GIVEN the migration has already completed on a repo
- WHEN `metta backlog migrate` runs again
- THEN no files are created, modified, or moved, the command reports nothing to do, and it exits 0

### Scenario: Slug collision is reported, not overwritten
- GIVEN `spec/backlog/dark-mode.md` and a pre-existing `spec/issues/dark-mode.md` both exist
- WHEN the migration runs
- THEN `spec/issues/dark-mode.md` is left byte-identical, the collision is reported naming the slug, and the legacy backlog file is not silently discarded


## Requirement: Frontmatter writes round-trip the body and untouched fields

Any issue-store or milestone-store write that mutates frontmatter (backlog add, priority/order/milestone updates, archive) MUST preserve the markdown body below the frontmatter byte-for-byte and MUST NOT rewrite the values of frontmatter fields it was not asked to change. The relative order of pre-existing frontmatter keys MUST be preserved; a newly added key MAY be appended. Archiving an issue (via `backlog done` or the standard fix-issues resolution path) MUST carry the full frontmatter block into `spec/issues/resolved/` unchanged. (Traces: US-1, US-6; intent impact — fix-issue resolution must preserve frontmatter through archive.)

### Scenario: Targeted frontmatter update leaves everything else intact
- GIVEN an issue file with frontmatter `type: idea`, `priority: medium`, `milestone: v0-6` and a body containing structured RCA sections, with a byte snapshot taken of the body
- WHEN `metta backlog add <slug> --order 3` updates the file
- THEN the frontmatter now additionally contains `backlog: true` and `order: 3`, the values and relative order of `type`, `priority`, and `milestone` are unchanged, and the body is byte-identical to the snapshot

### Scenario: Archive preserves frontmatter end to end
- GIVEN an open issue with frontmatter `backlog: true`, `milestone: v0-6`
- WHEN the issue is resolved through the standard issue archive path
- THEN `spec/issues/resolved/<slug>.md` contains the identical frontmatter block, keeping the issue countable in `v0-6`'s resolved rollup
