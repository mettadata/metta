# code-driven gates (spec-quality, design-review, task-quality, uat) have no implementation — workflow YAMLs reference them but src/gates/ contains no handlers. GateRegistry.run falls through to a default path that returns status: skip for unknown gate names. Observable effect: running any workflow that lists these gates logs a skip and does not enforce the intended check (e.g. full workflow's verification stage uat gate is silently skipped). Fix: implement each gate, or remove them from the workflow YAMLs if no longer planned.

**Captured**: 2026-04-17
**Status**: logged
**Severity**: major

code-driven gates (spec-quality, design-review, task-quality, uat) have no implementation — workflow YAMLs reference them but src/gates/ contains no handlers. GateRegistry.run falls through to a default path that returns status: skip for unknown gate names. Observable effect: running any workflow that lists these gates logs a skip and does not enforce the intended check (e.g. full workflow's verification stage uat gate is silently skipped). Fix: implement each gate, or remove them from the workflow YAMLs if no longer planned.
