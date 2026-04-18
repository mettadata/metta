# metta-backlog-description-flag-whitelist-spec-issues-spec

## Problem

Two related hook/backlog drifts block the simplest CLI-first workflows:

1. **`metta-backlog-skill-conflicts-with-metta-guard-edit-mjs-hook`** (major) — `/metta-backlog add` skill needs to inject a description body but the CLI only accepts `<title>`. The skill's workaround (Edit the file post-create) is blocked by `metta-guard-edit.mjs`. Net: descriptions silently drop to just the title.
2. **`metta-guard-edit-mjs-hook-blocks-enriching-spec-issues-after`** (minor) — after `metta issue "..."` creates `spec/issues/<slug>.md`, the hook blocks any subsequent Edit/Write on the file. Users must start a no-op change just to flesh out an issue body. `spec/backlog/` has the same surface.

## Proposal

Two surgical fixes in one change:

1. **Add `--description <text>` CLI flag to `metta backlog add`**
   `backlog-store.add()` already accepts a separate description parameter; the CLI just passes `title` for both. Wire the new flag through and default to `title` when absent (backward compatible). Update `/metta-backlog` skill template to pass the flag instead of post-Edit the file.

2. **Whitelist `spec/backlog/**` and `spec/issues/**` in `metta-guard-edit.mjs`**
   Extend `ALLOW_LIST` with a startsWith check for these directories. Users can enrich bodies after CLI create without opening a no-op metta change. Matches precedent: `spec/project.md` is already allow-listed for `/metta-init`'s discovery agent.

## Impact

- `src/cli/commands/backlog.ts` — add `--description` option; pass to store
- `src/templates/skills/metta-backlog/SKILL.md` — use `--description` flag; drop post-Edit step (+ mirror)
- `src/templates/hooks/metta-guard-edit.mjs` — widen ALLOW_LIST to startsWith matches for `spec/backlog/` and `spec/issues/` (+ mirror in `.claude/hooks/`)
- `tests/cli.test.ts` — new test for `--description` flag
- `tests/metta-guard-edit.test.ts` — new test covering the whitelist extension

## Out of Scope

- Same `--description` flag for `metta issue` (separate follow-up)
- Broader guard-hook redesign
- Whitelisting `spec/gaps/` (may revisit if users report similar friction)
