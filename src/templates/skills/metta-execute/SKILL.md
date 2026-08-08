---
name: metta:execute
description: Run implementation for the active change
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: .claude/hooks/metta-session-mint.mjs metta-execute
---

**IMPORTANT: When using the Agent tool, use these metta agent types: metta-proposer, metta-researcher, metta-architect, metta-planner, metta-executor, metta-reviewer, metta-verifier, metta-discovery. Do NOT use gsd-executor or general-purpose.**

You are the **orchestrator** for implementation. Spawn executor subagents per batch.

## Steps

1. `metta status --json` → confirm implementation is ready
2. Read `{change_root}/spec/changes/<change>/tasks.md` for the task list. `change_root` comes from the `metta instructions <id> --json` payload (the root of the checkout hosting the change, emitted alongside `output_path`) — use it verbatim; never re-derive paths from the session cwd. If you do not yet hold a payload, resolve it the same way: the change's worktree at `.metta/worktrees/<change>/` when that directory exists, otherwise the main checkout root.
3. Group tasks by batch (Batch 1, Batch 2, etc.)
4. For each batch:
   a. Check if tasks in this batch touch **different files** (no overlap)
   b. If NO overlap → **spawn all tasks in parallel** using multiple Agent tool calls in a single message
   c. If overlap exists → spawn tasks **sequentially** (one at a time)
   d. Wait for all tasks in batch to complete before starting next batch
5. After all batches, write `{change_root}/spec/changes/<change>/summary.md`, then commit it: `git -C "{change_root}" add "{change_root}/spec/changes/<change>/summary.md" && git -C "{change_root}" commit -m 'docs(<change>): implementation summary'` — always `git -C "{change_root}"` with the paths quoted, never plain git from your cwd: for a worktree-hosted change a plain `git add` would target the wrong checkout or fail with 'outside repository'
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

For **every** executor spawn (parallel or sequential, first run or re-run — not just the examples above): read `agent.model` from `metta instructions <id> --json`. If it is not `inherit`, pass it as `Agent(subagent_type: "metta-executor", model: "<value>", ...)`. If it is `inherit`, omit the `model` parameter. Pass the payload's `change_root` into every executor prompt: all file paths handed to an executor must be absolute under `{change_root}`, and all commits it makes must use `git -C "{change_root}"` — never plain git from the session cwd.

After each subagent returns, record its reported token usage: `metta tokens record --task <artifact-or-task-id> --agent <subagent-type> --model <alias> --tokens <count> --change <name>` — `--task` is the artifact or task id it worked, `--agent` is the `subagent_type` you spawned, `--model` is the model alias you passed to `Agent(...)` (use `inherit` when you omitted the `model` parameter), and `--tokens` is the token count from its completion report. This applies to every spawn — planner, executor, reviewer, and verifier alike.

## How to detect file overlap

Read the **Files** field of each task in the batch. If any two tasks list the same file or directory prefix, they overlap. Example:
- Task 1.1 files: `src/auth/model.ts` — Task 1.2 files: `src/product/model.ts` → NO overlap → parallel
- Task 2.1 files: `src/api/routes.ts` — Task 2.2 files: `src/api/routes.ts` → OVERLAP → sequential

## Deviation Rules (include in every executor subagent prompt)

- Bug found → fix + separate commit: `fix(<change>): ...`
- Missing utility → add + separate commit
- Blocked (>10 lines to fix) → STOP, report back to orchestrator (orchestrator: see STOP handling below before re-invoking)
- Design is wrong → STOP immediately, report back to orchestrator

**STOP handling (orchestrator):** when an executor that ran under a non-`inherit` model reports STOP, before re-invoking the executor for the affected task run `metta model-escalation record --task <id> --from <resolved-model> --to inherit --trigger stop_deviation --change <name>`, then re-invoke the executor with the `model` parameter omitted (top-tier).
