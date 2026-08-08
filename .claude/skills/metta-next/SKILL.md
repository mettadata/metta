---
name: metta:next
description: Advance to the next step in the workflow
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: .claude/hooks/metta-session-mint.mjs metta-next
---

**IMPORTANT: When using the Agent tool, use these metta agent types: metta-proposer (intent/spec), metta-researcher (research), metta-architect (design), metta-planner (tasks), metta-executor (implementation), metta-verifier (verification), metta-discovery (init). Do NOT use gsd-executor or general-purpose.**

Automatically advance to whatever's next in the metta workflow.

## Steps

1. `metta next --json` → returns the next action and command to run
2. Execute the returned command
3. If it returns an artifact to build: spawn a subagent with the right metta agent type (intent/spec→metta-proposer, research→metta-researcher, design→metta-architect, tasks→metta-planner, implementation→metta-executor, verification→metta-verifier) using `metta instructions` and the agent execution pattern
4. After completing: `metta next --json` again to get the next step
5. Repeat until all artifacts are done, then `metta finalize`

## Rules

- Let the CLI drive — `metta next` tells you what to do
- MUST call `metta complete` for each artifact
- Commit ownership: the orchestrator commits planning, review, and verification artifacts after each subagent returns. The executor subagent commits atomically per task during implementation. Planning-artifact subagents (proposer, researcher, architect, planner, product) write files only — they do not run git.
- Token recording is automatic — a SubagentStop hook records each subagent's harness-measured usage; do not run `metta tokens record` after subagent returns. Only if the hook is unavailable, record manually: `metta tokens record --task <artifact-or-task-id> --agent <subagent-type> --model <alias> --tokens <count> --change <name> --source prose`.
- If `metta next` says "finalize", run `/metta:ship` to finalize and merge
- If `metta next` says "ship", run `/metta:ship` (or the returned command) to merge the branch to main
