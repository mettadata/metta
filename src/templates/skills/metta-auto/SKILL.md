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

3. For each artifact in order:
   a. `metta instructions <artifact> --json --change <name>` → get template + persona
   b. **Spawn a subagent** with the right metta agent type (intent/spec→metta-proposer, research→metta-researcher, design→metta-architect, tasks→metta-planner, implementation→metta-executor) and the agent persona and task
   c. Subagent writes artifact to output_path with real content, then git commits
   d. `metta complete <artifact> --json --change <name>` → returns next
3. **For implementation — batch-parallel execution:**
   a. Read `spec/changes/<change>/tasks.md` yourself (the orchestrator, not a subagent)
   b. Parse batches (Batch 1, Batch 2, etc.)
   c. For each batch: check file overlap between tasks in that batch
   d. No overlap → **spawn one metta-executor per task in a single message** (parallel)
   e. Overlap → spawn tasks sequentially
   f. Wait for each batch to complete before starting the next
4. **Spawn 3 metta-reviewer agents in parallel** (fan-out — single message):
   - Agent 1 (subagent_type: "metta-reviewer"): "**Correctness reviewer** — logic errors, edge cases, spec compliance"
   - Agent 2 (subagent_type: "metta-reviewer"): "**Security reviewer** — OWASP top 10, XSS, injection, secrets"
   - Agent 3 (subagent_type: "metta-reviewer"): "**Quality reviewer** — dead code, naming, duplication, test gaps"
   - Merge results into `spec/changes/<change>/review.md` and commit
   - If critical issues:
     a. Parse each issue's file path from review.md
     b. Group by file — independent files = parallel
     c. **Spawn one metta-executor per independent file group in a single message**
     d. After fixes complete, re-run the 3 reviewers
5. **Spawn 3 metta-verifier agents in parallel** (fan-out — single message):
   - Agent 1 (subagent_type: "metta-verifier"): "Run `npm test` — report pass/fail count and failures"
   - Agent 2 (subagent_type: "metta-verifier"): "Run `npx tsc --noEmit` and `npm run lint` — report errors"
   - Agent 3 (subagent_type: "metta-verifier"): "Read spec.md, check each scenario has a passing test — cite evidence"
   - Merge results into summary.md and commit
   - If any gate fails: spawn parallel metta-executors to fix, then re-verify
6. `metta complete verification --json --change <name>`
7. `metta finalize --json --change <name>` → runs gates, archives, merges specs
8. `git checkout main && git merge metta/<change-name> --no-ff -m "chore: merge <change-name>"`
9. Report results to user

## Critical: You MUST review, verify, finalize, and merge

- Do NOT skip step 4 (review) — a metta-reviewer MUST review code before verification
- Do NOT skip step 5 (verify) — a metta-verifier MUST run gates and confirm spec compliance
- Do NOT stop after verification — finalize + merge must happen
- If reviewer verdict is NEEDS_CHANGES, fix before verifying
- If finalize fails gates, spawn metta-executor to fix, then retry

## Rules

- Ask discovery questions BEFORE writing spec — don't guess requirements
- Every subagent MUST write files to disk and git commit
- Every artifact MUST be followed by `metta complete` to advance workflow
- Deviation Rule 4: design is wrong → STOP, tell user
