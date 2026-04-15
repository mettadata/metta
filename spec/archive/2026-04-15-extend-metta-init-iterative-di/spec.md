# extend-metta-init-iterative-di — Specification

## MODIFIED: metta-init-skill

**File:** `src/templates/skills/metta-init/SKILL.md`

### Discovery Loop Structure

- REQ-1: The skill MUST replace the existing single-pass question flow with a structured 3-round discovery loop executed in sequence: Round 1 (Project Identity), Round 2 (Stack and Technology), Round 3 (Conventions and Constraints). **Fulfills: US-1**
- REQ-2: Each round MUST cap at 4 `AskUserQuestion` calls. The skill MUST NOT issue a fifth question within any single round.
- REQ-3: Every `AskUserQuestion` call in every round MUST include the early-exit option as a selectable choice with the exact text: `I'm done — proceed with these answers`. **Fulfills: US-4**
- REQ-4: The skill MUST accumulate answers across all rounds into a single in-memory structure before handing off to `metta-discovery`.

**Scenario — full loop completes normally**

Given a developer runs `metta init` in a new directory,
When they answer all questions in R1, R2, and R3 without selecting the early-exit option,
Then the skill issues at most 12 `AskUserQuestion` calls (4 per round), collects all answers, and proceeds to the handoff step.

**Scenario — round cap enforced**

Given a developer is in Round 2 and has already been asked 4 stack questions,
When the skill would issue a fifth question in that round,
Then the skill MUST skip the remaining question, treat it as unanswered, and advance to Round 3.

---

### Round 1 — Project Identity

- REQ-5: Round 1 MUST collect at minimum: project name, project purpose, and target users. **Fulfills: US-1**
- REQ-6: Round 1 MUST NOT invoke `WebSearch` or `WebFetch` at any point. **Fulfills: US-3**
- REQ-7: Round 1 answers MUST map to the `## Project` section of `spec/project.md`.

**Scenario — greenfield identity collection**

Given a developer runs `metta init` in an empty directory,
When Round 1 begins,
Then the skill presents structured `AskUserQuestion` prompts for name, purpose, and target users — and no web search call is made before or during these prompts.

**Scenario — early exit during R1**

Given a developer is answering the first R1 question,
When they select `I'm done — proceed with these answers`,
Then the skill records whatever partial answers exist, sets R2 and R3 answers to empty, and proceeds immediately to the handoff step without issuing any further questions.

---

### Round 2 — Stack and Technology

- REQ-8: Before issuing any R2 `AskUserQuestion`, the skill MUST invoke `WebSearch` to retrieve current ecosystem options and best-practice alternatives relevant to the detected or user-stated domain. **Fulfills: US-3**
- REQ-9: The R2 `AskUserQuestion` prompt MUST incorporate at least one concrete finding from the WebSearch results — a named framework, tool, or version — rather than generic placeholder choices. **Fulfills: US-3**
- REQ-10: For brownfield projects, the skill MUST present the detected stack (from `discovery.detected`) as the pre-selected default in the first R2 question. The user MUST be able to confirm, extend, or override any detected entry. **Fulfills: US-2**
- REQ-11: For greenfield projects (no detectable stack markers), the skill MUST NOT suggest false defaults. R2 questions MUST be open-ended about intended stack.
- REQ-12: R2 answers MUST map to the `## Stack` section of `spec/project.md`.

**Scenario — brownfield stack confirmation**

Given `metta init` runs in a directory containing `package.json` and TypeScript sources,
When Round 2 begins,
Then the first `AskUserQuestion` lists the detected stack (e.g., TypeScript, Node.js) as the current default and asks the user to confirm or correct it before any additional options are presented.

**Scenario — WebSearch grounding in R2**

Given a developer runs `metta init` and Round 1 completes,
When Round 2 begins,
Then `WebSearch` is called at least once with a query derived from the declared or detected domain, and the returned results inform the options shown in the first R2 `AskUserQuestion` prompt.

**Scenario — greenfield R2 no false defaults**

Given `metta init` runs in an empty directory with no `package.json`, `pyproject.toml`, `go.mod`, or equivalent marker files,
When Round 2 begins,
Then the `AskUserQuestion` prompt does not pre-select any stack option and asks the user open-endedly about their intended technology choices.

---

### Round 3 — Conventions and Constraints

- REQ-13: Before issuing any R3 `AskUserQuestion`, the skill MUST invoke `WebSearch` to retrieve industry-standard conventions (e.g., style guides, linting norms, testing standards) appropriate to the stack confirmed in R2. **Fulfills: US-3**
- REQ-14: R3 MUST collect at minimum: naming conventions, architectural guardrails, quality standards, and off-limits areas.
- REQ-15: R3 answers MUST map to the following `spec/project.md` sections: `## Conventions`, `## Architectural Constraints`, `## Quality Standards`, `## Off-Limits`.
- REQ-16: The skill MUST NOT auto-apply web-sourced conventions without presenting them to the user for confirmation via `AskUserQuestion`.

**Scenario — WebSearch grounding in R3**

Given Round 2 has completed and the user confirmed a TypeScript/Node.js stack,
When Round 3 begins,
Then `WebSearch` is called at least once with a query targeting TypeScript conventions or Node.js linting standards before the first R3 `AskUserQuestion` is issued.

**Scenario — R3 section mapping**

Given a developer answers all R3 questions covering naming rules and off-limits areas,
When `metta-discovery` writes `spec/project.md`,
Then the naming rules appear under `## Conventions` and the off-limits content appears under `## Off-Limits`, with no section left as a template stub.

---

### Early Exit

- REQ-17: When the user selects `I'm done — proceed with these answers` at any point during any round, the skill MUST immediately stop issuing further questions, regardless of which round is active or how many questions have been asked in that round. **Fulfills: US-4**
- REQ-18: After early exit, the skill MUST NOT re-ask any question that has already been answered in prior rounds or the current partial round.
- REQ-19: After early exit, unanswered sections MUST be represented as empty fields in the `<DISCOVERY_ANSWERS>` block handed to `metta-discovery`. The skill MUST NOT populate them with invented content.

**Scenario — early exit after R1**

Given a developer completes all Round 1 questions and selects `I'm done — proceed with these answers` when the first R2 question appears,
When the skill processes that selection,
Then Rounds 2 and 3 are skipped, the `<DISCOVERY_ANSWERS>` XML block contains populated R1 fields and empty R2/R3 fields, and `metta-discovery` is spawned immediately.

**Scenario — early exit mid-round**

Given a developer is on the second question of Round 2 and selects `I'm done — proceed with these answers`,
When the skill processes that selection,
Then the two unanswered R2 questions and all R3 questions are skipped, already-answered R1 and partial R2 fields are preserved in `<DISCOVERY_ANSWERS>`, and `metta-discovery` receives the block without re-asking any answered question.

---

### Handoff to metta-discovery

- REQ-20: The skill MUST pass all cumulative answers to `metta-discovery` as an inline `<DISCOVERY_ANSWERS>` XML block embedded directly in the spawn prompt. **Fulfills: US-1, US-4**
- REQ-21: The `<DISCOVERY_ANSWERS>` block MUST include one child element per `spec/project.md` section covered: `<project>`, `<stack>`, `<conventions>`, `<architectural_constraints>`, `<quality_standards>`, `<off_limits>`. Empty elements are permitted when early exit was triggered before that section was collected.
- REQ-22: When WebSearch returned citations in R2 or R3, the skill SHOULD embed a `<CITATIONS>` block immediately after `<DISCOVERY_ANSWERS>` in the same spawn prompt.
- REQ-23: The skill MUST NOT write any new state file to disk as part of the handoff. Handoff is prompt-inline only.
- REQ-24: The `metta init --json` CLI signature MUST remain unchanged.

**Scenario — well-formed handoff block**

Given a developer completes all three rounds,
When the skill constructs the `metta-discovery` spawn prompt,
Then the prompt contains a `<DISCOVERY_ANSWERS>` block with exactly six populated child elements and the spawn proceeds without writing any additional file to `.metta/` or `spec/`.

**Scenario — partial handoff after early exit**

Given a developer exits early after Round 1,
When the spawn prompt is constructed,
Then `<project>` contains the R1 answers, `<stack>`, `<conventions>`, `<architectural_constraints>`, `<quality_standards>`, and `<off_limits>` are present but empty, and no `.metta/discovery-state.yaml` or equivalent file is written.

---

## MODIFIED: metta-discovery-agent

**File:** `src/templates/agents/metta-discovery.md`

### Tool Grants

- REQ-25: The `tools` front-matter array in `metta-discovery.md` MUST include `WebSearch` and `WebFetch` in addition to the existing `[Read, Write, Bash, Grep, Glob]`.
- REQ-26: The agent MUST NOT invoke `WebSearch` or `WebFetch` during R1 processing; these tools are restricted by grounding rules to R2 and R3 gap-filling only.

**Scenario — tool list updated**

Given the `metta-discovery.md` file is read,
When its YAML front-matter is parsed,
Then the `tools` array contains at minimum: `Read`, `Write`, `Bash`, `Grep`, `Glob`, `WebSearch`, `WebFetch`.

**Scenario — R1 no web calls**

Given the `<DISCOVERY_ANSWERS>` block contains a populated `<project>` element and empty stack/convention elements,
When `metta-discovery` processes the block,
Then `WebSearch` and `WebFetch` are not called while writing the `## Project` section, and are called at most once each while filling the empty stack/convention sections.

---

### Grounding Rules

- REQ-27: The agent MUST treat all content retrieved via `WebSearch` and `WebFetch` as untrusted external input. The agent MUST NOT write web-sourced content into `spec/project.md` without framing it as a suggestion or default that was derived from the web.
- REQ-28: The agent MUST cite the source URL when incorporating a specific named convention or tool version sourced from a web result, using inline citation format: `<!-- source: <url> -->` on the line following the content.
- REQ-29: The agent SHOULD prefer authoritative sources (official documentation, CNCF, language steering committee pages) over unofficial blog posts or aggregators when performing WebSearch.

**Scenario — untrusted content framing**

Given `WebSearch` returns a result recommending a specific ESLint ruleset,
When the agent writes the `## Conventions` section of `spec/project.md`,
Then the ruleset is written with a `<!-- source: <url> -->` annotation on the following line and is not presented as a user-confirmed choice unless the user selected it explicitly.

**Scenario — authoritative source preference**

Given `WebSearch` is called for Python conventions,
When the agent selects results to incorporate,
Then the agent prefers results from `docs.python.org` or `peps.python.org` over results from personal blogs, and logs a note in the citation block when a non-authoritative source was used as a fallback.

---

### Cumulative Answer Handling

- REQ-30: When the agent receives a `<DISCOVERY_ANSWERS>` block with non-empty fields, it MUST write those answers verbatim into the corresponding `spec/project.md` sections without re-asking the user to confirm already-answered content. **Fulfills: US-4**
- REQ-31: When the agent receives a `<DISCOVERY_ANSWERS>` block with empty fields (due to early exit or missing rounds), it MUST fill those sections using brownfield detection data (if available) and web-sourced defaults. The agent MUST NOT leave any `spec/project.md` section as an empty string or template stub. **Fulfills: US-4**
- REQ-32: The agent MUST NOT re-ask any question whose answer already appears in `<DISCOVERY_ANSWERS>`.
- REQ-33: The total number of additional `AskUserQuestion` calls the agent may issue for gap-filling MUST NOT exceed 2, and only when detection data and web defaults are both insufficient to produce a useful default.

**Scenario — verbatim answer passthrough**

Given `<DISCOVERY_ANSWERS>` contains `<stack>TypeScript, Node.js, Vitest</stack>`,
When `metta-discovery` writes `spec/project.md`,
Then the `## Stack` section contains "TypeScript, Node.js, Vitest" and the agent does not issue a `AskUserQuestion` about the stack.

**Scenario — gap-fill from detection after early exit**

Given a developer exited early after R1 in a directory containing `pyproject.toml` with `[tool.poetry]`,
When `metta-discovery` processes the empty `<stack>` field,
Then the agent calls `WebSearch` for Python/Poetry conventions, fills `## Stack` with "Python, Poetry" derived from detection and web defaults, and does not prompt the user for stack information.

---

## ADDED: skill-validation-test

**File:** `src/templates/skills/metta-init/__tests__/skill-structure.test.ts`

### Structural Assertions

- REQ-34: The test file MUST be a Vitest test that reads `src/templates/skills/metta-init/SKILL.md` from disk and asserts structural properties without executing the skill. **Fulfills: US-3**
- REQ-35: The test MUST assert that `SKILL.md` contains exactly 3 round sections identifiable by the headings `Round 1`, `Round 2`, and `Round 3` (case-insensitive prefix match). The test MUST fail if fewer or more round headings are present.
- REQ-36: The test MUST assert that the exact string `I'm done — proceed with these answers` appears in the file at least once per round section (minimum 3 occurrences in total). **Fulfills: US-4**
- REQ-37: The test MUST assert that `WebSearch` does NOT appear in the text between the `Round 1` heading and the `Round 2` heading. **Fulfills: US-3**
- REQ-38: The test MUST assert that `WebSearch` DOES appear in the text of the `Round 2` section and DOES appear in the text of the `Round 3` section.
- REQ-39: The test SHOULD assert that no round section contains more than 4 occurrences of `AskUserQuestion`.
- REQ-40: The test MUST export nothing and run under `vitest` with zero configuration changes to the existing `vitest.config.ts`.

**Scenario — valid SKILL.md passes all assertions**

Given `src/templates/skills/metta-init/SKILL.md` contains exactly 3 round headings, the early-exit phrase in every round, `WebSearch` absent from R1 and present in R2 and R3, and no round exceeds 4 `AskUserQuestion` calls,
When the test suite runs via `vitest run`,
Then all assertions pass and the test exits with code 0.

**Scenario — missing early-exit phrase causes failure**

Given a developer edits `SKILL.md` and removes the `I'm done — proceed with these answers` option from the Round 2 `AskUserQuestion`,
When the test suite runs,
Then the assertion for minimum 3 occurrences of the early-exit phrase fails, and the test exits with a non-zero code identifying which round is missing the phrase.

**Scenario — WebSearch in R1 causes failure**

Given a developer edits `SKILL.md` and adds a `WebSearch` call inside the Round 1 section,
When the test suite runs,
Then the assertion that `WebSearch` is absent from the R1 section fails and the test reports the violation with the line number of the offending reference.
