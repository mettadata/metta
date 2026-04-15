## US-1: Rich spec/project.md output after 3-round discovery

**As a** developer running `metta init` on a new or existing project,
**I want to** answer structured questions across three rounds covering project identity, stack, and conventions,
**So that** the generated `spec/project.md` contains a detailed, accurate description of my project instead of a minimal scaffold.

**Priority:** P1

**Independent Test Criteria:** After completing all three rounds of discovery, `spec/project.md` must contain non-empty sections for project name, purpose, target users, technology stack, conventions, constraints, quality standards, and off-limits areas.

**Acceptance Criteria:**
- **Given** a developer runs `metta init` on a project with no existing `spec/project.md`, **When** they answer questions in all three rounds (R1: identity, R2: stack, R3: conventions), **Then** the generated `spec/project.md` contains populated sections for all three discovery domains and reflects the answers provided without leaving any section as a placeholder.
- **Given** a developer completes the full 3-round loop, **When** the `metta-discovery` agent writes `spec/project.md`, **Then** the file includes at minimum: project name, stated purpose, identified user personas, confirmed tech stack, key conventions, constraints, and quality gates — none of which may be empty strings or template stubs.

---

## US-2: Brownfield detected stack presented for confirmation in R2

**As a** developer running `metta init` on an existing codebase,
**I want to** see the automatically detected technology stack pre-filled as the default answer in round 2,
**So that** I can confirm it is correct or correct any misdetections before it is written into the project spec.

**Priority:** P1

**Independent Test Criteria:** When brownfield detection identifies at least one technology, the R2 question presenting stack options must display the detected technologies as the pre-selected default, and the user must be able to override any entry.

**Acceptance Criteria:**
- **Given** a developer runs `metta init` in a directory containing `package.json` and TypeScript sources, **When** round 2 begins, **Then** the `AskUserQuestion` prompt lists the detected stack (e.g., TypeScript, Node.js) as the current default and explicitly asks the user to confirm or correct it.
- **Given** the skill detects a Python project via `pyproject.toml`, **When** the R2 question is displayed, **Then** Python and its detected dependencies appear as defaults, and a developer who types a correction (e.g., "actually we use Poetry not pip") sees that correction reflected in the final `spec/project.md`.
- **Given** a completely greenfield directory with no detectable stack markers, **When** round 2 runs, **Then** no false defaults are suggested and the user is asked open-endedly about their intended stack.

---

## US-3: WebSearch-grounded tech and convention options in R2 and R3

**As a** developer who may not know best-practice conventions for my chosen stack,
**I want to** have the discovery skill to search for current industry conventions before presenting R2 and R3 questions,
**So that** the options I am shown reflect real, up-to-date practices rather than the model's potentially stale training data.

**Priority:** P2

**Independent Test Criteria:** The SKILL.md definition must reference a WebSearch call prior to presenting R2 questions (stack options) and prior to presenting R3 questions (conventions), and must not reference WebSearch in R1. A static analysis of SKILL.md structure can verify this.

**Acceptance Criteria:**
- **Given** a developer runs `metta init` and reaches round 2, **When** the skill builds the stack question, **Then** WebSearch has already been invoked to retrieve current ecosystem options relevant to the detected or user-stated domain before the `AskUserQuestion` call fires.
- **Given** a developer runs `metta init` and reaches round 3, **When** the skill builds convention and constraint questions, **Then** WebSearch has already been invoked to retrieve industry-standard conventions (e.g., style guides, linting standards, testing norms) for the confirmed stack.
- **Given** a developer runs `metta init` and is in round 1 only, **When** identity questions are asked, **Then** no WebSearch call is made during that round, ensuring R1 stays fast and focused.
- **Given** WebSearch returns results before R2, **When** the `AskUserQuestion` prompt is rendered, **Then** the options presented to the user cite or incorporate at least one concrete finding from those search results rather than generic placeholder choices.

---

## US-4: Early exit skips remaining rounds without re-asking answered questions

**As a** developer who already knows exactly what I want in my project spec,
**I want to** type "I'm done — proceed with these answers" at any point during discovery,
**So that** the skill immediately hands off my cumulative answers to `metta-discovery` and writes the spec without forcing me through the remaining rounds.

**Priority:** P2

**Independent Test Criteria:** Triggering the early-exit phrase at the end of R1 (before R2 and R3 run) must produce a valid `spec/project.md` that uses the R1 answers and lets `metta-discovery` fill gaps for unanswered sections, without re-prompting for any R1 answers.

**Acceptance Criteria:**
- **Given** a developer completes round 1 and types "I'm done — proceed with these answers" when prompted for R2, **When** the skill processes that input, **Then** rounds 2 and 3 are skipped entirely and `metta-discovery` receives the accumulated R1 answers via the `<DISCOVERY_ANSWERS>` XML block in the spawn prompt.
- **Given** a developer exits early after R2 (before R3), **When** `metta-discovery` runs, **Then** the agent fills missing convention and constraint sections by applying WebSearch and reasonable defaults, and does not re-ask any question the developer already answered in R1 or R2.
- **Given** a developer exits early at the very first question in R1, **When** `metta-discovery` receives an effectively empty `<DISCOVERY_ANSWERS>` block, **Then** the agent still produces a syntactically valid `spec/project.md` using brownfield detection data and web-sourced defaults rather than leaving sections blank.
- **Given** the early-exit option is available, **When** a developer reads any `AskUserQuestion` prompt in any round, **Then** the prompt explicitly mentions the early-exit phrase so the developer is always aware the option exists.
