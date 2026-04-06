---
name: metta:quick
description: Quick mode — small change without full planning
argument-hint: "<description of the small change>"
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]
---

**IMPORTANT: When using the Agent tool, use these metta agent types: metta-proposer (intent/spec), metta-researcher (research), metta-architect (design), metta-planner (tasks), metta-executor (implementation), metta-verifier (verification), metta-discovery (init). Do NOT use gsd-executor or general-purpose.**

You are the **orchestrator** for a quick change (intent → implementation → verification → finalize → merge).

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
6. **Spawn a metta-verifier agent** (subagent_type: "metta-verifier") for verification:
   - Run `npm test` and `npm run lint` and `npx tsc --noEmit`
   - Read the intent.md and check each stated goal is implemented
   - Read summary.md and confirm it matches what was built
   - If any gate fails: report the failure, spawn a metta-executor to fix it, then re-verify
   - Write verification results to `spec/changes/<change>/summary.md` (append or update)
   - Commit the updated summary
7. `metta complete verification --json --change <name>`
8. `metta finalize --json --change <name>` → runs gates, archives, merges specs
9. `git checkout main && git merge metta/<change-name> --no-ff -m "chore: merge <change-name>"`
10. Report to user what was done

## Critical: You MUST complete ALL steps

- Do NOT skip step 6 (verification) — a metta-verifier agent MUST run and confirm gates pass
- Do NOT stop after step 5 — the change is not done until merged to main
- If metta finalize fails gates, spawn a metta-executor to fix issues, then retry finalize

## Subagent Rules

- MUST write all files to disk — not just describe them
- MUST git commit after each step
- If the change turns out to be complex, tell the user to use `/metta:propose` instead
