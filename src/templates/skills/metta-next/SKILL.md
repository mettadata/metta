---
name: metta:next
description: Advance to the next step in the workflow
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]
---

Automatically advance to whatever's next in the metta workflow.

## Steps

1. `metta next --json` → returns the next action and command to run
2. Execute the returned command
3. If it returns an artifact to build: spawn a subagent with `metta instructions` and the agent execution pattern
4. After completing: `metta next --json` again to get the next step
5. Repeat until all artifacts are done, then `metta finalize`

## Rules

- Let the CLI drive — `metta next` tells you what to do
- MUST write files, git commit, and call `metta complete` for each artifact
- If `metta next` says "finalize", run `/metta:ship` to finalize and merge
