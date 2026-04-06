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
2. **Spawn a metta-proposer agent** (subagent_type: "metta-proposer") for the intent:
   `metta instructions intent --json --change <name>` → get template + persona
   Subagent writes intent.md (Problem, Proposal, Impact, Out of Scope), commits it
3. `metta complete intent --json --change <name>` → advances to implementation
4. **Implementation — check if work can be parallelized:**
   - Read the intent to identify independent pieces (e.g. separate files, separate modules)
   - If multiple independent files → **spawn one metta-executor per file group in a single message** (parallel)
   - If all changes touch the same files → spawn a single metta-executor (sequential)
   - Each executor: implement its piece, run tests, commit with `feat(<change>): <description>`
   - After all executors complete, write `spec/changes/<change>/summary.md` and commit
5. `metta complete implementation --json --change <name>` → advances to verification
6. **Spawn 3 metta-reviewer agents in parallel** (fan-out review — send all 3 in a single message):
   - Agent 1 (subagent_type: "metta-reviewer"): "You are a **correctness reviewer**. Check logic errors, off-by-one bugs, unhandled edge cases, spec compliance."
   - Agent 2 (subagent_type: "metta-reviewer"): "You are a **security reviewer**. Check OWASP top 10, XSS, injection, unvalidated input, secrets in code."
   - Agent 3 (subagent_type: "metta-reviewer"): "You are a **quality reviewer**. Check dead code, unused imports, naming, duplication, test coverage gaps."
   - Each writes their findings. Merge results into `spec/changes/<change>/review.md` and commit.
   - If any reviewer finds critical issues:
     a. Parse each issue's file path from review.md
     b. Group issues by file — issues in different files are independent
     c. **Spawn one metta-executor per independent file group in a single message** (parallel fixes)
     d. After all executors complete, re-run the 3 reviewers to verify fixes
7. **Spawn 3 metta-verifier agents in parallel** (fan-out verification — single message):
   - Agent 1 (subagent_type: "metta-verifier"): "Run `npm test` — report pass/fail count and any failures"
   - Agent 2 (subagent_type: "metta-verifier"): "Run `npx tsc --noEmit` and `npm run lint` — report any type or lint errors"
   - Agent 3 (subagent_type: "metta-verifier"): "Read intent.md and check each stated goal is implemented in the code — cite file:line evidence"
   - Merge results into `spec/changes/<change>/summary.md` and commit
   - If any gate fails: spawn parallel metta-executors to fix, then re-verify
8. `metta complete verification --json --change <name>`
9. `metta finalize --json --change <name>` → runs gates, archives, merges specs
10. `git checkout main && git merge metta/<change-name> --no-ff -m "chore: merge <change-name>"`
11. Report to user what was done

## Critical: You MUST complete ALL steps

- Do NOT skip step 6 (review) — a metta-reviewer MUST review code before verification
- Do NOT skip step 7 (verification) — a metta-verifier MUST confirm gates pass
- Do NOT stop after step 5 — the change is not done until merged to main
- If reviewer verdict is NEEDS_CHANGES, fix before proceeding to verification
- If finalize fails gates, spawn metta-executor to fix, then retry

## Subagent Rules

- MUST write all files to disk — not just describe them
- MUST git commit after each step
- If the change turns out to be complex, tell the user to use `/metta:propose` instead
