# Design: metta-backlog-description-flag-whitelist-spec-issues-spec

## Approach

Three surgical changes:
1. `backlog.ts` add-command gains `--description` option, passed to store (default = title).
2. `metta-guard-edit.mjs` ALLOW_LIST extended with `ALLOW_PREFIXES` for `spec/issues/` and `spec/backlog/`, gated on `.md` extension.
3. `metta-backlog` skill template switches to `--description` flag; drops post-Edit step. Mirror sync.

## Components

- `src/cli/commands/backlog.ts` — `--description` option wiring
- `src/templates/hooks/metta-guard-edit.mjs` — `ALLOW_PREFIXES` array
- `src/templates/skills/metta-backlog/SKILL.md` — flag-based invocation, no post-Edit
- `.claude/hooks/metta-guard-edit.mjs` + `.claude/skills/metta-backlog/SKILL.md` — mirrors
- `tests/cli.test.ts` — `--description` test case
- `tests/metta-guard-edit.test.ts` — allow-list prefix coverage

## Data Model

No schema changes. `BacklogStore.add()` already has the `description` parameter.

## API Design

- CLI: `--description <text>` — optional, string, defaults to title
- Hook allow-list: `ALLOW_PREFIXES: string[]`; match is `relPath.startsWith(p) && relPath.endsWith('.md')` for each prefix

## Dependencies

None added.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `--description` with shell-special chars | CLI argument parser handles quoting; no injection risk (argument passed directly to library function). |
| Allow-list widening enables accidental writes outside intended scope | Gate on `.md` extension; ONLY `spec/issues/` and `spec/backlog/` prefixes; keep existing exact-match behavior intact. |
| Mirror drift | Explicit sync after each edit; `diff -r` verification in summary step. |
| Skill template users on older CLI | Backward compatible: `metta backlog add "title"` without flag still works. |
