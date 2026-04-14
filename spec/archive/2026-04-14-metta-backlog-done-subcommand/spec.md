# Spec: metta backlog done — Archive Shipped Backlog Items

**Change:** metta-backlog-done-subcommand  
**Date:** 2026-04-14  
**Status:** Draft

---

## Problem

Backlog items in `spec/backlog/` accumulate indefinitely. `metta backlog promote <slug>` creates a change from a backlog item but does not delete the source file — promotion is not delivery. When the resulting change ships, the backlog file remains in `spec/backlog/` with `**Status**: backlog`, permanently misrepresenting the project's outstanding work. There is no CLI subcommand to mark an item done, no `BacklogStore.archive()` method, and no `done` option in the `/metta-backlog` skill. Path-traversal slugs are also unguarded in existing `BacklogStore` methods.

---

## Proposal

Add `metta backlog done <slug> [--change <name>]` backed by `BacklogStore.archive()` and a hardened `BacklogStore.remove()`, extend the `/metta-backlog` skill with a `done` branch, and add `assertSafeSlug` guards to all `BacklogStore` methods.

---

## Out of Scope

- Auto-archiving on `metta ship` — linkage between a change and its source backlog item is not tracked in change state; explicit invocation is required.
- `metta backlog undone <slug>` — no reverse flow; manual `git mv` is sufficient.
- Listing or showing archived items — `metta backlog list` continues to scan only `spec/backlog/*.md`, excluding `spec/backlog/done/`. No `--done` flag.
- Modifying `promote` behavior — `metta backlog promote <slug>` continues to leave the backlog file in place.
- Bulk archiving — no `metta backlog done --all` flag; each item is marked done individually.
- Changing the active backlog file format — the `**Status**: backlog` line in active items is not updated. Archived copies retain the original status line and gain `**Shipped-in**` as an additive metadata line only.
- Retroactive processing of existing shipped backlog items.

---

## Requirements

### REQ-1: ADDED: backlog-done-cli

`metta backlog done <slug> [--change <name>]` MUST be registered in `src/cli/commands/backlog.ts` alongside the existing four subcommands (`list`, `show`, `add`, `promote`).

The command MUST execute the following steps in order:

1. Call `BacklogStore.exists(slug)`. If the item is not found, the command MUST print `Backlog item '<slug>' not found` to stderr and exit with code 4. It MUST NOT write any file to `spec/backlog/done/`.

2. Call `BacklogStore.archive(slug, changeName?)`. If `--change <name>` was supplied, `changeName` MUST be passed to `archive()` so that `**Shipped-in**: <name>` is appended to the archived content before writing.

3. Call `BacklogStore.remove(slug)` to delete `spec/backlog/<slug>.md`.

4. Stage both paths and commit. The command MUST run:
   - `git add spec/backlog spec/backlog/done`
   - `git commit -m "chore: archive shipped backlog item <slug>"`

   If git is unavailable or there is nothing to commit, the command MUST swallow the error silently and continue without failing.

5. On success, the command MUST print `Archived backlog item: <slug>` in human mode, or `{ "archived": "<slug>" }` when the global `--json` flag is set, then exit with code 0.

#### Scenario 1.1 — Archive without a change reference

**Given** `spec/backlog/add-metta-fix-issues-skill-that-works-like-metta-fix-gap.md` exists  
**When** the user runs `metta backlog done add-metta-fix-issues-skill-that-works-like-metta-fix-gap`  
**Then** the command copies the file content to `spec/backlog/done/add-metta-fix-issues-skill-that-works-like-metta-fix-gap.md`  
**And** deletes `spec/backlog/add-metta-fix-issues-skill-that-works-like-metta-fix-gap.md`  
**And** commits with message `chore: archive shipped backlog item add-metta-fix-issues-skill-that-works-like-metta-fix-gap`  
**And** prints `Archived backlog item: add-metta-fix-issues-skill-that-works-like-metta-fix-gap` to stdout  
**And** exits with code 0

#### Scenario 1.2 — Archive with `--change` stamps Shipped-in metadata

**Given** `spec/backlog/add-metta-fix-issues-skill-that-works-like-metta-fix-gap.md` exists  
**When** the user runs `metta backlog done add-metta-fix-issues-skill-that-works-like-metta-fix-gap --change metta-fix-issues-cli-command-m`  
**Then** the archived file at `spec/backlog/done/add-metta-fix-issues-skill-that-works-like-metta-fix-gap.md` contains the line `**Shipped-in**: metta-fix-issues-cli-command-m`  
**And** the original `spec/backlog/add-metta-fix-issues-skill-that-works-like-metta-fix-gap.md` no longer exists  
**And** the command exits with code 0

#### Scenario 1.3 — Unknown slug exits with code 4

**Given** no file exists at `spec/backlog/nonexistent-item.md`  
**When** the user runs `metta backlog done nonexistent-item`  
**Then** the command prints `Backlog item 'nonexistent-item' not found` to stderr  
**And** exits with code 4  
**And** does not write any file to `spec/backlog/done/`

#### Scenario 1.4 — `--json` output format

**Given** `spec/backlog/my-item.md` exists  
**When** the user runs `metta backlog done my-item --json`  
**Then** stdout contains a JSON object whose `archived` field equals `"my-item"` (additional observability fields such as `shipped_in`, `committed`, `commit_sha` MAY be present)  
**And** the command exits with code 0

#### Scenario 1.5 — Git unavailable — command still succeeds

**Given** `spec/backlog/my-item.md` exists  
**And** the `git` binary is not available in the environment  
**When** the user runs `metta backlog done my-item`  
**Then** the command archives and removes the file  
**And** swallows the git error silently  
**And** prints `Archived backlog item: my-item`  
**And** exits with code 0

---

### REQ-2: ADDED: backlog-store-archival

`BacklogStore` in `src/backlog/backlog-store.ts` MUST gain a new method `archive(slug: string, changeName?: string): Promise<void>` and the existing `remove(slug: string)` MUST be hardened with an `assertSafeSlug` guard.

#### `archive(slug, changeName?)`

The method MUST:

1. Call `assertSafeSlug(slug)` — using the regex `/^[a-z0-9][a-z0-9-]{0,59}$/` — before any filesystem access. If the slug does not match, throw `Error: Invalid backlog slug '<slug>' — must match /^[a-z0-9][a-z0-9-]{0,59}$/`.
2. Throw `Error: Backlog item '<slug>' not found` if the item does not exist on disk.
3. Read the raw file content via `this.state.readRaw(join('backlog', '<slug>.md'))`.
4. If `changeName` is provided, call `assertSafeSlug(changeName)` and append `\n**Shipped-in**: <changeName>` to the content before writing.
5. Create `spec/backlog/done/` with `mkdir({ recursive: true })`.
6. Write the (possibly extended) content to `spec/backlog/done/<slug>.md` via `this.state.writeRaw`.

#### `remove(slug)` — hardened

The existing `remove(slug)` MUST call `assertSafeSlug(slug)` at the top of its body before any filesystem operation. It currently has no guard; this is the only change to its behavior.

#### `assertSafeSlug`

A module-private function `assertSafeSlug(slug: string): void` MUST be added to `backlog-store.ts`. It MUST use the same regex (`/^[a-z0-9][a-z0-9-]{0,59}$/`) and the same throw pattern as `IssuesStore`'s `assertSafeSlug`, with the error message adapted to say `Invalid backlog slug` instead of `Invalid issue slug`.

#### Scenario 2.1 — `archive()` creates `done/` directory when absent

**Given** `spec/backlog/done/` does not exist on disk  
**And** `spec/backlog/first-ever-done-item.md` exists  
**When** `BacklogStore.archive('first-ever-done-item')` is called  
**Then** `spec/backlog/done/` is created with `mkdir({ recursive: true })`  
**And** `spec/backlog/done/first-ever-done-item.md` is written successfully

#### Scenario 2.2 — `archive()` with `changeName` stamps Shipped-in

**Given** `spec/backlog/some-item.md` exists with content `# Some Item\n\n**Status**: backlog\n`  
**When** `BacklogStore.archive('some-item', 'my-change')` is called  
**Then** `spec/backlog/done/some-item.md` contains the original content followed by the line `**Shipped-in**: my-change`

#### Scenario 2.3 — `archive()` throws for missing item

**Given** no file exists at `spec/backlog/ghost-item.md`  
**When** `BacklogStore.archive('ghost-item')` is called  
**Then** the method throws an error matching `Backlog item 'ghost-item' not found`  
**And** no file is written to `spec/backlog/done/`

#### Scenario 2.4 — `archive()` rejects path-traversal slug

**Given** a caller passes `../../../etc/passwd` as the slug argument  
**When** `BacklogStore.archive('../../../etc/passwd')` is called  
**Then** the method throws an error matching `Invalid backlog slug '../../../etc/passwd'`  
**And** no filesystem read or write is performed

#### Scenario 2.5 — `remove()` rejects path-traversal slug

**Given** `spec/backlog/some-item.md` exists  
**When** `BacklogStore.remove('../escape')` is called  
**Then** the method throws before deleting any file, due to the `assertSafeSlug` guard

---

### REQ-3: ADDED: backlog-done-skill

The `/metta-backlog` skill MUST gain a fifth option, `done`, in the `AskUserQuestion` action picker.

The skill template at `src/templates/skills/metta-backlog/SKILL.md` and the deployed copy at `.claude/skills/metta-backlog/SKILL.md` MUST be byte-identical after all edits.

The `done` branch MUST follow this behavior:

1. Run `metta backlog list --json` and parse `.backlog[].slug` from the output to build the list of available slugs.
2. Present the slugs to the user via `AskUserQuestion` (same picker pattern as `promote`).
3. Ask the user, via `AskUserQuestion`, for an optional change name to record as `--change <name>`. If the user skips, omit the flag.
4. Run `metta backlog done <slug>` (with `--change <name>` appended if the user provided one).
5. Echo the archived path printed by the CLI back to the user.

The skill MUST NOT invent slugs; it MUST use only the slugs emitted by `metta backlog list --json`.

#### Scenario 3.1 — Skill `done` branch — with change name

**Given** the user invokes `/metta-backlog` in a Claude session  
**And** selects `done` from the action picker  
**And** selects slug `add-metta-fix-issues-skill-that-works-like-metta-fix-gap` from the list  
**And** provides change name `metta-fix-issues-cli-command-m` when prompted  
**When** the skill dispatches  
**Then** it runs `metta backlog done add-metta-fix-issues-skill-that-works-like-metta-fix-gap --change metta-fix-issues-cli-command-m`  
**And** echoes the archived path back to the user

#### Scenario 3.2 — Skill `done` branch — change name skipped

**Given** the user invokes `/metta-backlog` and selects `done`  
**And** selects a slug from the list  
**And** skips the optional change name prompt  
**When** the skill dispatches  
**Then** it runs `metta backlog done <slug>` without the `--change` flag

#### Scenario 3.3 — Skill files are byte-identical

**Given** the `done` branch has been added to the skill  
**When** the byte content of `src/templates/skills/metta-backlog/SKILL.md` and `.claude/skills/metta-backlog/SKILL.md` is compared  
**Then** they are identical

---

### REQ-4: ADDED: path-traversal-guard

All `BacklogStore` methods that accept a slug — `add`, `list`, `show`, `promote` (if it reads by slug), `exists`, `remove`, `archive` — MUST reject any slug that does not match `/^[a-z0-9][a-z0-9-]{0,59}$/` by calling `assertSafeSlug(slug)` before any filesystem access.

This requirement formalizes the guard already required by REQ-2 for `archive` and `remove`, and extends it to cover `show` and `exists`, which currently call `this.state.readRaw` and `this.state.exists` directly without validation.

The `assertSafeSlug` guard MUST be the first statement in each method body that accepts an external slug argument.

#### Scenario 4.1 — `show()` rejects hostile slug

**Given** a caller passes `../../secret` as the slug argument  
**When** `BacklogStore.show('../../secret')` is called  
**Then** the method throws an error matching `Invalid backlog slug '../../secret'`  
**And** no filesystem read is performed

#### Scenario 4.2 — `exists()` rejects hostile slug

**Given** a caller passes `../etc/hosts` as the slug argument  
**When** `BacklogStore.exists('../etc/hosts')` is called  
**Then** the method throws an error matching `Invalid backlog slug '../etc/hosts'`  
**And** no filesystem access is performed

#### Scenario 4.3 — `archive()` rejects hostile `changeName`

**Given** slug `valid-item` is safe  
**And** `changeName` is `../../hostile`  
**When** `BacklogStore.archive('valid-item', '../../hostile')` is called  
**Then** the method throws an error matching `Invalid backlog slug '../../hostile'`  
**And** no file is written to `spec/backlog/done/`

---

## Impact

**CLI surface:** One new subcommand (`metta backlog done`) added to an existing command group. No existing subcommands change behavior.

**BacklogStore:** `archive()` method added. `assertSafeSlug` guard added to `remove()`, `show()`, and `exists()`. Archived files gain one optional metadata line (`**Shipped-in**: <change>`); active backlog files are unchanged.

**Skill:** The `/metta-backlog` skill body gains one branch. The byte-identical constraint between template and deployed copy is maintained.

**Tests:** Approximately 8 new test cases across three test files — 5 unit tests in `src/backlog/backlog-store.test.ts`, 2 CLI integration tests in `src/cli/commands/backlog.test.ts`, and 1 static-content check in `src/templates/skills/metta-backlog/SKILL.test.ts`.

**Git history:** Each `metta backlog done` invocation produces `chore: archive shipped backlog item <slug>`, mirroring `fix-issue --remove-issue`'s `fix(issues): remove resolved issue <slug>`.
