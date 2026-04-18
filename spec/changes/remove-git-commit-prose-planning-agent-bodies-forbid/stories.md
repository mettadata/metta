# remove-git-commit-prose-planning-agent-bodies-forbid — User Stories

## US-1: Planning subagents do not run git

**As a** framework maintainer
**I want to** the 7 planning-agent bodies (proposer, product, architect, planner, researcher, reviewer, verifier) to have no `git add`/`git commit` prose
**So that** they honor the Group C skill rule "planning-artifact subagents write files only — they do not run git"
**Priority:** P1
**Independent Test Criteria:** `grep -rn 'git add\|git commit' src/templates/agents/metta-{proposer,product,architect,planner,researcher,reviewer,verifier}.md` returns zero matches.

**Acceptance Criteria:**
- **Given** the 7 planning-agent bodies **When** the commit-related instructions are inspected **Then** none contain `git add` or `git commit` commands

---

## US-2: Executors must not modify tasks.md

**As a** AI orchestrator
**I want to** `metta-executor.md` to explicitly forbid modifying `spec/changes/<change>/tasks.md`
**So that** `metta complete implementation` is the sole completion signal and the tasks.md file does not accumulate inconsistent marker styles across executors
**Priority:** P1
**Independent Test Criteria:** `metta-executor.md` contains a line stating "MUST NOT modify" and referring to `tasks.md`, and contains no instruction to flip `[x]` or other completion markers.

**Acceptance Criteria:**
- **Given** `metta-executor.md` **When** a maintainer reads the file **Then** the file forbids tasks.md modifications and contains no checkbox-flip instructions

---

## US-3: Deployed mirrors stay byte-identical

**As a** framework user running `/metta-*` skills
**I want to** the `.claude/agents/*.md` deployed copies to stay byte-identical to their `src/templates/agents/*.md` sources
**So that** active skill invocations get the updated agent bodies without drift
**Priority:** P2
**Independent Test Criteria:** `diff -r src/templates/agents .claude/agents` exits 0 with empty output.

**Acceptance Criteria:**
- **Given** all agent-body edits have been applied **When** a byte-level recursive diff runs between source and deployed **Then** the diff is empty
