---
name: metta:ship
description: Finalize and ship the active change
allowed-tools: [Read, Write, Bash, Grep, Glob]
---

Two-step process: **finalize** (archive + merge specs on branch) then **ship** (merge branch to main).

## Steps

1. `METTA_SKILL=1 metta finalize --dry-run --json --change <name>` → preview what will change
2. If clean: `METTA_SKILL=1 metta finalize --json --change <name>` → archives change to spec/archive/, merges delta specs into living specs
3. If spec conflicts: stop and tell the user to resolve them
4. `git checkout main` → switch back to main
5. `git merge metta/<change-name> --no-ff -m "chore: merge <change-name>"` → merge the feature branch
6. Report result to user

## Rules

- ALWAYS dry-run finalize before the real operation
- Finalize happens on the feature branch (metta/<change-name>)
- Ship merges the feature branch back to main
- If spec conflicts are found, do NOT proceed — tell the user
- Do not force-push or skip any steps
