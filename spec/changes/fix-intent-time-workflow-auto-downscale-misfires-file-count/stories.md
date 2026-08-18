# fix-intent-time-workflow-auto-downscale-misfires-file-count — User Stories

## US-1: Greenfield intents no longer misread as trivial

**As a** metta user starting a greenfield change at `standard` or `full`
**I want to** complete my intent without the scorer treating "no files exist yet" as evidence of triviality
**So that** my deliberately chosen workflow tier is not challenged — or collapsed — based on a signal that is structurally absent at intent time
**Priority:** P1
**Independent Test Criteria:** Completing an intent whose `## Impact` section parses to 0 files produces no workflow recommendation and fires no downscale prompt, while summary-time scoring of 0 files still recommends `trivial`.

**Acceptance Criteria:**
- **Given** an intent whose `## Impact` section parses to 0 files **When** intent-time complexity scoring runs **Then** no workflow recommendation is produced (no `trivial` recommendation is persisted) and no downscale prompt fires
- **Given** an intent whose `## Impact` section parses to 1 or more files **When** intent-time complexity scoring runs **Then** the file count is scored and a tier recommendation is produced exactly as before
- **Given** a change with 0 changed files at summary time **When** summary-time complexity scoring runs **Then** 0 is treated as a real signal and the `trivial` recommendation still fires, so genuinely trivial changes are caught at that later scoring point

## US-2: Non-interactive intent completion never silently collapses my workflow

**As an** AI orchestrator or pipeline running `metta complete intent` non-interactively (non-TTY or `--json`)
**I want to** have a recommended downscale fail closed — keeping the chosen workflow and printing an advisory — instead of being auto-accepted via a default-Yes
**So that** a deliberate `standard`/`full` decision is never destroyed, and planning artifacts are never dropped, without an explicit human or configured consent
**Priority:** P1
**Independent Test Criteria:** A non-interactive `metta complete intent` run that triggers a downscale recommendation exits with the workflow tier unchanged and an advisory banner printed, unless `auto_accept_recommendation: true` is set.

**Acceptance Criteria:**
- **Given** a change at `standard` or `full` whose intent scoring recommends a lower tier **When** `metta complete intent` runs with stdin not a TTY or with `--json` and `auto_accept_recommendation` is not set **Then** the chosen workflow is kept, planning artifacts are untouched, and the advisory banner reports the declined recommendation
- **Given** the same downscale recommendation **When** the change has `auto_accept_recommendation: true` **Then** the downscale is auto-accepted as the sanctioned opt-in path
- **Given** the same downscale recommendation **When** the run is an interactive TTY session **Then** the user is prompted and default-Yes behavior applies subject to `workflow_locked`, preserving today's interactive experience

## US-3: Every accepted downscale leaves an audit record

**As a** metta operator reviewing a change whose workflow tier was lowered
**I want to** find a decision record in the change's `.metta.yaml` capturing the from/to tiers, the cause of acceptance, and a timestamp
**So that** any workflow collapse is auditable and reversible after the fact, symmetric with the escalation record already written when a downscale is declined
**Priority:** P2
**Independent Test Criteria:** After any accepted downscale, the change's `.metta.yaml` contains a Zod-validated decision record with `from_tier`, `to_tier`, a cause-keyed justification, and a timestamp.

**Acceptance Criteria:**
- **Given** a downscale recommendation is accepted by any path (`auto_accept_recommendation`, interactive explicit yes, or TTY default-Yes) **When** the workflow is rewritten to the lower tier **Then** a decision record with `from_tier`, `to_tier`, a justification keyed to the accepting cause, and a timestamp is written to the change's `.metta.yaml`
- **Given** the decision record write **When** the metadata is persisted **Then** it validates against the existing `EscalationSchema` or a parallel downscale-record schema, and any new schema field is optional so existing `.metta.yaml` files continue to validate
- **Given** a downscale recommendation is declined **When** the decline path runs **Then** the existing escalation record behavior is unchanged
