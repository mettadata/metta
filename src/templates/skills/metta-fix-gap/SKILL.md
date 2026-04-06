---
name: metta:fix-gap
description: Resolve a reconciliation gap through the full metta change lifecycle
argument-hint: "<gap-slug or --all>"
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]
---

**IMPORTANT: When using the Agent tool, use these metta agent types: metta-proposer, metta-researcher, metta-architect, metta-planner, metta-executor, metta-reviewer, metta-verifier, metta-discovery. Do NOT use gsd-executor or general-purpose.**

You are the **orchestrator** for resolving reconciliation gaps. Each gap becomes a full metta change lifecycle.

## No-Argument Mode (interactive selection)

If `$ARGUMENTS` is empty (no gap-slug and no `--all`):

1. Run `metta gaps list --json` to get all open gaps
2. Display a ranked table to the user sorted by severity (critical > high > medium > low):
   | # | Slug | Severity | Summary |
   |---|------|----------|---------|
3. Ask the user via **AskUserQuestion**: "Which gap would you like to fix? Enter a number or slug."
4. Continue with the **Single Gap Pipeline** below using the selected gap

## Single Gap Pipeline

For a given `<gap-slug>`:

1. **Validate** — `metta gaps show <gap-slug> --json` → confirm gap exists and is open. If not found, report error and stop.

2. **Propose** — `metta propose "fix gap: <gap-slug> — <gap-summary>" --json` → creates change on branch `metta/<change-name>`

3. **Per-Artifact Loop** — For each planning artifact (intent, spec, design, tasks), spawn one subagent per artifact:
   `metta instructions <artifact> --json --change <name>` → spawn agent → `metta complete <artifact>`
   - Include the full gap details (from step 1) as context for every subagent
   - Discovery mode is always **batch** for fix-gap — the gap definition IS the discovery; do NOT run a separate discovery gate
   - For **research**: spawn 2-4 metta-researcher agents in parallel (one per approach)

4. **Implementation — MANDATORY PARALLEL EXECUTION:**
   **Do NOT spawn a single metta-executor for all tasks. You MUST parse batches and spawn per-task.**
   a. Read `spec/changes/<change>/tasks.md` — YOU the orchestrator, not a subagent
   b. Parse the batches (## Batch 1, ## Batch 2, etc.) and list tasks per batch
   c. For each batch:
      - List the **Files** field of each task
      - Different files → **spawn one metta-executor per task in a SINGLE message** (parallel)
      - Same files → spawn ONE AT A TIME (sequential)
      - Each executor prompt: include ONLY that task's details (Files, Action, Verify, Done)
      - Wait for ALL executors in batch to complete before next batch
   d. After all batches: write summary.md and commit
   e. `metta complete implementation --json --change <name>`

5. **Review — spawn 3 metta-reviewer agents in parallel** (fan-out — single message):
   - Agent 1 (subagent_type: "metta-reviewer"): "**Correctness reviewer**"
   - Agent 2 (subagent_type: "metta-reviewer"): "**Security reviewer**"
   - Agent 3 (subagent_type: "metta-reviewer"): "**Quality reviewer**"
   - Merge results into `spec/changes/<change>/review.md` and commit

6. **Review-Fix Loop (repeat until clean):**
   a. If any critical issues found:
      - Parse each issue's file path from review.md
      - Batch issues by file — independent files = parallel
      - Spawn one metta-executor per file batch (parallel fixes)
   b. After fixes: re-run the 3 reviewers
   c. If new issues found: repeat from (a)
   d. If all 3 reviewers report PASS or PASS_WITH_WARNINGS: exit loop
   e. Max 3 iterations — if still failing after 3 rounds, stop and report to user

7. **Verify — spawn 3 metta-verifier agents in parallel** (fan-out — single message):
   - Agent 1 (subagent_type: "metta-verifier"): "Run `npm test` — report pass/fail count and failures"
   - Agent 2 (subagent_type: "metta-verifier"): "Run `npx tsc --noEmit` and `npm run lint` — report errors"
   - Agent 3 (subagent_type: "metta-verifier"): "Read spec.md, check each scenario has a passing test — cite evidence"
   - Merge results into summary.md and commit
   - If any gate fails: spawn parallel metta-executors to fix, then re-verify

8. **Finalize** — `metta finalize --json --change <name>` → runs gates, archives, merges specs

9. **Merge** — `git checkout main && git merge metta/<change-name> --no-ff -m "chore: merge <change-name>"`

10. **Remove Gap** — `metta gaps remove <gap-slug> --json` → archives gap to `spec/archive/` then removes from `spec/gaps/`

## --all Mode (batch processing)

When `$ARGUMENTS` is `--all`:

1. Run `metta fix-gap --all --json` to get all gaps sorted by severity
2. **Batch gaps by file overlap** — read each gap file to identify which source files it touches:
   a. For each gap, extract the file paths mentioned (Location, Files fields)
   b. Batch gaps that touch the SAME files together (they must run sequentially)
   c. Gaps that touch DIFFERENT files are independent (can run in parallel)
3. **Spawn parallel executors per independent batch** — one metta-executor per batch in a SINGLE message:
   - Each executor gets ALL gaps in its batch, fixes them sequentially within the batch
   - Independent batchs run simultaneously
   - Example: gaps touching execution-engine.ts = Batch A, gaps touching context-engine.ts = Batch B → spawn 2 executors in parallel
4. After each batch completes:
   - Run `metta fix-gap --remove-gap <slug>` for each resolved gap in the batch
   - Log `[N/M] <slug>: resolved` or `[N/M] <slug>: failed at <phase>`
5. Print summary table:
   | Batch | Gaps | Files | Result |
   |-------|------|-------|--------|
   Show per-batch and total counts

## Rules

- Every subagent MUST write files to disk and git commit — no exceptions
- Every subagent MUST write files to disk and git commit
- Every artifact MUST be followed by `metta complete` to advance workflow
- Discovery mode is always **batch** for fix-gap — the gap definition provides all context
- Do NOT skip review or verification — all 3 reviewers and 3 verifiers MUST run
- Do NOT stop after verification — finalize + merge + remove-gap must happen
- If metta finalize fails gates, spawn a metta-executor to fix, then retry
- Deviation Rule 4: design is wrong → STOP, tell user
