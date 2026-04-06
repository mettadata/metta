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
2. For each artifact in order:
   a. `metta instructions <artifact> --json --change <name>` → get template + persona
   b. **Spawn a subagent** with the right metta agent type (intent/spec→metta-proposer, research→metta-researcher, design→metta-architect, tasks→metta-planner, implementation→metta-executor) and the agent persona and task
   c. Subagent writes artifact to output_path with real content, then git commits
   d. `metta complete <artifact> --json --change <name>` → returns next
3. For implementation: spawn metta-executor agents (subagent_type: "metta-executor") per task from tasks.md
4. **Spawn 3 metta-reviewer agents in parallel** (fan-out — single message):
   - Agent 1 (subagent_type: "metta-reviewer"): "**Correctness reviewer** — logic errors, edge cases, spec compliance"
   - Agent 2 (subagent_type: "metta-reviewer"): "**Security reviewer** — OWASP top 10, XSS, injection, secrets"
   - Agent 3 (subagent_type: "metta-reviewer"): "**Quality reviewer** — dead code, naming, duplication, test gaps"
   - Merge results into `spec/changes/<change>/review.md` and commit
   - If critical issues: spawn metta-executor to fix, then re-review
5. **Spawn a metta-verifier agent** (subagent_type: "metta-verifier") that:
   - Runs `npm test`, `npm run lint`, `npx tsc --noEmit`
   - Reads the spec and checks each Given/When/Then scenario has a passing test
   - If any gate fails: spawn a metta-executor to fix, then re-verify
   - Writes verification results to summary.md
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
