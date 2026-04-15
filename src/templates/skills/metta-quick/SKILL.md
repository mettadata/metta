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
   Before writing the intent, YOU (the orchestrator, not a subagent) MUST evaluate whether the change carries meaningful ambiguity BEFORE asking any questions.

   **Trivial-detection gate (first action):**
   - Trivial examples: single-line fix, typo correction, one-file delete — **zero questions**, proceed directly to spawning the proposer subagent.
   - Functional criterion: if the description leaves no approach, scope, or integration decisions unresolved → trivially scoped, skip the loop.
   - Non-trivial: multi-file change, existing contract touched, scope or approach unclear → enter the **DISCOVERY LOOP** below.

   **DISCOVERY LOOP (entered only when non-trivial):**
   Self-contained since this skill invokes independently of `/metta:propose`.

   - **Exit-option declaration:** every `AskUserQuestion` call within the loop MUST include a final selectable option exactly spelled `I'm done — proceed with these answers`.
   - **Round 1 (scope + architecture):** always runs once the loop is engaged. Ask 2–4 questions covering scope boundaries and architectural approach.
   - **Round 2 (data model + integration points):** conditional — run when the change involves file schemas, API contracts, external system calls, or store methods. Skip otherwise.
   - **Round 3 (edge cases + non-functional):** conditional — run when the change touches runtime code paths. Skip for docs-only or skill-only changes.
   - **Round 4+ (open-ended):** repeat while you honestly find remaining ambiguity; stop when none remains.
   - **Between-round status line** (print verbatim format before each new round):
     `Resolved: <A>, <B>. Open: <C> — proceeding to Round N.`
     When no further rounds are needed: `Resolved: all questions. Proceeding to proposer subagent.`
   - **Exit criterion:** the loop exits when (a) you honestly find no further ambiguity, or (b) the user selects the early-exit option `I'm done — proceed with these answers`.

   **Cumulative context:** pass the full set of all question-answer pairs from all completed rounds to the proposer subagent; answers from later rounds supplement, not replace, earlier answers.

3. **Spawn a metta-proposer agent** (subagent_type: "metta-proposer") for the intent:
   `metta instructions intent --json --change <name>` → get template + persona
   Subagent writes intent.md (Problem, Proposal, Impact, Out of Scope), commits it
4. `metta complete intent --json --change <name>` → advances to implementation
5. **Implementation — check if work can be parallelized:**
   - Read the intent to identify independent pieces (e.g. separate files, separate modules)
   - If multiple independent files → **spawn one metta-executor per file group in a single message** (parallel)
   - If all changes touch the same files → spawn a single metta-executor (sequential)
   - Each executor: implement its piece, run tests, commit with `feat(<change>): <description>`
   - After all executors complete, write `spec/changes/<change>/summary.md` and commit
6. `metta complete implementation --json --change <name>` → advances to verification
7. **Spawn 3 metta-reviewer agents in parallel** (fan-out — single message):
   - Agent 1 (subagent_type: "metta-reviewer"): "You are a **correctness reviewer**."
   - Agent 2 (subagent_type: "metta-reviewer"): "You are a **security reviewer**."
   - Agent 3 (subagent_type: "metta-reviewer"): "You are a **quality reviewer**."
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
