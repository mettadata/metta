# Research: SKILL.md Discovery Loop Patterns for metta-init

**Change:** extend-metta-init-iterative-di
**Date:** 2026-04-15

---

## 1. Round Format Conventions (propose + quick)

Both metta-propose and metta-quick follow an identical structural convention for each round:

### Heading style

Rounds are declared inline as bold list items inside a `**Rounds:**` section, not as top-level headings:

```markdown
**Rounds:**

- **Round 1 — Scope + architecture (ALWAYS run):** Ask 2–4 questions ...
- **Round 2 — Data model + integration (conditional):** Run if ...
- **Round 3 — Edge cases + non-functional (conditional):** Run if ...
```

For metta-init, the round labels MUST be readable by the structural test (REQ-35 asserts heading prefix match for `Round 1`, `Round 2`, `Round 3`). To satisfy REQ-35 and stay consistent with the orchestrator pattern, the rounds in SKILL.md should use bold section headers that include the exact strings:

```markdown
- **Round 1 — Project Identity (ALWAYS run):** ...
- **Round 2 — Stack and Technology (conditional — WebSearch first):** ...
- **Round 3 — Conventions and Constraints (conditional — WebSearch first):** ...
```

The test file uses case-insensitive prefix matching on `Round 1`, `Round 2`, `Round 3`, so these labels pass.

### Between-round status line

The verbatim format is the same in both skills. Print between rounds, not after the final round:

```
Resolved: <A>, <B>. Open: <C> — proceeding to Round N.
```

When no further rounds: `Resolved: all questions. Proceeding to metta-discovery subagent.`

This is a text output from the orchestrator, not an AskUserQuestion.

### AskUserQuestion usage

Every call within the loop MUST end with the early-exit option. Both skills use identical wording. Example from metta-propose:

```markdown
- "Auth strategy?" → [JWT tokens, Session cookies, OAuth only, I'm done — proceed with these answers]
```

Pattern: `"<question label>?" → [option A, option B, ..., I'm done — proceed with these answers]`

---

## 2. Early-Exit Pattern — Verbatim

Both skills phrase the exit option and its enforcement identically.

**Declaration (from metta-propose):**
> Every `AskUserQuestion` call in this loop MUST include a final option labeled exactly: `I'm done — proceed with these answers`.

**Exit criterion (from metta-propose):**
> Exit the loop when (a) you honestly find no further ambiguity, or (b) the user selects the early-exit option `I'm done — proceed with these answers`.

**Location in both skills:** Declared at the top of the `DISCOVERY LOOP` block, before the `Rounds:` list. Referenced again inside each round description via "include the early-exit option."

For metta-init SKILL.md, the block header should read:

```markdown
**Exit-option declaration:** every `AskUserQuestion` call within the loop MUST include a final selectable
option exactly spelled `I'm done — proceed with these answers`.

**Exit criterion:** the loop exits when (a) no further rounds remain, or (b) the user selects
`I'm done — proceed with these answers`.
```

REQ-17 through REQ-19 make the early-exit behavior more strict than propose/quick: after exit, unanswered fields MUST appear as empty elements in `<DISCOVERY_ANSWERS>`, never with invented content.

---

## 3. Concrete-Tech Grounding (WebSearch) Convention

The exact instruction in both propose and quick:

> When a question presents technology options (libraries, frameworks, tools, ORMs, test runners, auth providers), invoke `WebSearch` first to surface current best-practice options for the user's stack. Generic scope/architecture questions skip this. Cite findings to the user when offering options.

For metta-init, REQ-8 and REQ-13 are more prescriptive: WebSearch fires once at the **start of R2** and once at the **start of R3**, before any AskUserQuestion in those rounds — not per-question. The query is derived from the declared or detected domain (R2) or the confirmed stack (R3).

The instruction in SKILL.md should be placed as a sub-bullet under each round heading:

**R2 pattern:**
```markdown
  Before issuing any R2 question: `WebSearch("best practices <domain> stack 2025")` — derive domain
  from detected stack (brownfield) or R1 project purpose (greenfield). Cite at least one named tool
  or framework from the results as an option in the first AskUserQuestion.
```

**R3 pattern:**
```markdown
  Before issuing any R3 question: `WebSearch("<confirmed stack> conventions style guide linting 2025")`.
  Use results to populate concrete options (e.g., named rulesets, testing libraries). Tag sourced
  options with the citation URL for the `<CITATIONS>` block.
```

REQ-16 explicitly prohibits auto-applying web-sourced conventions; they must be presented via AskUserQuestion for the user to confirm.

---

## 4. Best Questions Per Round (AskUserQuestion-ready)

### Round 1 — Project Identity (no WebSearch, ALWAYS run)

| Label | Description |
|---|---|
| Project name | What is the canonical name for this project? (used in config.yaml + spec/project.md) |
| Purpose | One sentence: what problem does this project solve and for whom? |
| Target users | Who uses this system? (e.g., internal devs, external customers, IoT devices) |
| Project type | What kind of software is this? (e.g., CLI tool, web API, data pipeline, library) |

As AskUserQuestion options for "Project type":
`[CLI / developer tool, REST or GraphQL API, Frontend web app, Background service / daemon, Library / SDK, I'm done — proceed with these answers]`

### Round 2 — Stack and Technology (WebSearch first, conditional)

| Label | Description |
|---|---|
| Primary language + runtime | Confirm or correct the detected language/runtime (brownfield) or state intended choice (greenfield) |
| Frameworks and key libraries | Which framework(s) will anchor this project? (WebSearch results cited as options) |
| Data persistence | How is state stored? (database, file system, in-memory, external service) |
| Build and test toolchain | What build tool and test runner does the project use or plan to use? |

Brownfield R2 question sketch (REQ-10):
```markdown
AskUserQuestion: "Detected stack: TypeScript, Node.js (from package.json + tsconfig.json). Does this
match your project? Select to confirm or describe a correction."
Options: [Confirmed — TypeScript + Node.js, Add more (e.g. + Express, + Prisma), Correct a
misdetection (describe below), I'm done — proceed with these answers]
```

Greenfield R2 question (REQ-11 — no false defaults):
```markdown
AskUserQuestion: "No existing stack markers detected. What language and runtime will you use?
(WebSearch results suggest these as current options for <domain>: <cited list>)"
Options: [<result-1>, <result-2>, <result-3>, Other (I'll describe), I'm done — proceed with these answers]
```

### Round 3 — Conventions and Constraints (WebSearch first, conditional)

| Label | Description |
|---|---|
| Naming conventions | What naming style applies? (e.g., camelCase functions, kebab-case files, PascalCase classes) |
| Architectural guardrails | What patterns are required or prohibited? (e.g., no singletons, functional core, layered arch) |
| Quality standards | What are the gates? (e.g., 80% coverage, no lint warnings, type-safe only) |
| Off-limits areas | What must not be changed or added? (e.g., no third-party auth SDKs, no CommonJS) |

---

## 5. DISCOVERY_ANSWERS XML Block — 6 Required Child Elements

Per REQ-21, the block MUST contain exactly these six child elements (mapping to spec/project.md sections):

```xml
<DISCOVERY_ANSWERS>
  <project>
    name: Metta
    purpose: Composable, spec-driven development framework for AI-native engineering
    target_users: Software engineers using AI coding tools
    project_type: CLI tool / developer framework
  </project>
  <stack>
    TypeScript, Node.js 22, ESM, Commander.js, Zod, Vitest
  </stack>
  <conventions>
    camelCase for variables/functions, PascalCase for classes, kebab-case for files.
    Conventional commits. Barrel exports via index.ts. .js extensions in TS imports.
  </conventions>
  <architectural_constraints>
    Functional core, imperative shell. No singletons. No CommonJS. No unvalidated state writes.
  </architectural_constraints>
  <quality_standards>
    100% type-safe (strict mode). Near 1:1 test-to-source ratio. All state validated with Zod.
  </quality_standards>
  <off_limits>
    No auto-push to remote. No --force pushes. No --no-verify bypasses.
  </off_limits>
</DISCOVERY_ANSWERS>
```

When early exit triggers before a round, the corresponding elements are present but empty:

```xml
<DISCOVERY_ANSWERS>
  <project>name: Foo, purpose: Bar</project>
  <stack></stack>
  <conventions></conventions>
  <architectural_constraints></architectural_constraints>
  <quality_standards></quality_standards>
  <off_limits></off_limits>
</DISCOVERY_ANSWERS>
```

Per REQ-22, when WebSearch was used in R2 or R3, append a `<CITATIONS>` block immediately after:

```xml
<CITATIONS>
  <citation round="R2">https://example.com/ts-best-practices-2025</citation>
  <citation round="R3">https://typescript-eslint.io/rules/</citation>
</CITATIONS>
```

REQ-23: no new file is written to disk as part of handoff. The XML block is embedded inline in the Agent spawn prompt only.

---

## 6. Surfacing Brownfield Stack in R2 — Exact Question Sketch

The skill receives `discovery.detected` from `metta init --json`. R2 must use this object directly.

```markdown
**Round 2 — Stack and Technology:**

  *Brownfield path (discovery.detected is non-empty):*
  Present detected findings first as a text summary:
  "Detected in this repo: [join(discovery.detected.languages, ', ')],
   frameworks: [join(discovery.detected.frameworks, ', ')],
   tools: [join(discovery.detected.tools, ', ')]."

  Then issue AskUserQuestion:
  "Does this detected stack accurately describe your project?"
  Options:
    - "Yes — confirmed as-is"
    - "Add to it (I'll describe what's missing)"
    - "Correct a misdetection (I'll describe)"
    - "I'm done — proceed with these answers"

  *Greenfield path (discovery.detected is empty):*
  Issue AskUserQuestion using WebSearch results directly:
  "No existing markers detected. Based on your project purpose ('<R1.purpose>'),
   which technology stack are you planning?"
  Options derived from WebSearch results (cite inline). Always append:
    - "I'm done — proceed with these answers"
```

The key distinction: brownfield leads with the detection summary as prose, then confirms. Greenfield leads with WebSearch-grounded options, no defaults pre-selected (REQ-11).

---

## Copy-Ready R1 / R2 / R3 Block for SKILL.md

The following is ready to be pasted into the discovery loop section of metta-init's SKILL.md, after step 1 (`metta init --json`) and before the spawn step.

```markdown
2. **DISCOVERY LOOP (mandatory — do NOT skip this step):**
   Before spawning `metta-discovery`, YOU (the orchestrator) MUST run iterative discovery to collect
   project identity, stack, and conventions via `AskUserQuestion`. Do not guess.

   **Exit-option declaration:** every `AskUserQuestion` call within the loop MUST include a final
   selectable option exactly spelled `I'm done — proceed with these answers`.

   **Exit criterion:** the loop exits when (a) all three rounds have completed, or (b) the user
   selects `I'm done — proceed with these answers`.

   **Between-round status line** — print this between rounds:
   `Resolved: <X>, <Y>. Open: <Z> — proceeding to Round N.`
   When no further rounds: `Resolved: all questions. Proceeding to metta-discovery subagent.`

   **Rounds:**

   - **Round 1 — Project Identity (ALWAYS run):** Ask up to 4 questions on project name, purpose,
     target users, and project type. Do NOT invoke WebSearch or WebFetch during this round.
     Cap: 4 AskUserQuestion calls. Advance to Round 2 when cap reached or user accepts.

     Example questions:
     - "What is the canonical name of this project?" → [free text + I'm done — proceed with these answers]
     - "What problem does this project solve, and for whom?" → [free text + I'm done — proceed with these answers]
     - "Who are the primary users of this system?" → [Internal developers, External customers,
       Other services / machines, Mixed, I'm done — proceed with these answers]
     - "What kind of software is this?" → [CLI / developer tool, REST or GraphQL API, Frontend web app,
       Background service / daemon, Library / SDK, I'm done — proceed with these answers]

   - **Round 2 — Stack and Technology (conditional — WebSearch first):** Before issuing ANY R2
     AskUserQuestion, invoke `WebSearch("<domain> technology stack best practices 2025")` where
     `<domain>` is derived from `discovery.detected` (brownfield) or R1 project purpose (greenfield).
     Cite at least one named tool or framework from results in the first question. Cap: 4 AskUserQuestion calls.

     Brownfield: present the detected stack as a text summary, then ask for confirmation or correction:
     - "Detected: [detected.languages + detected.frameworks + detected.tools]. Does this match your
       project?" → [Confirmed as-is, Add to it (describe below), Correct a misdetection (describe),
       I'm done — proceed with these answers]

     Greenfield (no detection): do NOT suggest defaults. Use WebSearch results as open-ended options:
     - "No existing markers detected. Which language and runtime will you use? (Current options for
       <domain> from web search: <cited list>)" → [<result-1>, <result-2>, Other, I'm done — proceed
       with these answers]

     Additional R2 questions (as needed, within the cap):
     - "Which frameworks or libraries will anchor this project?" → [WebSearch-sourced options +
       I'm done — proceed with these answers]
     - "How will state be persisted?" → [SQL database, NoSQL database, File system, In-memory,
       External API, I'm done — proceed with these answers]
     - "What test runner will you use?" → [WebSearch-sourced options + I'm done — proceed with these answers]

   - **Round 3 — Conventions and Constraints (conditional — WebSearch first):** Before issuing ANY R3
     AskUserQuestion, invoke `WebSearch("<confirmed stack> conventions style guide linting 2025")`.
     Use results to present concrete, named options (not generic placeholders). Cap: 4 AskUserQuestion calls.

     Example questions:
     - "What naming conventions apply? (WebSearch found these standards for <stack>: <cited list>)"
       → [<convention-1>, <convention-2>, Custom (describe), I'm done — proceed with these answers]
     - "Are there required or prohibited architectural patterns?" → [Functional core imperative shell,
       Layered / hexagonal, No singletons, No globals, None specified, I'm done — proceed with these answers]
     - "What quality gates apply?" → [80%+ test coverage, Type-safe strict mode, No lint warnings,
       All of the above, I'm done — proceed with these answers]
     - "What areas are off-limits for this project?" → [No third-party auth SDKs, No ORM, No CommonJS,
       None, I'm done — proceed with these answers]

   **After the loop:** accumulate ALL answers from completed rounds. Build the `<DISCOVERY_ANSWERS>` XML
   block. Empty elements for rounds skipped via early exit. Append `<CITATIONS>` if WebSearch was used.

   ```
   <DISCOVERY_ANSWERS>
     <project><!-- R1 answers: name, purpose, target_users, project_type --></project>
     <stack><!-- R2 answers: language, runtime, frameworks, persistence, toolchain --></stack>
     <conventions><!-- R3 answers: naming conventions --></conventions>
     <architectural_constraints><!-- R3 answers: guardrails --></architectural_constraints>
     <quality_standards><!-- R3 answers: coverage, type safety, lint --></quality_standards>
     <off_limits><!-- R3 answers: prohibited areas --></off_limits>
   </DISCOVERY_ANSWERS>
   <CITATIONS>
     <citation round="R2"><!-- URL(s) from WebSearch --></citation>
     <citation round="R3"><!-- URL(s) from WebSearch --></citation>
   </CITATIONS>
   ```

3. **Spawn a metta-discovery agent** (subagent_type: "metta-discovery") with:
   - The agent persona from `discovery.agent.persona`
   - The mode (`discovery.mode`: brownfield or greenfield)
   - The `<DISCOVERY_ANSWERS>` block embedded inline in the prompt
   - The `<CITATIONS>` block (if WebSearch was used)
   - The output paths from `discovery.output_paths`
   - The templates from `discovery.constitution_template` and `discovery.context_template`
   - Clear task: "Write spec/project.md and .metta/config.yaml using the answers in
     <DISCOVERY_ANSWERS>. Do NOT re-ask any answered question. Fill empty fields from
     brownfield detection and web defaults. Then git add + commit."
```

---

## Key Differences from Propose/Quick

| Aspect | propose / quick | metta-init |
|---|---|---|
| WebSearch timing | Per-question when tech options present | Once per round (R2 start, R3 start) |
| Round names | Scope/Architecture, Data model, Edge cases | Project Identity, Stack, Conventions |
| R1 WebSearch | Allowed (tech questions can trigger it) | Explicitly prohibited (REQ-6) |
| Handoff target | proposer subagent (intent.md) | metta-discovery (spec/project.md + config.yaml) |
| Handoff format | Prose context wrapped in XML tags | Structured `<DISCOVERY_ANSWERS>` block (6 fixed child elements) |
| Early-exit consequence | Discovery context is partial | Empty XML elements passed; agent fills gaps |
| New state file | N/A | Must NOT write one (REQ-23) |

The structural test in REQ-34–40 validates SKILL.md statically: 3 round headings, early-exit phrase 3+ times, WebSearch absent from R1 text, present in R2 and R3 text, no round with more than 4 `AskUserQuestion` occurrences.
