# BMAD-METHOD Analysis

**Repo**: `referrences/BMAD-METHOD/`
**By**: bmad-code-org
**Stack**: Markdown prompts, YAML config, CSV technique libraries, Node.js installer
**Philosophy**: Full SDLC orchestration through specialized AI agent personas

---

## Architecture

Multi-phase, multi-agent orchestration across four SDLC phases:
- **Phase 1: Analysis** (optional) — exploration, research, concept validation
- **Phase 2: Planning** — requirements & UX design
- **Phase 3: Solutioning** — architecture & epic/story decomposition
- **Phase 4: Implementation** — development cycle

### The Agent Personas

| Agent | Role | Expertise |
|-------|------|-----------|
| Mary | Analyst | Market research, requirements elicitation |
| John | PM | PRD creation, requirements discovery |
| Winston | Architect | System architecture, ADRs, tech decisions |
| Amelia | Developer | Story execution, TDD implementation |
| Sally | UX Designer | Wireframes, interaction patterns, user flows |
| Paige | Technical Writer | Documentation, standards, communication |
| Master | Orchestrator | Party mode coordination (group discussions) |

Plus subagents: Artifact Analyzer, Web Researcher, Skeptic Reviewer, Opportunity Reviewer, Distillate Compressor, Round-Trip Reconstructor.

### Core Abstractions

**Skill System**: Each workflow is a skill with `SKILL.md` entry point and substages. Manifest metadata (`bmad-manifest.json`) declares menu codes, phase dependencies, output locations. Skills invocable via agent menu, direct CLI, or from other skills.

**File-Based Context Passing**: Agents don't call each other — they read files and write files. Artifacts in `_bmad-output/`, config in `_bmad/bmm/config.yaml`. Composable: run Phase 1 now, Phase 2 next month.

**Subagent Fan-Out**: Spawned in parallel with structured prompts defining persona, context, and task. Each produces JSON output. Graceful degradation: if subagents unavailable, main agent works sequentially.

**Mode System**: Guided (interactive checkpoints), Yolo (upfront input, auto-draft), Autonomous/Headless (full execution without human interaction).

---

## Core Workflow

### Phase 1: Analysis (Optional)

**Brainstorming**: 62 CSV-driven structured techniques. Anti-bias protocol rotates creative domains every 10 ideas. Target 100+ ideas.

**Research**: Market research (competitive landscape), domain research (subject matter), technical research (feasibility).

**Product Brief** (5 stages):
1. Intent understanding
2. Contextual discovery (fan-out: Artifact Analyzer + Web Researcher in parallel)
3. Guided elicitation (conversational gap-filling)
4. Draft & review (fan-out: Skeptic + Opportunity + Contextual reviewers in parallel)
5. Finalize + auto-generate distillate (token-efficient overflow capture)

**PRFAQ**: Amazon's Working Backwards method — write press release + customer FAQ.

### Phase 2: Planning

**Create PRD**: Ingest brief/research -> domain complexity assessment -> guided discovery (problem, users, metrics, NFRs) -> draft FRs with acceptance criteria -> validate with `bmad-validate-prd`.

Output: `PRD.md` with vision, user segments, success metrics, FRs, NFRs, constraints.

Optional: `bmad-create-ux-design` -> `ux-spec.md`.

### Phase 3: Solutioning

**Architecture**: Read PRD -> tech assessment -> ADRs (API style, DB, auth, state, deployment) -> FR-to-technical mapping -> standards & conventions.

Output: `architecture.md` with ADRs and mapping matrix.

**Epics & Stories**: Decompose requirements into epics -> break into stories -> structure in `epics.md`.

**Implementation Readiness Check**: Gate verifying PRD + Architecture + UX + Epics all exist and aligned.

### Phase 4: Implementation

Sequential story-by-story:
1. `bmad-create-story` — Amelia reads architecture/PRD, produces `story-{slug}.md` with AC, tasks, dependencies
2. `bmad-dev-story` — Execute tasks sequentially, implement + test, mark checkboxes only when passing
3. `bmad-code-review` — Multi-facet review (correctness, testing, quality, architecture alignment)
4. Sprint management: planning, status, course correction, retrospective

**Quick Dev** (parallel fast track): Clarify intent -> route to smallest safe path -> skip planning if zero-blast-radius -> implement + review.

---

## Strengths

### Multi-Agent Approach
- **True persona separation**: Each agent has distinct voice, expertise, principles — prevents role confusion
- **Subagent independence**: Party mode spawns real subagents (not roleplay), producing genuinely diverse perspectives
- **Graceful degradation**: Falls back to sequential execution when subagents unavailable

### Prompt Engineering Quality
- Precise persona instructions with embedded identity and communication style
- Context-rich subagent prompts (persona + history + project knowledge + constraints)
- JSON output specifications for structured data exchange
- Explicit compression rules for distillation (no hedging, explicit relationships)

### SDLC Coverage
- Full lifecycle from brainstorming through retrospective
- Optional depth tuning (analysis optional, planning depth adjusts for startup vs enterprise)
- Circular feedback via `bmad-correct-course` for mid-sprint changes

### Extensibility
- Module architecture (BMM, BMB, TEA) extends core without modification
- CSV-driven brainstorming techniques (62 methods, easy to add more)
- Skill-based registry with manifest discovery
- Templated agent definitions (copy/paste SKILL.md for custom agents)

### Distillation Pattern
Lossless compression of overflow (rejected ideas, requirements hints, technical constraints) into token-efficient distillates. Captures information summaries would lose.

---

## Weaknesses / Gaps

### Complexity Overhead
- Multi-step installation, config files, module selection — non-trivial for new users
- Phase 1 (Analysis) is verbose for solo devs building small features
- Many soft gates in guided mode ("anything else?") can feel like analysis paralysis
- Artifact/config/output directory management adds friction

### Missing Team Features
- No conflict resolution for simultaneous edits
- No async handoff state (assumes single session)
- No approval workflow (PM can't async approve stories)
- No integration with Jira, GitHub Issues, Linear — must copy/paste

### Limited Error Handling
- Subagent failures can block workflow (graceful degradation documented but not always implemented)
- No retry logic for timed-out web research
- No transaction semantics — partial story completion leaves inconsistent state
- Config changes mid-workflow cause stale context reads

### Tight Coupling
- Config paths hardcoded across all agents
- Artifact naming conventions assumed (`product-brief-{project}.md`, `PRD.md`)
- Phase ordering assumes linear progression; non-standard flows need workarounds

### Scalability
- Token explosion for large projects (distillates still large)
- No caching — each agent reload re-reads all context files
- Party mode practical limit ~5-6 parallel agents
- No streaming; assumes artifacts fit in context

### Testing & Validation
- No automated tests for workflows/skills
- No trace/audit to replay workflow decisions
- No schema validation before downstream consumption
- Amelia's test promises rely on honor system

---

## Key Design Decisions

| Decision | Rationale | Tradeoff |
|----------|-----------|----------|
| File-based context over API calls | Zero latency, agents optimize reading strategy | Can't incrementally refine based on feedback |
| Lossless distillation over summarization | Preserves info summaries would lose | Still token-heavy for large projects |
| True subagent independence | Genuine disagreement catches blind spots | Requires subagent capability, falls back |
| Mode system (Guided/Yolo/Autonomous) | Different oversight cadences per user/project | Three code paths to test |
| CSV-driven techniques | Separates library from logic, easy to extend | Complex techniques don't fit CSV well |
| Architecture as shared contract | Enforces consistency across distributed agents | Requires architecture phase before implementation |
| Quick Dev "compress intent first" | Reduces hallucination by setting tight boundaries | Still requires upfront user involvement |
