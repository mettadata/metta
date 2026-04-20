# Spec Traceability Verification: upgrade-metta-issue-skill-run-short-debugging-session-before

**Verdict**: PASS

## Summary

9 scenarios reviewed across 7 requirements. 4 scenarios have direct unit-test or CLI-test evidence; 5 scenarios rely on skill-level instructions (SKILL.md step numbers) for their behavioral guarantees, which is acceptable per the scenario-evidence rules: RCA authoring, `--quick`, and RCA fallback are inherently skill-agent behaviors with no CLI surface to assert. The CLI-level scenarios that SHOULD have direct test evidence (stdin auto-detect, TTY passthrough, parser tolerance) are all covered by unit tests in `src/issues/issues-store.test.ts` and integration tests in `tests/cli.test.ts`, plus gates: `npx tsc --noEmit` exits 0, `npm run lint` (aliased to `tsc --noEmit`) exits 0, `npm test` reports 818/818 passing across 58 test files.

## Traceability Matrix

### Requirement: Metta-issue skill performs root cause analysis before writing the ticket

#### Scenario: Happy path — structured ticket written after RCA

- **Evidence**:
  - Skill step 5 (`RCA session`) in `/home/utx0/Code/metta/.claude/skills/metta-issue/SKILL.md:19-38` instructs the skill to `Grep`/`Glob` for relevant source files, `Read` 2-5 files, run `git log -20 --oneline -- <path>`, trace the call path, and compose the body using the fixed `## Symptom` → `## Root Cause Analysis` → `### Evidence` → `## Candidate Solutions` schema.
  - Skill front-matter `allowed-tools: [Bash, AskUserQuestion, Read, Grep, Glob]` at `/home/utx0/Code/metta/.claude/skills/metta-issue/SKILL.md:4` satisfies the MUST-include requirement for `Read`, `Grep`, `Glob`, and `Bash`.
  - Skill step 7 (`Write ticket`) at `/home/utx0/Code/metta/.claude/skills/metta-issue/SKILL.md:48-52` pipes `$BODY` via stdin into `metta issue "$TITLE"`, confirming the body travels via pipe rather than as a CLI argument.
- **Status**: Verified (skill-instruction only; RCA authoring is agent-behavior, not code)

#### Scenario: Interactive path — description not provided as argument

- **Evidence**:
  - Skill step 2 (`Collect description`) at `/home/utx0/Code/metta/.claude/skills/metta-issue/SKILL.md:13` instructs the skill to use `AskUserQuestion` when `TITLE` is empty, then continue into step 5 (RCA).
  - Skill step 5 follows unconditionally after title is acquired (no `--quick` flag present), satisfying the "after the user provides… the skill proceeds with the full RCA flow" clause.
- **Status**: Verified (skill-instruction only)

---

### Requirement: Metta-issue skill supports --quick escape hatch

#### Scenario: --quick skips RCA and writes a shallow ticket

- **Evidence**:
  - Skill step 1 at `/home/utx0/Code/metta/.claude/skills/metta-issue/SKILL.md:11` parses and strips the `--quick` flag from the input.
  - Skill step 4 (`--quick short-circuit`) at `/home/utx0/Code/metta/.claude/skills/metta-issue/SKILL.md:17` sets `BODY="$TITLE"` and jumps directly to step 7, explicitly forbidding `Read`, `Grep`, `Glob`, or `Bash` file/git inspection in this branch.
  - Skill Rules section at `/home/utx0/Code/metta/.claude/skills/metta-issue/SKILL.md:56` ("Never forward `--quick` to the CLI — it is a skill-side flag only. Filter it out before calling `metta issue`") satisfies the requirement that `--quick` MUST NOT be passed to the CLI.
  - CLI surface confirmation: `src/cli/commands/issue.ts` (the `program.command('issue')` definition at lines 7-12) declares only `[description]`, `--severity`, and `--on-branch`. No `--quick` flag exists, so even an accidental forward would be rejected.
- **Status**: Verified (skill-instruction + CLI surface check)

---

### Requirement: Metta-issue skill falls back to shallow log when RCA fails

#### Scenario: RCA fails mid-session and fallback body is written

- **Evidence**:
  - Skill step 6 (`RCA-failure fallback`) at `/home/utx0/Code/metta/.claude/skills/metta-issue/SKILL.md:40-46` instructs the skill, on any RCA tool failure, to set `BODY` to `> RCA skipped: <one-sentence reason>\n\n<TITLE>` and omit `## Root Cause Analysis` / `## Candidate Solutions` sections.
  - Skill step 6 also states "Issue capture MUST proceed", and skill Rules line at `/home/utx0/Code/metta/.claude/skills/metta-issue/SKILL.md:58` ("Always fall back via step 6 if RCA fails — never leave an issue unlogged") satisfies the "issue capture MUST succeed" guarantee.
  - CLI write path: `src/cli/commands/issue.ts:27` calls `IssuesStore.create(description, body, severity)` regardless of body content, so the fallback body flows through the same write-and-commit path as the RCA body. `metta issues show <slug>` exits 0 because `src/cli/commands/issue.ts:63-83` simply reads + parses the file.
- **Status**: Verified (skill-instruction + CLI write path)

---

### Requirement: Metta-issue skill writes a structured body with fixed section order

#### Scenario: Full structured body validates section order and Evidence citation

- **Evidence**:
  - Skill step 5 at `/home/utx0/Code/metta/.claude/skills/metta-issue/SKILL.md:24-38` defines the exact fixed section schema (`## Symptom` → `## Root Cause Analysis` → `### Evidence` → `## Candidate Solutions`) with constraints: 1-3 Evidence items, 1-3 Candidate Solutions, each solution MUST include a `Tradeoff:` clause.
  - CLI/store pass-through: `src/issues/issues-store.ts:29` (`lines.push(issue.description)`) writes the body verbatim after the `**Severity**:` metadata line with no transformation, preserving H2 ordering.
  - Round-trip evidence: `src/issues/issues-store.test.ts:29-41` ("round-trips a structured H2 body without leaking headings into the title") asserts that a body containing `## Symptom`, `## Root Cause Analysis`, and `## Candidate Solutions` is returned verbatim from `show()` with no heading leakage into the `title` field.
  - `metta issues show … --json` returning all three headings in the `description` field is implicit in `src/cli/commands/issue.ts:72` (`outputJson(issue)`) combined with the parser returning `description` verbatim from `src/issues/issues-store.ts:45`.
- **Status**: Verified

---

### Requirement: Metta issue CLI auto-detects piped stdin as body

#### Scenario: Structured body piped via stdin becomes the issue body

- **Evidence**:
  - Implementation: `src/cli/commands/issue.ts:18-19` reads `stdinPayload = await readPipedStdin()` and uses it as `body` when `stdinPayload.trim() !== ''`, otherwise falling back to `description`. The positional `description` argument is passed to `IssuesStore.create(description, body, …)` at `src/cli/commands/issue.ts:27`, confirming the positional arg is the title and the piped payload is the body.
  - `readPipedStdin` helper: `src/cli/helpers.ts:299-349` returns `''` immediately when `process.stdin.isTTY` is truthy, otherwise reads all bytes and resolves on `end`/timeout.
  - Store behavior: `src/issues/issues-store.ts:61-75` uses `title` for slug generation and `description` (the body) separately, so the title does NOT appear in the body unless caller echoes it.
  - Indirect CLI regression coverage: `tests/cli.test.ts:431-439` exercises `metta issue "login flash" --severity major` through `runCli` (execFile, non-TTY stdin with no writer). Before the `readPipedStdin` timeout hardening, this test (and 8 others) timed out; now they pass, validating the TTY-absent/no-writer path settles within 100 ms.
  - No dedicated unit test asserting "piped body becomes description, positional becomes title" — this gap was acknowledged in `review/quality.md:22` and `review.md:22` and deferred.
- **Status**: Verified (implementation + integration coverage; no dedicated pipe-assertion test, deferred per review)

#### Scenario: Interactive TTY stdin leaves behavior unchanged

- **Evidence**:
  - Implementation: `src/cli/helpers.ts:300` (`if (process.stdin.isTTY) return ''`) guarantees an empty payload when stdin is a TTY; `src/cli/commands/issue.ts:19` then falls through to `body = description`, which `IssuesStore.create(description, body, …)` at `src/cli/commands/issue.ts:27` passes as both title and body — identical to the pre-upgrade behavior.
  - Store default preserved: `src/issues/issues-store.ts:69` (`description: description || title`) already treats an empty description as a title-fallback, and the TTY path now supplies `description` equal to the positional argument, so the description field ends up equal to the title.
  - Test: `tests/cli.test.ts:431-439` (`logs an issue with severity`) is the canonical pre-upgrade behavior assertion; it passes unmodified.
- **Status**: Verified

---

### Requirement: Issues-store parseIssue tolerates both freeform and structured bodies

#### Scenario: Both freeform and structured bodies round-trip through metta issues show

- **Evidence**:
  - Parser: `src/issues/issues-store.ts:34-48`. The metadata-field detection uses literal `startsWith('**Captured**:')` / `startsWith('**Context**:')` / `startsWith('**Severity**:')` predicates (lines 37-39), none of which match an `##` H2 heading, so structured bodies cannot misattribute their headings as metadata. Line 42-45 slices everything after `**Severity**:` and returns it verbatim, trimmed.
  - Freeform round-trip test: `src/issues/issues-store.test.ts:20-27` writes a plain-paragraph body, reads it back via `store.show(slug)`, asserts `issue.description === description` — covers the legacy body path.
  - Structured round-trip test: `src/issues/issues-store.test.ts:29-41` writes a body containing `## Symptom`, `## Root Cause Analysis`, `### Evidence`, and `## Candidate Solutions`, reads it back, and asserts that all three H2 headings are preserved in `description` and none leak into `title`.
  - Metadata boundary test: `src/issues/issues-store.test.ts:43-52` writes a body whose first line is `## Symptom` (the tight edge case — H2 immediately after `**Severity**:`) and asserts that `severity` parses as `'minor'` (metadata intact) AND `description.startsWith('## Symptom')` is true (no heading consumed as metadata).
  - `formatIssue` verbatim write: `src/issues/issues-store.ts:17-32` writes `issue.description` on line 29 with no transformation — H2 headings are not stripped or escaped.
- **Status**: Verified

---

### Requirement: Metta-fix-issues skill surfaces structured issue sections at step 1

#### Scenario: Structured sections displayed before fix planning begins

- **Evidence**:
  - Skill step 1 (`Validate`) at `/home/utx0/Code/metta/.claude/skills/metta-fix-issues/SKILL.md:27-29` instructs the orchestrator, after `metta issues show <issue-slug> --json` succeeds, to display the `## Symptom`, `## Root Cause Analysis` (including any `### Evidence` subsection), and `## Candidate Solutions` sections from the returned JSON `description`. Explicit legacy tolerance at line 29: "If one or more sections are absent (legacy shallow issue), display whatever body content is present and continue — do not error."
  - Step 2 unchanged: `/home/utx0/Code/metta/.claude/skills/metta-fix-issues/SKILL.md:31` runs `METTA_SKILL=1 metta propose "fix-<issue-slug>" --json` exactly as the pre-upgrade flow did.
  - Steps 3-11 are unmodified from the pre-upgrade definition (per `review.md` and the step-by-step content at `/home/utx0/Code/metta/.claude/skills/metta-fix-issues/SKILL.md:33-81`).
  - The JSON surface that drives this display is the verbatim `description` returned by `src/cli/commands/issue.ts:71-72` (`outputJson(issue)`), which in turn uses the parser from `src/issues/issues-store.ts:34-48` — no new CLI flag or subagent was added. This satisfies "No new CLI invocation, no new flag, and no new subagent is introduced."
- **Status**: Verified (skill-instruction + existing CLI surface)

## Unverified scenarios

None. Every scenario has at least one of: (a) a direct unit test, (b) a direct implementation file:line, or (c) a skill step number backed by an unchanged CLI/store code path.

Scenarios explicitly noted as skill-instruction-only coverage (acceptable per rules):

1. "Happy path — structured ticket written after RCA" — skill steps 5 + 7 drive an LLM agent workflow; no runtime assertion possible.
2. "Interactive path — description not provided as argument" — skill step 2 drives an LLM `AskUserQuestion` call; not CLI-testable.
3. "--quick skips RCA and writes a shallow ticket" — skill step 4 short-circuit is enforced by the skill agent; the CLI has no `--quick` flag to assert.
4. "RCA fails mid-session and fallback body is written" — skill step 6 fallback is agent-side; the underlying CLI write/commit/show path is covered by existing `tests/cli.test.ts:431-439`.
5. "Structured sections displayed before fix planning begins" — skill step 1 orchestrator display is agent-side; the underlying JSON surface is covered by the parser round-trip tests.

## Notes

- Gates: `npm test` → 58 files / 818 tests all pass (649s wall). `npx tsc --noEmit` → exit 0, clean. `npm run lint` (aliased to `tsc --noEmit`) → exit 0, clean. Also corroborated by `/home/utx0/Code/metta/spec/changes/upgrade-metta-issue-skill-run-short-debugging-session-before/verify/tsc-lint.md`.
- Known residual quality finding (non-blocker, deferred): `readPipedStdin` lacks a dedicated unit test covering TTY short-circuit, end-before-timeout, timeout-with-partial-buffer, and error paths. Coverage is indirect via 9 previously-timing-out CLI tests that now pass. See `review/quality.md:17` and `review.md:22` for context. Not a spec violation — no scenario mandates a helper-level unit test.
- No dedicated integration test pipes a structured body through `metta issue` stdin and asserts the resulting file body; this was also deferred. The integrated path is exercised indirectly by the full CLI test suite (which now settles in bounded time thanks to the timeout), and the unit-level invariants (parser tolerance + verbatim write) are covered directly by `src/issues/issues-store.test.ts`.
- No implementation source file was modified during verification.
