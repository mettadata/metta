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
