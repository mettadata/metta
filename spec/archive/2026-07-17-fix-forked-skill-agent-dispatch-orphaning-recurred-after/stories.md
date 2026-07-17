# fix-forked-skill-agent-dispatch-orphaning-recurred-after — User Stories

## US-1: A fork cannot silently abandon dispatched work

**As a** AI orchestrator invoking a `context: fork` metta skill
**I want to** be mechanically guaranteed that the fork cannot end its turn while an `Agent` child it dispatched is still pending
**So that** dispatched work is never orphaned to run unsupervised behind a "completed" fork result, eliminating the manual recovery cycle observed on effectively every forked-skill invocation in v0.2
**Priority:** P1
**Independent Test Criteria:** For the mechanism research selects, feed the enforcement hook a synthetic event sequence representing "child dispatched, child not yet returned, fork attempts to stop" (or an explicitly-async `Agent` dispatch shape, if the forced-synchronous mechanism lands) and verify the hook emits a blocking decision — exit code 2 or `{"decision":"block"}` — rather than allowing the turn to end.

**Acceptance Criteria:**
- **Given** a `metta-*` fork has dispatched an `Agent` child that has not yet returned **When** the fork attempts to end its turn (or attempts a dispatch shape that would detach the child, under the forced-synchronous mechanism) **Then** the enforcement mechanism blocks it mechanically — via hook decision, not contract prose — so exactly one of turn-end-blocking or forced-synchronous dispatch provably holds
- **Given** a `metta-*` fork whose dispatched `Agent` children have all returned **When** the fork attempts to end its turn **Then** the enforcement mechanism allows the stop without interference
- **Given** a subagent whose `agent_type` is not a `metta-*` fork caller **When** it dispatches agents or ends its turn **Then** the enforcement mechanism does not apply, consistent with the existing `metta-guard-bash.mjs` trust model
- **Given** the enforcement hook files exist **When** the template under `src/templates/hooks/` and the deployed copy under `.claude/hooks/` are compared **Then** they are byte-identical and pass `node --check`

---

## US-2: The orchestrator receives a truthful fork result

**As a** AI orchestrator invoking a `context: fork` metta skill
**I want to** receive a fork final message that reflects actually-completed work
**So that** I never treat in-progress narration like "the proposer agent is writing the intent artifact, I'll wait for it" as a terminal success and advance the workflow on top of unfinished work
**Priority:** P1
**Independent Test Criteria:** With enforcement in place, drive a fork through a dispatch-then-stop attempt using synthetic hook events and verify the blocking `reason` fed back to the fork instructs it to wait for the outstanding child, so the fork continues its turn and its eventual final message describes completed work rather than pending work.

**Acceptance Criteria:**
- **Given** a fork attempts to stop with a pending dispatched child and enforcement fires **When** the block decision is returned **Then** the accompanying `reason` explicitly tells the fork to wait for the outstanding child before returning, causing the fork to visibly continue or wait rather than surface in-progress narration as its result
- **Given** enforcement fired one or more times during a fork's run **When** the fork finally returns to the orchestrator **Then** its final message reflects the completed state of all dispatched work, not a promise about work still in flight
- **Given** the skill-host contract in `.claude/agents/metta-skill-host.md` **When** an orchestrator reads a fork summary that narrates in-progress or background work **Then** the contract directs it to treat that summary as a failed, non-terminal fork result rather than success

---

## US-3: Recovery is codified for the residual orphaning case

**As a** AI orchestrator handling a fork that orphaned its dispatched agent despite enforcement (mechanism gap, hook not firing)
**I want to** follow an exact, written recovery protocol carried by the skill-host contract and all six fork skills
**So that** I wait for the orphan's completion instead of racing a duplicate dispatch — preventing a repeat of the duplicate-proposer race that required killing an agent by hand
**Priority:** P2
**Independent Test Criteria:** A grep/contract check confirms `.claude/agents/metta-skill-host.md` and each of the six fork skill bodies (`metta-issue`, `metta-fix-issues`, `metta-propose`, `metta-quick`, `metta-auto`, `metta-ship`) contain the recovery-protocol section covering all three steps: treat in-progress narration as failure, wait on/attach to the orphan rather than re-dispatching, and only re-dispatch after the orphan is confirmed dead or complete.

**Acceptance Criteria:**
- **Given** the six `context: fork` skill bodies and `metta-skill-host.md` **When** each file is inspected **Then** every one carries the slimmed recovery-protocol section, and skill frontmatter (`context: fork`, `agent: metta-skill-host`) is unchanged
- **Given** an orchestrator detects an orphaned fork per the protocol **When** it follows the documented steps **Then** it checks for and waits on or attaches to the still-running orphaned agent instead of spawning a duplicate, and resumes from the orphan's persisted output/state
- **Given** an orphaned agent is confirmed dead or complete **When** the orchestrator needs the work done **Then** the protocol permits re-dispatching fresh work only at that point

---

## US-4: Enforcement is observable after the fact

**As a** metta maintainer auditing orphaning-prevention behavior
**I want to** inspect evidence of enforcement events — blocked stops, rejected async dispatch shapes, or recovery-protocol invocations
**So that** I can confirm the mechanism actually fires in real sessions, measure recurrence, and diagnose any residual orphaning without reconstructing sessions by hand
**Priority:** P3
**Independent Test Criteria:** Trigger an enforcement event synthetically (blocked stop or rejected dispatch) and verify a log record or equivalent durable evidence is produced that identifies the event type, the affected fork's agent identity, and enough context to correlate it with the session — inspectable after the session ends.

**Acceptance Criteria:**
- **Given** the enforcement mechanism blocks a fork's stop or rejects an async dispatch shape **When** the event fires **Then** a log record or equivalent evidence is emitted capturing the event type and the fork/agent identity involved
- **Given** an orchestrator invoked the codified recovery protocol for an orphaned fork **When** a maintainer reviews the session afterward **Then** the recovery invocation is discernible from recorded evidence, not only from ephemeral conversation text
- **Given** a maintainer investigating a suspected orphaning **When** they inspect the recorded enforcement evidence **Then** they can distinguish "enforcement fired and prevented orphaning" from "enforcement never fired" for the fork in question
