# Gap: Sub-schemas have no dedicated test coverage

**Detected:** 2026-04-06
**Source:** `tests/schemas.test.ts` vs `src/schemas/`
**Severity:** Low — sub-schemas are exercised indirectly, but boundary conditions are untested

## Description

The following schemas exist as exported types and are used by parent schemas, but no `describe` block in `tests/schemas.test.ts` targets them directly. Their validation logic is only exercised as a side-effect of testing the parent schema.

### Schemas without dedicated tests

| Schema | File | Tested Via |
|---|---|---|
| `BashToolConfigSchema` | `agent-definition.ts` | `AgentDefinitionSchema` test with Bash config |
| `ToolEntrySchema` | `agent-definition.ts` | `AgentDefinitionSchema` tests |
| `ArtifactStatusSchema` | `change-metadata.ts` | `ChangeMetadataSchema` tests |
| `ChangeStatusSchema` | `change-metadata.ts` | `ChangeMetadataSchema` tests |
| `DeviationSchema` | `execution-state.ts` | `ExecutionStateSchema` tests |
| `TaskStatusSchema` | `execution-state.ts` | `ExecutionStateSchema` tests |
| `ExecutionTaskSchema` | `execution-state.ts` | `ExecutionStateSchema` tests |
| `ExecutionBatchSchema` | `execution-state.ts` | `ExecutionStateSchema` tests |
| `GateFailureSchema` | `gate-result.ts` | `GateResultSchema` tests |
| `AutoCycleSchema` | `auto-state.ts` | `AutoStateSchema` tests |
| `SpecLockRequirementSchema` | `spec-lock.ts` | `SpecLockSchema` tests |
| `ReconciliationStatusSchema` | `spec-lock.ts` | `SpecLockSchema` tests |
| `ReconciliationRequirementSchema` | `spec-lock.ts` | `SpecLockSchema` tests |
| `ReconciliationSchema` | `spec-lock.ts` | `SpecLockSchema` tests |
| `ProviderConfigSchema` | `project-config.ts` | `ProjectConfigSchema` tests |
| `GateConfigSchema` | `project-config.ts` | `ProjectConfigSchema` tests |
| `GitConfigSchema` | `project-config.ts` | `ProjectConfigSchema` tests |
| `DocsConfigSchema` | `project-config.ts` | `ProjectConfigSchema` tests |
| `AutoConfigSchema` | `project-config.ts` | `ProjectConfigSchema` tests |
| `ProjectInfoSchema` | `project-config.ts` | `ProjectConfigSchema` tests |
| `WorkflowArtifactSchema` | `workflow-definition.ts` | `WorkflowDefinitionSchema` tests |
| `WorkflowOverrideSchema` | `workflow-definition.ts` | `WorkflowDefinitionSchema` tests |

## Untested boundary conditions (examples)

- `BashToolConfigSchema.strict()`: unknown fields should be rejected; not tested in isolation
- `GateFailureSchema.severity`: only `"error"` and `"warning"` are valid; an invalid value is never tested
- `DeviationSchema.rule`: min=1 is tested (rule=5 rejected), but rule=0 is not tested
- `ReconciliationStatusSchema`: the six valid values are never explicitly exercised; invalid values are not tested
- `ExecutionBatchSchema.status`: only two of four status values appear in tests
- `AutoCycleSchema` without `verification`: the optional omission path is not tested in isolation

## Recommended Actions

1. Add dedicated `describe` blocks for each sub-schema that has non-trivial validation (enums, patterns, ranges, `.strict()`)
2. Priority candidates: `GateFailureSchema`, `DeviationSchema`, `BashToolConfigSchema`, `ReconciliationRequirementSchema`
3. Lower-priority: pure enum schemas (`ArtifactStatusSchema`, `ChangeStatusSchema`, `TaskStatusSchema`) can remain covered via parent schema tests
