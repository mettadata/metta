# metta complete accepts stub/placeholder artifacts on intent/summary (no min-content check). Symptom: an orchestrator running metta quick inline (not via the /metta-quick skill) can write files containing literal strings like 'intent stub' or 'summary stub', run metta complete, and the framework marks the artifact done. Only stories-valid gate validates content; intent.md and summary.md have no equivalent quality check. Fix: add a pre-complete content sanity check per artifact (e.g. template sections present, min length, no lorem-ipsum markers), or promote skill-invocation to mandatory in CLAUDE.md with a guard.

**Captured**: 2026-04-17
**Status**: logged
**Severity**: major

metta complete accepts stub/placeholder artifacts on intent/summary (no min-content check). Symptom: an orchestrator running metta quick inline (not via the /metta-quick skill) can write files containing literal strings like 'intent stub' or 'summary stub', run metta complete, and the framework marks the artifact done. Only stories-valid gate validates content; intent.md and summary.md have no equivalent quality check. Fix: add a pre-complete content sanity check per artifact (e.g. template sections present, min length, no lorem-ipsum markers), or promote skill-invocation to mandatory in CLAUDE.md with a guard.
