---
name: metta:fix-issues
description: Resolve an issue through the full metta change lifecycle
argument-hint: "<issue-slug or --all>"
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]
context: fork
agent: metta-skill-host
---

**IMPORTANT: When using the Agent tool, use these metta agent types: metta-proposer, metta-researcher, metta-architect, metta-planner, metta-executor, metta-reviewer, metta-verifier, metta-discovery. Do NOT use gsd-executor or general-purpose.**

You are the **orchestrator** for resolving issues. Each issue becomes a full metta change lifecycle.

## No-Argument Mode (interactive selection)

If `$ARGUMENTS` is empty (no issue-slug and no `--all`):

1. Run `metta issues list --json` to get all open issues
2. Display a ranked table to the user sorted by severity (critical > major > minor):
   | # | Slug | Severity | Summary |
   |---|------|----------|---------|
3. Ask the user via **AskUserQuestion**: "Which issue would you like to fix? Enter a number or slug."
4. Continue with the **Single Issue Pipeline** below using the selected issue

## Single Issue Pipeline

For a given `<issue-slug>`:

1. **Validate** — `metta issues show <issue-slug> --json` → confirm issue exists and is open. If not found, report error and stop.

   From the returned JSON, display the `## Symptom`, `## Root Cause Analysis` (including any `### Evidence` subsection), and `## Candidate Solutions` sections of the `description` field to the orchestrator. If one or more sections are absent (legacy shallow issue), display whatever body content is present and continue — do not error.

2. **Propose** — `METTA_SKILL=1 metta propose "fix-<issue-slug>" --json` → creates change on branch `metta/<change-name>`

3. **Per-Artifact Loop** — For each planning artifact (intent, spec, design, tasks), spawn one subagent per artifact:
   `metta instructions <artifact> --json --change <name>` → spawn agent → `METTA_SKILL=1 metta complete <artifact>`
   - Include the full issue details (from step 1) as context for every subagent
   - Discovery mode is always **batch** for fix-issues — the issue definition IS the discovery; do NOT run a separate discovery gate
   - For **research**: spawn 2-4 metta-researcher agents in parallel (one per approach). Each researcher MUST write to `spec/changes/<change>/research-<approach-slug>.md` (a short kebab-case slug per approach, e.g. `research-websockets.md`, `research-sse.md`, `research-polling.md`). Forbid `/tmp/` paths — per-approach output MUST be in-tree so the synthesis step can read it.

4. **Synthesize research** — read all `spec/changes/<change>/research-*.md` files you just created, write a single consolidated `spec/changes/<change>/research.md` that summarizes each approach and ends with a recommendation, and git-commit it. Do NOT call `METTA_SKILL=1 metta complete research` until `spec/changes/<change>/research.md` exists on disk with real content.

5. **Implementation — MANDATORY PARALLEL EXECUTION:**
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
   e. `METTA_SKILL=1 metta complete implementation --json --change <name>`

6. **Review — spawn 3 metta-reviewer agents in parallel** (fan-out — single message):
   - Before spawning reviewer agents, run: `METTA_SKILL=1 metta iteration record --phase review --change <name>`
   - Agent 1 (subagent_type: "metta-reviewer"): "**Correctness reviewer**"
   - Agent 2 (subagent_type: "metta-reviewer"): "**Security reviewer**"
   - Agent 3 (subagent_type: "metta-reviewer"): "**Quality reviewer**"
   - Merge results into `spec/changes/<change>/review.md` and commit

7. **Review-Fix Loop (repeat until clean):**
   a. Run `METTA_SKILL=1 metta iteration record --phase review --change <name>`
   b. If any critical issues found:
      - Parse each issue's file path from review.md
      - Batch issues by file — independent files = parallel
      - Spawn one metta-executor per file batch (parallel fixes)
   c. After fixes: re-run the 3 reviewers
   d. If new issues found: repeat from (a)
   e. If all 3 reviewers report PASS or PASS_WITH_WARNINGS: exit loop
   f. Max 3 iterations — if still failing after 3 rounds, stop and report to user

8. **Verify — spawn 3 metta-verifier agents in parallel** (fan-out — single message):
   - Before spawning verifier agents, run: `METTA_SKILL=1 metta iteration record --phase verify --change <name>`
   - Agent 1 (subagent_type: "metta-verifier"): "Run `npm test` — report pass/fail count and failures"
   - Agent 2 (subagent_type: "metta-verifier"): "Run `npx tsc --noEmit` and `npm run lint` — report errors"
   - Agent 3 (subagent_type: "metta-verifier"): "Read spec.md, check each scenario has a passing test — cite evidence"
   - Merge results into summary.md and commit
   - If any gate fails: run `METTA_SKILL=1 metta iteration record --phase verify --change <name>` again, then spawn parallel metta-executors to fix, then re-verify

9. **Finalize** — `METTA_SKILL=1 metta finalize --json --change <name>` → runs gates, archives, merges specs

10. **Merge** — `git checkout main && git merge metta/<change-name> --no-ff -m "chore: merge <change-name>"`

11. **Remove Issue** — `METTA_SKILL=1 metta fix-issue --remove-issue <issue-slug> --json` → archives issue to `spec/issues/resolved/` then removes from `spec/issues/`

## --all Mode (batch processing)

**⚠️ MUST process ALL issues from critical → major → minor. Do NOT stop after any severity tier.**

When `$ARGUMENTS` is `--all` (optionally with `--severity <level>`):

1. Run `METTA_SKILL=1 metta fix-issue --all --json` (or `METTA_SKILL=1 metta fix-issue --all --severity critical --json` if user specified a severity filter) to get issues sorted by severity
2. **Batch issues by file overlap** — read each issue file to identify which source files it touches:
   a. For each issue, extract the file paths mentioned (Location, Files fields)
   b. Batch issues that touch the SAME files together (they must run sequentially)
   c. Issues that touch DIFFERENT files are independent (can run in parallel)
3. **Spawn parallel executors per independent batch** — one metta-executor per batch in a SINGLE message:
   - Each executor gets ALL issues in its batch, fixes them sequentially within the batch
   - Independent batches run simultaneously
   - Example: issues touching execution-engine.ts = Batch A, issues touching context-engine.ts = Batch B → spawn 2 executors in parallel
4. After each batch completes:
   - Run `METTA_SKILL=1 metta fix-issue --remove-issue <slug>` for each resolved issue in the batch
   - Log `[N/M] <slug>: resolved` or `[N/M] <slug>: failed at <phase>`
5. **Continue until ALL issues are processed** — critical, major, AND minor. Never stop early.
   - If an issue fails: log it, skip it, continue to the next
   - If an entire batch fails: log it, continue to the next batch
6. Print summary table:
   | Batch | Issues | Files | Result |
   |-------|--------|-------|--------|
   Show per-batch and total counts: `Resolved: X / Failed: Y / Total: Z`

## Rules

- Commit ownership: the orchestrator commits planning, review, and verification artifacts after each subagent returns. The executor subagent commits atomically per task during implementation. Planning-artifact subagents (proposer, researcher, architect, planner, product) write files only — they do not run git.
- Every artifact MUST be followed by `METTA_SKILL=1 metta complete` to advance workflow
- Discovery mode is always **batch** for fix-issues — the issue definition provides all context
- Do NOT skip review or verification — all 3 reviewers and 3 verifiers MUST run
- Do NOT stop after verification — finalize + merge + remove-issue must happen
- If metta finalize fails gates, spawn a metta-executor to fix, then retry
- Deviation Rule 4: design is wrong → STOP, tell user
