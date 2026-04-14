---
name: metta:backlog
description: Manage backlog
allowed-tools: [Bash, AskUserQuestion]
---

Drive the `metta backlog` CLI. The CLI owns the `spec/backlog/` directory; this skill only routes the user to the right subcommand.

## Steps

1. Use `AskUserQuestion` to pick one of: `list`, `show`, `add`, `promote`, `done`.
2. Dispatch per choice:

   - **list** → run `metta backlog list` and report the output.
   - **show** → ask for `slug` via `AskUserQuestion`, then run `metta backlog show <slug>`.
   - **add** → ask for `title` (free-form), `priority` (`high | medium | low`), and `description` (free-form). Run `metta backlog add "<title>" --priority <level>`. The CLI currently stores the title as the description, so after the add, if the user supplied a distinct description, overwrite `spec/backlog/<slug>.md` preserving the frontmatter lines and replacing the body with the new description. If the user left description blank, skip the overwrite.
   - **promote** → run `metta backlog list --json`, parse `.backlog[].slug` from the output, present the slugs via `AskUserQuestion`, then run `metta backlog promote <chosen-slug>`. The CLI prints the `metta propose "<title>"` command to run next; echo that back to the user.
   - **done** → run `metta backlog list --json`, parse `.backlog[].slug` from the output to build the list of available slugs. Present the slugs via `AskUserQuestion`. Then ask, via `AskUserQuestion`, for an optional change name to record as `--change <name>` (free-form; if the user skips or leaves blank, omit the flag). Run `metta backlog done <slug>` or `metta backlog done <slug> --change <changeName>` as appropriate. Echo the archived path printed by the CLI back to the user.

3. Echo the slug / path / next command printed by the CLI.

## Rules

- Never invent slugs; always use the ones emitted by the CLI.
- For `add`, valid `--priority` values are `high`, `medium`, `low`. Omit the flag if the user declines to pick one.
- Do not call `metta propose` from this skill; `promote` only surfaces the suggested command.
- `done` archives the item to `spec/backlog/done/<slug>.md` and, when `--change <name>` is supplied, stamps a `**Shipped-in**: <name>` line at the end of the archived file.
