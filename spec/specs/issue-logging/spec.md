# upgrade-metta-issue-skill-run-short-debugging-session-before

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
