# Schemas Specification

**Source:** `src/schemas/`
**Tests:** `tests/schemas.test.ts` (98 scenarios)
**Status:** Draft

This document specifies the Zod validation schemas used to parse and guard all persistent state, configuration, and runtime data in metta. All schemas use `.strict()` unless noted, which means unknown fields MUST cause a parse failure.

---

## RFC 2119 Keywords

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHOULD", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119.

---

## 1. ChangeMetadataSchema

**File:** `src/schemas/change-metadata.ts`
**Purpose:** Validates the metadata record written to `.metta/changes/<id>/metadata.yaml` for every tracked change.

### 1.1 ArtifactStatusSchema (enum)

The artifact status MUST be one of: `pending`, `ready`, `in_progress`, `complete`, `failed`, `skipped`.

### 1.2 ChangeStatusSchema (enum)

The change-level status MUST be one of: `active`, `paused`, `complete`, `abandoned`.

### 1.3 ChangeMetadataSchema fields

| Field | Type | Required | Constraint |
|---|---|---|---|
| `workflow` | string | REQUIRED | Free-form workflow name |
| `created` | string | REQUIRED | ISO 8601 datetime (`z.string().datetime()`) |
| `status` | ChangeStatusSchema | REQUIRED | One of the four change statuses |
| `current_artifact` | string | REQUIRED | Current artifact identifier |
| `base_versions` | Record<string, string> | REQUIRED | Map of file paths to content hashes |
| `artifacts` | Record<string, ArtifactStatusSchema> | REQUIRED | Map of artifact IDs to their statuses |

`.strict()` is enforced: unknown fields MUST be rejected.

### 1.4 Scenarios

**Scenario: Valid change metadata parses successfully**
- Given a change metadata object with all required fields (`workflow`, `created`, `status: "active"`, `current_artifact`, `base_versions`, `artifacts`) and valid artifact status values
- When parsed with `ChangeMetadataSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Unknown field is rejected**
- Given a change metadata object with all required fields plus an `extra_field`
- When parsed with `ChangeMetadataSchema.safeParse()`
- Then `result.success` MUST be `false` due to `.strict()` enforcement

**Scenario: Invalid change status is rejected**
- Given a change metadata object where `status` is `"invalid"`
- When parsed with `ChangeMetadataSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Invalid artifact status value is rejected**
- Given a change metadata object where an artifact map value is `"invalid_status"`
- When parsed with `ChangeMetadataSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Invalid datetime string is rejected**
- Given a change metadata object where `created` is `"not-a-date"`
- When parsed with `ChangeMetadataSchema.safeParse()`
- Then `result.success` MUST be `false`

---

## 2. SpecLockSchema

**File:** `src/schemas/spec-lock.ts`
**Purpose:** Validates the spec lock file (`.metta/spec.lock.yaml`) that tracks requirements, their content hashes, and reconciliation status.

### 2.1 SpecLockRequirementSchema fields

| Field | Type | Required | Constraint |
|---|---|---|---|
| `id` | string | REQUIRED | Unique requirement identifier |
| `hash` | string | REQUIRED | Content hash of the requirement |
| `scenarios` | string[] | REQUIRED | Array of scenario identifiers |

`.strict()` is enforced on this sub-schema.

### 2.2 ReconciliationStatusSchema (enum)

MUST be one of: `verified`, `partial`, `missing`, `unimplemented`, `diverged`, `undocumented`.

### 2.3 ReconciliationRequirementSchema fields

| Field | Type | Required | Constraint |
|---|---|---|---|
| `id` | string | REQUIRED | Requirement identifier |
| `status` | ReconciliationStatusSchema | REQUIRED | Reconciliation status |
| `gaps` | string[] | OPTIONAL | Descriptions of gaps found |
| `evidence` | string[] | OPTIONAL | Evidence paths or descriptions |

`.strict()` is enforced.

### 2.4 ReconciliationSchema fields

| Field | Type | Required | Constraint |
|---|---|---|---|
| `verified_at` | string | REQUIRED | ISO 8601 datetime |
| `requirements` | ReconciliationRequirementSchema[] | REQUIRED | Per-requirement reconciliation entries |

`.strict()` is enforced.

### 2.5 SpecLockSchema fields

| Field | Type | Required | Constraint |
|---|---|---|---|
| `version` | number | REQUIRED | Positive integer (`int().positive()`) |
| `hash` | string | REQUIRED | Content hash of the full spec |
| `updated` | string | REQUIRED | ISO 8601 datetime |
| `status` | enum | OPTIONAL | One of: `draft`, `reviewed`, `approved` |
| `source` | enum | OPTIONAL | One of: `scan`, `manual`, `change` |
| `scanned_from` | string[] | OPTIONAL | Directory paths that were scanned |
| `uncovered_behaviors` | number | OPTIONAL | Non-negative integer count |
| `reconciliation` | ReconciliationSchema | OPTIONAL | Full reconciliation snapshot |
| `requirements` | SpecLockRequirementSchema[] | REQUIRED | List of all tracked requirements |

`.strict()` is enforced.

### 2.6 SpecLockSchema scenarios

**Scenario: Minimal spec lock parses successfully**
- Given a spec lock with `version: 3`, `hash`, `updated`, and a `requirements` array containing two entries
- When parsed with `SpecLockSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Full spec lock with reconciliation parses successfully**
- Given a spec lock with all optional fields including `status: "draft"`, `source: "scan"`, `scanned_from`, and a `reconciliation` block containing `verified` and `partial` entries
- When parsed with `SpecLockSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Version zero is rejected**
- Given a spec lock with `version: 0`
- When parsed with `SpecLockSchema.safeParse()`
- Then `result.success` MUST be `false` because `version` requires a positive integer

**Scenario: Invalid reconciliation requirement status is rejected**
- Given a spec lock containing a reconciliation entry with `status: "unknown"`
- When parsed with `SpecLockSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Invalid status enum value is rejected**
- Given a spec lock with `status: "pending"` (not a member of the allowed set)
- When parsed with `SpecLockSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Invalid source enum value is rejected**
- Given a spec lock with `source: "auto"` (not a member of the allowed set)
- When parsed with `SpecLockSchema.safeParse()`
- Then `result.success` MUST be `false`

### 2.7 SpecLockRequirementSchema scenarios

**Scenario: Valid requirement parses successfully**
- Given a requirement with `id`, `hash`, and `scenarios` array
- When parsed with `SpecLockRequirementSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Missing id is rejected**
- Given a requirement with only `hash` and `scenarios`, omitting `id`
- When parsed with `SpecLockRequirementSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Missing hash is rejected**
- Given a requirement with only `id` and `scenarios`, omitting `hash`
- When parsed with `SpecLockRequirementSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Unknown field is rejected (.strict())**
- Given a requirement with `id`, `hash`, `scenarios`, and an extra `extra: true` field
- When parsed with `SpecLockRequirementSchema.safeParse()`
- Then `result.success` MUST be `false`

### 2.8 ReconciliationRequirementSchema scenarios

**Scenario: Valid reconciliation requirement with evidence parses successfully**
- Given a reconciliation requirement with `id: "checkout-flow"`, `status: "verified"`, and `evidence` array
- When parsed with `ReconciliationRequirementSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: All six valid status values are accepted**
- Given a reconciliation requirement with each of: `verified`, `partial`, `missing`, `unimplemented`, `diverged`, `undocumented`
- When each is parsed with `ReconciliationRequirementSchema.safeParse()`
- Then all six MUST return `result.success === true`

**Scenario: Invalid status enum is rejected**
- Given a reconciliation requirement with `status: "unknown"`
- When parsed with `ReconciliationRequirementSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Missing id is rejected**
- Given a reconciliation requirement with only `status: "verified"`, omitting `id`
- When parsed with `ReconciliationRequirementSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Unknown field is rejected (.strict())**
- Given a reconciliation requirement with `id`, `status`, and `extra: true`
- When parsed with `ReconciliationRequirementSchema.safeParse()`
- Then `result.success` MUST be `false`

---

## 3. ExecutionStateSchema

**File:** `src/schemas/execution-state.ts`
**Purpose:** Validates the runtime execution state written to `.metta/changes/<id>/state.yaml` during the execute phase.

### 3.1 DeviationSchema fields

| Field | Type | Required | Constraint |
|---|---|---|---|
| `rule` | number | REQUIRED | Integer in range 1–4 inclusive |
| `description` | string | REQUIRED | Description of the deviation |
| `commit` | string | OPTIONAL | Git commit SHA |
| `files` | string[] | OPTIONAL | Affected file paths |
| `action` | enum | OPTIONAL | One of: `fixed`, `added`, `stopped` |
| `reason` | string | OPTIONAL | Rationale for the deviation |

`.strict()` is enforced.

### 3.2 TaskStatusSchema (enum)

MUST be one of: `pending`, `in_progress`, `complete`, `failed`, `skipped`.

### 3.3 ExecutionTaskSchema fields

| Field | Type | Required | Constraint |
|---|---|---|---|
| `id` | string | REQUIRED | Task identifier (e.g., `"1.1"`) |
| `status` | TaskStatusSchema | REQUIRED | Current task status |
| `commit` | string | OPTIONAL | Git commit SHA after task completion |
| `worktree` | string | OPTIONAL | Path to the git worktree |
| `gates` | Record<string, enum> | OPTIONAL | Gate name to outcome (`pass`, `fail`, `warn`, `skip`) |
| `deviations` | DeviationSchema[] | OPTIONAL | Deviations recorded during this task |

`.strict()` is enforced.

### 3.4 ExecutionBatchSchema fields

| Field | Type | Required | Constraint |
|---|---|---|---|
| `id` | number | REQUIRED | Positive integer batch number |
| `status` | enum | REQUIRED | One of: `pending`, `in_progress`, `complete`, `failed` |
| `tasks` | ExecutionTaskSchema[] | REQUIRED | Array of tasks in this batch |

`.strict()` is enforced.

### 3.5 ExecutionStateSchema fields

| Field | Type | Required | Constraint |
|---|---|---|---|
| `change` | string | REQUIRED | Change identifier |
| `started` | string | REQUIRED | ISO 8601 datetime |
| `batches` | ExecutionBatchSchema[] | REQUIRED | Ordered list of execution batches |
| `deviations` | DeviationSchema[] | REQUIRED | Top-level deviations for the entire change |

`.strict()` is enforced.

### 3.6 ExecutionStateSchema scenarios

**Scenario: Execution state with batches and deviations parses successfully**
- Given an execution state with a completed batch containing a task with commit and gate results, an in-progress batch with a pending task, and a deviation with `rule: 1`, `commit`, and `files`
- When parsed with `ExecutionStateSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Deviation rule outside 1-4 range is rejected**
- Given an execution state with a deviation where `rule: 5`
- When parsed with `ExecutionStateSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Missing change field is rejected**
- Given an execution state with `started`, `batches`, and `deviations` but omitting `change`
- When parsed with `ExecutionStateSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Missing started field is rejected**
- Given an execution state with `change`, `batches`, and `deviations` but omitting `started`
- When parsed with `ExecutionStateSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Invalid started datetime is rejected**
- Given an execution state with `started: "not-a-date"`
- When parsed with `ExecutionStateSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Missing batches field is rejected**
- Given an execution state with `change`, `started`, and `deviations` but omitting `batches`
- When parsed with `ExecutionStateSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Missing deviations field is rejected**
- Given an execution state with `change`, `started`, and `batches` but omitting `deviations`
- When parsed with `ExecutionStateSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Invalid task status enum is rejected**
- Given an execution state with a task using `status: "cancelled"`
- When parsed with `ExecutionStateSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Invalid batch status enum is rejected**
- Given an execution state with a batch using `status: "cancelled"`
- When parsed with `ExecutionStateSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Batch id of zero is rejected**
- Given an execution state with a batch where `id: 0`
- When parsed with `ExecutionStateSchema.safeParse()`
- Then `result.success` MUST be `false`

### 3.7 DeviationSchema scenarios

**Scenario: Valid deviation with all optional fields parses successfully**
- Given a deviation with `rule: 1`, `description`, `commit`, `files`, and `action: "fixed"`
- When parsed with `DeviationSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Rule 0 is rejected (below minimum)**
- Given a deviation with `rule: 0` and `description`
- When parsed with `DeviationSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Rule 5 is rejected (above maximum)**
- Given a deviation with `rule: 5` and `description`
- When parsed with `DeviationSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Missing description is rejected**
- Given a deviation with only `rule: 2`, omitting `description`
- When parsed with `DeviationSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Unknown field is rejected (.strict())**
- Given a deviation with `rule: 1`, `description`, and `extra: true`
- When parsed with `DeviationSchema.safeParse()`
- Then `result.success` MUST be `false`

### 3.8 ExecutionTaskSchema scenarios

**Scenario: Valid task with commit and gates parses successfully**
- Given a task with `id: "1.1"`, `status: "complete"`, `commit`, and `gates` map
- When parsed with `ExecutionTaskSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: All five valid status values are accepted**
- Given a task with each of: `pending`, `in_progress`, `complete`, `failed`, `skipped`
- When each is parsed with `ExecutionTaskSchema.safeParse()`
- Then all five MUST return `result.success === true`

**Scenario: Invalid status enum is rejected**
- Given a task with `status: "cancelled"`
- When parsed with `ExecutionTaskSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Unknown field is rejected (.strict())**
- Given a task with `id`, `status: "pending"`, and `extra: true`
- When parsed with `ExecutionTaskSchema.safeParse()`
- Then `result.success` MUST be `false`

### 3.9 ExecutionBatchSchema scenarios

**Scenario: Valid batch with tasks parses successfully**
- Given a batch with `id: 1`, `status: "complete"`, and a `tasks` array with one complete task
- When parsed with `ExecutionBatchSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: All four valid status values are accepted**
- Given a batch with each of: `pending`, `in_progress`, `complete`, `failed`
- When each is parsed with `ExecutionBatchSchema.safeParse()`
- Then all four MUST return `result.success === true`

**Scenario: Invalid batch status enum is rejected**
- Given a batch with `status: "cancelled"`
- When parsed with `ExecutionBatchSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Batch id of zero is rejected**
- Given a batch with `id: 0`, `status: "pending"`, and empty `tasks`
- When parsed with `ExecutionBatchSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Negative batch id is rejected**
- Given a batch with `id: -1`, `status: "pending"`, and empty `tasks`
- When parsed with `ExecutionBatchSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Unknown field is rejected (.strict())**
- Given a batch with `id: 1`, `status: "pending"`, empty `tasks`, and `extra: true`
- When parsed with `ExecutionBatchSchema.safeParse()`
- Then `result.success` MUST be `false`

---

## 4. AutoStateSchema

**File:** `src/schemas/auto-state.ts`
**Purpose:** Validates the state file for `metta auto` cycles.

### 4.1 AutoCycleSchema fields

| Field | Type | Required | Constraint |
|---|---|---|---|
| `id` | number | REQUIRED | Positive integer cycle number |
| `phase` | string | REQUIRED | Current phase name |
| `artifacts` | string[] | REQUIRED | Artifact IDs produced in this cycle |
| `batches_run` | number | REQUIRED | Non-negative integer count of batches run |
| `verification` | object | OPTIONAL | Verification summary (see below) |

The optional `verification` object, when present, MUST be `.strict()` and MUST contain:
- `total_scenarios` (non-negative integer)
- `passing` (non-negative integer)
- `failing` (non-negative integer)
- `gaps` (string array)

`.strict()` is enforced on `AutoCycleSchema`.

### 4.2 AutoStateSchema fields

| Field | Type | Required | Constraint |
|---|---|---|---|
| `description` | string | REQUIRED | Plain-language description of the auto run |
| `started` | string | REQUIRED | ISO 8601 datetime |
| `max_cycles` | number | REQUIRED | Positive integer maximum cycle count |
| `current_cycle` | number | REQUIRED | Positive integer current cycle index |
| `cycles` | AutoCycleSchema[] | REQUIRED | Completed/in-progress cycle records |

`.strict()` is enforced.

### 4.3 Scenarios

**Scenario: Full auto state with verification summary parses successfully**
- Given an auto state with `description`, `started`, `max_cycles: 10`, `current_cycle: 2`, and one completed cycle including a `verification` block with 11 passing and 3 failing scenarios
- When parsed with `AutoStateSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Missing description is rejected**
- Given an auto state with all fields except `description`
- When parsed with `AutoStateSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Invalid started datetime is rejected**
- Given an auto state with `started: "yesterday"` (not ISO 8601)
- When parsed with `AutoStateSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: max_cycles of zero is rejected**
- Given an auto state with `max_cycles: 0`
- When parsed with `AutoStateSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Negative max_cycles is rejected**
- Given an auto state with `max_cycles: -1`
- When parsed with `AutoStateSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: current_cycle of zero is rejected**
- Given an auto state with `current_cycle: 0`
- When parsed with `AutoStateSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Negative batches_run on a cycle is rejected**
- Given an auto state with a cycle where `batches_run: -1`
- When parsed with `AutoStateSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Negative verification.failing is rejected**
- Given an auto state with a cycle where `verification.failing: -1`
- When parsed with `AutoStateSchema.safeParse()`
- Then `result.success` MUST be `false`

---

## 5. ProjectConfigSchema

**File:** `src/schemas/project-config.ts`
**Purpose:** Validates `.metta/config.yaml`, the primary user-facing project configuration file.

### 5.1 Sub-schemas

**ProviderConfigSchema** (all fields `.strict()`):

| Field | Type | Required |
|---|---|---|
| `provider` | string | REQUIRED |
| `model` | string | OPTIONAL |
| `api_key_env` | string | OPTIONAL |

**GateConfigSchema** (all fields `.strict()`):

| Field | Type | Required | Constraint |
|---|---|---|---|
| `command` | string | REQUIRED | Shell command to run |
| `timeout` | number | OPTIONAL | Positive integer milliseconds |
| `required` | boolean | OPTIONAL | |
| `on_failure` | enum | OPTIONAL | `retry_once`, `stop`, `continue_with_warning` |

**GitConfigSchema** (all fields `.strict()`):

| Field | Type | Required | Default |
|---|---|---|---|
| `enabled` | boolean | OPTIONAL | `true` |
| `commit_convention` | enum | OPTIONAL | `"conventional"` |
| `commit_template` | string | OPTIONAL | — |
| `protected_branches` | string[] | OPTIONAL | `["main", "master"]` |
| `merge_strategy` | enum | OPTIONAL | `"ff-only"` |
| `snapshot_retention` | enum | OPTIONAL | `"until_ship"` |
| `create_pr` | boolean | OPTIONAL | `false` |
| `pr_base` | string | OPTIONAL | `"main"` |

`commit_convention` MUST be one of: `conventional`, `none`, `custom`.
`merge_strategy` MUST be one of: `ff-only`, `no-ff`, `squash`.
`snapshot_retention` MUST be one of: `until_ship`, `always`, `never`.

**DocsConfigSchema** (all fields `.strict()`):

| Field | Type | Required | Default |
|---|---|---|---|
| `output` | string | OPTIONAL | `"./docs"` |
| `generate_on` | enum | OPTIONAL | `"finalize"` |
| `types` | string[] | OPTIONAL | `["architecture","api","changelog","getting-started"]` |

`generate_on` MUST be one of: `finalize`, `verify`, `manual`.

**AutoConfigSchema** (all fields `.strict()`):

| Field | Type | Required | Default |
|---|---|---|---|
| `max_cycles` | number | OPTIONAL | `10` |
| `ship_on_success` | boolean | OPTIONAL | `false` |

**ProjectInfoSchema** (all fields `.strict()`):

| Field | Type | Required |
|---|---|---|
| `name` | string | REQUIRED |
| `description` | string | OPTIONAL |
| `stack` | string | OPTIONAL |
| `conventions` | string | OPTIONAL |

### 5.2 ProjectConfigSchema fields (top-level)

| Field | Type | Required |
|---|---|---|
| `project` | ProjectInfoSchema | OPTIONAL |
| `defaults` | object | OPTIONAL |
| `providers` | Record<string, ProviderConfigSchema> | OPTIONAL |
| `tools` | string[] | OPTIONAL |
| `gates` | Record<string, GateConfigSchema> | OPTIONAL |
| `git` | GitConfigSchema | OPTIONAL |
| `docs` | DocsConfigSchema | OPTIONAL |
| `auto` | AutoConfigSchema | OPTIONAL |
| `context_sections` | string[] | OPTIONAL |
| `adapters` | string[] | OPTIONAL |
| `cleanup` | object | OPTIONAL |

The `defaults` object, when present, MUST be `.strict()` and MUST contain:
- `workflow` (string, default `"standard"`)
- `mode` (enum: `interactive`, `autonomous`, `supervised`; default `"supervised"`)

The `cleanup` object, when present, MUST be `.strict()` and MUST contain:
- `log_retention_days` (positive integer, default `30`)

`.strict()` is enforced on `ProjectConfigSchema`.

### 5.3 Scenarios

**Scenario: Minimal config with only project name parses successfully**
- Given a config object with only `project: { name: "My App" }`
- When parsed with `ProjectConfigSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Full config with all sections parses successfully**
- Given a config object with `project`, `defaults`, `providers`, `tools`, `gates`, `git`, `docs`, and `auto` sections fully populated
- When parsed with `ProjectConfigSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Git config defaults are applied when git section is empty**
- Given a config object with `git: {}`
- When parsed with `ProjectConfigSchema.parse()`
- Then `result.git.enabled` MUST be `true`, `result.git.commit_convention` MUST be `"conventional"`, and `result.git.merge_strategy` MUST be `"ff-only"`

**Scenario: Unknown field inside nested object is rejected**
- Given a config object with `project: { name: "App", unknown: true }`
- When parsed with `ProjectConfigSchema.safeParse()`
- Then `result.success` MUST be `false` due to `.strict()` on `ProjectInfoSchema`

**Scenario: Invalid defaults.mode enum value is rejected**
- Given a config object with `defaults: { mode: "manual" }`
- When parsed with `ProjectConfigSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Invalid git.merge_strategy enum value is rejected**
- Given a config object with `git: { merge_strategy: "rebase" }`
- When parsed with `ProjectConfigSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Invalid git.commit_convention enum value is rejected**
- Given a config object with `git: { commit_convention: "angular" }`
- When parsed with `ProjectConfigSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: context_sections, adapters, and cleanup fields are accepted**
- Given a config object with `context_sections: ["architecture", "api"]`, `adapters: ["jira"]`, and `cleanup: { log_retention_days: 7 }`
- When parsed with `ProjectConfigSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Default cleanup.log_retention_days is applied**
- Given a config object with `cleanup: {}` (no explicit `log_retention_days`)
- When parsed with `ProjectConfigSchema.parse()`
- Then `result.cleanup.log_retention_days` MUST be `30`

---

## 6. GateResultSchema

**File:** `src/schemas/gate-result.ts`
**Purpose:** Validates the structured result of a gate execution, written to state during the execute phase.

### 6.1 GateFailureSchema fields

| Field | Type | Required | Constraint |
|---|---|---|---|
| `file` | string | REQUIRED | File path where failure occurred |
| `line` | number | OPTIONAL | Line number of the failure |
| `message` | string | REQUIRED | Human-readable failure message |
| `severity` | enum | REQUIRED | One of: `error`, `warning` |

`.strict()` is enforced.

### 6.2 GateResultSchema fields

| Field | Type | Required | Constraint |
|---|---|---|---|
| `gate` | string | REQUIRED | Gate name |
| `status` | enum | REQUIRED | One of: `pass`, `fail`, `warn`, `skip` |
| `duration_ms` | number | REQUIRED | Duration in milliseconds |
| `output` | string | OPTIONAL | Raw command output |
| `failures` | GateFailureSchema[] | OPTIONAL | Structured failure list |

`.strict()` is enforced.

### 6.3 GateResultSchema scenarios

**Scenario: Passing gate result without optional fields parses successfully**
- Given a gate result with `gate: "tests"`, `status: "pass"`, and `duration_ms: 1234`
- When parsed with `GateResultSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Failing gate result with output and failures parses successfully**
- Given a gate result with `status: "fail"`, `output` text, and a `failures` array containing an entry with `file`, `line`, `message`, and `severity: "error"`
- When parsed with `GateResultSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Invalid status enum value is rejected**
- Given a gate result with `status: "success"` (not a member of the allowed set)
- When parsed with `GateResultSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Missing duration_ms is rejected**
- Given a gate result with `gate` and `status` but omitting `duration_ms`
- When parsed with `GateResultSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Missing gate is rejected**
- Given a gate result with `status` and `duration_ms` but omitting `gate`
- When parsed with `GateResultSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: GateFailure with invalid severity is rejected**
- Given a gate result with a failure entry using `severity: "critical"`
- When parsed with `GateResultSchema.safeParse()`
- Then `result.success` MUST be `false`

### 6.4 GateFailureSchema scenarios

**Scenario: Valid gate failure with line number parses successfully**
- Given a gate failure with `file`, `line: 10`, `message`, and `severity: "error"`
- When parsed with `GateFailureSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Gate failure with warning severity parses successfully**
- Given a gate failure with `file`, `message`, and `severity: "warning"` (no `line`)
- When parsed with `GateFailureSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Invalid severity enum is rejected**
- Given a gate failure with `severity: "critical"`
- When parsed with `GateFailureSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Unknown field is rejected (.strict())**
- Given a gate failure with `file`, `message`, `severity: "error"`, and `extra: true`
- When parsed with `GateFailureSchema.safeParse()`
- Then `result.success` MUST be `false`

---

## 7. WorkflowDefinitionSchema

**File:** `src/schemas/workflow-definition.ts`
**Purpose:** Validates workflow YAML files (shipped in `dist/workflows/`) that define the sequence and structure of artifacts.

### 7.1 WorkflowArtifactSchema fields

| Field | Type | Required |
|---|---|---|
| `id` | string | REQUIRED |
| `type` | string | REQUIRED |
| `template` | string | REQUIRED |
| `generates` | string | REQUIRED |
| `requires` | string[] | REQUIRED |
| `agents` | string[] | REQUIRED |
| `gates` | string[] | REQUIRED |

`.strict()` is enforced. All fields are REQUIRED with no defaults.

### 7.2 WorkflowOverrideSchema fields

| Field | Type | Required |
|---|---|---|
| `id` | string | REQUIRED |
| `requires` | string[] | OPTIONAL |
| `agents` | string[] | OPTIONAL |
| `gates` | string[] | OPTIONAL |

`.strict()` is enforced.

### 7.3 WorkflowDefinitionSchema fields

| Field | Type | Required | Constraint |
|---|---|---|---|
| `name` | string | REQUIRED | Workflow name |
| `description` | string | OPTIONAL | Human-readable description |
| `version` | number | REQUIRED | Positive integer |
| `extends` | string | OPTIONAL | Name of parent workflow |
| `artifacts` | WorkflowArtifactSchema[] | REQUIRED | Ordered artifact definitions |
| `overrides` | WorkflowOverrideSchema[] | OPTIONAL | Overrides for extended workflow artifacts |

`.strict()` is enforced.

### 7.4 Scenarios

**Scenario: Standard workflow definition parses successfully**
- Given a workflow definition with `name: "standard"`, `version: 1`, and two artifacts each with all seven required fields
- When parsed with `WorkflowDefinitionSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Extended workflow with overrides parses successfully**
- Given a workflow definition with `extends: "standard"`, one artifact, and one override entry specifying additional `requires`
- When parsed with `WorkflowDefinitionSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Version zero or negative is rejected**
- Given a workflow definition with `version: 0`
- When parsed with `WorkflowDefinitionSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: WorkflowArtifact missing generates field is rejected**
- Given a workflow definition with an artifact that has all fields except `generates`
- When parsed with `WorkflowDefinitionSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Unknown field on WorkflowArtifact is rejected (.strict())**
- Given a workflow definition with an artifact that includes an `extra: true` field
- When parsed with `WorkflowDefinitionSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Unknown field on WorkflowOverride is rejected (.strict())**
- Given a workflow definition with an override that includes an `unknown_field: true` field
- When parsed with `WorkflowDefinitionSchema.safeParse()`
- Then `result.success` MUST be `false`

---

## 8. AgentDefinitionSchema

**File:** `src/schemas/agent-definition.ts`
**Purpose:** Validates agent YAML files (shipped in `dist/agents/`) that define AI agent personas, capabilities, and tool access.

### 8.1 BashToolConfigSchema fields

| Field | Type | Required | Constraint |
|---|---|---|---|
| `deny_patterns` | string[] | OPTIONAL | Shell command patterns to deny |
| `allow_cwd` | enum | OPTIONAL | One of: `worktree_only`, `any` |

`.strict()` is enforced.

### 8.2 ToolEntrySchema

A `ToolEntry` MUST be either:
- A plain string (tool name), OR
- A `Record<string, BashToolConfigSchema>` (tool name mapped to configuration)

### 8.3 AgentDefinitionSchema fields

| Field | Type | Required | Constraint |
|---|---|---|---|
| `name` | string | REQUIRED | Agent identifier |
| `description` | string | OPTIONAL | Human-readable description |
| `version` | number | OPTIONAL | Positive integer |
| `persona` | string | REQUIRED | System prompt persona text |
| `capabilities` | string[] | REQUIRED | List of capability tags |
| `tools` | ToolEntrySchema[] | REQUIRED | Tools granted to this agent |
| `context_budget` | number | REQUIRED | Positive integer token budget |
| `rules` | string[] | OPTIONAL | Behavioral constraint rules |

`.strict()` is enforced.

### 8.4 Scenarios

**Scenario: Agent with simple string tools parses successfully**
- Given an agent definition with `name`, `persona`, `capabilities`, string tool entries (`"Read"`, `"Grep"`, `"Glob"`, `"Bash"`), and `context_budget: 80000`
- When parsed with `AgentDefinitionSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Agent with Bash tool configuration parses successfully**
- Given an agent definition with a mix of string tools and a `{ Bash: { deny_patterns: [...], allow_cwd: "worktree_only" } }` entry, plus optional `rules`
- When parsed with `AgentDefinitionSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Missing persona is rejected**
- Given an agent definition with `name`, `capabilities`, `tools`, and `context_budget` but omitting `persona`
- When parsed with `AgentDefinitionSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Missing capabilities is rejected**
- Given an agent definition with `name`, `persona`, `tools`, and `context_budget` but omitting `capabilities`
- When parsed with `AgentDefinitionSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: context_budget of zero is rejected**
- Given an agent definition with `context_budget: 0`
- When parsed with `AgentDefinitionSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: BashToolConfig with unknown field is rejected (.strict())**
- Given an agent definition with a Bash tool entry `{ Bash: { allow_cwd: "worktree_only", unknown: true } }`
- When parsed with `AgentDefinitionSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: BashToolConfig with invalid allow_cwd enum is rejected**
- Given an agent definition with a Bash tool entry `{ Bash: { allow_cwd: "everywhere" } }`
- When parsed with `AgentDefinitionSchema.safeParse()`
- Then `result.success` MUST be `false`

---

## 9. GateDefinitionSchema

**File:** `src/schemas/gate-definition.ts`
**Purpose:** Validates gate definition YAML files (shipped in `dist/gates/`) that describe quality gates.

### 9.1 GateDefinitionSchema fields

| Field | Type | Required | Default | Constraint |
|---|---|---|---|---|
| `name` | string | REQUIRED | — | Gate name |
| `description` | string | REQUIRED | — | Human-readable description |
| `command` | string | REQUIRED | — | Shell command to execute |
| `timeout` | number | OPTIONAL | `120000` | Positive integer milliseconds |
| `required` | boolean | OPTIONAL | `true` | Whether failure blocks progress |
| `on_failure` | enum | OPTIONAL | `"retry_once"` | One of: `retry_once`, `stop`, `continue_with_warning` |

`.strict()` is enforced.

### 9.2 Scenarios

**Scenario: Gate definition with only required fields applies defaults**
- Given a gate definition with only `name`, `description`, and `command`
- When parsed with `GateDefinitionSchema.parse()`
- Then `result.timeout` MUST be `120000`, `result.required` MUST be `true`, and `result.on_failure` MUST be `"retry_once"`

**Scenario: Missing name is rejected**
- Given a gate definition with `description` and `command` but omitting `name`
- When parsed with `GateDefinitionSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Missing description is rejected**
- Given a gate definition with `name` and `command` but omitting `description`
- When parsed with `GateDefinitionSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Missing command is rejected**
- Given a gate definition with `name` and `description` but omitting `command`
- When parsed with `GateDefinitionSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Invalid on_failure enum value is rejected**
- Given a gate definition with `on_failure: "abort"`
- When parsed with `GateDefinitionSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Timeout of zero is rejected**
- Given a gate definition with `timeout: 0`
- When parsed with `GateDefinitionSchema.safeParse()`
- Then `result.success` MUST be `false`

---

## 10. PluginManifestSchema

**File:** `src/schemas/plugin-manifest.ts`
**Purpose:** Validates `plugin.yaml` files for metta plugins.

### 10.1 PluginManifestSchema fields

| Field | Type | Required | Constraint |
|---|---|---|---|
| `type` | enum | REQUIRED | One of: `workflow`, `agent`, `provider`, `gate`, `hook` |
| `name` | string | REQUIRED | Matches `/^[a-z0-9-]+$/` |
| `version` | string | REQUIRED | Matches `/^\d+\.\d+\.\d+$/` (semver) |
| `description` | string | REQUIRED | Human-readable description |
| `requires` | object | OPTIONAL | Dependency declarations (see below) |

The `requires` object, when present, MUST be `.strict()` and MAY contain:
- `metta` (string, OPTIONAL) — minimum metta version requirement
- `plugins` (string[], OPTIONAL) — required plugin names

`.strict()` is enforced on `PluginManifestSchema`.

### 10.2 Scenarios

**Scenario: Minimal plugin manifest parses successfully**
- Given a plugin manifest with `type: "gate"`, `name: "quality-gates"`, `version: "1.0.0"`, and `description`
- When parsed with `PluginManifestSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Invalid name format is rejected**
- Given a plugin manifest with `name: "Invalid Name"` (contains uppercase and space)
- When parsed with `PluginManifestSchema.safeParse()`
- Then `result.success` MUST be `false` because the name MUST match `/^[a-z0-9-]+$/`

**Scenario: Invalid version format is rejected**
- Given a plugin manifest with `version: "v1"` (not semver)
- When parsed with `PluginManifestSchema.safeParse()`
- Then `result.success` MUST be `false` because the version MUST match `/^\d+\.\d+\.\d+$/`

---

## 11. StateFileSchema

**File:** `src/schemas/state-file.ts`
**Purpose:** Validates the top-level state file written to `.metta/changes/<id>/state.yaml`. Acts as a versioned envelope around execution and auto state.

### 11.1 StateFileSchema fields

| Field | Type | Required | Constraint |
|---|---|---|---|
| `schema_version` | number | REQUIRED | Positive integer |
| `execution` | ExecutionStateSchema | OPTIONAL | Execution phase state |
| `auto` | AutoStateSchema | OPTIONAL | Auto mode state |

`.strict()` is enforced. Both `execution` and `auto` are OPTIONAL; a state file MAY contain neither, either, or both.

### 11.2 Scenarios

**Scenario: State file with execution state parses successfully**
- Given a state file with `schema_version: 1` and a valid `execution` block (change, started, empty batches and deviations)
- When parsed with `StateFileSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Minimal state file with only schema_version parses successfully**
- Given a state file with only `schema_version: 1`
- When parsed with `StateFileSchema.parse()`
- Then `result.schema_version` MUST be `1`

**Scenario: State file missing schema_version is rejected**
- Given an empty object `{}`
- When parsed with `StateFileSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: schema_version of zero is rejected**
- Given a state file with `schema_version: 0`
- When parsed with `StateFileSchema.safeParse()`
- Then `result.success` MUST be `false`

---

## 12. Exports

**File:** `src/schemas/index.ts`

All schemas and their inferred TypeScript types are re-exported from `src/schemas/index.ts` as barrel exports. The export set includes all top-level schemas and the following sub-schemas that have direct tests:

- `DeviationSchema` / `Deviation`
- `ExecutionTaskSchema` / `ExecutionTask`
- `ExecutionBatchSchema` / `ExecutionBatch`
- `GateFailureSchema` / `GateFailure`
- `SpecLockRequirementSchema` / `SpecLockRequirement`
- `ReconciliationRequirementSchema` / `ReconciliationRequirement`

Consumers MUST import from `'../src/schemas/index.js'` (or the appropriate relative path with `.js` extension per Node16 ESM conventions).
