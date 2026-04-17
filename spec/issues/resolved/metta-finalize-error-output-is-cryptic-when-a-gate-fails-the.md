# metta finalize error output is cryptic: when a gate fails, the human-readable output only says 'Quality gates failed: Fix failures and retry.' without naming the gate or reason. Workaround is --json/--verbose/individual gate runs. Observed on multiple changes during trello-clone e2e dogfood. Fix: surface the failing gate name + message in the human-readable finalize output.

**Captured**: 2026-04-15
**Status**: logged
**Severity**: major

metta finalize error output is cryptic: when a gate fails, the human-readable output only says 'Quality gates failed: Fix failures and retry.' without naming the gate or reason. Workaround is --json/--verbose/individual gate runs. Observed on multiple changes during trello-clone e2e dogfood. Fix: surface the failing gate name + message in the human-readable finalize output.
