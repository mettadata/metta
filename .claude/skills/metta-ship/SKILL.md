---
name: metta:ship
description: Finalize and ship the active change
allowed-tools: [Read, Write, Bash, Grep, Glob]
---

Finalize the change — archive, merge specs, prepare for main.

## Steps

1. `metta finalize --dry-run --json --change <name>` → preview
2. If clean: `metta finalize --json --change <name>` → archives change, merges specs
3. Git commit any remaining changes
4. Report result to user

If spec conflicts are reported, stop and tell the user.