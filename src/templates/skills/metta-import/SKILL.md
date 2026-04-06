---
name: metta:import
description: Analyze existing code and generate specs with gap reports
argument-hint: "<directory to import — use . for entire project>"
allowed-tools: [Read, Write, Bash, Grep, Glob, Agent]
---

**IMPORTANT: When using the Agent tool, use metta agent types with isolation: "worktree". Do NOT use gsd-executor or general-purpose.**

You are the **orchestrator** for importing existing code into metta specs.

## Steps

1. `metta import "$ARGUMENTS" --json` → returns scan path, modules list, and output paths
2. Parse the response — check `mode` (parallel or single) and `modules` list
3. **If modules > 1**: spawn one metta-researcher per module **in parallel** (single message, each with isolation: "worktree")
   **If single module**: spawn one metta-researcher for the whole path (with isolation: "worktree")
4. Each researcher agent must:
   - Read all source files in their scan path
   - Identify logical capabilities (route groups, store modules, component groups)
   - For each capability, write `spec/specs/<capability>/spec.md`:
     - Use RFC 2119 keywords (MUST/SHOULD/MAY)
     - Extract Given/When/Then scenarios from existing tests
     - Mark each requirement with status: verified (has tests), partial, or uncovered
   - Run reconciliation — compare spec claims vs code evidence:
     - Requirement in spec but no code → gap: claimed-not-built
     - Code exists but no spec → gap: built-not-documented
     - Spec says X, code does Y → gap: diverged
     - Partially implemented → gap: partial
   - Write gap files to `spec/gaps/<slug>.md` for each mismatch
5. After all researchers complete, merge results and commit:
   `git add spec/ && git commit -m "docs: import specs from <path>"`
6. Report summary: specs generated, gaps found, test coverage

## Example

```
/metta:import .
→ metta import . --json
→ Spawns researcher to scan entire project
→ Generates spec/specs/todos/spec.md, spec/specs/kanban/spec.md, etc.
→ Creates spec/gaps/kanban-drag-no-tests.md for untested behaviors
→ Commits all specs and gaps

/metta:import src/lib/stores --by-module  
→ Spawns parallel researchers: one for todos.ts, one for kanban.ts, one for labels.ts
→ Each generates its own spec + gaps
```
