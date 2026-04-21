---
name: metta:quick
description: Quick mode — small change without full planning
argument-hint: "<description of the small change>"
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]
context: fork
agent: metta-skill-host
---

**IMPORTANT: When using the Agent tool, use these metta agent types: metta-proposer, metta-researcher, metta-architect, metta-planner, metta-executor, metta-reviewer, metta-verifier, metta-discovery. Do NOT use gsd-executor or general-purpose.**

You are the **orchestrator** for a quick change (intent → implementation → review → verification → finalize → merge).

## Steps

1. **Parse optional `--auto` / `--accept-recommended` from `$ARGUMENTS`:**

   - If `$ARGUMENTS` contains the token `--auto` or `--accept-recommended`, remove it from `$ARGUMENTS`. Set a local boolean flag `AUTO_MODE = true`.
   - Otherwise, `AUTO_MODE = false`.
   - The remaining text is the description.

   > **Note on `--auto` scope:** The `--auto` flag now also auto-accepts adaptive routing recommendations (intent-time downscale/upscale and post-implementation upscale prompts) in addition to its existing discovery-loop short-circuit behavior.

   Then run: `METTA_SKILL=1 metta quick "$ARGUMENTS" --json` → creates change on branch `metta/<change-name>`

2. **LIGHT DISCOVERY (mandatory — do NOT skip):**
   Before writing the intent, YOU (the orchestrator, not a subagent) MUST evaluate whether the change carries meaningful ambiguity BEFORE asking any questions.

   **Trivial-detection gate (first action):**
   - Trivial examples: single-line fix, typo correction, one-file delete — **zero questions**, proceed directly to spawning the proposer subagent.
   - Functional criterion: if the description leaves no approach, scope, or integration decisions unresolved → trivially scoped, skip the loop.
   - Non-trivial: multi-file change, existing contract touched, scope or approach unclear → enter the **DISCOVERY LOOP** below.

   **DISCOVERY LOOP (entered only when non-trivial):**
   Self-contained since this skill invokes independently of `/metta:propose`.

   **Auto mode short-circuit:** if `AUTO_MODE = true`, SKIP every `AskUserQuestion` call in this loop. For each question the loop would have asked, assume the user selected the first option (which by convention is the `(Recommended)` option). Record those implied answers in the cumulative context passed to the proposer subagent as if they had been collected normally. Then proceed directly to the proposer subagent.

   - **Exit-option declaration:** every `AskUserQuestion` call within the loop MUST include a final selectable option exactly spelled `I'm done — proceed with these answers`.
   - **Round 1 (scope + architecture):** always runs once the loop is engaged. Ask 2–4 questions covering scope boundaries and architectural approach.
   - **Concrete-tech grounding:** When a question presents technology options (libraries, frameworks, tools, ORMs, test runners, auth providers), invoke `WebSearch` first to surface current best-practice options for the user's stack. Generic scope/architecture questions skip this. Cite findings to the user when offering options.
   - **Round 2 (data model + integration points):** conditional — run when the change involves file schemas, API contracts, external system calls, or store methods. Skip otherwise.
   - **Round 3 (edge cases + non-functional):** conditional — run when the change touches runtime code paths. Skip for docs-only or skill-only changes.
   - **Round 4+ (open-ended):** repeat while you honestly find remaining ambiguity; stop when none remains. Soft ceiling: 1–2 open-ended rounds usually suffice — resist asking for the sake of asking.
   - **Between-round status line** (print verbatim format before each new round):
     `Resolved: <A>, <B>. Open: <C> — proceeding to Round N.`
     When no further rounds are needed: `Resolved: all questions. Proceeding to proposer subagent.`
   - **Exit criterion:** the loop exits when (a) you honestly find no further ambiguity, or (b) the user selects the early-exit option `I'm done — proceed with these answers`.

   **Cumulative context:** pass the full set of all question-answer pairs from all completed rounds to the proposer subagent; answers from later rounds supplement, not replace, earlier answers.

3. **Spawn a metta-proposer agent** (subagent_type: "metta-proposer") for the intent:
   `metta instructions intent --json --change <name>` → get template + persona
   Subagent writes intent.md (Problem, Proposal, Impact, Out of Scope), commits it
4. `METTA_SKILL=1 metta complete intent --json --change <name>` → advances to implementation
5. **IMPLEMENTATION — MANDATORY PARALLEL EXECUTION:**
   **⚠️ DO NOT spawn a single metta-executor for all work. You MUST parse independent pieces and spawn per-piece.**
   a. Read the intent yourself — YOU the orchestrator, not a subagent
   b. Identify independent pieces (e.g. separate files, separate modules) and list them
   c. Execute the pre-batch self-check below before spawning any agents:

      **Pre-batch self-check — you MUST complete every bullet before emitting any `Agent(...)` call. SHALL NOT skip. No hedge words — no "consider", "try to", "you may want to":**

      1. You MUST list, verbatim, the file path(s) each independent piece will touch.
      2. You MUST compare the file sets pairwise across all pieces and classify the batch as **shared** (at least one path appears in two pieces) or **disjoint** (no path is shared).
      3. You MUST declare, in writing, a parallel-vs-sequential decision for each piece: **Parallel** (spawn in the same message as the other Parallel pieces) or **Sequential** (spawn alone, after its predecessors).
      4. If you declare any piece **Sequential**, you MUST name the specific conflicting file path (e.g. `src/foo.ts shared with Piece A`) as the written justification. Sequential without a named file-path conflict is forbidden.

      **Rule inversion — parallel is the default.** Every piece is Parallel unless step 4 above names a concrete conflicting file path. N pieces with disjoint files SHALL be spawned in one message with N `Agent(...)` tool calls.

      **Fan-out anti-example — implementation of 3 disjoint pieces:**

      ```wrong
      // Three separate orchestrator messages. Each Agent call is sent alone and
      // the orchestrator waits for it to return before sending the next.
      // This serializes what should run concurrently and burns wall-clock time.
      msg 1: Agent(subagent_type: "metta-executor", ...Piece A...)
      // (wait for msg 1 to return)
      msg 2: Agent(subagent_type: "metta-executor", ...Piece B...)
      // (wait for msg 2 to return)
      msg 3: Agent(subagent_type: "metta-executor", ...Piece C...)
      ```

      ```right
      // One orchestrator message with three Agent tool calls in the same response.
      // The framework runs all three concurrently; the orchestrator resumes when
      // the last one returns.
      msg 1:
        Agent(subagent_type: "metta-executor", ...Piece A...)
        Agent(subagent_type: "metta-executor", ...Piece B...)
        Agent(subagent_type: "metta-executor", ...Piece C...)
      ```

      - Each executor: implement its piece, run tests, commit with `feat(<change>): <description>`
      - Each executor prompt MUST include only the specific piece's details — NOT the entire intent.
      - You MUST wait for ALL executors to complete before writing the summary.
   d. After all executors complete, write `spec/changes/<change>/summary.md` and commit
6. `METTA_SKILL=1 metta complete implementation --json --change <name>` → advances to verification
7. **REVIEW — trivial-detection gate, then fan-out:**

   **Trivial-detection gate (first action):** Run `metta status --json --change <name>` and read `complexity_score.recommended_workflow` from the returned state. If it equals `'trivial'`, take the trivial path below; otherwise (including when `complexity_score` is absent) take the standard 3-reviewer path.

   Tests (`npm test -- --run`) and type-check (`npx tsc --noEmit`) run on every change regardless of tier.

   **Trivial path (1 reviewer):**
   - Spawn 1 metta-reviewer agent (subagent_type: "metta-reviewer") with persona: "You are a quality reviewer. Check dead code, naming, duplication, test gaps."
   - Write findings to `spec/changes/<change>/review.md` and commit.

   **Standard path — you MUST spawn all 3 metta-reviewer agents in a SINGLE orchestrator message** (fan-out — parallel, one message, three `Agent(...)` calls):

   **Pre-batch self-check — you MUST complete every bullet before emitting any reviewer `Agent(...)` call. SHALL NOT skip. No hedge words:**

   1. You MUST list the conceptual `Files` scope of each reviewer: all three read the same source tree but write **distinct** output sections (correctness notes, security notes, quality notes) that you merge afterward. No reviewer writes to disk during its own turn.
   2. You MUST classify the reviewer fan-out as **disjoint** — the three reviewers do not share a write target.
   3. You MUST declare all 3 reviewers **Parallel**.
   4. Sequential is forbidden here because no reviewer writes a file that another reviewer also writes. If you believe a conflict exists, you MUST name the specific conflicting file path in writing; absent a named path, spawn in parallel.

   **Rule inversion — parallel is the default.** The three reviewers SHALL be emitted in one orchestrator message as three `Agent(...)` tool calls.

   **Fan-out anti-example — 3 reviewer agents:**

   ```wrong
   // Three separate messages. Correctness review finishes before security even
   // starts. Review latency triples for no reason.
   msg 1: Agent(subagent_type: "metta-reviewer", ...correctness...)
   msg 2: Agent(subagent_type: "metta-reviewer", ...security...)
   msg 3: Agent(subagent_type: "metta-reviewer", ...quality...)
   ```

   ```right
   // One message, three Agent calls. All three reviewers run concurrently.
   msg 1:
     Agent(subagent_type: "metta-reviewer", ...correctness...)
     Agent(subagent_type: "metta-reviewer", ...security...)
     Agent(subagent_type: "metta-reviewer", ...quality...)
   ```

   - Agent 1 (subagent_type: "metta-reviewer"): "You are a **correctness reviewer**."
   - Agent 2 (subagent_type: "metta-reviewer"): "You are a **security reviewer**."
   - Agent 3 (subagent_type: "metta-reviewer"): "You are a **quality reviewer**."
   - Each writes their findings. Merge results into `spec/changes/<change>/review.md` and commit.

   **REVIEW-FIX LOOP (applies to both paths, repeat until clean):**
   a. Run `METTA_SKILL=1 metta iteration record --phase review --change <name>`
   b. If critical issues found:
      - Parse each issue's file path from review.md
      - Group issues by file — independent files MUST be fixed in parallel (one metta-executor per file group, all spawned in the SAME orchestrator message)
      - Sequential fix-spawning is forbidden unless two issues share the same file path; in that case you MUST name the shared file in writing before serializing
   c. After fixes: re-run the reviewer(s) for the active path (standard path MUST re-spawn all 3 in one message)
   d. Repeat until all reviewers report PASS/PASS_WITH_WARNINGS (max 3 iterations)
8. **VERIFICATION — trivial-detection gate, then fan-out:**

   **Trivial-detection gate (first action):** Run `metta status --json --change <name>` and read `complexity_score.recommended_workflow` from the returned state. If it equals `'trivial'`, take the trivial path below; otherwise (including when `complexity_score` is absent) take the standard 3-verifier path.

   Tests (`npm test -- --run`) and type-check (`npx tsc --noEmit`) run on every change regardless of tier.

   **Trivial path (1 verifier):**
   - Spawn 1 metta-verifier agent (subagent_type: "metta-verifier") with prompt: "Run `npm test -- --run` and `npx tsc --noEmit && npm run lint` — report pass/fail count and any type/lint errors."
   - Merge results into `spec/changes/<change>/summary.md` and commit.

   **Standard path — you MUST spawn all 3 metta-verifier agents in a SINGLE orchestrator message** (fan-out — parallel, one message, three `Agent(...)` calls):

   **Pre-batch self-check — you MUST complete every bullet before emitting any verifier `Agent(...)` call. SHALL NOT skip. No hedge words:**

   1. You MUST list each verifier's command/scope: Agent 1 runs `npm test`; Agent 2 runs `npx tsc --noEmit` and `npm run lint`; Agent 3 reads `intent.md` and cross-references code. None of them writes a file that another writes.
   2. You MUST classify the verifier fan-out as **disjoint** — all three read the repo; only the orchestrator writes summary.md afterward.
   3. You MUST declare all 3 verifiers **Parallel**.
   4. Sequential is forbidden here unless you can name a specific conflicting file path that two verifiers both write to. No such path exists in the default configuration; sequential verification in the default configuration is therefore forbidden.

   **Rule inversion — parallel is the default.** The three verifiers SHALL be emitted in one orchestrator message as three `Agent(...)` tool calls.

   **Fan-out anti-example — 3 verifier agents:**

   ```wrong
   // Three separate messages. The type-check sits idle while npm test runs;
   // wall-clock gate time is the sum instead of the max.
   msg 1: Agent(subagent_type: "metta-verifier", ...npm test...)
   msg 2: Agent(subagent_type: "metta-verifier", ...tsc + lint...)
   msg 3: Agent(subagent_type: "metta-verifier", ...intent traceability...)
   ```

   ```right
   // One message, three Agent calls. All three verifiers run concurrently.
   msg 1:
     Agent(subagent_type: "metta-verifier", ...npm test...)
     Agent(subagent_type: "metta-verifier", ...tsc + lint...)
     Agent(subagent_type: "metta-verifier", ...intent traceability...)
   ```

   - Before spawning verifier agents, run: `METTA_SKILL=1 metta iteration record --phase verify --change <name>`
   - Agent 1 (subagent_type: "metta-verifier"): "Run `npm test` — report pass/fail count and any failures"
   - Agent 2 (subagent_type: "metta-verifier"): "Run `npx tsc --noEmit` and `npm run lint` — report any type or lint errors"
   - Agent 3 (subagent_type: "metta-verifier"): "Read intent.md and check each stated goal is implemented in the code — cite file:line evidence"
   - Merge results into `spec/changes/<change>/summary.md` and commit.

   If any gate fails (either path): run `METTA_SKILL=1 metta iteration record --phase verify --change <name>` again, then spawn parallel metta-executors to fix (all fixes in ONE orchestrator message unless two fixes share a file path you have named in writing), then re-verify.
9. `METTA_SKILL=1 metta complete verification --json --change <name>`
10. `METTA_SKILL=1 metta finalize --json --change <name>` → runs gates, archives, merges specs
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
- Commit ownership: the orchestrator commits planning, review, and verification artifacts after each subagent returns. The executor subagent commits atomically per task during implementation. Planning-artifact subagents (proposer, researcher, architect, planner, product) write files only — they do not run git.
- If the change turns out to be complex, tell the user to use `/metta:propose` instead
