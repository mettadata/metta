# Schemas Specification

**Source:** `src/schemas/`
**Tests:** `tests/schemas.test.ts`
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
- Given a change metadata object with all required fields and valid enum values
- When parsed with `ChangeMetadataSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Unknown field is rejected**
- Given a change metadata object that includes `extra_field`
- When parsed with `ChangeMetadataSchema.safeParse()`
- Then `result.success` MUST be `false` due to `.strict()` enforcement

**Scenario: Invalid change status is rejected**
- Given a change metadata object where `status` is `"invalid"`
- When parsed with `ChangeMetadataSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Invalid artifact status is rejected**
- Given a change metadata object where an artifact value is `"invalid_status"`
- When parsed with `ChangeMetadataSchema.safeParse()`
- Then `result.success` MUST be `false`

**Scenario: Invalid datetime is rejected**
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

### 2.6 Scenarios

**Scenario: Minimal spec lock parses successfully**
- Given a spec lock with `version`, `hash`, `updated`, and `requirements` populated
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

### 3.6 Scenarios

**Scenario: Execution state with batches and deviations parses successfully**
- Given an execution state with a completed batch containing a task with commit and gate results, an in-progress batch with a pending task, and a deviation with rule 1
- When parsed with `ExecutionStateSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Deviation rule outside 1-4 is rejected**
- Given an execution state with a deviation where `rule` is `5`
- When parsed with `ExecutionStateSchema.safeParse()`
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
- Given an auto state with one completed cycle including verification data showing 11 passing and 3 failing scenarios
- When parsed with `AutoStateSchema.safeParse()`
- Then `result.success` MUST be `true`

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
- Given a config object with project info, defaults, providers, tools, gates, git, docs, and auto sections
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

### 6.3 Scenarios

**Scenario: Passing gate result without optional fields parses successfully**
- Given a gate result with `gate`, `status: "pass"`, and `duration_ms`
- When parsed with `GateResultSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Failing gate result with output and failures parses successfully**
- Given a gate result with `status: "fail"`, `output` text, and a `failures` array with one entry containing file, line, message, and severity
- When parsed with `GateResultSchema.safeParse()`
- Then `result.success` MUST be `true`

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
- Given a workflow definition with `name`, `version: 1`, and two artifacts each with all required fields
- When parsed with `WorkflowDefinitionSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Extended workflow with overrides parses successfully**
- Given a workflow definition with `extends: "standard"`, one artifact, and one override entry specifying additional `requires`
- When parsed with `WorkflowDefinitionSchema.safeParse()`
- Then `result.success` MUST be `true`

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
- Given an agent definition with `name`, `persona`, `capabilities`, string tool entries (`"Read"`, `"Grep"`, etc.), and `context_budget`
- When parsed with `AgentDefinitionSchema.safeParse()`
- Then `result.success` MUST be `true`

**Scenario: Agent with Bash tool configuration parses successfully**
- Given an agent definition with a mix of string tools and a `{ Bash: { deny_patterns: [...], allow_cwd: "worktree_only" } }` entry, plus optional `rules`
- When parsed with `AgentDefinitionSchema.safeParse()`
- Then `result.success` MUST be `true`

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
- Given a state file with `schema_version: 1` and a valid `execution` block
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

---

## 12. Exports

**File:** `src/schemas/index.ts`

All schemas and their inferred TypeScript types are re-exported from `src/schemas/index.ts` as barrel exports. Consumers MUST import from `'../src/schemas/index.js'` (or the appropriate relative path with `.js` extension per Node16 ESM conventions).
