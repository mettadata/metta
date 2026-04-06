---
name: metta:quick
description: Quick mode — small change without full planning
argument-hint: "<description of the small change>"
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]
---

**IMPORTANT: When using the Agent tool, use these metta agent types: metta-proposer, metta-researcher, metta-architect, metta-planner, metta-executor, metta-reviewer, metta-verifier, metta-discovery. Do NOT use gsd-executor or general-purpose.**

You are the **orchestrator** for a quick change (intent → implementation → review → verification → finalize → merge).

## Steps

1. `metta quick "$ARGUMENTS" --json` → creates change on branch `metta/<change-name>`

2. **LIGHT DISCOVERY (mandatory — do NOT skip):**
   Before writing the intent, YOU (the orchestrator) MUST check if the change has ambiguity.
   - If the description is clear and specific (e.g. "fix typo in header") → proceed without questions
   - If there are decisions to make (e.g. which approach, what scope, what behavior) → ask 1-3 quick questions using AskUserQuestion
   - Pass answers to the proposer subagent

3. **Spawn a metta-proposer agent** (subagent_type: "metta-proposer", isolation: "worktree") for the intent:
   `metta instructions intent --json --change <name>` → get template + persona
   Subagent writes intent.md (Problem, Proposal, Impact, Out of Scope), commits it
4. `metta complete intent --json --change <name>` → advances to implementation
5. **Implementation — check if work can be parallelized:**
   - Read the intent to identify independent pieces (e.g. separate files, separate modules)
   - If multiple independent files → **spawn one metta-executor per file group in a single message**, each with `isolation: "worktree"` (parallel)
   - If all changes touch the same files → spawn a single metta-executor with `isolation: "worktree"` (sequential)
   - Each executor: implement its piece, run tests, commit with `feat(<change>): <description>`
   - After all executors complete, write `spec/changes/<change>/summary.md` and commit
6. `metta complete implementation --json --change <name>` → advances to verification
7. **Spawn 3 metta-reviewer agents in parallel** (fan-out — single message, each with `isolation: "worktree"`):
   - Agent 1 (subagent_type: "metta-reviewer", isolation: "worktree"): "You are a **correctness reviewer**."
   - Agent 2 (subagent_type: "metta-reviewer", isolation: "worktree"): "You are a **security reviewer**."
   - Agent 3 (subagent_type: "metta-reviewer", isolation: "worktree"): "You are a **quality reviewer**."
   - Each writes their findings. Merge results into `spec/changes/<change>/review.md` and commit.
   - **REVIEW-FIX LOOP (repeat until clean):**
     a. If critical issues found: group by file, spawn parallel metta-executors to fix
     b. After fixes: re-run the 3 reviewers
     c. Repeat until all reviewers report PASS/PASS_WITH_WARNINGS (max 3 iterations)
8. **Spawn 3 metta-verifier agents in parallel** (fan-out verification — single message):
   - Agent 1 (subagent_type: "metta-verifier"): "Run `npm test` — report pass/fail count and any failures"
   - Agent 2 (subagent_type: "metta-verifier"): "Run `npx tsc --noEmit` and `npm run lint` — report any type or lint errors"
   - Agent 3 (subagent_type: "metta-verifier"): "Read intent.md and check each stated goal is implemented in the code — cite file:line evidence"
   - Merge results into `spec/changes/<change>/summary.md` and commit
   - If any gate fails: spawn parallel metta-executors to fix, then re-verify
9. `metta complete verification --json --change <name>`
10. `metta finalize --json --change <name>` → runs gates, archives, merges specs
11. `git checkout main && git merge metta/<change-name> --no-ff -m "chore: merge <change-name>"`
12. Report to user what was done

## Critical: You MUST complete ALL steps

- Do NOT skip step 2 (discovery) — ask questions if the change has any ambiguity
- Do NOT skip step 7 (review) — 3 reviewers MUST review code
- Do NOT skip step 8 (verification) — 3 verifiers MUST confirm gates pass
- Do NOT stop after step 5 — the change is not done until merged to main
- If reviewer verdict is NEEDS_CHANGES, fix before proceeding to verification
- If finalize fails gates, spawn metta-executor to fix, then retry

## Subagent Rules

- MUST write all files to disk — not just describe them
- MUST git commit after each step
- If the change turns out to be complex, tell the user to use `/metta:propose` instead
