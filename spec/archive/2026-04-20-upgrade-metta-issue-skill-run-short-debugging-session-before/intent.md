# upgrade-metta-issue-skill-run-short-debugging-session-before

## Problem

AI orchestrators invoking `/metta-issue` produce shallow one-liner tickets: the skill calls `metta issue "<description>"` and stops. The resulting `spec/issues/*.md` file contains only a symptom headline with no root cause, no file-line evidence, and no candidate solutions.

This forces every future fixer running `/metta-fix-issues` to redo the full debugging session from scratch — reading source files, tracing the call path, checking git history — often days later when the original observation context is gone. The rediscovery work is strictly more expensive than capturing it at log time because the logging agent already has the failing execution in context. The cost is paid twice and the signal degrades between the two sessions.

Two groups are directly affected:

- **AI orchestrators logging issues** — they invoke `/metta-issue` with full in-context knowledge of the failure but have no mechanism to record that knowledge in the ticket.
- **Future fixers running `/metta-fix-issues`** — they receive a one-line slug and must reconstruct context cold, which slows resolution and introduces the risk of fixing the wrong root cause.

The severity is major: the issue-tracking system exists to accelerate fix cycles, but shallow tickets negate that value.

## Proposal

Three concrete deliverables:

**1. Upgrade the `/metta-issue` skill (`metta:issue` in `.claude/skills/metta-issue/SKILL.md`)**

Replace the current four-step log-and-stop flow with a debugging-first flow:

- Collect description and severity as today (interactive `AskUserQuestion` if not provided as arguments).
- By default, run a short RCA session before writing the ticket: read relevant source files and recent git history around the symptom, trace the call path, identify the most likely root cause with `### Evidence` subsections citing `file:line` references, and propose 1–3 candidate solutions with tradeoffs.
- Write the issue body as structured H2 sections in this order: `## Symptom`, `## Root Cause Analysis` (with `### Evidence`), `## Candidate Solutions`.
- Pass the full structured body to the CLI via stdin (auto-detected; no new flag required).
- Honour a `--quick` flag on the skill invocation: when present, skip RCA and log only the symptom headline — preserving today's behavior as an escape hatch for obvious or trivial symptoms.
- If RCA errors out for any reason, fall back to shallow logging and append a visible `> RCA skipped: <reason>` note to the body. Issue capture is never blocked by a failed debugging session.

**2. Extend the `metta issue` CLI command (`src/cli/commands/issue.ts`)**

- Auto-detect piped stdin at process startup: if `process.stdin` is not a TTY, read all of stdin and use it as the issue body, overriding the description-as-body default.
- When stdin body is present, pass it as the `description` field to `IssuesStore.create()` while keeping the description argument as the `title`.
- No new flag (`--body-file`, `--stdin`) is introduced. Auto-detection only.
- Interactive TTY stdin (no pipe) is ignored; behavior is identical to today.

**3. Update the `/metta-fix-issues` skill display (`.claude/skills/metta-fix-issues/SKILL.md`)**

- In step 1 (Validate), after fetching the issue via `metta issues show <slug> --json`, display the structured sections (`## Symptom`, `## Root Cause Analysis`, `## Candidate Solutions`) to the orchestrator before proceeding.
- This surfaces the pre-captured context without changing the fix, review, or verification flow in any way.

## Impact

- **`src/cli/commands/issue.ts`** — the `action` handler for `metta issue` gains stdin detection. When `!process.stdin.isTTY`, the command reads from stdin before proceeding and uses that content as the body. The `description` argument becomes title-only in that code path. The `IssuesStore.create()` call signature is unchanged; the body is passed as the existing `description` parameter.

- **`src/issues/issues-store.ts`** — the `parseIssue` function currently extracts `description` as everything after the `**Severity**:` metadata line. New tickets will contain H2 sections (`## Symptom`, `## Root Cause Analysis`, `## Candidate Solutions`) inside that body block. `parseIssue` must be made tolerant: it MUST continue to split on `**Severity**:` and return the remainder as `description` regardless of whether the body contains H2 headings or is a plain paragraph. No structural changes to `formatIssue` are required because the body is written verbatim. Existing issue files — which contain plain paragraphs — continue to parse correctly without any migration.

- **`.claude/skills/metta-issue/SKILL.md`** — the skill definition is rewritten to describe the RCA-first flow, the `--quick` escape hatch, the fallback behavior, and the stdin-pipe mechanism for passing the structured body to the CLI. The `allowed-tools` list expands to include `Read`, `Grep`, `Glob`, and `Bash` to support RCA file and git history inspection.

- **`.claude/skills/metta-fix-issues/SKILL.md`** — step 1 (Validate) gains an explicit display instruction for the structured issue sections. No other steps change. The resolution flow — propose, plan, execute, review, verify, finalize, merge — is unaffected.

- **Existing `spec/issues/*.md` files** — the on-disk format is preserved. The plain-paragraph body in existing files continues to parse without modification. No file is rewritten.

## Out of Scope

- **One-time migration of existing issue bodies.** Existing `spec/issues/*.md` files are left exactly as they are. There is no backfill of RCA sections onto previously logged issues.

- **Changes to the `/metta-fix-issues` resolution flow.** Only the display of the structured issue sections in step 1 changes. The propose → plan → execute → review → verify → finalize → merge pipeline, the parallel reviewer/verifier fan-out, the review-fix loop, and the remove-issue step are all out of scope.

- **New CLI flags.** No `--body-file`, `--stdin`, `--rca`, or any other new flag is added to `metta issue`. Stdin auto-detection is the only mechanism. The `--quick` flag lives on the skill invocation, not on the CLI command.

- **Hard time or tool-call bounds on RCA.** No timeout parameter, no maximum file-read count, no cap on git log depth. The AI decides when the debugging session is complete.

- **Changes to any other skill or CLI command.** Only `metta-issue`, `metta-fix-issues`, and `metta issue` (CLI) are in scope.
