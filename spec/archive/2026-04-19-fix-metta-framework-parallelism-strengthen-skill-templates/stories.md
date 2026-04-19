# fix-metta-framework-parallelism-strengthen-skill-templates — User Stories

## US-1: Unambiguous parallelism guidance in /metta-propose impl phase

**As a** AI orchestrator running the /metta-propose impl phase
**I want to** see explicit, mandatory parallelism rules in SKILL.md with concrete anti-examples
**So that** I batch independent Task invocations in a single message instead of serializing them and wasting orchestration time
**Priority:** P1
**Independent Test Criteria:** A grep of the /metta-propose SKILL.md content finds both the mandatory pre-batch self-check block and at least one labeled anti-example showing the wrong (serial) pattern alongside the right (parallel) pattern.

**Acceptance Criteria:**
- **Given** the /metta-propose SKILL.md file exists on disk **When** its contents are searched for the phrase "pre-batch self-check" (or equivalent mandatory-check header) **Then** the phrase is present and appears before the first Task-spawning instruction
- **Given** the /metta-propose SKILL.md file exists **When** its contents are searched for an anti-example section **Then** at least one block clearly labeled as "anti-example" or "wrong" is present and contrasts with a "correct" or "right" block demonstrating parallel Task batching
- **Given** a change with multiple independent implementation tasks **When** the orchestrator follows the updated SKILL.md **Then** independent Task tool calls are issued in a single assistant message (parallel) rather than sequential messages

---

## US-2: Copy-paste-ready parallel wave plan from the CLI

**As a** developer running `metta tasks plan --change <name>`
**I want to** receive a human-readable list of parallel waves grouped by file-overlap analysis of tasks.md
**So that** I can paste the plan directly into an AI orchestrator prompt and have the work executed in the minimum number of sequential rounds
**Priority:** P1
**Independent Test Criteria:** An integration test invoking `metta tasks plan --change <name>` against a fixture change with a known tasks.md prints numbered waves where tasks sharing any file are never in the same wave and tasks with disjoint file sets are grouped together.

**Acceptance Criteria:**
- **Given** a change directory with a valid tasks.md listing at least four tasks with a mix of overlapping and disjoint file targets **When** `metta tasks plan --change <name>` runs **Then** the command exits with code 0 and prints waves labeled "Wave 1", "Wave 2", etc., with each task's ID listed under exactly one wave
- **Given** two tasks that touch the same file path **When** the CLI computes waves **Then** those two tasks appear in different waves
- **Given** three tasks whose file paths are pairwise disjoint **When** the CLI computes waves **Then** all three tasks appear in the same wave
- **Given** the printed output **When** a developer reads it **Then** the format is suitable for copy-paste into a chat prompt (plain text, no ANSI escape codes when stdout is not a TTY)

---

## US-3: Same parallelism discipline in /metta-quick

**As a** AI orchestrator running /metta-quick on a multi-task change
**I want to** see the same mandatory pre-batch self-check and anti-example pattern in the /metta-quick SKILL.md
**So that** quick-mode runs do not regress into sequential Task spawning just because the change is small
**Priority:** P2
**Independent Test Criteria:** A grep of the /metta-quick SKILL.md content finds the same mandatory self-check header and at least one anti-example that mirrors the one in /metta-propose.

**Acceptance Criteria:**
- **Given** the /metta-quick SKILL.md file on disk **When** its contents are searched for the mandatory pre-batch self-check block **Then** the block is present and phrased consistently with the /metta-propose version
- **Given** both SKILL.md files **When** their anti-example sections are compared **Then** both contain a labeled wrong-vs-right contrast demonstrating parallel Task batching

---

## US-4: Anti-example catches drift during skill maintenance

**As a** skill author maintaining a metta-* SKILL.md
**I want to** find a clearly labeled anti-example block adjacent to the parallelism rule
**So that** when I edit the skill I have a concrete reference for what the rule is preventing and I do not accidentally remove it
**Priority:** P2
**Independent Test Criteria:** A text assertion confirms the anti-example block in each updated SKILL.md is delimited with stable markers (e.g., fenced code blocks with "wrong" and "right" labels) that a future contributor can recognize.

**Acceptance Criteria:**
- **Given** the updated /metta-propose and /metta-quick SKILL.md files **When** their anti-example blocks are inspected **Then** each block uses stable, recognizable markers (labeled headings or fenced code blocks with explicit "wrong" / "right" labels)
- **Given** a contributor editing one of these skills **When** they view the file **Then** the anti-example sits immediately adjacent to the parallelism rule it illustrates (not buried in a separate section)

---

## US-5: Machine-readable wave structure for script consumers

**As a** developer writing a script that consumes metta task plans
**I want to** pass `--json` to `metta tasks plan` and receive a structured JSON document describing waves and task IDs
**So that** I can programmatically feed the plan into another tool without regex-scraping prose output
**Priority:** P2
**Independent Test Criteria:** An integration test invoking `metta tasks plan --change <name> --json` against a fixture change parses the stdout as JSON and asserts the presence of a waves array with each wave containing a taskIds array.

**Acceptance Criteria:**
- **Given** a valid change with a tasks.md **When** `metta tasks plan --change <name> --json` runs **Then** stdout is valid JSON parseable without error
- **Given** the parsed JSON **When** its shape is inspected **Then** it contains a top-level waves array where each element has at minimum a wave index and a taskIds array
- **Given** the same tasks.md fixture **When** both the human-readable and `--json` outputs are generated **Then** the wave groupings are identical between the two formats

---

## US-6: Mandatory self-check, not a suggestion

**As a** AI orchestrator mid-stream deciding whether to batch Task calls
**I want to** see the pre-batch self-check framed as a hard requirement (MUST/REQUIRED) rather than a soft suggestion
**So that** I do not skip it under time pressure and silently fall back to serial execution
**Priority:** P1
**Independent Test Criteria:** A grep of each updated SKILL.md confirms the self-check uses imperative RFC-2119-style language (MUST, REQUIRED, or SHALL) and not hedge words like "consider" or "try to".

**Acceptance Criteria:**
- **Given** the updated SKILL.md files **When** their self-check blocks are scanned for modal verbs **Then** at least one of MUST, REQUIRED, or SHALL is present in the self-check directive
- **Given** the same blocks **When** scanned for hedge words ("consider", "try to", "you may want to") **Then** those hedge words are absent from the self-check directive itself

---
