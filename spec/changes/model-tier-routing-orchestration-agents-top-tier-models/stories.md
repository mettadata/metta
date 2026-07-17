# model-tier-routing-orchestration-agents-top-tier-models — User Stories

## US-1: Planning agents always author at top tier

**As a** metta maintainer running orchestration sessions
**I want to** have every planning-cohort agent (proposer, specifier, researcher, architect, planner, product) run at the inherited top-tier model, with no agent file pinning a downgraded model
**So that** the artifacts that set the quality ceiling for everything downstream — intent, spec, architecture, task breakdown — are authored by the strongest available model instead of a deliberately cheapened one that has already produced real design bugs
**Priority:** P1
**Independent Test Criteria:** `grep -l "model: sonnet" src/templates/agents/*.md .claude/agents/*.md` returns no planning-cohort agent files, and `diff` confirms each deployed `.claude/agents/metta-{proposer,specifier,researcher,architect,planner,product}.md` is byte-identical to its template.

**Acceptance Criteria:**
- **Given** the shipped agent templates in `src/templates/agents/` **When** I inspect the frontmatter of `metta-proposer.md`, `metta-specifier.md`, `metta-researcher.md`, `metta-architect.md`, and `metta-planner.md` **Then** none carries a `model:` key pinning a downgraded model (the key is absent or set to `inherit`)
- **Given** the deployed copies in `.claude/agents/` **When** I compare each planning-cohort agent file against its template **Then** they are byte-identical
- **Given** `metta-product.md`, which currently has no `model:` key **When** the planning cohort rule is applied **Then** it is explicitly included in the "never below inherit" set without gaining any new frontmatter key

---

## US-2: Profile-driven executor routing by workflow tier

**As a** metta maintainer configuring a cost profile
**I want to** declare a `models` profile in `.metta/config.yaml` so that trivial/quick-tier changes emit the profile's cheap executor model in the instruction contract, while standard/full-tier changes and all non-executor roles emit inherit/top-tier
**So that** the ~60% of subagent tokens spent on well-specified, low-ambiguity execution work is routed to a cheaper model per change, without touching agent files and without any behavior change for projects that configure nothing
**Priority:** P1
**Independent Test Criteria:** Against a fixture `.metta/config.yaml` with a budget-style profile, `metta instructions` for a quick-tier change's implementation artifact emits `agent.model` set to the profile's cheap executor model, the same invocation on a standard-tier fixture emits inherit/top-tier, and against a fixture with no `models` key the full output is byte-for-byte identical to today's output.

**Acceptance Criteria:**
- **Given** a project whose `.metta/config.yaml` contains a budget-style `models` profile and an active change classified `trivial` or `quick` **When** `metta instructions` generates the executor invocation for an implementation artifact **Then** the emitted `agent` block carries a `model` field resolving to the profile's cheap executor model
- **Given** the same profile but an active change classified `standard` or `full` **When** `metta instructions` generates the executor invocation **Then** the emitted `model` field resolves to inherit/top-tier
- **Given** any `models` profile **When** instructions are generated for a non-executor role **Then** the emitted `model` field resolves to inherit/top-tier
- **Given** a project with no `models` key in `.metta/config.yaml` **When** `metta instructions` runs for any change at any tier **Then** the output matches today's behavior byte-for-byte (zero behavior change)
- **Given** a skill documenting the `Agent(subagent_type: "...")` invocation pattern (at minimum `metta-execute`) **When** an AI orchestrator follows the documented pattern **Then** it reads the emitted `model` field and passes it through to the `Agent` tool's per-invocation model parameter

---

## US-3: Reviewer and verifier are immune to downgrade

**As a** metta maintainer relying on cheap execution being safe
**I want to** have the schema structurally reject any `models` configuration that assigns a non-inherit/non-top model to the `reviewer` or `verifier` role
**So that** the safety net that makes cheap execution tolerable at all cannot be weakened by any profile, misconfiguration, or future convention drift — the guarantee lives in validation, not documentation
**Priority:** P1
**Independent Test Criteria:** Loading a fixture `.metta/config.yaml` that maps `reviewer` or `verifier` to a cheap model fails Zod validation with a clear error, and a schema-level unit test confirms no representable profile shape can express a downgraded reviewer or verifier.

**Acceptance Criteria:**
- **Given** a `.metta/config.yaml` whose `models` section attempts to assign a cheap model to `reviewer` **When** the config is loaded **Then** Zod validation rejects it with an error identifying the offending role
- **Given** the same attempt against `verifier` **When** the config is loaded **Then** validation rejects it identically
- **Given** every named profile the schema ships (e.g. quality/balanced/budget) **When** each profile is resolved **Then** `reviewer` and `verifier` resolve to inherit/top-tier in all of them
- **Given** the `models` schema definition **When** its shape is inspected **Then** the rejection is structural (validation-time), not a documentation-only convention

---

## US-4: Rung-1 model escalation on STOP or verify-FAIL

**As an** AI orchestrator consuming instruction contracts
**I want to** re-run a task at the top-tier model when a cheap-executor invocation produces a STOP/deviation report or a subsequent verification FAILs while scope stayed within the original tier, with each escalation audit-logged
**So that** cheap-first execution degrades gracefully — a struggling cheap model is escalated rather than looped or trusted, and every escalation leaves a verifiable record of task, from-model, to-model, and trigger
**Priority:** P1
**Independent Test Criteria:** Simulating an executor STOP (and separately a verify-FAIL) on an in-tier cheap-executor fixture change causes the next instruction generation for that task to resolve `model` to top-tier without changing the workflow tier, and the audit log in `.metta/` state contains a Zod-valid record with task id, from-model, to-model, and trigger signal.

**Acceptance Criteria:**
- **Given** a quick-tier change whose executor ran at the profile's cheap model **When** the executor produces a STOP/deviation report and file scope remains within the tier boundary **Then** the affected task is re-run at the top-tier model
- **Given** the same change **When** a verification run FAILs against the cheap-executor output and scope stayed in-tier **Then** the affected task or fix is re-run at the top-tier model
- **Given** a Rung-1 escalation fires **When** the re-run is initiated **Then** the change's workflow tier is unchanged (model-only escalation)
- **Given** any Rung-1 escalation event **When** it is recorded **Then** the audit record persisted via the state-store carries at minimum the task/fix identifier, from-model, to-model, and triggering signal (STOP/deviation vs verify-FAIL), and is Zod-validated on write

---

## US-5: Rung-2 workflow escalation reuses existing upscale machinery

**As an** AI orchestrator handling a change that outgrew its tier
**I want to** have scope overflow (file count past the tier boundary) hand off to the existing adaptive-workflow-tier-selection upscale machinery, with the escalated re-run re-checking tier so higher-tier obligations and top-tier planning agents come along automatically
**So that** a change that turned out bigger than classified gets the full planning rigor of its true tier — without metta duplicating tier-upscale logic inside instruction contracts
**Priority:** P2
**Independent Test Criteria:** Driving a fixture cheap-executor change past its tier's file-count boundary triggers the existing upscale path (no new upscale implementation appears in instruction-contracts code), and `metta instructions` on the upscaled change resolves all roles — including executor — to inherit/top-tier with any retroactive higher-tier artifact obligations flagged.

**Acceptance Criteria:**
- **Given** a quick-tier change with a cheap-executor profile **When** its file count grows past the quick-tier boundary **Then** the existing `adaptive-workflow-tier-selection` upscale machinery handles the escalation, unmodified and not re-implemented
- **Given** a Rung-2 escalation has raised the effective tier **When** instructions are next generated for the change **Then** planning agents and the executor resolve to inherit/top-tier via the same per-tier resolution used everywhere else
- **Given** the escalated re-run **When** it proceeds **Then** tier is re-checked so retroactive stories/spec obligations that fire at the higher tier still fire
- **Given** the trigger signals **When** they are discriminated **Then** in-tier STOP/verify-FAIL routes to Rung 1 (model-only) and file-count overflow routes to Rung 2 (workflow escalation)

---

## US-6: Escalation rate makes the cheap-first bet measurable

**As a** project owner watching orchestration costs
**I want to** see an escalation-rate metric (proportion of cheap-tier executor invocations later escalated to top-tier) in `metta progress`, in both human-readable and `--json` output
**So that** I can empirically judge whether the cheap-executor profile is actually saving money — a high escalation rate tells me the savings are illusory and the profile should be tightened, without pretending the metric catches silent wrong-but-plausible output
**Priority:** P2
**Independent Test Criteria:** Against a fixture state containing recorded escalation events, `metta progress` prints an escalation-rate figure in human-readable output and `metta progress --json` includes the same value as a structured field, following the existing ceremony-commit-ratio reporting pattern.

**Acceptance Criteria:**
- **Given** a project with recorded Rung-1 escalation events **When** I run `metta progress` **Then** the human-readable output reports the escalation rate as the proportion of cheap-tier executor invocations subsequently escalated to top-tier
- **Given** the same state **When** I run `metta progress --json` **Then** the JSON output includes the escalation-rate metric as a structured field
- **Given** a project with cheap-tier invocations and zero escalations **When** I run `metta progress` **Then** the metric reports zero rather than being omitted
- **Given** the spec text describing the metric **When** it characterizes what the metric proves **Then** it does not claim Rung 1 or the metric catches silent wrong-but-plausible cheap-executor output — that residual remains handled by the existing fix-loop
