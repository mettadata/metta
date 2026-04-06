# Gap: Missing negative test cases for several schemas

**Detected:** 2026-04-06
**Source:** `tests/schemas.test.ts` vs `src/schemas/`
**Severity:** Medium — schemas have required fields and enum constraints that are only tested for the happy path

## Description

Several top-level schemas are tested only for valid inputs. Their required fields, enum constraints, and integer range constraints are never tested for rejection. This means a future regression in those constraints could go undetected.

## Specific gaps by schema

### AutoStateSchema

No negative tests exist. The following SHOULD be tested:
- Reject when `description` is missing
- Reject when `started` is not a valid datetime
- Reject when `max_cycles` is zero or negative (`int().positive()`)
- Reject when `current_cycle` is zero or negative
- Reject when a cycle's `batches_run` is negative (`nonnegative()` constraint)
- Reject when `verification.failing` is negative

### GateResultSchema

Only valid inputs are tested. The following SHOULD be tested:
- Reject when `status` is not one of `pass`, `fail`, `warn`, `skip`
- Reject when `duration_ms` is missing
- Reject when `gate` is missing
- Reject a `GateFailure` entry with an invalid `severity` value

### WorkflowDefinitionSchema

Only valid inputs are tested. The following SHOULD be tested:
- Reject when `version` is zero or negative
- Reject when a `WorkflowArtifact` is missing any required field (e.g., `generates`, `template`)
- Reject unknown fields on `WorkflowArtifactSchema` (.strict() enforcement)
- Reject unknown fields on `WorkflowOverrideSchema` (.strict() enforcement)

### AgentDefinitionSchema

Only valid inputs are tested. The following SHOULD be tested:
- Reject when `persona` is missing
- Reject when `capabilities` is missing or not an array
- Reject when `context_budget` is zero or negative
- Reject when `BashToolConfig` contains unknown fields (.strict() enforcement)
- Reject when `BashToolConfig.allow_cwd` is an invalid enum value

### GateDefinitionSchema

Only the defaults scenario is tested. The following SHOULD be tested:
- Reject when `name` is missing
- Reject when `description` is missing
- Reject when `command` is missing
- Reject when `on_failure` is an invalid enum value
- Reject when `timeout` is zero or negative

### StateFileSchema

Mostly well-tested. The following edge case SHOULD be tested:
- Reject when `schema_version` is zero or negative (the `.positive()` constraint is not exercised)

### SpecLockSchema

Mostly well-tested. The following SHOULD be tested:
- Reject when `reconciliation.requirements` contains an invalid `ReconciliationStatusSchema` value
- Reject when `status` is an invalid enum value (e.g., `"pending"`)
- Reject when `source` is an invalid enum value

### ProjectConfigSchema

Partially tested. The following SHOULD be tested:
- Reject when `defaults.mode` is an invalid enum value
- Reject when `git.merge_strategy` is an invalid enum value
- Reject when `git.commit_convention` is an invalid enum value
- Verify `context_sections`, `adapters`, and `cleanup` fields are recognized (no test confirms these optional fields are accepted)
- Verify `cleanup.log_retention_days` defaults to 30

## Recommended Actions

1. Add at least one negative test per schema covering a missing required field
2. Add at least one negative test per schema covering an invalid enum value
3. Add tests for the `context_sections`, `adapters`, and `cleanup` fields in `ProjectConfigSchema`
4. Add a test confirming `schema_version <= 0` is rejected in `StateFileSchema`
