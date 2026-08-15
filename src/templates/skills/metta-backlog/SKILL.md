---
name: metta:backlog
description: Manage backlog
allowed-tools: [Bash, AskUserQuestion]
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: .claude/hooks/metta-session-mint.mjs metta-backlog
---

Drive the `metta backlog` CLI. The backlog is a view over `spec/issues/` frontmatter — there is no separate backlog store. This skill only routes the user to the right subcommand.

## Steps

1. Use `AskUserQuestion` to pick one of: `list`, `show`, `add`, `promote`, `done`, `migrate`, `milestone`.
2. Dispatch per choice:

   - **list** → run `metta backlog list` and report the output.
   - **show** → ask for `slug` via `AskUserQuestion`, then run `metta backlog show <slug>`.
   - **add** → first ask via `AskUserQuestion`: "Add an existing issue to the backlog, or capture a new idea?" (`existing issue | new idea`).
     - **existing issue** → run `metta issues list --json` (allow-listed; also lets the session-credential mint hook complete a prior Bash cycle), present the open-issue slugs via `AskUserQuestion`, then optionally collect `priority` (`high | medium | low`), `order` (a number), and `milestone` (a milestone slug). Run `metta backlog add <slug>` appending `--priority <level>`, `--order <n>`, and/or `--milestone <slug>` for whichever the user supplied; omit any flag the user declined.
     - **new idea** → ask for `title` (free-form) and `description` (free-form), plus the same optional `priority` / `order` / `milestone`. First run `metta backlog list --json` (allow-listed; lets the session-credential mint hook complete a prior Bash cycle — output can be ignored), then run `metta backlog add "<title>" --new --description "<description>"` plus any optional flags. Omit `--description` if the user left it blank (description then defaults to the title). This mints a `type: idea` entry in `spec/issues/`.
   - **promote** → run `metta backlog list --json`, parse `.backlog[].slug` from the output, present the slugs via `AskUserQuestion`, then run `metta backlog promote <chosen-slug>`. The CLI prints the `/metta-fix-issues <slug>` handoff command; echo that back to the user.
   - **done** → run `metta backlog list --json`, parse `.backlog[].slug` from the output to build the list of available slugs. Present the slugs via `AskUserQuestion`. Then ask, via `AskUserQuestion`, for an optional change name to record as `--change <name>` (free-form; if the user skips or leaves blank, omit the flag). Run `metta backlog done <slug>` or `metta backlog done <slug> --change <changeName>` as appropriate. Echo the archived path (`spec/issues/resolved/<slug>.md`) printed by the CLI back to the user.
   - **migrate** → run `metta backlog migrate --json`. Report the converted counts (`converted.active`, `converted.done`), any `collisions` (each with `slug`, `legacy_path`, `existing_path` — collisions are reported, never overwritten), and the `archived_to` location. If `nothing_to_do` is true, tell the user there were no legacy `spec/backlog/` files to migrate.
   - **milestone** → ask via `AskUserQuestion` which milestone action to take: `create | list | show`.
     - **create** → ask for `slug`, `name`, and optional `target` (date) and `description`. First run `metta milestone list --json` (allow-listed; lets the session-credential mint hook complete a prior Bash cycle — output can be ignored), then run `metta milestone create <slug> --name "<name>"` plus `--target <date>` / `--description <text>` when supplied.
     - **list** → run `metta milestone list` and report the rollups (open/resolved counts and percent per milestone) plus any warnings.
     - **show** → run `metta milestone list --json`, present the milestone slugs via `AskUserQuestion`, then run `metta milestone show <slug>` and report the per-issue breakdown.

3. Echo the slug / path / next command printed by the CLI.

## Rules

- The backlog is a view over `spec/issues/` frontmatter; `spec/backlog/` is not a store. Never write to `spec/issues/` or `spec/milestones/` directly — the CLI owns those files.
- Never invent slugs; always use the ones emitted by the CLI.
- For `add`, valid `--priority` values are `high`, `medium`, `low`. Omit the flag if the user declines to pick one.
- For `add` without `--new`, an unresolved slug makes the CLI exit non-zero and suggest `--new`. Confirm with the user before re-running with `--new` — a typo must not silently mint a new idea.
- Do not invoke the fix-issues flow yourself; `promote` only surfaces the `/metta-fix-issues <slug>` command.
- `done` archives the entry to `spec/issues/resolved/<slug>.md` (frontmatter preserved) and, when `--change <name>` is supplied, records the shipping change on the archived file.
