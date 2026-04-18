---
name: metta:refresh
description: Regenerate CLAUDE.md from project constitution and specs
allowed-tools: [Read, Bash]
---

Run `metta refresh` to regenerate CLAUDE.md from the project constitution (spec/project.md) and active specs (spec/specs/).

This updates all metta marker sections:
- Project description and stack
- Conventions and off-limits
- Active specs table with requirement counts
- Full command reference
- Reference links

Use `metta refresh --dry-run` to preview changes without writing.
Use `metta refresh --json` for structured output.

## Behavior

After writing `CLAUDE.md`, `metta refresh` automatically commits the regenerated file on your behalf using the commit message `chore(refresh): regenerate CLAUDE.md`. This prevents the regenerated file from silently contaminating subsequent unrelated commits.

If the repository is not a git working tree, has uncommitted changes to unrelated files, or the regenerated content is identical to the working copy, the auto-commit is skipped and the reason is surfaced in the command output.

Pass `--no-commit` to opt out of the auto-commit. This is the escape hatch for workflows that want to inspect the diff or stage `CLAUDE.md` as part of a larger commit. In that mode, `metta refresh` writes the file and leaves staging and committing entirely up to you.
