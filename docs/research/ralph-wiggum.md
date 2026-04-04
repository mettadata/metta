# Ralph Wiggum Loop Analysis

**Repo**: `referrences/how-to-ralph-wiggum/`
**By**: Geoffrey Huntley
**Stack**: Bash scripts, markdown prompts, filesystem state
**Philosophy**: Context is everything. Let Ralph Ralph. Simplicity wins.

---

## Architecture

This is a **documented pattern/methodology** with reference implementations, not a framework. Core components:

- **Loop Script** (`loop.sh`) — ~70 line bash orchestrator with mode selection and max-iterations
- **Two-Mode Prompt System** — `PROMPT_plan.md` (gap analysis) and `PROMPT_build.md` (implementation)
- **Persistent State Files** — `IMPLEMENTATION_PLAN.md` and `AGENTS.md` on disk
- **Specification Docs** — One markdown file per "Topic of Concern" in `specs/`

### The Loop (simplest form)
```bash
while true; do
  cat PROMPT.md | claude
done
```

Each iteration: fresh context window, same deterministic file loading, one task, one commit, exit. The `IMPLEMENTATION_PLAN.md` on disk is the shared state between isolated executions.

---

## Core Workflow

### Phase 1: Requirements (human + LLM conversation)
Identify Jobs-To-Be-Done -> break into Topics of Concern (one sentence without "and") -> write `specs/*.md` (one per topic).

### Phase 2: Planning Mode (`./loop.sh plan`)
Each iteration:
1. Study specs and current code
2. Gap analysis (specs vs code)
3. Create/update `IMPLEMENTATION_PLAN.md` as prioritized bullet list
4. No implementation, no commits
5. Exit -> loop restarts with fresh context

### Phase 3: Building Mode (`./loop.sh build`)
Each iteration:
- Phase 0: Orient (study specs, plan, scan source)
- Phase 1: Select task from IMPLEMENTATION_PLAN.md
- Phase 2: Search codebase (don't assume not implemented)
- Phase 3: Implement changes
- Phase 4: Run tests (backpressure)
- Phase 5: Update IMPLEMENTATION_PLAN.md with findings
- Phase 6: Update AGENTS.md if operational learnings
- Phase 7: Commit
- Exit -> context cleared -> loop restarts

### Subagent Model
- Up to 500 parallel Sonnet subagents for searching/reading
- Only 1 subagent for build/tests (backpressure control)
- Opus for complex reasoning (debugging, architecture)

---

## Strengths

### Context Window Optimization (primary design goal)
- Only ~176K truly usable from 200K advertised
- One tight task per loop = best utilization
- No context pollution from previous iterations
- Deterministic setup: same files loaded each time

### Backpressure as Primary Control
- Tests/lints/builds create hard gates
- Existing code patterns steer future implementation
- AGENTS.md reminders guide agent toward correct patterns
- "Steer upstream" with specs/utilities; "steer downstream" with test failures

### Eventual Consistency Through Iteration
- No global state synchronization needed
- Dumb bash loop + file I/O = zero orchestration complexity
- Self-corrects through observed failure patterns
- Plan is disposable — regenerate from specs cheaply

### Philosophy: "Let Ralph Ralph"
- Agent decides which task, approach, prioritization
- Operator tunes environment, not prescribes steps
- Observes failure patterns, adds guardrails reactively
- "Signs aren't just prompt text. They're anything Ralph can discover."

### Clear Success Signals
- Commits force explicit task completion
- Tests pass/fail as binary gate
- Updated plan prevents duplicate work
- One commit per task keeps history clean and reversible

---

## Weaknesses / Gaps

### Incomplete Framework
- Documentation of a pattern, not a finished tool
- Users must adapt `loop.sh` and prompts to their project
- AGENTS.md must be manually written per-project (no template generation)
- No standardized way to handle project diversity

### Subagent Orchestration Opacity
- "Use up to 500 Sonnet subagents" but no tool/library for this
- Relies on Claude's inherent subagent ability
- No explicit pooling, lifecycle handling, or management

### Backpressure Assumptions
- Assumes good test coverage exists upfront
- Flaky or missing tests make backpressure noisy/useless
- Subjective quality criteria (tone, aesthetics) need LLM-as-judge (proposed, not core)
- Hard for domains without programmatic validation

### State Management Limitations
- IMPLEMENTATION_PLAN.md is the only cross-iteration state
- No conflict resolution for multiple branches
- Plan can grow bloated (manual cleanup recommended)
- No versioning of specs

### Scaling Uncertainties
- Tested for single-agent, single-project scenarios
- Unclear how to coordinate multiple agents on same codebase
- No guidance on concurrent changes
- Works best for greenfield or well-structured codebases

### Plan Creation Difficulty
- First PLANNING iteration is expensive (gap analysis on entire codebase)
- Requires well-structured specs to work well
- Vague/incomplete specs produce vague plans

---

## Key Design Decisions

| Decision | Rationale | Tradeoff |
|----------|-----------|----------|
| Fresh context per iteration | Every token is precious; prevents context degradation | Must coordinate through disk state |
| Plan is disposable | Regenerating from specs is cheap | No version control or careful merging |
| Backpressure as primary control | Can't prescribe every detail for non-deterministic LLMs | Requires good test coverage |
| One task per iteration | Prevents task interference, forces clear scope | No multi-task transactions |
| Specs -> Plan -> Code funnel | Separate WHAT from HOW from DO | Requires upfront spec work |
| Sign-based steering | More robust than prompt tweaking | Less explicit than detailed instructions |

---

## Proposed Enhancements (documented in README)

1. **AskUserQuestion for Planning** — systematic interview during requirements
2. **Acceptance-Driven Backpressure** — derive tests from acceptance criteria in specs
3. **Non-Deterministic Backpressure** — LLM-as-judge for subjective criteria
4. **Ralph-Friendly Work Branches** — `plan-work` mode for scoped planning per branch
5. **JTBD -> Story Map -> SLC Release** — connect audience/activities to release planning

---

## Security Philosophy

"It's not if it gets popped, it's when. And what is the blast radius?"
- Sandbox is the security boundary (Docker, E2B, Modal, Fly Sprites, Cloudflare)
- Inside sandbox, full permissions (`--dangerously-skip-permissions`)
- Minimum viable access: only credentials needed for task
