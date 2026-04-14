# Design: metta-issue-metta-backlog-slas

## Approach
Two additive skill files plus a clean deletion of the `idea` surface. Skills are pure shell wrappers around existing CLI commands; no new CLI code, no new stores. The deletion removes 9 code sites identified in research (command, store, helpers wiring, barrel export, tests, two refresh.ts lines).

## Components

### `src/templates/skills/metta-issue/SKILL.md` (new)
Frontmatter: `name: metta:issue`, `description: Log an issue`, `allowed-tools: [Bash, AskUserQuestion]`.
Body: instruct the agent to (1) collect `description` via `AskUserQuestion` if not supplied in args, (2) collect `severity` via `AskUserQuestion` with options `critical | major | minor` (default `minor`), (3) run `metta issue "<description>" --severity <level>`, (4) echo the path of the created issue file.

### `src/templates/skills/metta-backlog/SKILL.md` (new)
Frontmatter: `name: metta:backlog`, `description: Manage backlog`, `allowed-tools: [Bash, AskUserQuestion]`.
Body: (1) `AskUserQuestion` with four options `list | show | add | promote`; (2) branch per choice:
- `list` → `metta backlog list`
- `show` → ask for slug, run `metta backlog show <slug>`
- `add` → ask for title, priority (`high/medium/low`), description; run `metta backlog add "<title>" --priority <level>` then append the description to the generated file (or use whatever stdin/arg the `add` subcommand accepts — verify in implementation)
- `promote` → run `metta backlog list --json`, parse slugs, ask the user to pick one, run `metta backlog promote <slug>`.

### `.claude/skills/metta-issue/SKILL.md` and `.claude/skills/metta-backlog/SKILL.md` (new)
Byte-identical copies deployed by the install pipeline via `src/delivery/command-installer.ts`. The installer does `cp -r src/templates/skills/* .claude/skills/`, so on next `metta install` both new skills propagate to target projects. For this repo's own deployed copies, drop them in the same commit so the fix-metta-next-gap-detect-unme static test pattern (byte-identity check) is satisfied.

### `src/cli/commands/idea.ts` (delete)
Remove entirely.

### `src/ideas/` (delete)
Remove directory and its single file `ideas-store.ts`.

### `src/cli/index.ts` (modify)
Remove line 15 (`import { registerIdeaCommand } from './commands/idea.js'`) and the call to `registerIdeaCommand(program)` in the setup block.

### `src/cli/helpers.ts` (modify)
Remove three sites per research:
- Line 7: import of `IdeasStore`
- Line 24: `ideasStore: IdeasStore` field on `CliContext`
- Line 44: instantiation `const ideasStore = new IdeasStore(specDir)` and its inclusion in the returned context object

### `src/index.ts` (modify)
Remove line 10 barrel re-export `export * from './ideas/ideas-store.js'`.

### `src/cli/commands/refresh.ts` (modify)
Remove line 150 `- metta idea <description> -- capture an idea` bullet.
Remove line 178 `[Ideas](spec/ideas/)` TOC row.

### `tests/ideas-store.test.ts` (delete)
Remove entirely.

### `tests/cli.test.ts` (modify)
Delete the `describe('metta idea', ...)` block (research pinpointed starting at line 273). Add two new static-file tests modelled on the existing `metta-init skill template` and `metta-next skill template` patterns:
- `describe('metta-issue skill template', ...)` asserts file exists, frontmatter name is `metta:issue`, body references `metta issue`, and template matches `.claude/` copy.
- `describe('metta-backlog skill template', ...)` asserts file exists, frontmatter name is `metta:backlog`, body references each of `list`, `show`, `add`, `promote`, and template matches `.claude/` copy.

### `tests/refresh.test.ts` (modify if applicable)
If any test asserts the presence of the `Ideas` row or the `metta idea` bullet (we changed these in this change), update or delete those assertions. Executor must verify during implementation — no rewrite shown here in design.

## Data Model
No state or schema changes. No migrations. User repos with `spec/ideas/` retain it as untracked orphan data.

## API Design
- Removed: `metta idea [description]`
- New skills (not CLI): `/metta:issue`, `/metta:backlog`
- Unchanged: `metta issue`, `metta backlog list/show/add/promote`

## Dependencies
None added. `AskUserQuestion` is a Claude Code built-in tool available to skills.

## Risks & Mitigations
- **Risk**: `metta backlog add` may not accept `--priority` the way the skill assumes. Mitigation: executor reads `src/cli/commands/backlog.ts` and `src/backlog/backlog-store.ts` before writing the skill body; adjust skill invocations to match the real CLI surface.
- **Risk**: deleting `ideasStore` from `CliContext` breaks any caller still referencing `ctx.ideasStore`. Mitigation: grep after deletion; build will catch any stragglers.
- **Risk**: a test asserts the specific string `metta idea` elsewhere. Mitigation: executor greps `tests/` and removes/adjusts.
- **Risk**: CLAUDE.md in this repo shows `[Ideas]` / `metta idea` until `metta refresh` runs. Mitigation: run `metta refresh` as the final implementation step before commit, or let finalize handle it.

## Test Strategy
- Delete existing `metta idea` tests. Build fails if any production code still depends on the store.
- Add two skill static-file tests (byte-identity between template and deployed copy + content checks).
- Run `npx vitest run` — full suite must pass.
- Smoke: after build, run `metta idea foo` and confirm Commander errors with "unknown command"; run `metta issue "test" --severity minor` and `metta backlog list` to confirm those still work.
