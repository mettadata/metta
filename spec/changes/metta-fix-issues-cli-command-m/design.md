# Design: metta-fix-issues-cli-command-m

## Approach

Mirror `src/cli/commands/fix-gap.ts` (191 lines) structurally, applying the six concrete
deltas identified in research: (1) replace the severity enum with `critical | major | minor`
and the weight map `{ critical: 0, major: 1, minor: 2 }`; (2) eliminate the raw-file
re-read in the `--all` branch because `IssuesStore.list()` already returns `severity`
directly (research §1); (3) archive to `spec/issues/resolved/<slug>.md` with no date
prefix instead of `spec/archive/<date>-<slug>-gap-resolved.md` (research §2); (4) add
`archive(slug): Promise<void>` and `remove(slug): Promise<void>` to `IssuesStore` with
explicit existence guards and idempotency on the resolved copy (research §3); (5) stage
`spec/issues` and `spec/issues/resolved` and commit with message
`fix(issues): remove resolved issue <slug>` (research §5–6); (6) print issue display
fields `title`, `severity`, `status`, `description` (and `captured`/`context` when
present) rather than the gap-specific field set (research, "Additional Difference").
The skill template is a near-copy of `metta-fix-gap/SKILL.md` with targeted token
substitutions listed in research §4. No new external dependencies are introduced; the
severity types stay domain-local and are never unified.

---

## Components

### `src/cli/commands/fix-issue.ts` (new file)

```ts
export type IssueSeverity = 'critical' | 'major' | 'minor'

const severityWeight: Record<IssueSeverity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
}

export function sortBySeverityForIssues<T extends { severity: IssueSeverity }>(
  issues: T[],
): T[]

export function registerFixIssueCommand(program: Command): void
```

`IssueSeverity` is a local type alias — it does not re-export from `fix-gap.ts` or
reference `fix-gap.ts`'s `Severity` type. The two enums remain domain-local per
research decision 1 and spec requirement `fix-issue-cli-command`.

`sortBySeverityForIssues` sorts ascending by `severityWeight`, returning a new array
(spread copy, same pattern as `fix-gap.ts:25`).

`registerFixIssueCommand` registers `fix-issue [issue-slug]` on `program` with options
`--all`, `--severity <level>`, and `--remove-issue <slug>`. The action handler has four
branches evaluated in priority order:

**Branch 1 — `--remove-issue <slug>`:**
Calls `ctx.issuesStore.exists(slug)`; if false, emits error (JSON or stderr) and exits
with code 4. On success: calls `ctx.issuesStore.archive(slug)`, then
`ctx.issuesStore.remove(slug)`. Runs `git add spec/issues spec/issues/resolved` then
`git commit -m "fix(issues): remove resolved issue <slug>"` inside a try/catch (silent
on git absence). Emits `{ removed: slug }` (JSON) or `Removed issue: <slug>` (prose).
Exits 0.

**Branch 2 — single `[issue-slug]`:**
Calls `ctx.issuesStore.exists(slug)`; exits 4 on not-found. On success: calls
`ctx.issuesStore.show(slug)` and prints `title`, `severity`, `status`, `description`,
plus `captured` and `context` when present. Prints delegate hint:
`metta execute --skill fix-issues --target <slug>`. JSON shape: `{ issue: { slug, ...Issue } }`.

**Branch 3 — `--all` (optionally `--severity <level>`):**
Calls `ctx.issuesStore.list()` — no raw-file re-read needed because `list()` returns
`severity` in each item (see `issues-store.ts:78`). Sorts with
`sortBySeverityForIssues`. Filters by `options.severity` when provided. Formats each
line as `  [SEVERITY ] [STATUS] <slug padded> <title>` (matching `fix-gap.ts:159`
column layout). JSON shape: `{ issues: filtered, severity_filter: string | null }`.
Empty result with filter: exits 0 with `{ issues: [], severity_filter: "..." }`.

**Branch 4 — no args:**
Prints usage block referencing `/metta-fix-issues` skill for interactive selection.
JSON shape: `{ usage: "metta fix-issue ...", commands: { ... } }`. Exits 0.

All branches read `const json = program.opts().json` at the top of the action handler,
matching `fix-gap.ts:38`.

---

### `src/issues/issues-store.ts` — additions to `IssuesStore`

Two new methods appended after the existing `exists` method (line 104):

```ts
async archive(slug: string): Promise<void>
async remove(slug: string): Promise<void>
```

**`archive(slug)` behavior:**
1. Calls `this.exists(slug)`; throws `new Error(\`Issue '\${slug}' not found\`)` if false.
   This is an explicit guard absent in `GapsStore.archive` (`gaps-store.ts:142`).
2. Reads content via `this.state.readRaw(join('issues', \`\${slug}.md\`))`.
3. Calls `mkdir(join(this.specDir, 'issues', 'resolved'), { recursive: true })`.
   The `resolved/` directory already exists in the repo
   (`spec/issues/resolved/tasks-in-tasks-md-arent-getting-checked-off-...md`), so
   `recursive: true` ensures idempotent directory creation.
4. Writes content to `this.state.writeRaw(join('issues', 'resolved', \`\${slug}.md\`), content)`.
   `writeRaw` overwrites without error, satisfying the idempotency requirement (spec
   `issues-store-archival`, scenario "archive is idempotent when resolved copy already exists").
5. Returns `Promise<void>`. Does NOT return the archive path (contrast:
   `GapsStore.archive` returns `Promise<string>` at `gaps-store.ts:142`).

**`remove(slug)` behavior:**
1. Calls `this.state.delete(join('issues', \`\${slug}.md\`))`.
2. `state.delete` uses `unlink` under the hood, which throws `ENOENT` if the file is
   absent. This surfaces as a thrown error, consistent with the spec requirement that
   `remove` MUST throw if the file is absent.
3. Does NOT verify presence of the resolved copy (spec explicitly states callers are
   expected to call `archive` first).

The `mkdir` import is already present on line 1 of `issues-store.ts`. The `unlink`
import from `node:fs/promises` is not directly used by `IssuesStore` — `remove` delegates
to `this.state.delete`, which already calls `unlink` internally (`gaps-store.ts:135`
follows the same pattern). No new imports are needed.

---

### `src/cli/index.ts` — registration

Add one import after the existing `registerFixGapCommand` import (line 34):

```ts
import { registerFixIssueCommand } from './commands/fix-issue.js'
```

Add one registration call after `registerFixGapCommand(program)` (line 79):

```ts
registerFixGapCommand(program)
registerFixIssueCommand(program)
```

Placing `fix-issue` immediately adjacent to `fix-gap` keeps related commands visually
grouped in both the source and the `--help` output.

---

### `src/templates/skills/metta-fix-issues/SKILL.md` (new file)

YAML frontmatter:

```yaml
---
name: metta:fix-issues
description: Resolve an issue through the full metta change lifecycle
argument-hint: "<issue-slug or --all>"
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]
---
```

Body is a near-copy of `.claude/skills/metta-fix-gap/SKILL.md` with the substitutions
from research §4 applied:

| From | To |
|------|----|
| `metta:fix-gap` | `metta:fix-issues` |
| `fix-gap` (command) | `fix-issue` |
| `fix-gap` (skill name) | `fix-issues` |
| `gap` / `gaps` | `issue` / `issues` |
| `metta gaps list` | `metta issues list` |
| `metta gaps show` | `metta issue show` |
| `--remove-gap` | `--remove-issue` |
| `fix(gaps): remove resolved gap` | `fix(issues): remove resolved issue` |
| `spec/archive/` | `spec/issues/resolved/` |
| `/metta-fix-gap` (interactive hint) | `/metta-fix-issues` |
| `"fix gap: <slug> — <summary>"` | `"fix issue: <slug> — <title>"` |

The pipeline structure (propose → plan → execute → review → verify → finalize → merge →
remove-issue) is structurally identical to the fix-gap skill. The Remove step changes to:
`metta fix-issue --remove-issue <slug>`.

All four CLI invocation modes must appear in the skill body (spec requirement
`skill-template`, scenarios 3): no-argument interactive mode, single-slug pipeline,
`--all` batch mode, and `--remove-issue` removal.

---

### `.claude/skills/metta-fix-issues/SKILL.md` (new file)

Byte-identical copy of `src/templates/skills/metta-fix-issues/SKILL.md`. The build
process (or `metta install`) copies template skills to the `.claude/skills/` tree. The
executor MUST create both files with identical content; the test suite asserts byte
identity.

---

## Data Model

All `--json` output shapes mirror the gap command equivalents with `gap`/`gaps` keys
replaced by `issue`/`issues`.

**Branch 1 — `--remove-issue` success:**
```json
{ "removed": "stale-issue" }
```

**Branch 1 — `--remove-issue` not-found error:**
```json
{ "error": { "code": 4, "type": "not_found", "message": "Issue 'stale-issue' not found" } }
```

**Branch 1 — `--remove-issue` runtime error:**
```json
{ "error": { "code": 4, "type": "remove_error", "message": "Failed to remove issue 'stale-issue'" } }
```

**Branch 2 — single slug success:**
```json
{
  "issue": {
    "slug": "spec-merger-strips-inline-backticks",
    "title": "...",
    "captured": "2026-04-06",
    "context": "...",
    "status": "logged",
    "severity": "major",
    "description": "..."
  }
}
```
`context` is omitted when absent on the `Issue` object.

**Branch 2 — slug not found:**
```json
{ "error": { "code": 4, "type": "not_found", "message": "Issue 'no-such-issue' not found" } }
```

**Branch 2 — show error:**
```json
{ "error": { "code": 4, "type": "show_error", "message": "Failed to show issue 'no-such-issue'" } }
```

**Branch 3 — `--all` success:**
```json
{
  "issues": [
    { "slug": "...", "title": "...", "severity": "critical" },
    { "slug": "...", "title": "...", "severity": "major" }
  ],
  "severity_filter": null
}
```
`severity_filter` is a string when `--severity` was provided, `null` otherwise.
Note: `IssuesStore.list()` returns `{ slug, title, severity }` items — no `status`
field in the list shape. This matches the type returned by `issues-store.ts:78`.

**Branch 3 — `--all` with filter, empty result:**
```json
{ "issues": [], "severity_filter": "critical" }
```

**Branch 3 — list error:**
```json
{ "error": { "code": 4, "type": "list_error", "message": "Failed to list issues" } }
```

**Branch 4 — no args:**
```json
{
  "usage": "metta fix-issue [issue-slug] [--all] [--remove-issue <slug>]",
  "commands": {
    "fix-issue <slug>": "Show issue details and delegate to skill",
    "fix-issue --all": "List all issues sorted by severity",
    "fix-issue --remove-issue <slug>": "Remove a resolved issue"
  }
}
```

---

## API Design

```
metta fix-issue [issue-slug] [--all] [--severity <level>] [--remove-issue <slug>]
```

**Options:**

| Flag | Values | Description |
|------|--------|-------------|
| `[issue-slug]` | string | Show single issue details + delegate hint |
| `--all` | — | List all open issues sorted by severity |
| `--severity <level>` | `critical \| major \| minor` | Filter `--all` output to one tier |
| `--remove-issue <slug>` | string | Archive then delete the named issue |
| `--json` | — | (global) Emit JSON instead of prose |

**Exit codes:**

| Code | Condition |
|------|-----------|
| 0 | All success paths; no-args usage print; empty `--all` result |
| 4 | Slug not found (branches 1 and 2); `IssuesStore.archive`/`remove` throws; list error |

Exit code 4 matches `fix-gap.ts` exactly (lines 51, 73, 84, 109, 168).

**Human stdout contracts per mode:**

- No args: `Usage: metta fix-issue [issue-slug] [--all] [--remove-issue <slug>]` plus
  reference to `/metta-fix-issues` skill.
- Single slug: heading `# Issue: <title>`, then `Severity: <level>`, `Status: <status>`,
  optional `Captured: <date>`, optional `Context: <text>`, blank line, description,
  blank line, `Delegate to skill: metta execute --skill fix-issues --target <slug>`.
- `--all`: one line per issue formatted as
  `  [SEVERITY ] [STATUS] <slug padded to 30>  <title>` where STATUS is `logged`
  (the only value in the `Issue` interface — `issues-store.ts:12`).
- `--remove-issue`: `Removed issue: <slug>`.

---

## Dependencies

Internal only:

- `IssuesStore` from `src/issues/issues-store.js` — the only store interaction.
- `execFile` / `promisify` from Node built-ins — git commit, matching `fix-gap.ts:2-3`.
- `join` from `node:path` — path construction.
- `createCliContext`, `outputJson` from `../helpers.js` — matching `fix-gap.ts:6`.
- `Command` from `commander` — command registration.

No new npm dependencies. No Zod schema changes. No `StateStore` API changes.

The `StateStore.delete` method used by `IssuesStore.remove` is already exercised by
`GapsStore.remove` (`gaps-store.ts:134-136`); no new paths through `StateStore` are opened.

---

## Risks & Mitigations

**Severity enum confusion across domains.**
The gaps domain uses `critical | medium | low`; the issues domain uses
`critical | major | minor`. Sharing or unifying these types would create implicit
coupling between unrelated domains and risk breaking `fix-gap`'s filter logic if the
shared type is ever changed. Mitigation: `IssueSeverity` is declared locally in
`fix-issue.ts` and never imported by or exported to `fix-gap.ts`. The types share the
string `"critical"` but are structurally independent. `sortBySeverityForIssues` is a
distinct function — not a re-export of `sortBySeverity` from `fix-gap.ts`. Research
decision 1 and spec requirement `fix-issue-cli-command` both mandate this separation.

**`spec/issues/resolved/` already contains a pre-existing entry.**
`spec/issues/resolved/tasks-in-tasks-md-arent-getting-checked-off-as-they-are-buil.md`
exists from the `archive-resolved-task-checkbox` change (confirmed by directory listing).
`IssuesStore.archive` must tolerate this: it uses `mkdir({ recursive: true })` and
`writeRaw` (which overwrites), satisfying the idempotency requirement in spec scenario
"archive is idempotent when resolved copy already exists". No migration or cleanup of
this existing file is needed.

**`--remove-issue` flag name feels redundant within a command already named `fix-issue`.**
A user might expect `--remove` alone. However, matching the `fix-gap` pattern
(`--remove-gap`) provides consistency and makes both commands learnable together.
Mitigation: accept the redundancy; document in help text. The spec names the flag
`--remove-issue <slug>` explicitly.

**`IssuesStore.list()` does not return `status`.**
The `--all` branch formats lines with `[STATUS]`. `IssuesStore.list()` returns
`{ slug, title, severity }` — no `status` field (`issues-store.ts:78`). The `Issue`
interface has `status: 'logged'` as a literal type (`issues-store.ts:12`), meaning all
issues are always `logged`. Mitigation: the `--all` branch hardcodes `'logged'` as the
status label in the format string, or calls `issue.status ?? 'logged'`. This is not a
divergence from spec; it is a concrete simplification. If `IssuesStore.list()` is
later extended to return `status`, the format string picks it up automatically if the
implementation uses the returned field.

**Git operations silently swallowed.**
`fix-gap.ts:58-60` wraps git calls in a bare `catch {}`. This is intentional for
environments without git or with nothing to commit, but it means a real git failure
(e.g., merge conflict, locked index) is invisible to the user. Mitigation: inherit
the same behavior as `fix-gap` for consistency; a future change can add logging to
stderr in the catch block if users report confusion. This is an existing risk in
fix-gap, not introduced by this change.

---

## Test Strategy

### `tests/issues-store.test.ts` (new file)

Covers spec requirement `issues-store-archival` and its four scenarios directly.

**TC-IS-01** (scenario: "archive moves content to resolved directory")
Setup: write `spec/issues/some-issue.md` with content `# Some Issue\n` using a temp
specDir. Call `store.archive('some-issue')`. Assert: `spec/issues/resolved/some-issue.md`
exists with identical content; `spec/issues/some-issue.md` is unchanged.

**TC-IS-02** (scenario: "archive on missing slug throws")
Setup: empty specDir, no `some-issue.md`. Call `store.archive('missing-slug')`. Assert:
thrown error message contains `missing-slug`; `spec/issues/resolved/missing-slug.md`
does not exist.

**TC-IS-03** (scenario: "archive is idempotent when resolved copy already exists")
Setup: write `spec/issues/dup-issue.md`; pre-create `spec/issues/resolved/dup-issue.md`
with stale content. Call `store.archive('dup-issue')`. Assert: resolves without error;
resolved file content equals current `spec/issues/dup-issue.md` content.

**TC-IS-04** (scenario: "remove deletes the open issue file")
Setup: write `spec/issues/done-issue.md`. Call `store.remove('done-issue')`. Assert:
`spec/issues/done-issue.md` does not exist.

**TC-IS-05** (not a named scenario but implied by spec: "remove throws when file absent")
Setup: empty specDir. Call `store.remove('ghost-issue')`. Assert: throws with ENOENT
or equivalent.

### `tests/cli.test.ts` — new cases (appended to existing file)

Covers spec requirement `fix-issue-cli-command` scenarios and `cli-registration`
scenarios.

**TC-CLI-01** (scenario: "no-args prints usage")
Invoke `fix-issue` with no arguments. Assert: stdout contains
`Usage: metta fix-issue` and `/metta-fix-issues`; exit code 0.

**TC-CLI-02** (scenario: "single-slug prints details and delegate hint")
Seed a temp issuesStore with slug `spec-merger-strips-inline-backticks`. Invoke
`fix-issue spec-merger-strips-inline-backticks`. Assert: stdout includes title,
severity, status, and the string
`metta execute --skill fix-issues --target spec-merger-strips-inline-backticks`.

**TC-CLI-03** (scenario: "single-slug not found exits non-zero")
No issue seeded. Invoke `fix-issue no-such-issue`. Assert: stderr contains
`no-such-issue`; exit code 4.

**TC-CLI-04** (scenario: "--all lists issues sorted severity-first")
Seed three issues with severities `minor`, `critical`, `major` (inserted out of order).
Invoke `fix-issue --all`. Assert: critical line appears before major line, major before
minor; each line tagged with its severity in brackets.

**TC-CLI-05** (scenario: "--all --severity filters to matching tier")
Same three-issue fixture. Invoke `fix-issue --all --severity critical`. Assert: stdout
contains the critical issue slug; does not contain the major or minor slugs.

**TC-CLI-06** (scenario: "--remove-issue archives and commits")
Seed `stale-issue` in a temp specDir. Invoke
`fix-issue --remove-issue stale-issue`. Assert: `spec/issues/resolved/stale-issue.md`
exists; `spec/issues/stale-issue.md` absent; git log contains a commit with message
`fix(issues): remove resolved issue stale-issue`.

**TC-CLI-07** (scenario: "command appears in --help output")
Invoke `metta --help`. Assert: stdout includes `fix-issue` with a short description.

**TC-CLI-08** (scenario: "registerFixIssueCommand is called in index.ts" — static)
Read `src/cli/index.ts`. Assert: contains `registerFixIssueCommand(program)` and
the import references `./commands/fix-issue.js`.

### `tests/cli.test.ts` — skill template cases

**TC-SKILL-01** (scenario: "template file exists with correct frontmatter name")
Read `src/templates/skills/metta-fix-issues/SKILL.md`. Assert: YAML frontmatter
contains `name: metta:fix-issues`.

**TC-SKILL-02** (scenario: "deployed skill is byte-identical to template")
Read both `src/templates/skills/metta-fix-issues/SKILL.md` and
`.claude/skills/metta-fix-issues/SKILL.md`. Assert: contents are byte-identical.

**TC-SKILL-03** (scenario: "skill body references all four CLI invocation modes")
Read `src/templates/skills/metta-fix-issues/SKILL.md`. Assert: text contains
`fix-issue <` (or similar slug reference), `fix-issue --all`, `fix-issue --remove-issue`,
and `/metta-fix-issues` (interactive mode hint).
