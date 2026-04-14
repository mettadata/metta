# Research: metta-backlog-done-subcommand

## Summary

This change mirrors the `fix-issue --remove-issue` pattern onto backlog. The pattern is well-established; the primary delta from the issues side is (a) the optional `Shipped-in:` metadata append and (b) adding the `assertSafeSlug` guard that is present on IssuesStore but absent from BacklogStore.

---

## Decision 1: Does BacklogStore.remove() already exist?

Yes. `src/backlog/backlog-store.ts` line 104–106:

```ts
async remove(slug: string): Promise<void> {
  await this.state.delete(join('backlog', `${slug}.md`))
}
```

It is a straight delete with no slug validation. By contrast, `IssuesStore.remove` (line 128–131) calls `assertSafeSlug(slug)` before the delete.

**Required delta:** add `assertSafeSlug(slug)` to `BacklogStore.remove()` and to `BacklogStore.show()` (currently unguarded at line 99) and `BacklogStore.exists()` (line 108). Mirror the guard pattern exactly from IssuesStore.

`BacklogStore` also needs a private `assertSafeSlug` function (or the shared regex inline). Recommend duplicating the same regex `/^[a-z0-9][a-z0-9-]{0,59}$/` locally, identical to IssuesStore — no shared util file exists today so a shared module would be new scope.

---

## Decision 2: Archive file format and write strategy

`IssuesStore.archive` (lines 118–126) reads the raw markdown content and writes it verbatim to `spec/issues/resolved/<slug>.md`. No metadata is appended.

The spec for this change requires optionally appending `Shipped-in: <changeName>` before writing to `spec/backlog/done/<slug>.md`. The write strategy is therefore:

1. Read raw content: `this.state.readRaw(join('backlog', `${slug}.md`))`
2. If `changeName` is provided, append `\n**Shipped-in**: ${changeName}\n` to the content (after trimming trailing newlines, then adding one clean newline before the metadata line).
3. Write modified content via `this.state.writeRaw(join('backlog', 'done', `${slug}.md`), modifiedContent)`.

This keeps the approach consistent with the issues pattern (using `writeRaw`) while adding the optional metadata line. No new StateStore API is needed.

---

## Decision 3: Directory setup for spec/backlog/done/

`spec/backlog/done/` does not currently exist. `IssuesStore.archive` calls `mkdir(join(this.specDir, 'issues', 'resolved'), { recursive: true })` inline before writing (line 124). The same inline `mkdir` must be added to `BacklogStore.archive` before the `writeRaw` call:

```ts
await mkdir(join(this.specDir, 'backlog', 'done'), { recursive: true })
```

No globals. No pre-initialization. The `mkdir` is idempotent on subsequent calls.

---

## Decision 4: CLI subcommand position

Current subcommand order in `src/cli/commands/backlog.ts`: `list`, `show`, `add`, `promote`.

The `done` subcommand goes after `promote`. Rationale: `promote` graduates an item to an active change; `done` archives an item that has been shipped. They are semantically adjacent (both are lifecycle-terminating operations on a backlog item) so co-location at the end is natural.

Commander registers subcommands in source order, which becomes the help-text order. No structural constraint forces any particular position; after `promote` is purely a convention choice.

---

## Decision 5: Skill extension

`/home/utx0/Code/metta/.claude/skills/metta-backlog/SKILL.md` currently lists 4 branches in the `AskUserQuestion` picker: `list`, `show`, `add`, `promote`.

The 5th branch text:

```
- **done** → ask for `slug` via `AskUserQuestion` (present the list via `metta backlog list --json` and parse `.backlog[].slug` to offer choices). Optionally ask for `changeName` (free-form, may be blank). Run `metta backlog done <slug>` or `metta backlog done <slug> --change <changeName>`. Echo the archive path printed by the CLI.
```

The skill step 1 `AskUserQuestion` options list must be extended from `list | show | add | promote` to `list | show | add | promote | done`.

---

## Decision 6: Hostile changeName guard

The `changeName` option is an optional free-text string identifying the change that shipped the item (e.g. `metta-backlog-done-subcommand`). It is written verbatim into the archived markdown file as `**Shipped-in**: <changeName>`.

IssuesStore uses `SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/` for slugs. `changeName` in practice looks like a change slug (lowercase, hyphens, digits), but the spec should not over-constrain it.

**Recommended guard:** use the same regex as slug — `/^[a-z0-9][a-z0-9-]{0,59}$/` — applied only when `changeName` is provided (i.e., skip the check when the option is omitted or empty). Rationale:

- Change names in this codebase are always slugified (see `spec/changes/` directory entries, e.g. `metta-backlog-done-subcommand`).
- Allowing uppercase or spaces in `changeName` would require escaping for YAML/markdown safety; restricting to the slug regex eliminates all injection surface (no path separators, no shell metacharacters, no markdown-breaking characters).
- The error message should be distinct from the slug error: `Invalid change name '${changeName}' — must be a slug (lowercase letters, digits, hyphens, max 60 chars)`.

The guard lives in the CLI action handler (not in BacklogStore.archive), consistent with how the issues CLI validates before calling the store.

---

## Implementation Plan (confirmed mirror)

| Step | File | Change |
|------|------|--------|
| 1 | `src/backlog/backlog-store.ts` | Add `assertSafeSlug` function (copy from IssuesStore). Add guard calls to `show`, `remove`, `exists`. Add `archive(slug, changeName?)` method with inline `mkdir`, raw read, optional append, `writeRaw`. |
| 2 | `src/cli/commands/backlog.ts` | Add `done` subcommand after `promote`. Arguments: `<slug>`. Option: `--change <changeName>`. Flow: validate changeName if provided, `exists` check, `archive`, `remove`, git commit touching `spec/backlog` and `spec/backlog/done`, JSON/text output. |
| 3 | `.claude/skills/metta-backlog/SKILL.md` | Extend picker to include `done`; add branch description. |
| 4 | Tests | `src/backlog/backlog-store.test.ts` — archive method, assertSafeSlug on show/remove/exists. `src/cli/commands/backlog.test.ts` — done subcommand branches (not-found, success, invalid changeName, no-args usage). |

The git commit message pattern from fix-issue is: `chore(backlog): archive done item ${slug}`. Use the same convention.

No novel architectural decisions required. Full mirror confirmed.
