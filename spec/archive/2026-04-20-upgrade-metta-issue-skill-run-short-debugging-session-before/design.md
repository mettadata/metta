# Design: upgrade-metta-issue-skill-run-short-debugging-session-before

## Approach

Three implementation axes were researched and selected; together they keep the change surface minimal while satisfying every spec requirement.

**Inline-skill RCA** runs the debugging session inside the orchestrator's own context window — exploiting the execution context that prompted the `/metta-issue` invocation in the first place — rather than delegating to a new subagent, which would require reconstructing that context from files and add an agent-spawn round-trip the user can feel interactively.

**`node:stream/consumers` `text()` with an explicit `isTTY` guard** is a built-in, one-line, non-blocking API (Node >= 16, well within metta's Node >= 22 requirement) that avoids manual Buffer concat, adds zero npm dependencies, and composes cleanly with the `isTTY` guard pattern already established in `helpers.ts` by `askYesNo`.

**Pass-through parser** costs zero behavioral diff: `parseIssue` at `src/issues/issues-store.ts:42–43` already slices everything after the `**Severity**:` line and returns it verbatim as `description`, and none of its metadata `startsWith` predicates match a `##` line, so structured H2 bodies already round-trip correctly with only a clarifying comment and new test coverage needed.

Together these three axes keep the deliverable to one new CLI helper function, one action-handler branch, two SKILL.md rewrites, and a new test file — no new npm packages, no new subagent files, no migrations.

## Components

Five touch points, each with a single, bounded responsibility:

**1. `src/cli/helpers.ts` — new `readPipedStdin(): Promise<string>` helper**

Appended after the existing `askYesNo` function (line 255). Guards with `if (process.stdin.isTTY) return ''` immediately, so callers can never accidentally hang on an interactive terminal. Delegates the actual read to `text` imported dynamically from `node:stream/consumers`, wrapped in a try/catch that returns `''` on any stream error (SIGPIPE, early writer exit). Returns the full UTF-8 payload on success. The caller is responsible for the trim-check: `payload.trim() === ''` is the empty-fallback gate, not the helper itself, because the helper should be a pure "read what is there" function. Exported as a named export to maintain the barrel-export contract.

**2. `src/cli/commands/issue.ts` — action handler gains stdin detection**

At the top of the `.action(async (description, options) => { ... })` body, before the `if (!description)` guard, add two lines:

```typescript
const stdinPayload = await readPipedStdin()
const body = stdinPayload.trim() !== '' ? stdinPayload : description
```

The existing `if (!description)` guard stays in place: a missing description positional argument is still an error even when stdin provides a body, because the title is always required. The `IssuesStore.create()` call on line 25 changes from `create(description, description, ...)` to `create(description, body, ...)`. The `description` argument continues to serve as the `title`; `body` carries either the piped payload or the description fallback. No new CLI flag is introduced; auto-detection is the only mechanism.

**3. `src/issues/issues-store.ts` — clarifying comment on `parseIssue`, no functional change**

The `parseIssue` function at lines 34–46 is already correct. The only modification is a one-line comment inserted immediately before the `description` extraction at line 43:

```typescript
// Body is returned verbatim — may be a freeform paragraph or structured H2 sections.
// Callers must not attempt to parse H2 headings out of this field; use the raw string.
const description = lines.slice(descStart + 1).join('\n').trim()
```

No change to the `Issue` interface, `formatIssue`, or any `IssuesStore` method. A new companion file `src/issues/issues-store.test.ts` is created (there is currently no test file for this module) covering three cases: freeform body round-trip, structured H2 body round-trip, and the guard that H2 lines are not misattributed as metadata fields.

**4. `.claude/skills/metta-issue/SKILL.md` — full rewrite to 7-step RCA-first flow**

The current 20-line skill is replaced with a ~70-line document. The front-matter gains `Read`, `Grep`, `Glob` to the `allowed-tools` list alongside the existing `Bash` and `AskUserQuestion`. The body is structured as seven numbered steps: (1) parse `$ARGUMENTS` for `--quick` and strip it before any downstream use; (2) collect description via `AskUserQuestion` if absent; (3) collect severity via `AskUserQuestion` if absent; (4) `--quick` short-circuit — set `BODY="$TITLE"` and jump to step 7; (5) RCA session — use `Grep`/`Glob` to locate relevant source files, `Read` for the 2–5 most relevant, `Bash` with `git log -20 --oneline -- <path>` for each, then format `BODY` using the exact three-H2 schema with `### Evidence` citing at least one `path/to/file:LINE` reference and `## Candidate Solutions` entries each carrying a `Tradeoff:` clause; (6) fallback — on any tool failure during step 5, set `BODY` to `> RCA skipped: <reason>\n\n<TITLE>` with no `## Root Cause Analysis` or `## Candidate Solutions` sections; (7) write ticket — `printf '%s' "$BODY" | METTA_SKILL=1 metta issue "$TITLE" --severity <level>`. The Rules section explicitly prohibits forwarding `--quick` to the CLI, caps severity values to the three known options, mandates fallback on RCA failure, and trusts the AI to stop RCA when evidence is solid (no hard file-read limit).

**5. `.claude/skills/metta-fix-issues/SKILL.md` — display instruction added to step 1 (Validate)**

Step 1 currently reads: `metta issues show <issue-slug> --json` → confirm issue exists and is open. A display instruction is appended inline: after the JSON is confirmed, the orchestrator MUST display the `## Symptom`, `## Root Cause Analysis` (including any `### Evidence` subsection), and `## Candidate Solutions` sections from the `description` field to itself (i.e., include them verbatim in reasoning context) before advancing to step 2 (Propose). When one or more sections are absent — as is normal for legacy shallow issues — the orchestrator MUST display whatever body content is present and MUST NOT error or refuse to continue. No new CLI invocation, no new flag, and no new subagent is introduced; the orchestrator reads sections directly from the JSON `description` string. All other steps (2–11) are unchanged.

## Data Model

The on-disk format for `spec/issues/<slug>.md` files is defined by `formatIssue` in `src/issues/issues-store.ts`. The metadata header is unchanged:

```
# <title>

**Captured**: <ISO-date>
**Status**: logged
**Severity**: critical | major | minor

<description body>
```

The `<description body>` block (everything after the blank line following `**Severity**:`) now has three valid shapes:

**Default structured form** (produced by the upgraded `/metta-issue` skill after a successful RCA session):

```markdown
## Symptom
<one paragraph: what was observed, when, and in which command or code path>

## Root Cause Analysis
<analysis of the most probable root cause>

### Evidence
- `path/to/file.ts:LINE` — <one sentence explaining what this line shows>

## Candidate Solutions
1. **<Option name>** — <description>. Tradeoff: <drawback or risk>.
```

Section order is fixed: `## Symptom` must precede `## Root Cause Analysis`, which must precede `## Candidate Solutions`. The `### Evidence` H3 is a required subsection of `## Root Cause Analysis`. Each candidate solution carries a `Tradeoff:` clause. Between one and three evidence items and between one and three candidate solutions are permitted.

**Shallow `--quick` form** (produced when `--quick` is passed or when the description is short and no RCA is warranted):

```markdown
<plain description paragraph; no H2 sections>
```

**RCA-failure fallback form** (produced when the RCA session errors out):

```markdown
> RCA skipped: <reason>

<plain description paragraph>
```

The blockquote is the first line of the body. No `## Root Cause Analysis` or `## Candidate Solutions` sections appear in this form to avoid misleading partial analyses.

**Backward-compatible freeform form** (all existing `spec/issues/*.md` files authored before this upgrade): any body text that does not start with `## Symptom` or `> RCA skipped:`. The parser returns the full body verbatim; display and fix flows treat it as the description string and render it as-is.

None of the above body shapes require migration. `parseIssue` handles all four by returning `lines.slice(descStart + 1).join('\n').trim()` unchanged.

## API Design

**Helper API — `readPipedStdin(): Promise<string>`**

Signature: `export async function readPipedStdin(): Promise<string>`

Contract: returns `''` immediately when `process.stdin.isTTY` is truthy (interactive terminal — no read is attempted). Returns the full UTF-8 payload when stdin is a pipe and content is available. Returns `''` on any stream error (SIGPIPE, early-close, empty byte stream). Does not perform the trim check — callers are responsible for `payload.trim() === ''` to distinguish empty-pipe from genuine absence. Exposes a single promise; no stream events need to be driven by the caller. Implemented using `text` from `node:stream/consumers` (dynamic import, catching any rejection).

**CLI contract — `metta issue "<title>" [--severity <level>] [--on-branch <name>]`**

Behavioral contract after this change, by stdin state:

- stdin is a pipe AND `stdinPayload.trim() !== ''` → `title = description` (positional arg), `body = stdinPayload`. The `description` argument is used exclusively as the issue title; the piped content becomes the full issue body passed to `IssuesStore.create(description, body, severity)`.
- stdin is a TTY OR `stdinPayload.trim() === ''` → `title = body = description` (today's behavior; `IssuesStore.create(description, description, severity)` unchanged).

The `description` positional argument remains required in all cases; a missing title is still an error. No new flags are added. The `--severity` and `--on-branch` flags are unchanged.

**Skill contract — `/metta-issue [--quick] [description]`**

The skill accepts an optional `--quick` flag as the first token of `$ARGUMENTS`. When present, the skill strips `--quick` before any CLI invocation and never forwards it to `metta issue`. The description argument is optional at the skill level; a missing description triggers an `AskUserQuestion` collect at step 2. The skill produces a `metta issue` CLI call with the structured body piped via stdin using `printf '%s' "$BODY" | METTA_SKILL=1 metta issue "$TITLE" --severity <level>`.

**Fix-issues step-1 display contract**

After `metta issues show <issue-slug> --json` succeeds in step 1, the orchestrator MUST include the `description` field content in its reasoning context — specifically displaying any `## Symptom`, `## Root Cause Analysis` (and `### Evidence`), and `## Candidate Solutions` sections that are present — before any call to step 2 (`metta propose`). When sections are absent (legacy issues), the full body text is displayed without error. This is an orchestrator reasoning instruction only; no new CLI flag or subagent is introduced to implement it.

## Dependencies

**External:** None added. `node:stream/consumers` is a Node.js built-in module available since Node 17 and verified present on Node 22.22.0 (the project's minimum runtime is Node >= 22). No new entries in `package.json` `dependencies` or `devDependencies`.

**Internal:**

- `readPipedStdin` is a new named export in `src/cli/helpers.ts`, co-located with the existing TTY-guarded `askYesNo` helper. It is imported by `src/cli/commands/issue.ts` using an `.js`-extended ESM import path (`../helpers.js`), consistent with the project's Node16 ESM convention.
- `parseIssue` in `src/issues/issues-store.ts` is unchanged in behavior; the clarifying comment is a documentation-only addition.
- `formatIssue` in `src/issues/issues-store.ts` is unchanged.
- `IssuesStore.create(title, description, severity, context?)` signature is unchanged; the action handler in `issue.ts` passes `body` (which may now be the piped stdin payload) as the `description` argument.
- The new `src/issues/issues-store.test.ts` imports `IssuesStore` and uses `mkdtemp` / `rm` from `node:fs/promises` and `tmpdir` from `node:os` — all Node built-ins. No test-specific external packages are needed beyond the already-installed Vitest.

## Risks & Mitigations

**1. RCA prompt produces malformed body (missing section, wrong order, no Evidence citation)**

The SKILL.md step-5 prompt pins the exact three heading strings (`## Symptom`, `## Root Cause Analysis`, `### Evidence`, `## Candidate Solutions`) and mandates a `Tradeoff:` clause on every candidate. The phrase "write ONLY the following markdown body" plus the explicit section headers plus the `Tradeoff:` label are the three constraints that, together, stabilise schema compliance without a post-validator in the happy path. The fallback path in step 6 catches any exception or malformed output during RCA and writes a safe `> RCA skipped: <reason>` body instead, ensuring the issue is never left in an inconsistent state.

**2. Stdin hangs on an interactive TTY**

The `isTTY` guard in `readPipedStdin` returns `''` immediately when `process.stdin.isTTY` is truthy. No call to `text()` is made in that branch; the event loop is never blocked. This mirrors the guard already established by `askYesNo` at `helpers.ts:260` and tested by the same spawn-and-pipe Vitest pattern. A future caller who imports `readPipedStdin` without reading this file cannot accidentally omit the guard because the guard is baked into the helper, not delegated to the caller.

**3. Empty-pipe edge case (`echo "" | metta issue "<title>"`)**

A bare `echo ""` on Unix writes `"\n"` to the pipe — a single newline — which is non-empty on a raw byte comparison but semantically absent. The action handler in `issue.ts` uses `stdinPayload.trim() !== ''` as the gate, so `"\n"` and `"   \n"` both produce `false` and fall through to `description` as body. This matches the spec scenario for `echo -n '' | metta issue "<title>"` and the research finding that trimmed comparison is the only safe check.

**4. Legacy issue files break after upgrade**

`parseIssue` is pass-through: it anchors on `**Severity**:` and returns everything after it verbatim. None of the metadata predicates (`l.startsWith('**Captured**:')`, `l.startsWith('**Context**:')`, `l.startsWith('**Severity**:')`) match a `##` line. This property is explicitly verified by the third new test case in `src/issues/issues-store.test.ts` ("does not misattribute H2 lines as metadata fields"). The two existing `spec/issues/*.md` files contain freeform bodies and will parse unchanged. No file migration is required or permitted by the spec.

**5. `--quick` flag accidentally reaches the `metta issue` CLI**

`--quick` is a skill-side argument; the `metta issue` CLI does not declare it as an option and would throw an unrecognised-option error if it arrived. The SKILL.md Rules section includes an explicit rule: "Never forward `--quick` to the CLI." Step 1 of the skill strips `--quick` from `$ARGUMENTS` before any downstream use, including before the `AskUserQuestion` description prompt. The CLI-level guard (Commander.js `unknownOption` handling) provides a second safety net if the strip is accidentally omitted.

**6. RCA session runs unbounded and burns tokens**

The spec explicitly rules out hard time or tool-call bounds on RCA: "No timeout parameter, no maximum file-read count, no cap on git log depth. The AI decides when the debugging session is complete." The SKILL.md step-5 instruction says "stop when you have sufficient evidence" to give the AI clear stopping criteria. If token consumption becomes a practical concern in production, a follow-up backlog item can introduce a soft bound (e.g., a maximum file-read count instruction) without changing any code. For the current change, trusting AI judgment is the accepted posture per the intent's Out of Scope section.

**7. Fix-issues display silently no-ops on legacy issues**

Legacy issues have freeform bodies with no `## Symptom` section. The SKILL.md step-1 display instruction says "display whatever body is present; do not error when sections are missing." The orchestrator is not expected to parse or validate the body structure — it receives a `description` string from `metta issues show --json` and renders it verbatim. There is no code path that errors on missing sections; the instruction is purely additive to the existing confirm-and-proceed logic. US-6 acceptance criteria explicitly require that the fix flow "behaves identically to today's `/metta-fix-issues` on the same input" for legacy issues.
