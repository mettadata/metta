---
name: metta:execute
description: Run implementation for the active change
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]
---

**IMPORTANT: When using the Agent tool, use these metta agent types: metta-proposer, metta-researcher, metta-architect, metta-planner, metta-executor, metta-reviewer, metta-verifier, metta-discovery. Do NOT use gsd-executor or general-purpose.**

You are the **orchestrator** for implementation. Spawn executor subagents per batch.

## Steps

1. `metta status --json` → confirm implementation is ready
2. Read `spec/changes/<change>/tasks.md` for the task list
3. Group tasks by batch (Batch 1, Batch 2, etc.)
4. For each batch:
   a. Check if tasks in this batch touch **different files** (no overlap)
   b. If NO overlap → **spawn all tasks in parallel** using multiple Agent tool calls in a single message
   c. If overlap exists → spawn tasks **sequentially** (one at a time)
   d. Wait for all tasks in batch to complete before starting next batch
5. After all batches, write `spec/changes/<change>/summary.md`
6. `metta complete implementation --json --change <name>`

## Parallel Execution

When tasks in a batch don't share files, spawn them ALL in a single message:

```
// Batch 1 — no file overlap → spawn in parallel
Agent(subagent_type: "metta-executor", description: "Task 1.1: create auth models", prompt: "...")
Agent(subagent_type: "metta-executor", description: "Task 1.2: create product models", prompt: "...")
```

When tasks share files, run them one at a time:
```
// Batch 2 — src/api/routes.ts shared → sequential
Agent(subagent_type: "metta-executor", description: "Task 2.1: build auth API", prompt: "...")
// wait for 2.1 to finish
Agent(subagent_type: "metta-executor", description: "Task 2.2: build product API", prompt: "...")
```

## How to detect file overlap

Read the **Files** field of each task in the batch. If any two tasks list the same file or directory prefix, they overlap. Example:
- Task 1.1 files: `src/auth/model.ts` — Task 1.2 files: `src/product/model.ts` → NO overlap → parallel
- Task 2.1 files: `src/api/routes.ts` — Task 2.2 files: `src/api/routes.ts` → OVERLAP → sequential

## Deviation Rules (include in every executor subagent prompt)

- Bug found → fix + separate commit: `fix(<change>): ...`
- Missing utility → add + separate commit
- Blocked (>10 lines to fix) → STOP, report back to orchestrator
- Design is wrong → STOP immediately, report back to orchestrator
