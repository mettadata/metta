# Intent: metta backlog done — Archive Shipped Backlog Items

**Change:** metta-backlog-done-subcommand  
**Date:** 2026-04-14  
**Status:** Draft

---

## Problem

Backlog items in `spec/backlog/` accumulate indefinitely. `metta backlog promote <slug>` creates a change from a backlog item but intentionally does not delete the source file — promotion is not delivery. When the resulting change ships, the backlog file remains in `spec/backlog/` with `**Status**: backlog`, permanently misrepresenting the project's outstanding work.

Three specific deficiencies drive this change:

1. **No archive lifecycle for backlog items.** Issues have `metta fix-issue --remove-issue <slug>`, which calls `IssuesStore.archive()` (copy to `spec/issues/resolved/`) followed by `IssuesStore.remove()` (delete the original). Backlog has no equivalent: `BacklogStore` exposes `remove()` but no `archive()`, and no CLI entry point calls either method in a done-marking flow.

2. **No linkage between shipped items and the change that delivered them.** When a backlog item is promoted and its change ships, there is no record of which change resolved it. The archived issue for `metta-fix-issues-cli-command-m` (commit `16d1053`) implemented `spec/backlog/add-metta-fix-issues-skill-that-works-like-metta-fix-gap.md` — but reading that file gives no indication it is done.

3. **No `done` option in the `/metta-backlog` skill.** The skill drives `list`, `show`, `add`, and `promote` interactively, but a user who wants to mark an item done from inside a Claude session has no path. They must drop to the terminal and call `BacklogStore` methods that the CLI does not expose.

The concrete motivating case: `spec/backlog/add-metta-fix-issues-skill-that-works-like-metta-fix-gap.md` was shipped by change `metta-fix-issues-cli-command-m` (commit `16d1053`, merged 2026-04-14) and still sits in `spec/backlog/` showing `**Status**: backlog`.

---

## Proposal

Add a `done` subcommand to `metta backlog`, back it with two new `BacklogStore` methods, and extend the `/metta-backlog` skill with a fifth branch.

### 1. CLI: `metta backlog done <slug> [--change <name>]`

Registered in `src/cli/commands/backlog.ts` alongside the existing four subcommands.

**Behavior:**

1. Call `BacklogStore.exists(slug)` — if the item is not found, print `Backlog item '<slug>' not found` to stderr and exit code 4.
2. Call `BacklogStore.archive(slug, changeName?)` — this copies the file to `spec/backlog/done/<slug>.md`. If `--change <name>` was supplied, append the line `**Shipped-in**: <name>` to the archived content before writing.
3. Call `BacklogStore.remove(slug)` — delete `spec/backlog/<slug>.md`.
4. Stage both paths and commit: `git add spec/backlog spec/backlog/done`, then `git commit -m "chore: archive shipped backlog item <slug>"`. If git is unavailable or there is nothing to commit, continue silently (same pattern as `fix-issue --remove-issue`).
5. Print `Archived backlog item: <slug>` (human output) or `{ "archived": "<slug>" }` (`--json` output).

### 2. BacklogStore: `archive(slug, changeName?)` and hardened `remove(slug)`

New method `archive(slug: string, changeName?: string): Promise<void>` in `src/backlog/backlog-store.ts`:

- Call `assertSafeSlug(slug)` — same regex guard used in `IssuesStore` (`/^[a-z0-9][a-z0-9-]{0,59}$/`) — before any filesystem access.
- Throw if the item does not exist.
- Read the raw file content via `this.state.readRaw(join('backlog', '<slug>.md'))`.
- If `changeName` is provided, also call `assertSafeSlug(changeName)` before appending `\n**Shipped-in**: <changeName>` to the content.
- `mkdir({ recursive: true })` for `spec/backlog/done/`.
- Write the (possibly extended) content to `spec/backlog/done/<slug>.md` via `this.state.writeRaw`.

Existing `remove(slug)` gains an `assertSafeSlug(slug)` call at the top — it currently has no guard, unlike its `IssuesStore` counterpart.

The `assertSafeSlug` function is added to `backlog-store.ts` verbatim from `issues-store.ts` (same regex, same error message pattern adapted for backlog slugs).

### 3. Skill: extend `/metta-backlog` with `done` branch

The skill template at `src/templates/skills/metta-backlog/SKILL.md` and the deployed copy at `.claude/skills/metta-backlog/SKILL.md` gain a fifth option in the `AskUserQuestion` picker: `done`.

**New `done` branch behavior:**

1. Run `metta backlog list --json`, parse `.backlog[].slug` from the output.
2. Ask the user which slug to mark done via `AskUserQuestion` (same picker pattern as `promote`).
3. Ask the user (optional, can skip) for a change name to record as `--change <name>`.
4. Run `metta backlog done <slug>` (with `--change <name>` if provided).
5. Echo the archived path printed by the CLI.

Both file locations MUST be byte-identical after the edit.

### 4. Tests

- `src/backlog/backlog-store.test.ts`: unit tests for `archive()` happy path, `archive()` with `changeName` stamps `Shipped-in`, `archive()` throws for missing item, `archive()` rejects path-traversal slug, `remove()` rejects path-traversal slug.
- `src/cli/commands/backlog.test.ts` (or equivalent integration test): `backlog done` happy path exits 0 and removes original file; `backlog done` with unknown slug exits 4; `backlog done` with `--change` stamps `Shipped-in` in archived file.
- `src/templates/skills/metta-backlog/SKILL.test.ts` (static content test): both skill file paths contain the string `done`.

---

## Impact

**CLI surface:** One new subcommand (`metta backlog done`) added to an existing command group. No existing subcommands change behavior. No breaking changes.

**BacklogStore:** Two method additions (`archive`) and one guard addition to `remove`. The stored file format gains one optional metadata line (`**Shipped-in**: <change>`) in archived copies only; active backlog files are unchanged.

**Skill:** The `/metta-backlog` skill body is extended by one branch. The byte-identical constraint between template and deployed copy is maintained.

**Tests:** Approximately 8 new test cases across 3 test files (5 unit, 2 CLI integration, 1 skill static-content check).

**Spec/docs:** No spec files require updating. `metta refresh` output may mention `backlog done` once `refresh.ts` reads the registered commands list — this is a side effect, not a required change.

**Git history:** Each `metta backlog done` invocation produces a conventional-commit `chore: archive shipped backlog item <slug>` from within the command, mirroring `fix-issue --remove-issue`'s `fix(issues): remove resolved issue <slug>`.

---

## Out of Scope

- **Auto-archiving on `metta ship`.** When a change that originated from `metta backlog promote` ships, the original backlog file is not automatically archived. The user runs `metta backlog done` explicitly, the same way they run `metta fix-issue --remove-issue` manually. YAGNI: the linkage between a change and its source backlog item is not tracked in change state.
- **`metta backlog undone <slug>`.** No reverse flow to move an item from `spec/backlog/done/` back to `spec/backlog/`. Manual `git mv` is sufficient for the rare case.
- **Listing or showing archived items.** `metta backlog list` continues to scan only `spec/backlog/*.md`, excluding `spec/backlog/done/`. A `--done` flag is not added.
- **Modifying `promote` behavior.** `metta backlog promote <slug>` continues to leave the backlog file in place. Users who want the item archived after promotion call `backlog done` separately.
- **Bulk archiving.** No `metta backlog done --all` flag. Each item is marked done individually.
- **Changing the active backlog file format.** The `**Status**: backlog` line in active items is not updated to `done`. Archived copies retain the original status line and gain `**Shipped-in**` as an additive metadata line.
- **Modifying already-shipped backlog items automatically.** `spec/backlog/add-metta-fix-issues-skill-that-works-like-metta-fix-gap.md` will be archived by the user running `metta backlog done add-metta-fix-issues-skill-that-works-like-metta-fix-gap --change metta-fix-issues-cli-command-m` after this change ships. The command does not retroactively process existing shipped items.

---

## Given/When/Then Scenarios

### Scenario 1: Archive a shipped backlog item without a change reference

**Given** `spec/backlog/add-metta-fix-issues-skill-that-works-like-metta-fix-gap.md` exists  
**When** the user runs `metta backlog done add-metta-fix-issues-skill-that-works-like-metta-fix-gap`  
**Then** the command:
- copies the file content to `spec/backlog/done/add-metta-fix-issues-skill-that-works-like-metta-fix-gap.md`
- deletes `spec/backlog/add-metta-fix-issues-skill-that-works-like-metta-fix-gap.md`
- commits with message `chore: archive shipped backlog item add-metta-fix-issues-skill-that-works-like-metta-fix-gap`
- prints `Archived backlog item: add-metta-fix-issues-skill-that-works-like-metta-fix-gap`
- exits with code 0

### Scenario 2: Archive with `--change` stamps Shipped-in metadata

**Given** `spec/backlog/add-metta-fix-issues-skill-that-works-like-metta-fix-gap.md` exists  
**When** the user runs `metta backlog done add-metta-fix-issues-skill-that-works-like-metta-fix-gap --change metta-fix-issues-cli-command-m`  
**Then** the archived file at `spec/backlog/done/add-metta-fix-issues-skill-that-works-like-metta-fix-gap.md` contains the line:
```
**Shipped-in**: metta-fix-issues-cli-command-m
```
**And** the original `spec/backlog/add-metta-fix-issues-skill-that-works-like-metta-fix-gap.md` no longer exists

### Scenario 3: Unknown slug exits with code 4

**Given** no file exists at `spec/backlog/nonexistent-item.md`  
**When** the user runs `metta backlog done nonexistent-item`  
**Then** the command:
- prints `Backlog item 'nonexistent-item' not found` to stderr
- exits with code 4
- does not write any file to `spec/backlog/done/`

### Scenario 4: Path-traversal slug is rejected by assertSafeSlug

**Given** a caller passes `../../../etc/passwd` as the slug argument  
**When** `BacklogStore.archive('../../../etc/passwd')` is called directly  
**Then** the method throws an error matching `Invalid backlog slug '..\/..\/..\/etc\/passwd'` without performing any filesystem read or write

### Scenario 5: `remove()` without prior `archive()` is guarded

**Given** `spec/backlog/some-item.md` exists  
**When** `BacklogStore.remove('../escape')` is called  
**Then** the method throws before deleting any file, due to the `assertSafeSlug` guard added to `remove()`

### Scenario 6: `--json` output format

**Given** `spec/backlog/my-item.md` exists  
**When** the user runs `metta backlog done my-item --json`  
**Then** stdout contains exactly: `{ "archived": "my-item" }`  
**And** the command exits with code 0

### Scenario 7: Git unavailable — command still succeeds

**Given** `spec/backlog/my-item.md` exists  
**And** the `git` binary is not available in the environment  
**When** the user runs `metta backlog done my-item`  
**Then** the command:
- archives and removes the file
- swallows the git error silently
- prints `Archived backlog item: my-item`
- exits with code 0

### Scenario 8: `archive()` creates `spec/backlog/done/` if it does not exist

**Given** `spec/backlog/done/` does not exist on disk  
**And** `spec/backlog/first-ever-done-item.md` exists  
**When** `BacklogStore.archive('first-ever-done-item')` is called  
**Then** `spec/backlog/done/` is created with `mkdir({ recursive: true })`  
**And** `spec/backlog/done/first-ever-done-item.md` is written successfully

### Scenario 9: `/metta-backlog` skill `done` branch — with change name

**Given** the user invokes `/metta-backlog` in a Claude session  
**And** selects `done` from the action picker  
**And** selects slug `add-metta-fix-issues-skill-that-works-like-metta-fix-gap` from the backlog list  
**And** provides change name `metta-fix-issues-cli-command-m` when prompted  
**When** the skill dispatches  
**Then** it runs `metta backlog done add-metta-fix-issues-skill-that-works-like-metta-fix-gap --change metta-fix-issues-cli-command-m`  
**And** echoes the archived path back to the user

### Scenario 10: `/metta-backlog` skill `done` branch — change name skipped

**Given** the user invokes `/metta-backlog` and selects `done`  
**And** selects a slug  
**And** skips the optional change name prompt  
**When** the skill dispatches  
**Then** it runs `metta backlog done <slug>` without the `--change` flag
