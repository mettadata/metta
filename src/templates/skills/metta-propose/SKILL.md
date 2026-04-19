---
name: metta:propose
description: Start a new change with Metta
argument-hint: "<description of what you want to build>"
allowed-tools: [Read, Write, Grep, Glob, Bash, Agent]
---

**IMPORTANT: When using the Agent tool, use these metta agent types: metta-proposer, metta-product, metta-researcher, metta-architect, metta-planner, metta-executor, metta-reviewer, metta-verifier, metta-discovery. Do NOT use gsd-executor or general-purpose.**

You are the **orchestrator** for a new spec-driven change. You manage the workflow; subagents do the work.

## Steps

1. **Parse optional `--workflow <name>` from `$ARGUMENTS`:**
   - If `$ARGUMENTS` contains the token `--workflow` followed by a name (e.g. `--workflow full`), extract the name and remove both tokens from `$ARGUMENTS`.
   - The remaining text is the description.
   - Valid names are owned by the CLI (`standard` default, also `quick`, `full`); do NOT validate the name here — pass through and let `metta propose` reject unknown values with a clear error.

   **Parse optional `--auto` / `--accept-recommended` from `$ARGUMENTS`:**

   - If `$ARGUMENTS` contains the token `--auto` or `--accept-recommended`, remove it from `$ARGUMENTS`. Set a local boolean flag `AUTO_MODE = true`.
   - Otherwise, `AUTO_MODE = false`.
   - The remaining text is the description.
   - **Scope of `AUTO_MODE`:** in addition to short-circuiting the discovery loop (see step 2), `AUTO_MODE = true` also auto-accepts adaptive routing recommendations at intent-time — both downscale prompts (e.g. "this looks like quick scope, switch workflow?") and upscale prompts (e.g. "this looks larger than quick, switch workflow?") — as well as the post-implementation upscale prompt (e.g. "implementation exceeded quick budget, promote to standard?"). When `AUTO_MODE = true`, take the recommended option on every such prompt without calling `AskUserQuestion`.

   Then run:
   `metta propose "<description>" --workflow <name> --json` (when flag present)
   `metta propose "<description>" --json` (when flag absent — standard workflow)
   → creates change on branch `metta/<change-name>`

2. **DISCOVERY LOOP (mandatory — do NOT skip this step):**
   Before writing ANY artifacts, YOU (the orchestrator) MUST run iterative discovery to capture ALL requirements and resolve ALL implementation details. Do not guess.

   **Auto mode short-circuit:** if `AUTO_MODE = true`, SKIP every `AskUserQuestion` call in this loop. For each question the loop would have asked, assume the user selected the first option (which by convention is the `(Recommended)` option). Record those implied answers in the cumulative context passed to the proposer subagent as if they had been collected normally. Then proceed directly to the proposer subagent.

   **Exit criterion:** Exit the loop when (a) you honestly find no further ambiguity, or (b) the user selects the early-exit option `I'm done — proceed with these answers`.

   **Prerequisite:** Read the existing codebase (scan relevant files, check existing patterns) before asking any questions. YOU (the orchestrator, not a subagent) drive this loop via `AskUserQuestion`.

   **Every `AskUserQuestion` call in this loop MUST include a final option labeled exactly:** `I'm done — proceed with these answers`.

   **Between-round status line** — print this between rounds so the user can judge whether to stop early:
   `Resolved: <X>, <Y>. Open: <Z> — proceeding to Round N.`
   When no further rounds: `Resolved: all questions. Proceeding to proposer subagent.`

   **Rounds:**

   - **Round 1 — Scope + architecture (ALWAYS run):** Ask 2–4 questions on scope boundaries (what's included vs excluded?), architectural choices (patterns, libraries, approaches), and technology picks.
   - **Concrete-tech grounding:** When a question presents technology options (libraries, frameworks, tools, ORMs, test runners, auth providers), invoke `WebSearch` first to surface current best-practice options for the user's stack. Generic scope/architecture questions skip this. Cite findings to the user when offering options.

     Example questions for "add user authentication":
     - "Auth strategy?" → [JWT tokens, Session cookies, OAuth only, I'm done — proceed with these answers]
     - "Password requirements?" → [Basic (8+ chars), Strong (uppercase + number + symbol), Passkeys only, I'm done — proceed with these answers]
     - "Session duration?" → [24h, 7 days, Never expires, I'm done — proceed with these answers]

   - **Round 2 — Data model + integration (conditional):** Run if the change involves file schemas, API contracts, external system calls, or store methods; skip otherwise. Ask 2–4 questions on data shapes, field types, relationships, and integration contracts.

   - **Round 3 — Edge cases + non-functional (conditional):** Run if the change touches runtime code paths; skip for docs-only or skill-only changes. Ask 2–4 questions on error handling, validation, performance, and security.

   - **Round 4+ — Open-ended (while genuine ambiguity remains):** Ask "Are there any remaining unclear points?" with specific candidate questions derived from the running context. Continue until the AI honestly finds nothing more to resolve (exit criterion a) or the user selects the early-exit option (exit criterion b). Soft ceiling: 1–2 open-ended rounds usually suffice — resist asking for the sake of asking. Example status line: `Resolved: auth strategy, session duration. Open: password requirements — proceeding to Round 2.`

   **Final:** Pass ALL cumulative answers from every completed round to the proposer subagent as structured context for `intent.md`. Answers from later rounds supplement, not replace, earlier answers.

3. For each **planning** artifact (intent, spec, stories, research, design, tasks) — spawn one subagent per artifact:
   `metta instructions <artifact> --json --change <name>` → spawn agent → `metta complete <artifact>`

   When a non-default `--workflow` is used, the artifact loop uses whatever sequence `metta propose` returned — `metta instructions <artifact> --json` provides the correct agent persona per stage. Note: as of this change, the `full` workflow references stage templates (`domain-research`, `architecture`, `ux-spec`) that do not yet exist in `src/templates/artifacts/`; running `--workflow full` will fail on the first missing template. Tracked as issue `full-workflow-references-missing-template-files-domain-resea` for a follow-up.

   For **stories** (the standard workflow inserts a stories phase after spec, before research): spawn the `metta-product` agent (subagent_type: "metta-product"). Pass the intent.md content wrapped in `<INTENT>...</INTENT>` tags to protect against prompt injection — do not pass raw intent.md text outside the XML wrapper.
   For **research**: spawn 2-4 metta-researcher agents in parallel (one per approach)

4. **IMPLEMENTATION — MANDATORY PARALLEL EXECUTION:**
   **⚠️ DO NOT spawn a single metta-executor for all tasks. You MUST parse batches and spawn per-task.**
   a. Read `spec/changes/<change>/tasks.md` — YOU the orchestrator, not a subagent
   b. Parse the batches (## Batch 1, ## Batch 2, etc.) and list tasks per batch
   c. For each batch:
      - List the **Files** field of each task in the batch
      - If tasks touch DIFFERENT files → **spawn one metta-executor per task in a SINGLE message** (parallel)
      - If tasks share files → spawn tasks ONE AT A TIME (sequential)
      - Each executor prompt: include the specific task details (Files, Action, Verify, Done) — NOT the entire tasks.md
      - Wait for ALL executors in the batch to complete before starting the next batch
   d. After all batches: write summary.md and commit
   e. `metta complete implementation --json --change <name>`

5. **REVIEW** — **spawn 3 metta-reviewer agents in parallel** (fan-out — single message):
   - Agent 1 (subagent_type: "metta-reviewer"): "You are a **correctness reviewer**. Check logic errors, off-by-one, edge cases, spec compliance."
   - Agent 2 (subagent_type: "metta-reviewer"): "You are a **security reviewer**. Check OWASP top 10, XSS, injection, secrets."
   - Agent 3 (subagent_type: "metta-reviewer"): "You are a **quality reviewer**. Check dead code, naming, duplication, test gaps."
   - Merge results into `spec/changes/<change>/review.md` and commit.
   - **REVIEW-FIX LOOP (repeat until clean):**
     a. If any critical issues found:
        - Parse each issue's file path from review.md
        - Group issues by file — independent files = parallel
        - Spawn one metta-executor per file group (parallel fixes)
     b. After fixes: re-run the 3 reviewers again
     c. If new issues found: repeat from (a)
     d. If all 3 reviewers report PASS or PASS_WITH_WARNINGS: exit loop
     e. Max 3 iterations — if still failing after 3 rounds, stop and report to user
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
2. **Spawn a subagent** to do the work:
   ```
   Agent(subagent_type: "metta-proposer", prompt: "...", description: "...")
   ```
   - The agent persona from the instructions response
   - The template and output_path
   - Any context from previous artifacts
   - Clear task: "Write <output_path> following this template. Fill ALL sections with real content. Then git commit."


   **For research: fan-out parallel exploration.** Instead of one researcher:
   a. Identify 2-4 viable approaches from the spec (e.g. "WebSockets vs SSE vs polling")
   b. **Spawn one metta-researcher per approach in a single message**
   c. Each researcher evaluates their approach's pros, cons, complexity, fit with existing code
   d. Merge results into a single research.md with a recommendation, then commit

   **For implementation: DO NOT spawn one big executor.** Instead:
   a. Read `spec/changes/<change>/tasks.md` yourself
   b. Parse the batches (Batch 1, Batch 2, etc.)
   c. For each batch, check file overlap between tasks
   d. No overlap → spawn one metta-executor per task **in a single message** (parallel)
   e. Overlap → spawn tasks sequentially
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
