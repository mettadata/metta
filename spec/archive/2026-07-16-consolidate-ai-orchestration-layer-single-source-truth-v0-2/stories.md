# consolidate-ai-orchestration-layer-single-source-truth-v0-2 — User Stories

## US-1: Personas come from one place

**As a** metta maintainer editing agent personas
**I want to** have `metta instructions <artifact>` emit persona text parsed at runtime from the agent template file
**So that** editing the canonical `.md` agent file is sufficient — the persona a subagent actually receives can never silently diverge from the persona a human reads in `.claude/agents/`
**Priority:** P1
**Independent Test Criteria:** Edit a persona sentence in an agent template file, run `metta instructions` for an artifact assigned to that agent, and assert the emitted output contains the edited sentence while `grep` finds no `BUILTIN_AGENTS` persona string literals remaining in `src/cli/commands/instructions.ts`.

**Acceptance Criteria:**
- **Given** an agent template file in `src/templates/agents/` (mirrored in `.claude/agents/`) **When** `metta instructions <artifact>` resolves that agent **Then** the persona (and any other template-sourced `AgentDefinition` fields) emitted are parsed from the template file's frontmatter/body at runtime, following the constitution-check pattern from step 4b
- **Given** a maintainer edits the persona text in the agent template file **When** `metta instructions` is run again with no TypeScript changes **Then** the emitted instructions reflect the edited text
- **Given** the runtime-parse path is in place **When** `src/cli/commands/instructions.ts` is inspected **Then** the hardcoded `BUILTIN_AGENTS` persona/capability/tool/context-budget literals are deleted
- **Given** skill files that re-embed persona strings inline **When** the audit completes **Then** diverging copies are removed or repointed to the canonical agent template source (excluding the out-of-scope 11x agent-types disclaimer)
- **Given** any agent template touched by this work **When** the change lands **Then** `src/templates/agents/<file>` and `.claude/agents/<file>` are byte-identical (`diff` exits 0)
- **Given** an artifact whose agent resolution succeeds today **When** the new path replaces the hardcoded record **Then** the content subagents receive is unchanged except where it fixes a documented divergence

---

## US-2: No phantom agents, no silent aliasing

**As an** AI orchestrator consuming `metta instructions` output
**I want to** have every agent name referenced by a workflow YAML resolve to a real agent `.md` file, with unrecognized names failing loudly
**So that** the persona a workflow declares is the persona actually delivered — never a silent substitution to a different agent under a different persona string
**Priority:** P1
**Independent Test Criteria:** For every `agents:` entry across all workflow YAMLs in `src/templates/workflows/`, assert a matching agent template file exists (or the entry was repointed to one that does), and running `metta instructions` for an artifact assigned an unrecognized agent name produces an explicit error rather than executor-persona output.

**Acceptance Criteria:**
- **Given** the `standard` and `full` workflow YAMLs assign `agents: [specifier]` **When** the researched resolution is implemented **Then** either a real `metta-specifier.md` exists in both `src/templates/agents/` and `.claude/agents/` (byte-identical) carrying the distinct requirements-engineer persona, or the workflow YAMLs are repointed to name `proposer` explicitly and the `specifier` alias is removed
- **Given** an agent name that resolves to no agent template file **When** `metta instructions` is invoked for an artifact assigned to it **Then** the command signals a resolution failure instead of silently falling back to the executor persona
- **Given** the resolution decision (create vs. repoint) **When** the change is finalized **Then** the choice and its rationale are recorded in the change's research/design artifacts, and no workflow YAML in the repo references an agent name without a backing agent file

---

## US-3: One workflow definition per distinct behavior

**As a** metta maintainer evolving workflow shapes
**I want to** stop hand-maintaining two byte-equivalent `trivial.yaml`/`quick.yaml` files, per the researched dedupe decision
**So that** a future workflow-shape change is made in one place and cannot leave the two tiers silently out of sync
**Priority:** P2
**Independent Test Criteria:** Run the propose/tier path such that one change scores `trivial` and another scores `quick`, and assert both tier names resolve to a loadable workflow whose `metta instructions` output is correct end-to-end — with either only one workflow file remaining on disk or a recorded rationale for keeping both.

**Acceptance Criteria:**
- **Given** the researched dedupe option (e.g., map the `trivial` tier name to `quick.yaml` and delete `trivial.yaml`, or keep both with the cost documented) **When** it is applied **Then** both the `trivial` (≤1 file) and `quick` (2-3 files) tier names still resolve to a loadable workflow through propose → downscale → instructions
- **Given** a change downscaled or scored into either tier **When** `metta instructions` is run for its artifacts **Then** the emitted artifact/gate sequence is identical to today's behavior for that tier
- **Given** the option that deletes `trivial.yaml` is chosen **When** templates are deployed **Then** `src/templates/workflows/` and the deployed `.metta/workflows/` copies of every remaining touched workflow file are byte-identical
- **Given** whichever option is chosen **When** the change is finalized **Then** the decision and rationale are recorded in the change artifacts, not left implicit

---

## US-4: Gate scaffolds match reality for non-JS stacks

**As a** metta maintainer deciding the fate of the go/python/rust gate scaffolds
**I want to** verify via `install.ts`'s multi-stack detection whether the scaffolds are reachable before deleting or keeping them
**So that** we neither break non-JS consumer installs by deleting live code nor carry dead code alongside an unfixed npm-hardcoding bug
**Priority:** P2
**Independent Test Criteria:** Run `metta install` (or its test harness equivalent) against a fixture project containing `Cargo.toml` or `pyproject.toml` and assert the outcome matches the researched decision — per-stack gates scaffolded without npm-hardcoded commands if kept, or scaffolds absent from `src/templates/gate-scaffolds/` and no `install.ts` path reads them if deleted.

**Acceptance Criteria:**
- **Given** `install.ts`'s multi-stack detection (`Cargo.toml`, `go.mod`, `pyproject.toml`) **When** research traces whether the go/python/rust scaffold YAMLs are reachable for consumer projects **Then** the finding (live vs. unreachable) is recorded with evidence before any deletion occurs
- **Given** research finds the scaffolds live **When** the change is implemented **Then** the scaffolds are kept and the npm-hardcoding inconsistency in the real gates is fixed, verified by an install into a rust or python fixture producing stack-appropriate gate commands
- **Given** research finds the scaffolds genuinely unreachable **When** the change is implemented **Then** the go/python/rust scaffold YAMLs and any `install.ts` code path that reads them are deleted, and an install into a rust or python fixture still completes successfully
- **Given** any template/deployed asset pair touched by this story **When** the change lands **Then** the pairs remain byte-identical and the full test suite is green
