---
name: metta:roadmap
description: Manage the ordered feature roadmap
allowed-tools: [Bash, AskUserQuestion]
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: .claude/hooks/metta-session-mint.mjs metta-roadmap
---

Drive the `metta roadmap` CLI. The CLI owns `spec/roadmap.md`; this skill only routes the user to the right subcommand.

## Steps

1. Use `AskUserQuestion` to pick one of: `view`, `add`, `reorder`, `remove`, `next`.
2. Dispatch per choice:

   - **view** → run `metta roadmap` and report the output. Entries marked `(dangling — backlog item missing)` reference a deleted backlog item; surface that to the user.
   - **add** → first run `metta roadmap --json` (allow-listed; lets the session-credential mint hook complete a prior Bash cycle and shows the current entries — slugs already on the roadmap cannot be added again). Then run `metta backlog list --json`, parse `.backlog[].slug` from the output, and present the slugs via `AskUserQuestion`. Ask for an optional free-text note (if the user skips or leaves it blank, omit the flag). Run `metta roadmap add <chosen-slug>` or `metta roadmap add <chosen-slug> --note "<note>"` as appropriate. Echo the position printed by the CLI.
   - **reorder** → first run `metta roadmap --json` (allow-listed mint-cycle primer), parse `.roadmap[].slug` from the output to get the current slugs, and present them to the user via `AskUserQuestion` to build the complete new order — every current slug exactly once. Run `metta roadmap reorder <slug...>` with the full permutation. Echo the new order printed by the CLI.
   - **remove** → first run `metta roadmap --json` (allow-listed mint-cycle primer), parse `.roadmap[]` from the output, and present the entries (position + slug, flagging any `dangling` ones) via `AskUserQuestion`. Run `metta roadmap remove <position-or-slug>` — position is required for all-digit slugs (they cannot be addressed by slug). Echo the removed slug / former position printed by the CLI.
   - **next** → first run `metta roadmap --json` (allow-listed mint-cycle primer; also shows which entry is on top). Then run `metta roadmap next`. The CLI prints the `metta propose "<title>"` command to run next; echo that back to the user. Dangling entries ahead of the activated one are skipped with a stderr warning, not treated as errors — surface those warnings to the user.

3. Echo the slug / position / next command printed by the CLI.

## Rules

- Never invent slugs; always use the ones emitted by the CLI (`metta backlog list --json` for `add`, `metta roadmap --json` for `reorder`/`remove`).
- Always echo the CLI's output back to the user, including commit lines and error messages.
- Do not call `metta propose` from this skill; `next` only surfaces the suggested command.
- `reorder` requires the complete permutation: every current roadmap slug exactly once, no additions, no omissions.
- `remove` accepts a 1-based position or an entry slug; all-digit input is always treated as a position, so an all-digit slug must be removed by position.
- Orchestrators answering "what should we build next?" read the top entry from `metta roadmap` — `next` is the flow that activates and pops it.
