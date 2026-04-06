---
name: metta:propose
description: Start a new change with Metta
argument-hint: "<description of what you want to build>"
allowed-tools: [Read, Write, Grep, Glob, Bash, Agent]
---

**IMPORTANT: When using the Agent tool, use these metta agent types: metta-proposer, metta-researcher, metta-architect, metta-planner, metta-executor, metta-reviewer, metta-verifier, metta-discovery. Do NOT use gsd-executor or general-purpose.**

You are the **orchestrator** for a new spec-driven change. You manage the workflow; subagents do the work.

## Steps

1. `metta propose "$ARGUMENTS" --json` → creates change on branch `metta/<change-name>`

2. **DISCOVERY GATE (mandatory — do NOT skip this step):**
   Before writing ANY artifacts, YOU (the orchestrator, not a subagent) MUST ask the user discovery questions using AskUserQuestion. This is the most important step — it prevents the entire downstream pipeline from building the wrong thing.

   a. Read the existing codebase (scan relevant files, check existing patterns)
   b. Identify ambiguity — what decisions need user input? Think about:
      - Architecture choices (which technology/pattern/library?)
      - Scope boundaries (what's included vs excluded?)
      - Data model decisions (what fields, what types, what relationships?)
      - Integration points (how does this connect to existing code?)
      - Edge cases (what happens when X fails/is empty/overflows?)
   c. Ask 3-6 focused questions using AskUserQuestion with concrete options
   d. Wait for answers before proceeding
   e. Include the answers in the context you pass to the proposer subagent

   Example questions for "add user authentication":
   - "Auth strategy?" → [JWT tokens, Session cookies, OAuth only]
   - "Password requirements?" → [Basic (8+ chars), Strong (uppercase + number + symbol), Passkeys only]
   - "Session duration?" → [24h, 7 days, Never expires]

3. For each **planning** artifact (intent, spec, research, design, tasks) — spawn one subagent per artifact:
   `metta instructions <artifact> --json --change <name>` → spawn agent with `isolation: "worktree"` → `metta complete <artifact>`
   For **research**: spawn 2-4 metta-researcher agents in parallel (one per approach), each with `isolation: "worktree"`

4. **IMPLEMENTATION — MANDATORY PARALLEL EXECUTION:**
   **⚠️ DO NOT spawn a single metta-executor for all tasks. You MUST parse batches and spawn per-task.**
   a. Read `spec/changes/<change>/tasks.md` — YOU the orchestrator, not a subagent
   b. Parse the batches (## Batch 1, ## Batch 2, etc.) and list tasks per batch
   c. For each batch:
      - List the **Files** field of each task in the batch
      - If tasks touch DIFFERENT files → **spawn one metta-executor per task in a SINGLE message** (parallel, each with `isolation: "worktree"`)
      - If tasks share files → spawn tasks ONE AT A TIME (sequential, each with `isolation: "worktree"`)
      - Each executor prompt: include the specific task details (Files, Action, Verify, Done) — NOT the entire tasks.md
      - Wait for ALL executors in the batch to complete before starting the next batch
   d. After all batches: write summary.md and commit
   e. `metta complete implementation --json --change <name>`

5. **REVIEW** — **spawn 3 metta-reviewer agents in parallel** (fan-out — single message):
   - Agent 1 (subagent_type: "metta-reviewer"): "You are a **correctness reviewer**. Check logic errors, off-by-one, edge cases, spec compliance."
   - Agent 2 (subagent_type: "metta-reviewer"): "You are a **security reviewer**. Check OWASP top 10, XSS, injection, secrets."
   - Agent 3 (subagent_type: "metta-reviewer"): "You are a **quality reviewer**. Check dead code, naming, duplication, test gaps."
   - Merge results into `spec/changes/<change>/review.md` and commit.
   - If any critical issues:
     a. Parse each issue's file path from review.md
     b. Group issues by file — issues in different files are independent
     c. **Spawn one metta-executor per independent file group in a single message** (parallel fixes)
     d. After all executors complete, re-run the 3 reviewers to verify fixes
6. **VERIFICATION** — **spawn 3 metta-verifier agents in parallel** (fan-out — single message):
   - Agent 1 (subagent_type: "metta-verifier"): "Run `npm test` — report pass/fail count and failures"
   - Agent 2 (subagent_type: "metta-verifier"): "Run `npx tsc --noEmit` and `npm run lint` — report errors"
   - Agent 3 (subagent_type: "metta-verifier"): "Read spec.md, check each Given/When/Then scenario has a passing test — cite evidence"
   - Merge results into summary.md and commit
   - If any gate fails: spawn parallel metta-executors to fix, then re-verify
7. When `all_complete: true`:
   a. `metta finalize --json --change <name>` → runs gates, archives, merges specs
   b. `git checkout main && git merge metta/<change-name> --no-ff -m "chore: merge <change-name>"`
8. Report to user what was done

## Critical: You MUST verify, finalize, and merge

- Do NOT skip verification — a metta-verifier agent MUST run gates and confirm spec compliance
- Do NOT stop after the last artifact — finalize + merge must happen
- If metta finalize fails gates, spawn a metta-executor to fix, then retry

## Agent Execution Pattern

For each artifact, you act as the **orchestrator** — lean context, no implementation. You spawn a subagent to do the work.

### Per-Artifact Loop

1. `metta instructions <artifact> --json --change <name>`
   → Returns: agent.persona, agent.tools, template, output_path, context
2. **Spawn a subagent with `isolation: "worktree"`** — every subagent runs in its own git worktree:
   ```
   Agent(subagent_type: "metta-proposer", isolation: "worktree", prompt: "...", description: "...")
   ```
   - The agent persona from the instructions response
   - The template and output_path
   - Any context from previous artifacts
   - Clear task: "Write <output_path> following this template. Fill ALL sections with real content. Then git commit."
   - The worktree isolates the agent's work — if it fails, main branch is untouched

   **For research: fan-out parallel exploration.** Instead of one researcher:
   a. Identify 2-4 viable approaches from the spec (e.g. "WebSockets vs SSE vs polling")
   b. **Spawn one metta-researcher per approach in a single message**, each with `isolation: "worktree"`
   c. Each researcher evaluates their approach's pros, cons, complexity, fit with existing code
   d. Merge results into a single research.md with a recommendation, then commit

   **For implementation: DO NOT spawn one big executor.** Instead:
   a. Read `spec/changes/<change>/tasks.md` yourself
   b. Parse the batches (Batch 1, Batch 2, etc.)
   c. For each batch, check file overlap between tasks
   d. No overlap → spawn one metta-executor per task **in a single message**, each with `isolation: "worktree"` (parallel)
   e. Overlap → spawn tasks sequentially, each still in its own worktree
   f. Wait for batch to complete before starting next batch
3. When the subagent completes:
   `metta complete <artifact> --json --change <name>`
   → Returns: next artifact to build, or all_complete: true
4. Repeat with next artifact

### Subagent Prompt Template

When spawning subagents, include this in the prompt. Use subagent_type: "metta-proposer" for intent/spec artifacts.

"You are: {agent.persona}

Write the file {output_path} following this template:
{template}

Context from previous artifacts:
{read the files from spec/changes/<change>/}

Rules:
- Fill in ALL sections with real, specific content — no placeholders
- When done, run: git add {output_path} && git commit -m 'docs(<change>): create <artifact>'
- For implementation tasks, use conventional commits: feat(<change>): <description>
- For specs, use RFC 2119 keywords (MUST/SHOULD/MAY) and Given/When/Then scenarios"
