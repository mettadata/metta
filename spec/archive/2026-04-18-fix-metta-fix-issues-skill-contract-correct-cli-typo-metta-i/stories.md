# User Stories

## US-1: Correct CLI subcommand in metta-fix-issues skill

**As a** AI orchestrator running `/metta-fix-issues <slug>`
**I want to** have the skill invoke the correct CLI subcommand `metta issues show <slug> --json`
**So that** the validate step succeeds on the first try instead of hitting the logger's exit-1 rejection
**Priority:** P1
**Independent Test Criteria:** Grepping `metta issue show` across `src/templates/skills/*.md` and `.claude/skills/*/SKILL.md` returns zero matches, and `metta issues show` appears exactly where the validate step is described in `metta-fix-issues/SKILL.md`.

**Acceptance Criteria:**
- **Given** an orchestrator has just invoked `/metta-fix-issues <slug>` **When** it reads line 27 of the skill **Then** it runs `metta issues show <slug> --json` (plural) and receives the issue JSON payload without a non-zero exit.
- **Given** a maintainer greps the repository for the old typo **When** the grep targets `src/templates/skills/` and `.claude/skills/` **Then** zero matches are returned for `metta issue show`.

## US-2: Align skill commit-ownership prose with runtime behavior

**As a** AI orchestrator parsing skill templates
**I want to** read commit-ownership language that accurately states the orchestrator commits planning, review, and verification artifacts after each subagent returns, and the executor subagent commits atomically per task during implementation
**So that** I do not waste cycles instructing `metta-product` or other commit-incapable subagents to run git commands they cannot execute
**Priority:** P1
**Independent Test Criteria:** Each of the six listed skill files (`metta-fix-issues`, `metta-fix-gap`, `metta-auto`, `metta-next`, `metta-quick`, `metta-propose`) contains the updated commit-ownership paragraph, and the old "Every subagent MUST ... git commit" line returns zero grep matches under `src/templates/skills/` and `.claude/skills/`.

**Acceptance Criteria:**
- **Given** the six skill files are read **When** their commit-ownership section is inspected **Then** all six describe orchestrator-owned artifact commits and executor atomic per-task commits.
- **Given** a grep for "Every subagent MUST write files to disk and git commit" **When** run across `src/templates/skills/` and `.claude/skills/` **Then** zero matches are returned.

## US-3: Give metta-product the Bash tool so future commit regressions stay green

**As a** framework maintainer
**I want to** the `metta-product` agent frontmatter to include `Bash` in its `tools:` list
**So that** if a future skill regresses and asks the agent to commit, the commit succeeds instead of silently failing with "I don't have a Bash tool available"
**Priority:** P2
**Independent Test Criteria:** `src/templates/agents/metta-product.md` frontmatter `tools:` list includes `Bash` alongside `Read` and `Write`.

**Acceptance Criteria:**
- **Given** the agent template is loaded **When** the frontmatter `tools:` array is parsed **Then** `Bash` is present.
- **Given** an orchestrator spawns `metta-product` with a commit instruction **When** the agent attempts `git add` and `git commit` **Then** the commands execute successfully.

## US-4: Eliminate skill-to-skill drift on commit ownership

**As a** contributor editing any skill template
**I want to** see a single consistent commit-ownership rule across all six skills
**So that** skill-to-skill drift cannot reintroduce the subagent-commit bug in the future
**Priority:** P2
**Independent Test Criteria:** All six skill files (`metta-fix-issues`, `metta-fix-gap`, `metta-auto`, `metta-next`, `metta-quick`, `metta-propose`) contain byte-identical commit-ownership prose; a cross-file diff of that paragraph is empty.

**Acceptance Criteria:**
- **Given** the commit-ownership paragraph is extracted from each of the six skill files **When** the paragraphs are diffed pairwise **Then** all diffs are empty.
- **Given** the byte-identity test between `src/templates/skills/` and `.claude/skills/` mirrors runs **When** the edited skill files are compared **Then** the mirrors remain byte-identical to their source templates.
