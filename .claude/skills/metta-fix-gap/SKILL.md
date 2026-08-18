---
name: metta:fix-gap
description: Resolve a reconciliation gap through the full metta change lifecycle
argument-hint: "<gap-slug or --all>"
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: .claude/hooks/metta-session-mint.mjs metta-fix-gap
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

2. **Propose** — Invoke the `/metta-propose` skill via the Skill tool with the description `fix gap: <gap-slug> — <gap-summary>` → creates change on branch `metta/<change-name>`. Do NOT call `metta propose` directly: `propose` is a Tier-1 fork-enforced subcommand authorized solely by a verified fork caller identity, and metta-fix-gap runs as a Tier-2 session-credentialed skill that can never supply one. Routing through the Skill tool dispatches into `/metta-propose`'s own forked execution (`context: fork`, `agent: metta-skill-host`), which carries the trusted `agent_type` the guard requires. Note the returned change name for the steps below.

3. **Per-Artifact Loop** — For each planning artifact (intent, spec, design, tasks), spawn one subagent per artifact:
   `metta instructions <artifact> --json --change <name>` → spawn agent → `metta complete <artifact>`
   - The `metta propose` JSON payload carries `worktree` — the root of the checkout hosting the change (when null, the main checkout root hosts the change); treat that value as `{change_root}`. The `metta instructions` JSON payloads carry an absolute `output_path` and `change_root`. Use them verbatim; never re-derive paths from the session cwd.
   - Include the full gap details (from step 1) as context for every subagent
   - Discovery mode is always **batch** for fix-gap — the gap definition IS the discovery; do NOT run a separate discovery gate
   - For **research**: spawn 2-4 metta-researcher agents in parallel (one per approach). Each researcher MUST write to `{change_root}/spec/changes/<change>/research-<approach-slug>.md` (a short kebab-case slug per approach, e.g. `research-websockets.md`, `research-sse.md`, `research-polling.md`). Forbid `/tmp/` paths — per-approach output MUST be in-tree so the synthesis step can read it.

4. **Synthesize research** — read all `{change_root}/spec/changes/<change>/research-*.md` files you just created, write a single consolidated `{change_root}/spec/changes/<change>/research.md` that summarizes each approach and ends with a recommendation, then commit it: `git -C "{change_root}" add "<path>" && git -C "{change_root}" commit -m 'docs(<change>): synthesize research'` — always `git -C "{change_root}"` with the paths quoted, never plain git from your cwd: for a worktree-hosted change plain git would target the wrong checkout or fail with 'outside repository'. Do NOT call `metta complete research` until `{change_root}/spec/changes/<change>/research.md` exists on disk with real content.

5. **Implementation — MANDATORY PARALLEL EXECUTION:**
   **Do NOT spawn a single metta-executor for all tasks. You MUST parse batches and spawn per-task.**
   a. Read `{change_root}/spec/changes/<change>/tasks.md` — YOU the orchestrator, not a subagent
   b. Parse the batches (## Batch 1, ## Batch 2, etc.) and list tasks per batch
   c. For each batch:
      - List the **Files** field of each task
      - Different files → **spawn one metta-executor per task in a SINGLE message** (parallel)
      - Same files → spawn ONE AT A TIME (sequential)
      - Each executor prompt: include ONLY that task's details (Files, Action, Verify, Done) plus the `change_root` value — executors use absolute `{change_root}/...` paths and commit with `git -C "{change_root}"`, never plain git from the cwd
      - Wait for ALL executors in batch to complete before next batch
   d. After all batches: write `{change_root}/spec/changes/<change>/summary.md` and commit it with `git -C "{change_root}"`
   e. `metta complete implementation --json --change <name>`

6. **Review — spawn 3 metta-reviewer agents in parallel** (fan-out — single message):
   - Agent 1 (subagent_type: "metta-reviewer"): "**Correctness reviewer**"
   - Agent 2 (subagent_type: "metta-reviewer"): "**Security reviewer**"
   - Agent 3 (subagent_type: "metta-reviewer"): "**Quality reviewer**"
   - Merge results into `{change_root}/spec/changes/<change>/review.md` and commit it with `git -C "{change_root}"`

7. **Review-Fix Loop (repeat until clean):**
   a. Run `metta iteration record --phase review --change <name>`
   b. If any critical issues found:
      - Parse each issue's file path from review.md
      - Batch issues by file — independent files = parallel
      - Spawn one metta-executor per file batch (parallel fixes)
   c. After fixes: re-run the 3 reviewers
   d. If new issues found: repeat from (a)
   e. If all 3 reviewers report PASS or PASS_WITH_WARNINGS: exit loop
   f. Max 3 iterations — if still failing after 3 rounds, stop and report to user

8. **Verify — spawn 3 metta-verifier agents in parallel** (fan-out — single message):
   - Before spawning verifier agents, run: `metta iteration record --phase verify --change <name>`
   - Agent 1 (subagent_type: "metta-verifier"): "Run `cd "{change_root}" && npm test` — report pass/fail count and failures"
   - Agent 2 (subagent_type: "metta-verifier"): "Run `cd "{change_root}" && npx tsc --noEmit` and `cd "{change_root}" && npm run lint` — report errors"
   - Agent 3 (subagent_type: "metta-verifier"): "Read {change_root}/spec/changes/<change>/spec.md, check each scenario has a passing test — cite evidence"
   - Merge results into `{change_root}/spec/changes/<change>/summary.md` and commit it with `git -C "{change_root}"`
   - If any gate fails: run `metta iteration record --phase verify --change <name>` again, then spawn parallel metta-executors to fix, then re-verify

9. **Finalize** — `metta finalize --json --change <name>` → runs gates, archives, merges specs

10. **Ship** —
    a. `git -C "{change_root}" push -u origin metta/<change-name>` → push the feature branch to the remote
    b. `gh pr create --title "<conventional-commit-style title from the change>" --body "<summary from summary.md or intent.md highlights>"` → open a PR. The body MUST end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
    c. `gh pr checks <pr-number> --watch --fail-fast` → wait for all CI checks on the PR to complete before merging. If any check fails or is cancelled, do NOT merge — report the failing check(s) and the PR URL to the user and stop. If gh reports that no checks are reported yet (checks can lag PR creation by a few seconds), wait ~10s and retry the command
    d. `gh pr merge <pr-number> --merge` → land the PR immediately, unless the user asked to leave it open for review — in that case stop here and report the PR URL instead of merging
    e. Back on `main`: `git pull --ff-only`, then clean up the change branch and worktree

11. **Remove Gap** — `metta gaps remove <gap-slug> --json` → archives gap to `spec/archive/` then removes from `spec/gaps/`

## --all Mode (batch processing)

**⚠️ MUST process ALL gaps from critical → medium → low. Do NOT stop after any severity tier.**

When `$ARGUMENTS` is `--all` (optionally with `--severity <level>`):

1. Run `metta status --json` first — an allow-listed warm-up call that lets the session-credential mint hook complete a prior Bash cycle before the fix-gap call (output can be ignored)
2. Run `metta fix-gap --all --json` (or `metta fix-gap --all --severity critical --json` if user specified a severity filter) to get gaps sorted by severity
3. **Batch gaps by file overlap** — read each gap file to identify which source files it touches:
   a. For each gap, extract the file paths mentioned (Location, Files fields)
   b. Batch gaps that touch the SAME files together (they must run sequentially)
   c. Gaps that touch DIFFERENT files are independent (can run in parallel)
4. **Spawn parallel executors per independent batch** — one metta-executor per batch in a SINGLE message:
   - Each executor gets ALL gaps in its batch, fixes them sequentially within the batch
   - Independent batches run simultaneously
   - Example: gaps touching execution-engine.ts = Batch A, gaps touching context-engine.ts = Batch B → spawn 2 executors in parallel
5. After each batch completes:
   - Run `metta fix-gap --remove-gap <slug>` for each resolved gap in the batch
   - Log `[N/M] <slug>: resolved` or `[N/M] <slug>: failed at <phase>`
6. **Continue until ALL gaps are processed** — critical, medium, AND low. Never stop early.
   - If a gap fails: log it, skip it, continue to the next
   - If an entire batch fails: log it, continue to the next batch
7. Print summary table:
   | Batch | Gaps | Files | Result |
   |-------|------|-------|--------|
   Show per-batch and total counts: `Resolved: X / Failed: Y / Total: Z`

## Rules

- Commit ownership: the orchestrator commits planning, review, and verification artifacts after each subagent returns. The executor subagent commits atomically per task during implementation. Planning-artifact subagents (proposer, researcher, architect, planner, product) write files only — they do not run git.
- Every artifact MUST be followed by `metta complete` to advance workflow
- Discovery mode is always **batch** for fix-gap — the gap definition provides all context
- Do NOT skip review or verification — all 3 reviewers and 3 verifiers MUST run
- Do NOT stop after verification — finalize + ship + remove-gap must happen
- If metta finalize fails gates, spawn a metta-executor to fix, then retry
- Direct local merge of the change branch into main (`git merge`) is forbidden — every change ships through a pushed branch and a GitHub PR
- Deviation Rule 4: design is wrong → STOP, tell user
- If an executor or verifier STOP-reports a silent-write anomaly (Edit/Write success with no on-disk effect), escalate to the user with the report; never work around it via bash writes or orchestrator-performed writes.
