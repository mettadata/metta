# fix-automatic-token-recording-via-posttooluse-hook-remove — User Stories

## US-1: Complete token reports without orchestrator diligence

**As a** metta-adopting developer reviewing per-change token spend
**I want to** have every subagent run's token usage recorded automatically by the framework when the Task tool completes
**So that** TOKENS.md is complete and trustworthy after a build without depending on the orchestrating model remembering to run a recording command after every spawn
**Priority:** P1
**Independent Test Criteria:** After a build in which the orchestrator never runs `metta tokens record` manually, TOKENS.md contains a record for every subagent (Task tool) completion.

**Acceptance Criteria:**
- **Given** the PostToolUse hook is installed and registered **When** a Task/Agent tool call completes **Then** the hook invokes `metta tokens record` with usage extracted from the hook payload, with no orchestrator action required
- **Given** a build spawns multiple subagents **When** the change is finalized **Then** TOKENS.md shows one entry per subagent run with no runs missing due to skipped prose instructions
- **Given** the hook payload identifies the subagent (type, model, prompt/description) **When** a record is written **Then** the record's task/agent/model fields reflect those payload values

## US-2: Exact harness-measured counts instead of self-reported estimates

**As a** metta-adopting developer analyzing token spend
**I want to** see harness-measured token counts (when the Claude Code hook payload exposes them) instead of the subagent's self-reported prose estimate
**So that** I can trust the numbers in TOKENS.md as accurate measurements rather than model-generated approximations
**Priority:** P1
**Independent Test Criteria:** For a hook-recorded run, the token count in TOKENS.md matches the usage value from the PostToolUse payload, and the record is distinguishable by provenance from a prose-recorded estimate.

**Acceptance Criteria:**
- **Given** the research spike confirms the PostToolUse payload exposes subagent token usage **When** the hook records a run **Then** the recorded count is the exact payload value, not a model-authored estimate
- **Given** the research spike finds usage is NOT exposed in the payload **When** the design decision point is reached **Then** the change stops after logging the finding — no hook that records fabricated counts is shipped
- **Given** records exist from both eras **When** TOKENS.md is generated **Then** hook-sourced (exact) and prose-sourced (estimated) records are distinguishable via a provenance marker

## US-3: Correct recording from inside change worktrees

**As a** metta-adopting developer whose builds execute inside `.metta/worktrees/<change>/`
**I want to** have hook-triggered records resolve and attach to the correct active change even when the hook's cwd is a worktree rather than the repo root
**So that** token records are never misfiled to the wrong change or silently dropped, the way worktree-blind hooks have failed before
**Priority:** P1
**Independent Test Criteria:** A recording invoked with cwd inside `.metta/worktrees/<change>/` writes its record to that change's metadata, verified against both worktree and repo-root cwds.

**Acceptance Criteria:**
- **Given** the hook fires with cwd inside `.metta/worktrees/<change>/` **When** it invokes `metta tokens record` **Then** the record is attributed to that change, not lost or misfiled
- **Given** the hook fires with cwd at the repo root with an active change **When** it records **Then** the record is attributed to the active change as before
- **Given** no active change can be resolved from the cwd **When** the hook runs **Then** it fails safely without misattributing the record

## US-4: No double-counting during the transition

**As a** metta-adopting developer reading TOKENS.md totals
**I want to** see each subagent run counted exactly once even when both the hook and legacy skill prose record the same run
**So that** per-change totals and per-agent breakdowns remain accurate during the migration from prose-driven to hook-driven recording
**Priority:** P1
**Independent Test Criteria:** When a run has both a hook-sourced and a prose-sourced record, the generated TOKENS.md counts it once, preferring the hook-sourced exact value.

**Acceptance Criteria:**
- **Given** a run recorded by both the hook and the prose contract **When** TOKENS.md is generated **Then** the run appears once and totals include only the hook-sourced count
- **Given** token usage records are written with a provenance/source marker **When** any record is persisted **Then** the write is validated by the extended Zod schema
- **Given** a run recorded only via prose (e.g. hook missed it) **When** the report is generated **Then** the prose record is retained rather than discarded

## US-5: Recording failures never break my build

**As a** metta-adopting developer running lifecycle workflows
**I want to** have any token-recording hook error be non-blocking
**So that** a bookkeeping failure never fails a Task tool call or interrupts planning, execution, or verification
**Priority:** P2
**Independent Test Criteria:** A forced hook error (e.g. CLI unavailable or unresolvable change) leaves the Task tool completion successful and the session uninterrupted.

**Acceptance Criteria:**
- **Given** `metta tokens record` fails or is unavailable **When** the PostToolUse hook runs **Then** the Task tool call still completes successfully
- **Given** the new hook is registered in `.claude/settings.json` **When** other hooks on the same events fire **Then** existing guard/mint hook behavior is unaffected

## US-6: Leaner skills and meaningful gap reporting

**As a** metta-adopting developer (and skill maintainer)
**I want to** have the per-subagent recording prose removed or demoted in the four lifecycle skills and the TOKENS.md GAPS section reworded as a hook-health indicator
**So that** skill instructions shrink to what the orchestrator actually must do, and a reported gap means "the hook missed a run" — a real signal — instead of "the model forgot"
**Priority:** P2
**Independent Test Criteria:** After the hook is recording reliably, the lifecycle skills (installed copies and template sources, kept in sync) no longer mandate per-subagent `metta tokens record` calls, and the GAPS section wording describes hook coverage.

**Acceptance Criteria:**
- **Given** the hook records reliably **When** the lifecycle skills are updated **Then** the "run `metta tokens record` after each subagent returns" instruction is removed or reduced to a fallback note in both installed skills and `src/templates/skills/` sources
- **Given** a run is missing from the records **When** TOKENS.md is generated **Then** the GAPS section describes it as a hook coverage miss rather than orchestrator non-compliance
- **Given** existing TOKENS.md consumers **When** the report is regenerated **Then** the overall report structure is unchanged apart from GAPS wording and dedupe-aware totals
