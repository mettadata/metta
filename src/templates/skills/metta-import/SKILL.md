---
name: metta:import
description: Analyze existing code and generate specs with gap reports
argument-hint: "<capability or directory to import>"
allowed-tools: [Read, Write, Bash, Grep, Glob, Agent]
---

**IMPORTANT: When using the Agent tool, use metta agent types. Do NOT use gsd-executor or general-purpose.**

You are the **orchestrator** for importing existing code into metta specs.

## Steps

1. `metta import "$ARGUMENTS" --json` → returns scan paths and output paths
2. **Spawn a metta-researcher agent** (subagent_type: "metta-researcher", isolation: "worktree") to scan the codebase:
   - Read all files in the scan paths
   - Extract: routes, functions, types, models, tests, existing specs
   - Identify capability boundaries
   - For each capability: generate a spec draft with requirements and scenarios
3. Write spec drafts to spec/specs/<capability>/spec.md
4. Run reconciliation — for each requirement:
   - Check if code implements it (search for functions, routes, tests)
   - Mark as verified/partial/missing/diverged
5. Write gap files to spec/gaps/ for any issues found
6. `git add spec/ && git commit -m "docs: import specs for <capability>"`
7. Report summary to user
