# gate 'warn' status treated inconsistently between Finalizer and verify command. Finalizer counts warn as pass (finalize succeeds even if a gate reports warn), while the verify command treats warn as fail (verify errors out). No gate in the codebase currently emits warn, but if any ever does, the same run would succeed under metta finalize and fail under metta verify — confusing. Fix: pick one semantic (warn = pass-with-caveat OR warn = fail) and apply uniformly.

**Captured**: 2026-04-17
**Status**: logged
**Severity**: minor

gate 'warn' status treated inconsistently between Finalizer and verify command. Finalizer counts warn as pass (finalize succeeds even if a gate reports warn), while the verify command treats warn as fail (verify errors out). No gate in the codebase currently emits warn, but if any ever does, the same run would succeed under metta finalize and fail under metta verify — confusing. Fix: pick one semantic (warn = pass-with-caveat OR warn = fail) and apply uniformly.
