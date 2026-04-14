# Research: metta-issue-metta-backlog-slas

## Decision: skill authoring style

### Approaches Considered
1. **Match existing terse skills** (selected) — e.g. `src/templates/skills/metta-status/SKILL.md` is 8 lines: frontmatter + one-sentence instructions + branching guidance. Keeps skills minimal, defers complex logic to the CLI.
2. **Write verbose orchestrators like `/metta-init`** — that skill drives subagent spawns and parses complex JSON. Appropriate when the CLI output is structured and requires interpretation. Overkill for issue/backlog.

### Rationale
`metta issue` and `metta backlog <sub>` already do the heavy lifting. The skill body's job is to collect args via `AskUserQuestion` and shell out. Use the terse style.

## Decision: complete surface area of `idea` to remove

Audited via grep:
- `src/cli/commands/idea.ts` — standalone file, delete.
- `src/cli/index.ts:15` — `registerIdeaCommand` import and its registration call.
- `src/ideas/ideas-store.ts` — store, delete (`rm -rf src/ideas/`).
- `src/cli/helpers.ts:7,24,44` — imports `IdeasStore`, includes `ideasStore` in `CliContext`, instantiates it. Remove the three sites.
- `src/index.ts:10` — barrel export `export * from './ideas/ideas-store.js'`. Remove.
- `tests/ideas-store.test.ts` — delete.
- `tests/cli.test.ts:273-` — the `describe('metta idea', ...)` block, delete.
- `src/cli/commands/refresh.ts:150` — removes `metta idea` bullet from Organization section.
- `src/cli/commands/refresh.ts:178` — removes `[Ideas](spec/ideas/)` row from TOC.

No other callers of `IdeasStore` or references to `metta idea` outside of the archived change/spec history (which we do not edit).

## Decision: `spec/ideas/` on disk

Intent's "Out of Scope" says we don't migrate. Confirm: the directory is user data, not shipped repo data. This metta repo has no `spec/ideas/` either (only `spec/issues/`). Nothing to delete in-tree.

## Decision: skill filenames and frontmatter

Match the existing convention seen in e.g. `metta-status/SKILL.md`:

```
---
name: metta:<command>
description: <one-line>
allowed-tools: [Read, Bash, AskUserQuestion]
---
```

`AskUserQuestion` is needed only for the two new skills where we prompt for missing args. Confirm this tool is already used — yes, the `/metta-init` skill lists it indirectly via the discoverer agent.

## Decision: backlog subcommand routing inside the skill

The skill needs to branch. Options:
1. **Ask the user which subcommand** via `AskUserQuestion` with 4 options (list/show/add/promote). Selected.
2. Require the user to pass the subcommand as a skill arg. Friction.
3. One skill per subcommand (`/metta-backlog-add`, etc.). Clutter.

Selected approach needs the skill body to include a switch on the user's selection and call the right CLI.

## Decision: JSON vs human output from the CLI

All metta CLI commands support `--json`. Skill should use `--json` and parse for programmatic use (e.g. `backlog list --json` to surface slugs for the `promote` picker). For the capture operations (`issue`, `backlog add`), JSON output reports the created file path which the skill echoes back.

## Decision: tests

- Static file checks for both skills: file exists, frontmatter name matches, body references the right CLI (pattern: `tests/cli.test.ts` already has a similar check for `metta-next` and `metta-init` skill templates).
- The existing `metta idea` test block must be deleted, not adapted.
- No new functional CLI tests — the CLI commands themselves (`metta issue`, `metta backlog *`) already have coverage that remains valid.

## Decision: breaking change announcement

`metta idea` removal is breaking. Pre-1.0, acceptable. No deprecation cycle — spec is explicit that the command should fail with "unknown command" post-change.

## Risks

- **Risk**: `IdeasStore` consumers I missed. Mitigation: greps above cover all of `src/` and `tests/`. Runtime typecheck + build will catch any stragglers.
- **Risk**: `spec/ideas/` TOC row in this repo's own live `CLAUDE.md` is regenerated on refresh — but refresh is what we're changing, so the next `metta refresh` drops the row automatically.
- **Risk**: a future change re-introduces `idea` by accident. Not mitigated — just accept and rely on code review.

### Artifacts Produced
None.
