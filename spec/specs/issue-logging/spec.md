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

`metta backlog done <slug>` MUST archive the issue through the issue store's standard resolution path: the file MUST be copied to `spec/issues/resolved/<slug>.md` with its frontmatter preserved, and the open file at `spec/issues/<slug>.md` MUST be removed. The command MUST NOT write to `spec/backlog/done/`. The optional `--change <name>` stamp (`**Shipped-in**` metadata) MUST continue to be supported and appended to the archived copy. After completion the entry MUST no longer appear in `metta backlog list`. The auto-commit MUST stage exactly the two file paths the command touched — the removed open file `spec/issues/<slug>.md` and the created archive file `spec/issues/resolved/<slug>.md` — and MUST NOT pass directory pathspecs, so unrelated dirty files under `spec/issues/` are never swept into the commit. (Traces: US-6 of PR #85; intent proposal §3.)
Fulfills: US-1

### Scenario: Done moves the issue to resolved and off the backlog
- GIVEN a backlogged issue exists at `spec/issues/<slug>.md` with frontmatter `backlog: true` and `type: idea`
- WHEN the user runs `metta backlog done <slug>`
- THEN `spec/issues/resolved/<slug>.md` exists with the frontmatter (`type: idea`, `backlog: true`) intact, `spec/issues/<slug>.md` is gone, nothing was written under `spec/backlog/done/`, and the slug no longer appears in `metta backlog list`

### Scenario: Shipped-in stamp survives the new archive path
- GIVEN a backlogged issue exists
- WHEN the user runs `metta backlog done <slug> --change some-shipped-change`
- THEN the archived copy at `spec/issues/resolved/<slug>.md` contains the `**Shipped-in**: some-shipped-change` stamp in addition to its preserved frontmatter

### Scenario: Done commits only the archived pair of paths
- GIVEN a backlogged issue `<slug>` and an unrelated modified file `spec/issues/unrelated.md`
- WHEN the user runs `metta backlog done <slug>`
- THEN the auto-commit contains exactly `spec/issues/<slug>.md` (deletion) and `spec/issues/resolved/<slug>.md` (addition), and `spec/issues/unrelated.md` remains dirty and uncommitted

## Requirement: Milestone store with Zod-validated frontmatter and CLI

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


## Requirement: Backlog auto-commits stage only the files the command wrote

Every auto-commit performed by a `metta backlog` write command (`add`, `done`, `migrate`, and any other subcommand that writes files and commits) MUST pass only the explicit file paths the command itself created, modified, moved, or archived to `commitPaths` — never a directory pathspec such as `spec/issues` or `spec/issues/resolved`. Files under `spec/issues/` that were dirty before the command ran and were not touched by the command MUST NOT be staged or committed, and MUST remain in their pre-command working-tree state after the command completes. This applies to all three `commitPaths` call sites in `src/cli/commands/backlog.ts` (the `add`, `done`, and `migrate` paths).
Fulfills: US-1

### Scenario: Unrelated dirty file survives a backlog add
- GIVEN a working tree containing an unrelated modified file `spec/issues/other-issue.md`
- WHEN the user runs `metta backlog add "new item" --new`
- THEN the resulting auto-commit contains only the newly created issue file, and `spec/issues/other-issue.md` remains modified and uncommitted in the working tree

### Scenario: Done and migrate stage only their own moved or updated files
- GIVEN an unrelated dirty file exists under `spec/issues/` and a backlogged issue `<slug>` exists
- WHEN the user runs `metta backlog done <slug>` (or `metta backlog migrate` where migrate moves legacy files)
- THEN the auto-commit stages exactly the files the command moved, archived, or updated, and the unrelated dirty file is absent from the commit

### Scenario: No directory pathspecs at any commitPaths call site
- GIVEN the three `commitPaths` call sites in `src/cli/commands/backlog.ts`
- WHEN any backlog write command executes its auto-commit
- THEN the paths passed to `commitPaths` are explicit file paths (e.g. `spec/issues/<slug>.md`, `spec/issues/resolved/<slug>.md`), and no argument is a bare directory such as `spec/issues`


## Requirement: Backlog and milestone list renderers sanitize titles

The backlog list renderer (`src/cli/commands/backlog.ts`, title output around line 75) and the milestone issues renderer (`src/cli/commands/milestone.ts`, title output around line 176) MUST strip ANSI escape sequences (including CSI sequences such as `\x1b[31m`) and non-printing control characters (C0 controls other than the renderer's own intentional formatting, plus DEL) from issue titles before printing them to the terminal. Titles consisting solely of ordinary printable text MUST be rendered unchanged. Sanitization MUST apply to the rendered output only — the issue file's frontmatter MUST NOT be modified. Other CLI output surfaces are out of scope for this requirement.
Fulfills: US-2

### Scenario: ANSI escape in a backlog title is stripped
- GIVEN a backlogged issue whose frontmatter title contains the ANSI sequence `\x1b[31m` followed by text
- WHEN the user runs the backlog list view
- THEN the rendered line for that issue contains no `\x1b` escape byte and shows only the sanitized printable text

### Scenario: Control characters in a milestone issue title are stripped
- GIVEN an issue assigned to a milestone whose title embeds control characters (e.g. `\x07`, `\x08`)
- WHEN `metta milestone show <slug>` renders the milestone's issue list
- THEN the printed title contains none of the embedded control characters

### Scenario: Plain titles render unchanged
- GIVEN an issue with an ordinary plain-text title
- WHEN either the backlog list or the milestone issues renderer prints it
- THEN the title is displayed byte-for-byte unchanged

### Scenario: Sanitization does not rewrite the issue file
- GIVEN an issue whose frontmatter title contains an ANSI escape sequence
- WHEN the backlog list is rendered
- THEN the issue file on disk is byte-identical to its pre-render state


## Requirement: No stale spec/backlog references in generated CLAUDE.md, docs, or guard-edit allowlist

All references to the retired `spec/backlog/` directory store MUST be removed from the surfaces that still carry them. Specifically: (1) the CLAUDE.md Table of Contents emitted by `metta refresh` (`src/cli/commands/refresh.ts`) MUST NOT contain a `spec/backlog/` row — it MUST either omit the backlog row or describe the backlog as the frontmatter view over `spec/issues/`; (2) the five docs files `docs/workflows/README.md`, `docs/workflows/skills.md`, `docs/internals/architecture.md`, `docs/guide/troubleshooting.md`, and `docs/internals/guard-hooks.md` MUST describe backlog storage as frontmatter over `spec/issues/` and MUST NOT describe `spec/backlog/` as a live directory store; mentions that describe `spec/backlog/` strictly as the legacy input to `metta backlog migrate` are permitted; (3) the guard-edit hook template (`src/templates/hooks/metta-guard-edit.mjs`) MUST NOT include `spec/backlog/` in its allowlisted edit prefixes, so out-of-band `.md` edits under that path are denied. (Cross-capability note: item 1 touches the refresh/CLAUDE.md regeneration surface and item 3 the orchestration guard-edit template; they are specified here because the residue originates from the backlog rework and no multi-H1 delta is supported.)
Fulfills: US-3

### Scenario: Refresh emits a TOC without a spec/backlog row
- GIVEN a project using metta with the change applied
- WHEN the user runs `metta refresh` and inspects the regenerated CLAUDE.md Table of Contents
- THEN no row references the path `spec/backlog/`; any backlog row present points at the issues-backed view

### Scenario: Docs describe the frontmatter-over-issues model
- GIVEN the five affected docs files
- WHEN they are searched for the string `spec/backlog/`
- THEN every remaining match describes the retired directory only as the legacy input to `metta backlog migrate`, no match describes `spec/backlog/` as a live directory store, and backlog storage is described as frontmatter over `spec/issues/`

### Scenario: Guard-edit denies edits under the retired path
- GIVEN the guard-edit hook built from the updated template is active
- WHEN an out-of-band `.md` edit targets a path under `spec/backlog/`
- THEN the edit is denied because the prefix is no longer allowlisted


## Requirement: Bare metta backlog is allowed by the guard-bash hook

The `ALLOWED_BARE` set in the `metta-guard-bash` PreToolUse hook MUST include `backlog`, so that a bare `metta backlog` invocation (the read-only backlog view) is allowed without a session credential, consistent with bare `roadmap` and `release`. The change MUST be applied to both hook copies — `.claude/hooks/metta-guard-bash.mjs` and `src/templates/hooks/metta-guard-bash.mjs` — and the two copies MUST remain byte-identical. The Tier 2 (session-tier) authorization for the scoped two-word write forms `backlog add`, `backlog done`, and `backlog promote` MUST be unchanged: those forms MUST still be denied without valid authorization. (Cross-capability note: this requirement targets the orchestration-guard hook surface; it is specified here because no multi-H1 delta is supported.)
Fulfills: US-4

### Scenario: Bare backlog invocation is allowed
- GIVEN the `metta-guard-bash` PreToolUse hook is active and no session credential has been minted
- WHEN a session issues the bare command `metta backlog`
- THEN the hook allows the command rather than denying it

### Scenario: Both hook copies stay byte-identical
- GIVEN the repo hook `.claude/hooks/metta-guard-bash.mjs` and the template `src/templates/hooks/metta-guard-bash.mjs` after the change
- WHEN their contents are compared byte-for-byte (as by the byte-identity test)
- THEN both include `backlog` in `ALLOWED_BARE` and the files are identical

### Scenario: Write forms remain gated
- GIVEN the guard-bash hook is active and no valid session credential exists
- WHEN a session issues `metta backlog add <slug>`, `metta backlog done <slug>`, or `metta backlog promote <slug>`
- THEN each command is denied exactly as before the change


## Requirement: Single issues-store test file with no compiled test code in dist

Exactly one issues-store test file MUST exist in the repository, at `tests/issues-store.test.ts`; the colocated `src/issues/issues-store.test.ts` MUST be removed. Every test case that existed only in the colocated file MUST be folded into `tests/issues-store.test.ts` before deletion, so no coverage is lost, and the consolidated suite MUST pass. After a build (`tsc`), `dist/` MUST NOT contain any compiled `issues-store.test` module or any other compiled `.test.` artifact originating from `src/`.
Fulfills: US-5

### Scenario: Build output contains no compiled test module
- GIVEN the consolidated test suite with the colocated file deleted
- WHEN the project is built with `tsc` and `dist/` is inspected
- THEN no `issues-store.test` artifact (nor any `*.test.js`/`*.test.d.ts` compiled from `src/`) is present in `dist/`

### Scenario: Unique test cases survive consolidation
- GIVEN test cases that existed only in `src/issues/issues-store.test.ts`
- WHEN the colocated file is deleted
- THEN each of those cases exists in `tests/issues-store.test.ts` and the full test suite passes

### Scenario: Exactly one issues-store test file in the tree
- GIVEN the repository after the change
- WHEN the tree is searched for files matching `issues-store.test`
- THEN exactly one match exists, at `tests/issues-store.test.ts`


## Requirement: Tier advisory recommendation is capped at standard

The complexity tier advisory rendered by `src/complexity/renderer.ts` MUST never recommend upscaling to the `full` tier while upscale-to-full is unsupported: when a change's complexity scores at `full`, every surface that emits the renderer's advisory MUST show a recommendation capped at `standard`, and no emitted string may read "scored full -- upscale recommended" or otherwise advise upscaling to `full`. The cap MUST apply at the renderer (or equivalently at every surface emitting its output) so the advisory is consistent with the existing full-tier caps in `src/cli/commands/complete.ts` (lines 362-367 and 462-466). The existing upscale-to-`standard` recommendation for a change scored `standard` while running at `quick` MUST be unchanged, and the underlying complexity scoring values MUST NOT be modified by the cap. (Cross-capability note: this requirement targets the adaptive-workflow-tier-selection advisory surface; it is specified here because no multi-H1 delta is supported.)
Fulfills: US-6

### Scenario: Full-scored change renders a capped advisory
- GIVEN a change whose complexity scores at the `full` tier while running at a lower tier
- WHEN the complexity advisory is rendered on any surface that emits it
- THEN the output recommends at most `standard` and never contains a recommendation to upscale to `full`

### Scenario: Standard-over-quick recommendation is unchanged
- GIVEN a change scored at `standard` while running at `quick`
- WHEN the advisory is rendered
- THEN the existing upscale-to-standard recommendation text appears exactly as before the change

### Scenario: Scoring values are untouched by the cap
- GIVEN a change whose raw complexity score maps to the `full` tier
- WHEN the advisory cap is applied at render time
- THEN the stored/computed score and scored tier remain `full`; only the rendered recommendation text is capped, consistently across all emitting surfaces


## Requirement: CLI JSON output escapes DEL and C1 control characters

`outputJson` (`src/cli/helpers.ts`), the single stdout edge for all `--json` command output including the `handleError` JSON error envelopes, MUST escape every code unit in the range U+007F through U+009F (DEL plus the C1 controls) in the serialized JSON text as a six-character JSON escape sequence — a backslash followed by `uXXXX` (e.g. `\` + `u009b` for U+009B) — applied after `JSON.stringify`. C0 control handling (U+0000–U+001F) performed by `JSON.stringify` itself MUST remain unchanged. Code points at or below U+007E and at or above U+00A0 — including multi-byte UTF-8 characters — MUST pass through the emission edge unchanged. Emitted `--json` stdout MUST NOT contain any raw code unit in the U+007F–U+009F range.
Fulfills: US-1

### Scenario: Raw CSI byte in a stored issue title is escaped in issues show --json
- GIVEN a stored issue whose title contains a raw single-byte CSI character (U+009B)
- WHEN the user runs `metta --json issues show <slug>`
- THEN the emitted JSON text contains no raw bytes in the U+007F–U+009F range and the affected code point appears as the six-character escape sequence backslash + `u009b`

### Scenario: DEL in a user-influenced field never reaches stdout raw
- GIVEN a stored record whose user-influenced field contains DEL (U+007F)
- WHEN any `--json` command emits that record via `outputJson`
- THEN the raw DEL byte does not appear in stdout and the code point is emitted as the six-character escape sequence backslash + `u007f`

### Scenario: JSON error envelopes receive the same escaping
- GIVEN a `--json` command that fails such that `handleError` emits a JSON error envelope containing user-influenced text with C1 control characters
- WHEN the envelope is written to stdout
- THEN no raw code units in the U+007F–U+009F range appear in the emitted envelope text

### Scenario: Boundary neighbors and multi-byte characters pass through unchanged
- GIVEN stored content containing ordinary printable text, the boundary code points U+007E and U+00A0, and multi-byte UTF-8 characters
- WHEN the content is emitted via a `--json` command
- THEN those code points appear in the emitted JSON text unchanged, and only code points in the U+007F–U+009F range are escaped


## Requirement: JSON escaping preserves parsed-value fidelity and never mutates stored data

Applying `JSON.parse` to the emitted `--json` stdout MUST yield string values byte-identical to the stored originals; the DEL/C1 escaping changes only the JSON text encoding, which the JSON grammar permits, and MUST NOT alter parsed values. Escaping MUST apply at the emission edge only: `.metta/` state files and `spec/` store files MUST NOT be modified by any `--json` emission. The existing byte-faithful `--json` regression tests in `tests/cli-issue-backlog.test.ts`, `tests/cli-gaps.test.ts`, `tests/cli-roadmap.test.ts`, and `tests/cli-status.test.ts` MUST continue to pass without modification.
Fulfills: US-2

### Scenario: JSON.parse round-trips escaped output to the exact stored strings
- GIVEN a stored title containing U+009B and U+007F
- WHEN the corresponding `--json` command output is passed through `JSON.parse`
- THEN the resulting string values are byte-identical to the stored originals

### Scenario: Existing byte-faithful test suites pass unmodified
- GIVEN the existing byte-faithful `--json` tests in `tests/cli-issue-backlog.test.ts`, `tests/cli-gaps.test.ts`, `tests/cli-roadmap.test.ts`, and `tests/cli-status.test.ts`
- WHEN the full test suite runs after the fix
- THEN all four suites pass without any modification to their assertions

### Scenario: Stored files are untouched by JSON emission
- GIVEN stored data in `.metta/` state files and `spec/` stores containing C1 control characters
- WHEN any `--json` command runs and emits that data
- THEN the stored files on disk are byte-identical to their pre-emission state


## Requirement: Shared pure escape helper applied at every CLI stdout JSON edge

A single shared pure helper (e.g. `escapeJsonControls(jsonText: string): string`) MUST implement the DEL/C1 escaping over already-serialized JSON text. The helper MUST be idempotent — applying it to already-escaped output produces identical text — MUST return an empty string unchanged, and MUST escape exactly the U+007F–U+009F range while leaving all other code points intact. Every CLI stdout JSON emission point that carries user-influenced strings MUST route through this helper: `outputJson` in `src/cli/helpers.ts`, the `config get` JSON object-value edge in `src/cli/commands/config.ts`, and the tasks `--json` rendering edge in `src/cli/commands/tasks-renderer.ts`. The helper MUST NOT be applied to stored data at write time.
Fulfills: US-3

### Scenario: config get escapes C1 controls identically to outputJson
- GIVEN a config object value containing user-influenced strings with C1 control characters
- WHEN `metta config get` prints that value as JSON to stdout
- THEN the U+007F–U+009F range is escaped as backslash + `uXXXX` sequences identically to `outputJson` output and no raw C1 bytes reach stdout

### Scenario: Tasks --json rendering routes through the shared helper
- GIVEN the tasks `--json` rendering path emitting user-influenced strings containing C1 control characters
- WHEN it writes JSON to stdout
- THEN the shared escape helper is applied and no raw code units in the U+007F–U+009F range appear in stdout

### Scenario: Helper is idempotent and precise at range boundaries
- GIVEN inputs consisting of already-escaped JSON text, an empty string, and strings containing the boundary code points U+007E, U+007F, U+009F, and U+00A0
- WHEN the escape helper is invoked on each input
- THEN already-escaped text is returned unchanged, the empty string is returned unchanged, U+007F and U+009F are escaped as backslash + `u007f` and backslash + `u009f` respectively, and U+007E and U+00A0 are left intact


## Requirement: Milestone store update applies validated patches

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


## Requirement: Milestone close CLI verb transitions to a terminal state

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


## Requirement: Milestone update CLI verb edits mutable fields

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


## Requirement: Renderers and rollups handle the abandoned state

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


## Requirement: Guard authorization for milestone close and update

The `metta-guard-bash` hook's allow-list MUST authorize the scoped two-word forms `milestone close` and `milestone update` under the same Tier 2 (session-tier) trust rules as the existing `milestone create` verb, with no change to the two-tier trust model itself. Contexts not authorized for existing milestone mutating verbs MUST be blocked from the new verbs identically. (Traces: US-5; intent proposal §6.)

### Scenario: Authorized skill context may invoke the new verbs
- GIVEN a skill context holding a valid session credential that authorizes `metta milestone create`
- WHEN it invokes `metta milestone close <slug>` or `metta milestone update <slug>`
- THEN the guard hook permits both commands

### Scenario: Unauthorized context is blocked identically
- GIVEN a context without a valid session credential
- WHEN it attempts `metta milestone close <slug>` or `metta milestone update <slug>`
- THEN the guard blocks the commands with the same denial behavior it applies to `metta milestone create`
