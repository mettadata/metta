# metta-discovery agent cannot Write outside an active change due to PreToolUse guard. /metta-init runs before any active change exists, so metta-discovery's Write tool is blocked by the metta-guard-edit hook. Agent works around by shelling out via Bash heredoc, which is a guard bypass. Fix: either exempt metta-discovery from the guard when invoked from /metta-init, or have the guard recognize init context (no active change expected).

**Captured**: 2026-04-15
**Status**: logged
**Severity**: minor

metta-discovery agent cannot Write outside an active change due to PreToolUse guard. /metta-init runs before any active change exists, so metta-discovery's Write tool is blocked by the metta-guard-edit hook. Agent works around by shelling out via Bash heredoc, which is a guard bypass. Fix: either exempt metta-discovery from the guard when invoked from /metta-init, or have the guard recognize init context (no active change expected).
