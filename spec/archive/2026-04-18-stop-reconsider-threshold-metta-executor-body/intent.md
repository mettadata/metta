# stop-reconsider-threshold-metta-executor-body

## Problem

`metta-executor` body had no explicit stop-and-reconsider threshold. When a task caused cascading test failures in unrelated modules, executors kept trying to fix them, burning tool budget instead of escalating.

Tracked as `metta-quick-executor-burns-tool-budget-fixing-cascading-test` (major).

## Proposal

Add **Rule 5** to `src/templates/agents/metta-executor.md` Deviation Rules: if cascading failures appear in tests unrelated to the task, STOP after at most 2 fix attempts and report back. The orchestrator can then re-scope or split the task.

Mirror to `.claude/agents/metta-executor.md`.

## Impact

- `src/templates/agents/metta-executor.md` + deployed mirror
- No code changes, no tests

## Out of Scope

- CLI-level budget tracking
- Mechanical enforcement (this is prose guidance; policy depends on the executor following it)
