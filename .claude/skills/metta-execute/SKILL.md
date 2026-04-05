---
name: metta:execute
description: Run implementation for the active change
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]
---

You are the **orchestrator** for implementation. Spawn executor subagents for each task.

## Steps

1. `metta status --json` → confirm implementation is ready
2. Read `spec/changes/<change>/tasks.md` for the task list
3. For each task in batch order, **spawn a subagent** with:
   - Persona: "You are an implementation engineer. Write clean, tested code."
   - Task description, files to modify, verification criteria from tasks.md
   - Instructions to run tests after implementation
   - Instructions to commit: `git commit -m "feat(<change>): <task description>"`
4. After all tasks, spawn a subagent to write `spec/changes/<change>/summary.md`
5. `metta complete implementation --json --change <name>`

## Deviation Rules (include in every executor subagent prompt)

- Bug found → fix + separate commit: `fix(<change>): ...`
- Missing utility → add + separate commit
- Blocked (>10 lines to fix) → STOP, report back to orchestrator
- Design is wrong → STOP immediately, report back to orchestrator