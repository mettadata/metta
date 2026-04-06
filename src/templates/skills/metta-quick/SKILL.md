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
4. **Spawn a metta-executor agent** (subagent_type: "metta-executor") for the implementation:
   - Read the intent for context
   - Implement the change, run tests, commit code
   - Write `spec/changes/<change>/summary.md`, commit it
5. `metta complete implementation --json --change <name>` → advances to verification
6. **Spawn a metta-reviewer agent** (subagent_type: "metta-reviewer") for code review:
   - Review ALL changed files for correctness, security, quality, performance
   - Write `spec/changes/<change>/review.md` with issues and verdict
   - If verdict is NEEDS_CHANGES: spawn a metta-executor to fix the issues, then re-review
7. **Spawn a metta-verifier agent** (subagent_type: "metta-verifier") for verification:
   - Run `npm test` and `npm run lint` and `npx tsc --noEmit`
   - Read the intent.md and check each stated goal is implemented
   - If any gate fails: spawn a metta-executor to fix it, then re-verify
   - Write verification results to `spec/changes/<change>/summary.md` (append or update)
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
