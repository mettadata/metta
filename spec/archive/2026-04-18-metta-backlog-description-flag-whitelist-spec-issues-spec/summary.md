# Summary: metta-backlog-description-flag-whitelist-spec-issues-spec

## Problem

1. `/metta-backlog add` could not persist a description — skill tried to post-Edit the file but `metta-guard-edit.mjs` blocks Edit/Write outside `spec/project.md` and `.metta/config.yaml`.
2. After `metta issue "..."` created an issue file, the same hook blocked any follow-up body enrichment.

## Solution

- **CLI**: `metta backlog add --description <text>` flag, defaults to title (backward compatible).
- **Hook**: `ALLOW_PREFIXES = ['spec/issues/', 'spec/backlog/']` whitelist for `.md` files under those dirs.
- **Skill**: `/metta-backlog` now passes `--description` directly; post-Edit workaround removed.
- Deployed mirrors synced byte-identically.

## Files touched

- `src/cli/commands/backlog.ts`
- `src/templates/hooks/metta-guard-edit.mjs` + `.claude/hooks/metta-guard-edit.mjs`
- `src/templates/skills/metta-backlog/SKILL.md` + `.claude/skills/metta-backlog/SKILL.md`
- `tests/cli.test.ts` (2 new tests)
- `tests/metta-guard-edit.test.ts` (3 new tests)

## Resolves

- `metta-backlog-skill-conflicts-with-metta-guard-edit-mjs-hook` (major)
- `metta-guard-edit-mjs-hook-blocks-enriching-spec-issues-after` (minor)
