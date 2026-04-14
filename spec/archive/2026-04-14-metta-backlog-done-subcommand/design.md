# Design: metta backlog done — Archive Shipped Backlog Items

**Change:** metta-backlog-done-subcommand
**Date:** 2026-04-14
**Status:** Draft

---

## Approach

This change mirrors the established `fix-issue --remove-issue` pattern onto the backlog lifecycle. The pattern is: guard the slug, check existence, archive (copy + optional metadata append), remove (delete source), commit, report. No novel architectural decisions are required.

The three deltas from the issues-side implementation are:

1. `BacklogStore.archive()` accepts an optional `changeName` and appends `**Shipped-in**: <changeName>` to the archived content before writing — issues-side archive is verbatim copy only.
2. `BacklogStore` currently has no `assertSafeSlug` guard at all (unlike `IssuesStore`). Guards are added to `show()`, `exists()`, `remove()`, and the new `archive()` — covering all methods that accept an external slug (REQ-4).
3. The `/metta-backlog` skill gains a fifth branch (`done`) with an optional second prompt for `changeName`.

The implementation keeps all I/O at the CLI boundary (imperative shell) and all pure logic in the store (functional core), consistent with project conventions.

---

## Components

### `src/backlog/backlog-store.ts`

**New module-level symbols:**

- `SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/` — identical to `issues-store.ts`. Kept local; no shared util module is introduced (would be new scope per research Decision 1).
- `assertSafeSlug(slug: string): void` — throws `Error: Invalid backlog slug '<slug>' — must match /^[a-z0-9][a-z0-9-]{0,59}$/` if slug does not match. First statement in every method body accepting an external slug.

**New method — `archive(slug: string, changeName?: string): Promise<void>`:**

1. `assertSafeSlug(slug)`
2. Throw `Error: Backlog item '<slug>' not found` if source file absent.
3. `readRaw(join('backlog', '<slug>.md'))` — raw markdown string.
4. If `changeName` is provided: `assertSafeSlug(changeName)`, then append `\n**Shipped-in**: ${changeName}\n` (trim trailing newlines from content first, then append one clean newline before the metadata line).
5. `mkdir(join(this.specDir, 'backlog', 'done'), { recursive: true })` — idempotent.
6. `writeRaw(join('backlog', 'done', '<slug>.md'), content)`.

**Modified methods (guard additions only, no signature changes):**

- `show(slug)` — add `assertSafeSlug(slug)` as first statement.
- `exists(slug)` — add `assertSafeSlug(slug)` as first statement.
- `remove(slug)` — add `assertSafeSlug(slug)` as first statement.

Note: `add()` derives its slug internally via `slugify()` and accepts a title string, not an external slug — no guard needed there. `list()` accepts no slug argument.

### `src/cli/commands/backlog.ts`

New subcommand registered after `promote`:

```
backlog done <slug> [--change <name>]
```

Action handler flow:

1. Read `--change` option into `changeName?: string`.
2. If `changeName` is provided, validate it against `SLUG_RE` inline (per research Decision 6: guard lives in CLI handler, not in `BacklogStore.archive`). On failure: print `Invalid change name '<changeName>' — must be a slug (lowercase letters, digits, hyphens, max 60 chars)` to stderr, `process.exit(4)`.
3. `await ctx.backlogStore.exists(slug)` — if false, print `Backlog item '<slug>' not found` to stderr, `process.exit(4)`.
4. `await ctx.backlogStore.archive(slug, changeName)`.
5. `await ctx.backlogStore.remove(slug)`.
6. Git commit (graceful-skip pattern identical to `fix-issue --remove-issue`):
   ```
   git add spec/backlog spec/backlog/done
   git commit -m "chore: archive shipped backlog item <slug>"
   ```
   Errors swallowed silently.
7. Output:
   - Human: `Archived backlog item: <slug>`
   - JSON (`--json`): `{ "archived": "<slug>", "shipped_in": <changeName | null>, "committed": <bool>, "commit_sha"?: <string> }`

The `autoCommitFile` helper from `src/cli/helpers.ts` is not used here because two paths must be staged (`spec/backlog` and `spec/backlog/done`) rather than a single file. The `execFile` pattern from `fix-issue.ts` is used directly, matching the precedent.

### `src/templates/skills/metta-backlog/SKILL.md` and `.claude/skills/metta-backlog/SKILL.md`

Both files must be byte-identical after the edit (REQ-3, Scenario 3.3). Changes:

- Step 1 `AskUserQuestion` options extend from `list | show | add | promote` to `list | show | add | promote | done`.
- New `done` branch added to Step 2 dispatch table:
  - Run `metta backlog list --json`, parse `.backlog[].slug` for the picker (mirrors `promote` branch).
  - `AskUserQuestion` to select a slug.
  - `AskUserQuestion` for optional `changeName` (free-form, may be blank; if blank, omit `--change`).
  - Run `metta backlog done <slug>` or `metta backlog done <slug> --change <changeName>`.
  - Echo the archived path printed by the CLI.

---

## Data Model

No schema changes. No Zod changes. No new YAML files.

The only data format change is an optional additive metadata line in archived backlog files:

```markdown
**Shipped-in**: <changeName>
```

This line appears only in `spec/backlog/done/<slug>.md`. Active backlog files in `spec/backlog/` are never modified by this command.

The `spec/backlog/done/` directory is created on first use via `mkdir({ recursive: true })`. It is not pre-initialized or tracked beyond its contents.

---

## API Design

### CLI

```
metta backlog done <slug> [--change <name>]
```

| Exit code | Meaning |
|-----------|---------|
| 0 | Archive and removal succeeded |
| 4 | Slug not found, hostile slug, or hostile changeName |

Human output (exit 0):
```
Archived backlog item: <slug>
```

JSON output (`--json`, exit 0):
```json
{ "archived": "<slug>", "shipped_in": "<changeName or null>", "committed": true, "commit_sha": "abc1234" }
```

Error output (exit 4, stderr):
```
Backlog item '<slug>' not found
```
or
```
Invalid change name '<name>' — must be a slug (lowercase letters, digits, hyphens, max 60 chars)
```

### BacklogStore public API additions

```typescript
archive(slug: string, changeName?: string): Promise<void>
```

Throws on: invalid slug, invalid changeName, missing source file.

`show()`, `exists()`, `remove()` signatures unchanged; behavior unchanged for valid slugs.

---

## Dependencies

No new runtime dependencies. All building blocks already exist:

| Need | Source |
|------|--------|
| `execFile` for git | `node:child_process` (already used in `fix-issue.ts`) |
| `mkdir` for `done/` dir | `node:fs/promises` (already imported in `backlog-store.ts`) |
| `readRaw` / `writeRaw` / `delete` / `exists` | `StateStore` (already used in `backlog-store.ts`) |
| `createCliContext`, `outputJson` | `src/cli/helpers.ts` (already used in `backlog.ts`) |
| `SLUG_RE` / `assertSafeSlug` pattern | Copied verbatim from `issues-store.ts`; no shared util |

The decision to not extract `assertSafeSlug` into a shared utility is intentional: the function is four lines, a shared module would be new scope, and both copies are held in sync by the test suite (path-traversal tests on both stores).

---

## Risks and Mitigations

### Risk 1: Existing BacklogStore tests pass hostile slugs as fixtures

Adding `assertSafeSlug` to `show()`, `exists()`, and `remove()` will cause any existing test that calls those methods with a path-traversal or non-slug string to throw unexpectedly.

**Mitigation:** Audit `tests/backlog-store.test.ts` before implementing. Update any fixture that uses a non-slug string as a slug argument to use a valid slug. The change is isolated to test fixtures; the production behavior change (throwing on hostile input) is the intended outcome.

### Risk 2: Skill byte-identity constraint is fragile

The two skill files (`src/templates/skills/metta-backlog/SKILL.md` and `.claude/skills/metta-backlog/SKILL.md`) must remain byte-identical. A manual edit to one without the other breaks REQ-3.

**Mitigation:** The static-content test (Scenario 3.3) detects drift as soon as it is introduced. The build step that copies templates to `dist/` does not write to `.claude/`, so the deployed copy requires an explicit second edit — the process is documented in the implementation plan.

### Risk 3: `changeName` validation is in CLI, not in store

Research Decision 6 places the `changeName` guard in the CLI handler. A caller who constructs a `BacklogStore` directly and passes a hostile `changeName` to `archive()` will have the store-level `assertSafeSlug(changeName)` guard as the last line of defense.

**Mitigation:** `BacklogStore.archive()` calls `assertSafeSlug(changeName)` when `changeName` is provided (REQ-2, REQ-4). Defense is in depth: CLI validates first, store validates second.

### Risk 4: `spec/backlog/done/` is not in `.gitignore` or any glob exclusion

If `metta backlog list` reads `spec/backlog/*.md` using `readdir` without filtering subdirectories, future entries in `spec/backlog/done/` could appear in the active list.

**Mitigation:** The existing `list()` implementation calls `readdir(backlogDir)` (non-recursive) and filters to entries ending in `.md`. Subdirectory entries returned by `readdir` are directory names without `.md` extensions, so `done/` is already excluded. No code change needed; this is verified by the existing list tests.

### Risk 5: Git commit message format diverges from project convention

The spec prescribes `chore: archive shipped backlog item <slug>`. The `fix-issue` command uses `fix(issues): remove resolved issue <slug>` (scope-qualified). Inconsistency is minor but visible in git log.

**Mitigation:** Acceptable. `chore:` is a valid conventional commit type. Scope could be added (`chore(backlog): archive shipped backlog item <slug>`) without breaking anything; the research implementation plan shows that form as well. Either is acceptable — the design adopts `chore: archive shipped backlog item <slug>` matching the spec exactly.

---

## Test Strategy

Each of the 13 spec scenarios maps to one or more tests. Tests are distributed across three files.

### `tests/backlog-store.test.ts` — unit tests

| Scenario | Test description |
|----------|-----------------|
| REQ-2 / Scenario 2.1 | `archive()` creates `spec/backlog/done/` when absent and writes the file |
| REQ-2 / Scenario 2.2 | `archive('some-item', 'my-change')` appends `**Shipped-in**: my-change` to archived content |
| REQ-2 / Scenario 2.3 | `archive('ghost-item')` throws matching `Backlog item 'ghost-item' not found`; no file written |
| REQ-2 / Scenario 2.4 | `archive('../../../etc/passwd')` throws matching `Invalid backlog slug '../../../etc/passwd'`; no FS access |
| REQ-2 / Scenario 2.5 | `remove('../escape')` throws before any delete |
| REQ-4 / Scenario 4.1 | `show('../../secret')` throws matching `Invalid backlog slug '../../secret'` |
| REQ-4 / Scenario 4.2 | `exists('../etc/hosts')` throws matching `Invalid backlog slug '../etc/hosts'` |
| REQ-4 / Scenario 4.3 | `archive('valid-item', '../../hostile')` throws matching `Invalid backlog slug '../../hostile'`; no write |

Six hostile inputs to exercise (per task brief): `../../../etc/passwd`, `../escape`, `../../secret`, `../etc/hosts`, `../../hostile`, and at least one with embedded null or shell metachar (e.g. `item;rm -rf`).

### `tests/cli.test.ts` (or `tests/backlog.test.ts`) — CLI integration tests

| Scenario | Test description |
|----------|-----------------|
| REQ-1 / Scenario 1.1 | `metta backlog done <slug>` exits 0; archived file exists at `done/<slug>.md`; original deleted |
| REQ-1 / Scenario 1.2 | `metta backlog done <slug> --change my-change` exits 0; archived file contains `**Shipped-in**: my-change` |
| REQ-1 / Scenario 1.3 | `metta backlog done nonexistent-item` exits 4; stderr matches `not found`; nothing written to `done/` |
| REQ-1 / Scenario 1.4 | `metta backlog done my-item --json` exits 0; stdout is valid JSON with `"archived": "my-item"` |
| REQ-1 / Scenario 1.5 | Git unavailable (PATH override): exits 0; file is archived and removed |
| REQ-4 (CLI guard) | `metta backlog done valid-item --change ../../hostile` exits 4; stderr matches invalid change name message |
| Git commit message | Happy-path run: commit message matches `chore: archive shipped backlog item <slug>` |

### `tests/skills/metta-backlog.test.ts` (or static content check in `tests/cli.test.ts`)

| Scenario | Test description |
|----------|-----------------|
| REQ-3 / Scenario 3.3 | `src/templates/skills/metta-backlog/SKILL.md` and `.claude/skills/metta-backlog/SKILL.md` have identical byte content |
| REQ-3 / Scenario 3.1–3.2 (structural) | Both skill files contain the string `done`; both contain `metta backlog done`; both contain `--change` |

Scenarios 3.1 and 3.2 (runtime skill behavior) are covered by static content assertions — the skill executes in a Claude session and cannot be integration-tested in the Vitest suite. The static assertions confirm the branch text is present and correctly formed.

---

## ADR-1: No Shared `assertSafeSlug` Utility

**Decision:** Duplicate `SLUG_RE` and `assertSafeSlug` in `backlog-store.ts` verbatim from `issues-store.ts` rather than extracting to a shared utility.

**Rationale:** A shared `src/utils/slug.ts` module would require a new file, new exports, and updates to imports in both stores. The function is four lines. The duplication is bounded and detected by path-traversal tests on both stores. Introducing a shared utility is new scope for this change.

**Constraint:** If a third store needs slug validation, extract then. Not now.

---

## ADR-2: `changeName` Guard in CLI Handler, Store as Defense-in-Depth

**Decision:** The CLI handler validates `changeName` against `SLUG_RE` before calling `BacklogStore.archive()`. The store also calls `assertSafeSlug(changeName)` as a second guard.

**Rationale:** Research Decision 6 recommends guard-in-CLI for consistency with how the issues CLI validates before calling the store. The store guard is retained as defense-in-depth for programmatic callers who bypass the CLI. This matches the pattern used for `slug` itself: CLI checks `exists()` before calling `archive()`, and `archive()` also checks existence internally before reading.

---

## ADR-3: Direct `execFile` for Multi-Path Git Stage, Not `autoCommitFile`

**Decision:** Use `execFile` directly (as `fix-issue.ts` does) rather than the `autoCommitFile` helper from `src/cli/helpers.ts`.

**Rationale:** `autoCommitFile` accepts a single file path and stages that one file. The `done` subcommand must stage two paths: `spec/backlog` (the deleted source) and `spec/backlog/done` (the new archive). Forcing this through `autoCommitFile` would require calling it twice with separate commits or modifying its signature — both are worse than the three-line `execFile` pattern already established in `fix-issue.ts`.
