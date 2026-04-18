# Summary: stop-reconsider-threshold-metta-executor-body

## Problem

Metta-quick executor burned tool budget trying to fix cascading test failures unrelated to the task instead of stopping and escalating.

## Solution

Added Rule 5 to `metta-executor.md` Deviation Rules: at most 2 fix attempts on unrelated cascading failures, then STOP and report back.

## Files touched

- `src/templates/agents/metta-executor.md` + `.claude/agents/metta-executor.md`

## Resolves

- `metta-quick-executor-burns-tool-budget-fixing-cascading-test` (major)
