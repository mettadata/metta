---
name: metta:auto
description: Full lifecycle loop — discover, build, verify, ship
argument-hint: "<description of what to build>"
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]
---

**IMPORTANT: When using the Agent tool, use these metta agent types: metta-proposer, metta-researcher, metta-architect, metta-planner, metta-executor, metta-reviewer, metta-verifier, metta-discovery. Do NOT use gsd-executor or general-purpose.**

You are the **orchestrator** for the full Metta lifecycle. Spawn subagents for each phase.

## Steps

1. `metta propose "$ARGUMENTS" --json` → creates change

2. **DISCOVERY GATE (mandatory):**
   Before writing ANY artifacts, YOU (the orchestrator) MUST ask discovery questions using AskUserQuestion.
   a. Scan relevant codebase files for context
   b. Identify ambiguity — architecture choices, scope, data model, edge cases
   c. Ask 3-6 focused questions with concrete options
   d. Wait for answers before proceeding
   e. Pass answers as context to all downstream subagents

3. For each **planning** artifact (intent, spec, design, tasks) — one subagent per artifact:
   `metta instructions <artifact> --json` → spawn agent with `isolation: "worktree"` → `metta complete <artifact>`
   For **research**: spawn 2-4 metta-researcher agents in parallel (one per approach), each with `isolation: "worktree"`

4. **IMPLEMENTATION — MANDATORY PARALLEL EXECUTION:**
   **⚠️ DO NOT spawn a single metta-executor for all tasks. You MUST parse batches and spawn per-task.**
   a. Read `spec/changes/<change>/tasks.md` — YOU the orchestrator, not a subagent
   b. Parse the batches (## Batch 1, ## Batch 2, etc.) and list tasks per batch
   c. For each batch:
      - List the **Files** field of each task
      - Different files → **spawn one metta-executor per task in a SINGLE message** (parallel, each with `isolation: "worktree"`)
      - Same files → spawn ONE AT A TIME (sequential, each with `isolation: "worktree"`)
      - Each executor prompt: include ONLY that task's details (Files, Action, Verify, Done)
      - Wait for ALL executors in batch to complete before next batch
   d. After all batches: write summary.md and commit
   e. `metta complete implementation --json --change <name>`
5. **Spawn 3 metta-reviewer agents in parallel** (fan-out, each with `isolation: "worktree"`):
   - Agent 1 (subagent_type: "metta-reviewer", isolation: "worktree"): "**Correctness reviewer**"
   - Agent 2 (subagent_type: "metta-reviewer", isolation: "worktree"): "**Security reviewer**"
   - Agent 3 (subagent_type: "metta-reviewer", isolation: "worktree"): "**Quality reviewer**"
   - Merge results into `spec/changes/<change>/review.md` and commit
   - If critical issues:
   **REVIEW-FIX LOOP (repeat until clean):**
     a. Group issues by file, spawn parallel metta-executors to fix
     b. After fixes: re-run the 3 reviewers
     c. Repeat until all PASS/PASS_WITH_WARNINGS (max 3 iterations)
6. **Spawn 3 metta-verifier agents in parallel** (fan-out — single message):
   - Agent 1 (subagent_type: "metta-verifier"): "Run `npm test` — report pass/fail count and failures"
   - Agent 2 (subagent_type: "metta-verifier"): "Run `npx tsc --noEmit` and `npm run lint` — report errors"
   - Agent 3 (subagent_type: "metta-verifier"): "Read spec.md, check each scenario has a passing test — cite evidence"
   - Merge results into summary.md and commit
   - If any gate fails: spawn parallel metta-executors to fix, then re-verify
7. `metta complete verification --json --change <name>`
8. `metta finalize --json --change <name>` → runs gates, archives, merges specs
9. `git checkout main && git merge metta/<change-name> --no-ff -m "chore: merge <change-name>"`
10. Report results to user

## Critical: You MUST review, verify, finalize, and merge

- Do NOT skip step 5 (review) — 3 reviewers MUST review code before verification
- Do NOT skip step 5 (verify) — a metta-verifier MUST run gates and confirm spec compliance
- Do NOT stop after verification — finalize + merge must happen
- If reviewer verdict is NEEDS_CHANGES, fix before verifying
- If finalize fails gates, spawn metta-executor to fix, then retry

## Rules

- Ask discovery questions BEFORE writing spec — don't guess requirements
- Every subagent MUST write files to disk and git commit
- Every artifact MUST be followed by `metta complete` to advance workflow
- Deviation Rule 4: design is wrong → STOP, tell user
