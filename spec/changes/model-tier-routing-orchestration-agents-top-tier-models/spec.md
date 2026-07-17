# instruction-contracts

<!-- Rung-2 escalation behavior (workflow-tier upscale triggered by scope overflow) belongs to the
     existing adaptive-workflow-tier-selection capability — its intent-time and post-implementation
     upscale machinery is reused unmodified (single-target limitation, established pattern: one
     capability owns tier classification and upscaling). Acceptance criteria for that behavior are
     covered by this change's stories, not restated as instruction-contracts requirements here. The
     escalation-rate metric requirement is authored in this file because the events it reports on
     (model-escalation audit records) are artifacts emitted by this capability's instruction
     generation, even though the metric's reporting surface (`metta progress`) also serves
     adaptive-workflow-tier-selection's ceremony-commit-ratio metric. -->

## MODIFIED: Requirement: Emitted Instructions Contract Carries Complete Agent Identity

The instructions output for an artifact MUST include the resolved agent's name, persona, tools, and
model. The `name`, `persona`, and `tools` fields MUST be sourced from that agent's definition file at
generation time, and the `tools` field MUST reflect the tool list declared in the agent definition
rather than a value computed or hardcoded independently of it. The `model` field MUST be computed
per instruction-generation call from the project's resolved `models` configuration and the active
change's current workflow tier. When the project has no `models` configuration, the `model` field
MUST resolve to `inherit` for every agent and every artifact, preserving the effective execution
behavior that existed before this field was introduced (every role running under the session's
inherited model). Consumers of the instructions output (human or AI orchestrator) MUST be able to
determine, from the output alone, which agent produced the contract, what persona and tool access
that agent has, and which model it MUST run under.

### Scenario: Instructions output includes name, persona, tools, and model sourced consistently
- GIVEN an artifact assigned to an agent with a defined name, persona, and tool list, in a project with a `models` configuration present
- WHEN instructions are generated for that artifact
- THEN the output's agent object contains a `name`, a `persona`, a `tools` list, and a `model` value
- AND the `name`, `persona`, and `tools` values match the corresponding values in that agent's definition file

### Scenario: A tool list change in the agent definition is reflected in the next generation
- GIVEN an agent definition whose tool list is edited to add or remove a tool
- WHEN instructions are next generated for an artifact assigned to that agent
- THEN the emitted `tools` list reflects the edited tool list

### Scenario: No models configuration yields inherit for every emitted model field
- GIVEN a project with no `models` configuration present
- WHEN instructions are generated for artifacts assigned to agents in any role, at any workflow tier
- THEN every emitted `model` field resolves to `inherit`


## ADDED: Requirement: Planning Cohort Requires Top-Tier Model

Every agent in the planning cohort — proposer, specifier, product, researcher, architect, and
planner — MUST run at the session's inherited model or better. No agent definition file MAY pin a
planning-cohort agent's model below inherit, and the `models` configuration schema MUST NOT expose a
mechanism capable of assigning a planning-cohort role a model below inherit. The set of roles
representable in `models` configuration MUST be limited to those this capability defines as
configurable (the executor role, and the reviewer and verifier roles addressed elsewhere); no
planning-cohort role name is a valid key in that configuration's shape. This constraint MUST hold
regardless of workflow tier: no combination of configuration and tier classification may cause a
planning-cohort agent to resolve to a downgraded model.

### Scenario: Shipped planning-cohort agent definitions carry no downgraded model
- GIVEN the shipped agent definition files for the proposer, specifier, product, researcher, architect, and planner agents
- WHEN their frontmatter is inspected for a model-pinning key
- THEN none of them pins a model below inherit

### Scenario: Planning-cohort roles resolve to inherit under every configuration and tier
- GIVEN any resolvable `models` configuration and any workflow tier classification
- WHEN model resolution runs for a planning-cohort role
- THEN the resolved value is inherit/top-tier

### Scenario: The configuration schema exposes no planning-cohort role key
- GIVEN the `models` configuration schema's set of representable role keys
- WHEN that set is inspected
- THEN it contains only the executor role and the reviewer and verifier roles, and no planning-cohort role name is present


## ADDED: Requirement: Tier-Coupled Executor Routing

When the active change's current workflow tier is `trivial` or `quick`, an eligible executor-role
invocation MAY resolve to the profile's designated cheap-executor model, provided the project's
`models` configuration designates one for that tier. When the active change's current workflow tier
is `standard` or `full`, or when no cheap-executor model is designated for the current tier, the
executor role MUST resolve to inherit/top-tier. Tier eligibility MUST be evaluated per
instruction-generation call against the change's current workflow tier, not a value cached from an
earlier point in the change's lifecycle.

### Scenario: Quick-tier executor invocation resolves to the configured cheap-executor model
- GIVEN a project whose `models` configuration designates a cheap-executor model for the quick tier, and an active change currently classified `quick`
- WHEN instructions are generated for the executor's implementation artifact
- THEN the emitted `model` field resolves to the profile's designated cheap-executor model

### Scenario: Standard-tier executor invocation resolves to inherit regardless of profile
- GIVEN the same `models` configuration, with the active change currently classified `standard`
- WHEN instructions are generated for the executor's implementation artifact
- THEN the emitted `model` field resolves to inherit/top-tier

### Scenario: A tier change since intent time is reflected at generation time
- GIVEN a change originally classified `quick` whose current workflow tier has since become `standard`
- WHEN instructions are generated for the executor's implementation artifact after the tier changed
- THEN the emitted `model` field resolves to inherit/top-tier, reflecting the current tier rather than the tier recorded at intent time


## ADDED: Requirement: Safety-Net Immunity For Reviewer And Verifier

The `models` configuration schema MUST make it structurally impossible for any profile or explicit
role map to assign a non-inherit, non-top-tier model to the reviewer or verifier role: loading a
configuration document that attempts to do so MUST fail validation with an error identifying the
offending role field. No model-resolution code path defined by this capability — including
tier-coupled executor routing and Rung-1 model escalation — may produce a downgraded model value for
the reviewer or verifier role under any input. Every named profile the schema ships MUST resolve
reviewer and verifier to inherit/top-tier.

### Scenario: A configuration assigning a downgraded model to reviewer is rejected
- GIVEN a `models` configuration document whose role map assigns a cheap model to the reviewer role
- WHEN the configuration is loaded
- THEN validation fails with an error identifying the reviewer field as the offending field

### Scenario: A configuration assigning a downgraded model to verifier is rejected identically
- GIVEN a `models` configuration document whose role map assigns a cheap model to the verifier role
- WHEN the configuration is loaded
- THEN validation fails with an error identifying the verifier field as the offending field

### Scenario: Every shipped named profile resolves reviewer and verifier to top-tier
- GIVEN each named profile the `models` configuration schema ships
- WHEN each profile is resolved
- THEN the reviewer and verifier roles resolve to inherit/top-tier in every one of them


## ADDED: Requirement: Rung-1 Model Escalation On STOP Or Verify-FAIL

When an executor invocation running under a downgraded model produces a STOP/deviation report, or a
subsequent verification run FAILs against output produced under a downgraded model, and the change's
file scope has remained within its current workflow tier's boundary, the affected task or fix MUST
be re-run with its emitted `model` resolved to inherit/top-tier for that re-run. Each such escalation
MUST be recorded in a durable audit record carrying, at minimum: the task or fix identifier, the
from-model, the to-model, and the triggering signal (STOP/deviation report or verify-FAIL).

### Scenario: An in-tier STOP report escalates the next run to top-tier
- GIVEN a quick-tier change whose executor invocation ran under the profile's cheap-executor model
- WHEN that invocation produces a STOP/deviation report and the change's file scope remains within the quick tier's boundary
- THEN instructions next generated for the affected task resolve the `model` field to inherit/top-tier

### Scenario: An in-tier verify-FAIL escalates the fix run to top-tier
- GIVEN the same change, with output produced under the cheap-executor model
- WHEN a verification run FAILs against that output and the change's file scope remains within the quick tier's boundary
- THEN instructions next generated for the affected fix resolve the `model` field to inherit/top-tier

### Scenario: A Rung-1 escalation is recorded in a durable audit record
- GIVEN a Rung-1 escalation fires for a task
- WHEN the escalation is recorded
- THEN the persisted audit record carries the task/fix identifier, the from-model, the to-model, and the triggering signal, and remains retrievable after the recording process ends


## ADDED: Requirement: Rung Discrimination Between Model And Workflow Escalation

Model escalation (Rung 1) MUST NOT by itself change a change's workflow tier classification. A
scope-overflow signal — the change's file count exceeding its current workflow tier's boundary —
MUST be routed to the existing adaptive-workflow-tier-selection upscale machinery rather than
recorded or handled as a Rung-1 model escalation. When a workflow-tier upscale occurs through that
machinery, subsequent instruction-generation calls for the change's planning artifacts MUST resolve
to inherit/top-tier under the same per-tier resolution used elsewhere in this capability, and the
change's obligations MUST be re-evaluated against the new tier.

### Scenario: A Rung-1 escalation leaves the workflow tier unchanged
- GIVEN a Rung-1 model escalation fires for a task on an in-tier change
- WHEN the escalated re-run is initiated
- THEN the change's recorded workflow tier before and after the escalation is identical

### Scenario: Scope overflow routes to workflow escalation, not model escalation
- GIVEN a change's file count grows past its current workflow tier's boundary
- WHEN this scope-overflow signal is detected
- THEN it is routed to the existing workflow-tier upscale machinery and is not recorded as a Rung-1 model escalation

### Scenario: A workflow-tier upscale brings planning artifacts to top-tier
- GIVEN a change whose workflow tier has been upscaled through the existing upscale machinery
- WHEN instructions are next generated for a planning artifact on that change
- THEN the emitted `model` field resolves to inherit/top-tier


## ADDED: Requirement: Escalation-Rate Metric In Progress Reporting

`metta progress` MUST compute and report an escalation rate: the proportion of cheap-tier executor
invocations recorded in the model-escalation audit records that were subsequently escalated to
top-tier under Rung 1. The metric MUST be included in both the default human-readable output and the
`--json` output, following the same reporting pattern established for the ceremony-commit-ratio
metric. When cheap-tier executor invocations have been recorded and none were escalated, the metric
MUST report a rate of zero rather than being omitted. When no cheap-tier executor invocations have
been recorded at all, the metric MUST render an explicit no-data indicator rather than a numeric
value that could be mistaken for a computed zero. The metric MUST NOT be described, in reporting
output or accompanying documentation, as detecting silent wrong-but-plausible cheap-executor output
that produced neither a STOP/deviation report nor a verify-FAIL.

### Scenario: Both output modes report a computed escalation rate
- GIVEN audit records showing cheap-tier executor invocations, some of which were subsequently escalated
- WHEN `metta progress` and `metta progress --json` are run
- THEN the human-readable output reports the computed escalation rate and the JSON output includes the same value as a structured field

### Scenario: Zero escalations among recorded invocations reports as zero, not omitted
- GIVEN audit records showing cheap-tier executor invocations with zero of them escalated
- WHEN `metta progress` runs
- THEN the metric reports a rate of zero rather than being omitted from the output

### Scenario: No recorded cheap-tier invocations renders an explicit no-data indicator
- GIVEN no cheap-tier executor invocations have been recorded
- WHEN `metta progress` runs
- THEN the metric renders an explicit no-data indicator rather than a numeric zero


## ADDED: Requirement: Model Vocabulary Validated At Config Load

Every model value in a `models` configuration document — whether inside a named profile or an
explicit per-role/per-tier map — MUST be validated at config load time against the runtime's
documented agent-model vocabulary. A value outside that vocabulary MUST be rejected with a typed,
catchable error identifying the offending field and the invalid value. The runtime MUST NOT silently
accept an undocumented model value and MUST NOT coerce it to a nearby valid value.

### Scenario: A model value within the documented vocabulary validates successfully
- GIVEN a `models` configuration document whose model values are all within the runtime's documented agent-model vocabulary
- WHEN the configuration is loaded
- THEN validation succeeds

### Scenario: A model value outside the documented vocabulary is rejected
- GIVEN a `models` configuration document containing a model value outside the runtime's documented agent-model vocabulary
- WHEN the configuration is loaded
- THEN validation fails with a typed error identifying the offending field and the invalid value

### Scenario: A rejected configuration is never silently substituted
- GIVEN a `models` configuration document that fails vocabulary validation
- WHEN the load failure is inspected
- THEN no instruction output is resolved from that configuration and no valid value has been substituted in place of the rejected one
