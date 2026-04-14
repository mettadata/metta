# metta-issue-metta-backlog-slas

## Problem
The idea / issue / backlog trio has three problems today:

1. **No slash commands for issue or backlog.** `metta issue <desc>` and `metta backlog add/list/show/promote` exist as CLI commands, but users working through Claude Code have no `/metta-issue` or `/metta-backlog` skill. Capture requires dropping to the shell; promotion of backlog → active change is manual.

2. **`idea` overlaps with `backlog` and is asymmetric.** Both are parking lots. `backlog` has full CRUD (`list`, `show`, `add`, `promote`) and carries priority + source metadata. `idea` only has capture — no list, no show, no promote. Captured ideas pile up in `spec/ideas/` with no management surface. Two parking lots with overlapping intent is worse than one good one.

3. **Discoverability.** `metta issue` is the logging path for the spec-merger bug and the recent finalize double-archive bug, but neither was captured via a consistent entry point.

Affected: anyone capturing work outside the active change, anyone triaging backlog for next milestone, the `/metta-next` and `/metta-propose` skill flows which don't surface captured items.

## Proposal
Three linked edits:

1. **Add `/metta-issue` skill** at `src/templates/skills/metta-issue/`. Wraps `metta issue <desc> [--severity <level>]`. Prompts for description + severity via `AskUserQuestion` when invoked without args. Commits and reports the created file path. Same install/deployment path as other skills.

2. **Add `/metta-backlog` skill** at `src/templates/skills/metta-backlog/`. Wraps the full backlog subcommand set. Interactive subcommand selection (`list` / `add` / `show` / `promote`) via `AskUserQuestion`. For `add`, collect title + priority + description. For `promote`, list items and let the user pick one, then run `metta backlog promote <slug>`.

3. **Remove `metta idea` entirely.** Delete: `src/cli/commands/idea.ts` (if standalone) or the `idea` command registration, `src/ideas/` store, `tests/ideas-store.test.ts` and any CLI tests targeting `metta idea`, references in `src/templates/skills/*` or prompts, `spec/ideas/` from the CLAUDE.md Table of Contents, and the "Ideas" row in the workflow docs. Any captured ideas in a user's repo are left alone (their working tree, not our concern). Consumers of the ideas-store interface that remain? — verify none.

Installation path: skills are copied from `src/templates/skills/` into `.claude/skills/` on `metta install`, so both new skills will land automatically on the next install/refresh. Existing installs (like zeus) pick them up on re-install.

## Impact
- **CLI surface**: `metta idea` removed (breaking). `metta issue` and `metta backlog` unchanged.
- **Skills**: two new slash commands available to Claude Code users.
- **Store deletion**: `src/ideas/` + tests removed. Anything still importing from it must be updated — if there are none, clean deletion.
- **Docs**: CLAUDE.md Table of Contents loses the Ideas row; workflow section under "Organization" loses `metta idea` line.
- **Existing `spec/ideas/` folders**: left untouched in user repos; the directory becomes orphaned but harmless. Document in the spec that migration is not automated.
- **Tests**: `tests/ideas-store.test.ts` and any CLI tests for `metta idea` deleted. New tests for the two skills' static files and for the skill → CLI wiring.

## Out of Scope
- Migration tool to convert existing `spec/ideas/*.md` files into backlog items. Users can re-file manually; idea count in this repo is zero.
- `/metta-issue-list` or `/metta-issues` triage skill. Skill adds *capture*; triage stays on the CLI for now.
- Adding a `severity` filter to backlog or a `priority` field to issue. Keep the two stores' schemas as they are.
- Renaming `spec/ideas/` on disk or auto-archiving it.
- Changing how issues are surfaced in `metta progress` / `metta status`.
- Any UI layer.
