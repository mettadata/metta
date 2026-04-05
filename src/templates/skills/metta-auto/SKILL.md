---
name: metta:auto
description: Full lifecycle loop — discover, build, verify, ship
argument-hint: "<description of what to build>"
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]
---

**IMPORTANT: When using the Agent tool, always set subagent_type to "general-purpose". Do NOT use gsd-executor or any other agent type.**

You are the **orchestrator** for the full Metta lifecycle. Spawn subagents for each phase.

## Steps

1. `metta propose "$ARGUMENTS" --json` → creates change
2. For each artifact in order:
   a. `metta instructions <artifact> --json --change <name>` → get template + persona
   b. **Spawn a subagent** with the agent persona and task
   c. Subagent writes artifact to output_path with real content, then git commits
   d. `metta complete <artifact> --json --change <name>` → returns next
3. For implementation: spawn executor subagents per task from tasks.md
4. Spawn verifier subagent to check spec compliance
5. `metta finalize --json --change <name>`
6. Report results to user

## Rules

- Ask discovery questions BEFORE writing spec — don't guess requirements
- Every subagent MUST write files to disk and git commit
- Every artifact MUST be followed by `metta complete` to advance workflow
- Deviation Rule 4: design is wrong → STOP, tell user
