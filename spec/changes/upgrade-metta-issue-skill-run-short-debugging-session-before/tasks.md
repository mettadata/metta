# Tasks for upgrade-metta-issue-skill-run-short-debugging-session-before

## Batch 1 (no dependencies — parallel, 3 tasks)

- [x] **Task 1.1: Add `readPipedStdin` helper to `src/cli/helpers.ts`**
  - **Files**: `src/cli/helpers.ts`
  - **Action**: Append after the existing `askYesNo` function (near line 255) a new exported async function `readPipedStdin(): Promise<string>`. The function must: (1) return `''` immediately when `process.stdin.isTTY` is truthy; (2) otherwise `import { text } from 'node:stream/consumers'` and return `await text(process.stdin)`, wrapped in a try/catch that returns `''` on any error (SIGPIPE, early-close, empty stream). The function does NOT trim — callers are responsible for the `payload.trim() === ''` check. Add the name to the barrel if `src/cli/helpers.ts` re-exports via index, but do not alter `src/index.ts` unless `helpers.ts` is already barrel-exported there.
  - **Verify**: `npx tsc --noEmit` exits 0; `grep -n 'readPipedStdin' src/cli/helpers.ts` shows the export; no new entries in `package.json`.
  - **Done**: `readPipedStdin` is exported from `src/cli/helpers.ts` and importable by other CLI modules via `../helpers.js` ESM path.

- [x] **Task 1.2: Add clarifying comment to `parseIssue` in `src/issues/issues-store.ts`**
  - **Files**: `src/issues/issues-store.ts`
  - **Action**: Locate the `parseIssue` function (lines ~34–46). Immediately before the line `const description = lines.slice(descStart + 1).join('\n').trim()` (or its equivalent), insert a two-line `//` comment block:
    ```
    // Body is returned verbatim — may be a freeform paragraph or structured H2 sections.
    // H2 headings (##) in the body are safe: no metadata startsWith predicate matches '##'.
    ```
    No other change to the function, the `Issue` interface, `formatIssue`, or any `IssuesStore` method.
  - **Verify**: `npx tsc --noEmit` exits 0; `git diff src/issues/issues-store.ts` shows exactly two added comment lines and zero deleted or changed functional lines.
  - **Done**: Comment present immediately above the `description` extraction line; no runtime behavior change; existing tests (if any) still pass.

- [x] **Task 1.3: Create `src/issues/issues-store.test.ts` covering body tolerance**
  - **Files**: `src/issues/issues-store.test.ts`
  - **Action**: Create the file using Vitest `describe/it/expect`. Each test must use an isolated temp directory (`import { mkdtempSync, rmSync } from 'node:fs'` + `import { tmpdir } from 'node:os'`) — never the real `spec/` tree. Construct an `IssuesStore` instance pointing at the temp directory. Write three test cases:
    1. **Freeform body round-trip**: `create` an issue with title `"freeform title"` and description `"A plain paragraph with no headings."`. Call `show(slug)` and assert the returned `description` equals `"A plain paragraph with no headings."`.
    2. **Structured H2 body round-trip**: `create` an issue with title `"structured title"` and description `"## Symptom\nfoo fails\n\n## Root Cause Analysis\nbar is broken\n\n### Evidence\nsrc/foo.ts:42 — confirms failure\n\n## Candidate Solutions\n1. Fix bar. Tradeoff: risky."`. Call `show(slug)` and assert: `title === "structured title"`, `description` contains `"## Symptom"`, `"## Root Cause Analysis"`, `"## Candidate Solutions"`, and that `title` does NOT contain `"##"` (no heading leaked into title).
    3. **Metadata boundary guard**: `create` an issue with severity `"minor"` and description starting with `"## Symptom\nsome symptom"`. Call `show(slug)` and assert: `severity === "minor"`, `description` begins with `"## Symptom"`, and `severity` does NOT contain `"##"`.
    Clean up the temp directory in an `afterEach` block using `rmSync(tmpDir, { recursive: true })`.
  - **Verify**: `npx vitest run src/issues/issues-store.test.ts` exits 0 with all 3 tests passing; no test accesses `spec/` directly.
  - **Done**: Test file exists, all 3 cases green, isolated from real spec tree.

---

## Batch 2 (depends on Batch 1 — specifically Task 1.1; 1 task)

- [x] **Task 2.1: Wire `readPipedStdin` into the `metta issue` action handler**
  - **Depends on**: Task 1.1
  - **Files**: `src/cli/commands/issue.ts`
  - **Action**: Import `readPipedStdin` at the top of the file: `import { readPipedStdin } from '../helpers.js'`. Inside the `.action(async (description, options) => { ... })` callback, immediately after any JSON/context setup lines and BEFORE the `if (!description)` guard, add:
    ```typescript
    const stdinPayload = await readPipedStdin()
    const body = stdinPayload.trim() !== '' ? stdinPayload : description
    ```
    Change the `IssuesStore.create()` call from `create(description, description, ...)` to `create(description, body, ...)`. The existing `if (!description)` guard (missing positional arg → error) is left entirely unchanged — the title is always required. The `--severity` and `--on-branch` options are unchanged. No new CLI flags are introduced.
  - **Verify**: `npx tsc --noEmit` exits 0. Build (`npm run build`) succeeds. Manual smoke tests after build:
    - `printf '## Symptom\nfoo hangs\n## Root Cause Analysis\nbar\n### Evidence\nsrc/foo.ts:42\n## Candidate Solutions\n1. fix bar' | node dist/cli/index.js issue "foo hangs on startup" --json` produces a file where `title` is `"foo hangs on startup"` and `description` starts with `"## Symptom"`.
    - `node dist/cli/index.js issue "same title" --json` (no pipe, TTY) produces a file where `description` equals `"same title"`.
    - `echo -n '' | node dist/cli/index.js issue "empty pipe" --json` produces a file where `description` equals `"empty pipe"` (empty-pipe fallback).
  - **Done**: CLI auto-detects piped stdin per spec R5; TTY behavior is byte-identical to pre-upgrade; empty/whitespace pipe falls back to description-as-body.

---

## Batch 3 (depends on Batch 2; parallel, 2 tasks)

- [x] **Task 3.1: Rewrite `.claude/skills/metta-issue/SKILL.md` with the 7-step RCA flow**
  - **Depends on**: Task 2.1
  - **Files**: `.claude/skills/metta-issue/SKILL.md`
  - **Action**: Fully rewrite the skill file. The YAML frontmatter must set `allowed-tools: [Bash, AskUserQuestion, Read, Grep, Glob]`. The body must contain exactly 7 numbered steps:
    1. Parse `$ARGUMENTS`: extract `--quick` flag if present and strip it; set `TITLE` to the remaining argument (may be empty).
    2. If `TITLE` is empty, use `AskUserQuestion` to collect the description; set `TITLE` to the response.
    3. Use `AskUserQuestion` to collect severity if not already supplied (options: `critical`, `major`, `minor`; default `minor`).
    4. `--quick` short-circuit: if `--quick` was set, set `BODY="$TITLE"` and jump to step 7 (write ticket). Do NOT use `Read`, `Grep`, `Glob`, or `Bash` file/git inspection in this branch.
    5. RCA session: use `Grep`/`Glob` to locate source files relevant to the symptom; `Read` the 2–5 most relevant files; run `Bash` with `git log -20 --oneline -- <path>` for each relevant file; trace the call path from the entry point to the failure site. Compose `BODY` using the exact schema:
       ```
       ## Symptom
       <one paragraph>

       ## Root Cause Analysis
       <narrative>

       ### Evidence
       - `path/to/file.ts:LINE` — <one sentence>

       ## Candidate Solutions
       1. **<Option>** — <description>. Tradeoff: <drawback>.
       ```
       Section order is fixed (`## Symptom` → `## Root Cause Analysis` → `### Evidence` → `## Candidate Solutions`). Between 1 and 3 evidence items and 1 and 3 candidate solutions are required. Each solution must include a `Tradeoff:` clause. Stop RCA when evidence is sufficient — no hard file-read cap.
    6. Fallback: if any tool call in step 5 fails or the RCA cannot produce a complete body, set `BODY` to:
       ```
       > RCA skipped: <reason>

       <TITLE>
       ```
       No `## Root Cause Analysis` or `## Candidate Solutions` sections appear in this form.
    7. Write ticket: `printf '%s' "$BODY" | METTA_SKILL=1 metta issue "$TITLE" --severity <level>`.
    Include a Rules section that explicitly states: (a) Never forward `--quick` to the CLI; (b) `--quick` is a skill-side flag only; (c) severity must be one of `critical`, `major`, `minor`; (d) always fall back (step 6) on RCA failure — never leave the issue unlogged.
  - **Verify**: File parses as valid YAML frontmatter + markdown. `grep 'allowed-tools' .claude/skills/metta-issue/SKILL.md` shows all 5 tools. Manual count confirms 7 numbered steps present. Rules section contains the `--quick` prohibition.
  - **Done**: SKILL.md contains all 7 steps, the exact three-H2 body schema with `### Evidence` and `Tradeoff:` requirements, the `--quick` fallback path, the RCA-failure fallback path, and the prohibition on forwarding `--quick` to the CLI.

- [x] **Task 3.2: Add structured-section display to step 1 of `.claude/skills/metta-fix-issues/SKILL.md`**
  - **Depends on**: Task 2.1
  - **Files**: `.claude/skills/metta-fix-issues/SKILL.md`
  - **Action**: Locate step 1 (Validate) in the Single Issue Pipeline section. Find the line that instructs `metta issues show <issue-slug> --json`. Immediately after it, insert the following instruction (as a new paragraph or bullet within that step block):
    > From the returned JSON, display the `## Symptom`, `## Root Cause Analysis` (including any `### Evidence` subsection), and `## Candidate Solutions` sections of the `description` field to the orchestrator. If one or more sections are absent (legacy shallow issue), display whatever body content is present and continue — do not error.
    Do NOT alter steps 2 through 11. The only acceptable diff is an addition within the step 1 block.
  - **Verify**: `git diff .claude/skills/metta-fix-issues/SKILL.md` shows additions only within the step 1 region and zero changes to lines belonging to steps 2–11.
  - **Done**: Step 1 contains the display instruction for structured sections; graceful handling of missing sections is stated; steps 2–11 remain byte-identical to pre-change content.

---

## Batch 4 (depends on all prior batches; 1 task)

- [x] **Task 4.1: Write `summary.md` and mark implementation complete**
  - **Depends on**: Task 3.1, Task 3.2 (and transitively all prior tasks)
  - **Files**: `spec/changes/upgrade-metta-issue-skill-run-short-debugging-session-before/summary.md`
  - **Action**: Create the file summarizing all 6 concrete deliverables shipped by this change. List each changed file with a one-line rationale:
    1. `src/cli/helpers.ts` — added `readPipedStdin()` helper for non-TTY stdin detection
    2. `src/cli/commands/issue.ts` — wired `readPipedStdin` into action handler; piped body supersedes description-as-body
    3. `src/issues/issues-store.ts` — added clarifying comment above the `description` extraction line in `parseIssue`
    4. `src/issues/issues-store.test.ts` — new test file covering freeform round-trip, H2 round-trip, and metadata boundary guard
    5. `.claude/skills/metta-issue/SKILL.md` — full rewrite to 7-step RCA-first flow with `--quick` escape hatch and fallback path
    6. `.claude/skills/metta-fix-issues/SKILL.md` — step 1 (Validate) gains structured-section display instruction with graceful legacy fallback
    The file is authored by the orchestrator after all implementation tasks pass verification; it is not a placeholder.
  - **Verify**: File exists at the correct path; `wc -l` shows non-trivial content (at least 15 lines); all 6 file entries are present.
  - **Done**: `summary.md` committed alongside all implementation changes; ready for the verification gate.
