# Intent: metta-fix-issues-cli-command-m

## Problem

There is no first-class CLI command for driving issues through the metta change lifecycle.
Two open issues already sit in `spec/issues/` with no workflow to act on them:

- `spec-merger-strips-inline-backticks-and-duplicates-requireme.md`
- `metta-install-should-not-touch-claude-md-that-should-be-left.md`

The only path today is to manually run `metta propose "..."` with the right description,
remember to reference the issue slug, and then manually archive the issue file after
the change ships. There is no `--all`, no severity filter, and no archival semantics.

`metta fix-gap` already solves the identical problem for reconciliation gaps:
`src/cli/commands/fix-gap.ts` (191 lines) implements single-gap, `--all`, `--severity`,
and `--remove-gap` branches. A companion skill at
`.claude/skills/metta-fix-gap/SKILL.md` orchestrates the full pipeline from propose
through merge and gap removal. The issues domain has the `IssuesStore` class
(`src/issues/issues-store.ts`) but it exposes only `create`, `list`, `show`, and
`exists` — no `archive` or `remove` methods — and has no corresponding CLI command or
skill. The backlog item
`spec/backlog/add-metta-fix-issues-skill-that-works-like-metta-fix-gap.md` captures
the gap.

## Proposal

Add a `metta fix-issue` command and a `metta-fix-issues` skill that mirror `fix-gap`
exactly in shape and orchestration pattern.

### CLI command — `src/cli/commands/fix-issue.ts`

Four branches, matching `fix-gap.ts` line for line in structure:

| Branch | Trigger | Behaviour |
|--------|---------|-----------|
| `--remove-issue <slug>` | explicit archival flag | archive to `spec/issues/resolved/`, git commit |
| `fix-issue <slug>` | single issue by name | show issue details, print delegate hint |
| `--all [--severity <level>]` | batch | list all open issues sorted by severity, optionally filtered |
| no args | fallback | print usage |

Severity parsing reuses `parseSeverity` / `sortBySeverity` from `fix-gap.ts`
(extracted to a shared `src/cli/severity.ts` helper, or re-exported — decision for
design phase).

### IssuesStore additions — `src/issues/issues-store.ts`

`IssuesStore` MUST gain two methods:

- `archive(slug: string): Promise<void>` — copies `spec/issues/<slug>.md` to
  `spec/issues/resolved/<slug>.md` (creates the `resolved/` directory if absent).
- `remove(slug: string): Promise<void>` — deletes `spec/issues/<slug>.md`.

These mirror `GapsStore.archive` and `GapsStore.remove`.

### Skill — `src/templates/skills/metta-fix-issues/SKILL.md`

New skill template, deployed byte-identical to
`.claude/skills/metta-fix-issues/SKILL.md`. Modeled on `metta-fix-gap/SKILL.md` with
these differences:

- Refers to `metta fix-issue` (not `metta fix-gap`) for list, show, and remove commands.
- Change proposal description pattern: `"fix issue: <slug> — <title>"` (links issue
  to change via the propose description, not frontmatter).
- After merge: calls `metta fix-issue --remove-issue <slug>` to archive the issue.
- `--all` mode batches by file overlap across issue content, same as `fix-gap` skill.

### Registration

`metta fix-issue` MUST be registered in `src/cli/index.ts` alongside the existing
`fix-gap` registration.

### Tests — `tests/cli.test.ts`

Four new test cases:

1. Single `fix-issue <slug>` — valid slug prints details and delegate hint.
2. `--all --severity critical` — only critical issues returned; medium/minor excluded.
3. `--remove-issue <slug>` — file moves to `spec/issues/resolved/<slug>.md` and is
   deleted from `spec/issues/`.
4. `--remove-issue <slug>` commits the archive move with message
   `fix(issues): remove resolved issue <slug>`.

One static skill template test: byte-identity between
`src/templates/skills/metta-fix-issues/SKILL.md` and
`.claude/skills/metta-fix-issues/SKILL.md`, and presence of `fix-issue` subcommand
references in the skill body.

## Impact

- Developers can run `metta fix-issue --all` to drive every open issue through the
  full propose → plan → execute → verify → finalize → ship lifecycle without manual
  bookkeeping.
- Resolved issues move to `spec/issues/resolved/` automatically on `--remove-issue`,
  establishing a traceable audit trail (convention already established by the
  `archive-resolved-task-checkbox` change).
- The two existing open issues (`spec-merger-strips-inline-backticks-...`,
  `metta-install-should-not-touch-claude-md-...`) become actionable immediately after
  this change ships.
- Closes the backlog item
  `add-metta-fix-issues-skill-that-works-like-metta-fix-gap`.
- No existing commands or stores are modified in a breaking way; `IssuesStore.archive`
  and `IssuesStore.remove` are purely additive.

## Out of Scope

- **Migration of existing open issues.** The user runs `metta fix-issue --all` manually
  after this change ships. No automated migration.
- **Auto-archival on ship.** Archival is only triggered by the explicit
  `--remove-issue` flag, not by `metta ship` or `metta finalize`. Lifecycle hooks are
  not modified.
- **Auto-linking via frontmatter.** Issue-to-change linkage is via the propose
  description pattern (`"fix issue: <slug> — <title>"`), not a new frontmatter field.
- **Batch-resolving multiple issues in a single change.** Each issue spawns its own
  dedicated change branch.
- **Changes to `metta issue` create / list / show behavior.** Existing issue creation
  and display commands are untouched.
- **Severity taxonomy changes.** `IssuesStore` uses `critical | major | minor`;
  `fix-gap` uses `critical | medium | low`. We adopt the issues store's existing enum
  for the new command without renaming either.
