# on_failure gate policy inconsistently honored — retry_once works at execute-time (ExecutionEngine.runTaskGatesInDir at src/execution/execution-engine.ts:355 calls GateRegistry.runWithRetry) but NOT at finalize-time (Finalizer calls GateRegistry.runAll which bypasses retry). stop and continue_with_warning on_failure values are parsed by the gate-definition schema but never honored anywhere in the codebase — the registry has no branching on them. Fix: either wire on_failure semantics uniformly across execute and finalize call paths, or drop the unused on_failure values from the schema and docs.

**Captured**: 2026-04-17
**Status**: logged
**Severity**: major

on_failure gate policy inconsistently honored — retry_once works at execute-time (ExecutionEngine.runTaskGatesInDir at src/execution/execution-engine.ts:355 calls GateRegistry.runWithRetry) but NOT at finalize-time (Finalizer calls GateRegistry.runAll which bypasses retry). stop and continue_with_warning on_failure values are parsed by the gate-definition schema but never honored anywhere in the codebase — the registry has no branching on them. Fix: either wire on_failure semantics uniformly across execute and finalize call paths, or drop the unused on_failure values from the schema and docs.
