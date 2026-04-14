# Add /metta-fix-issues skill that works like /metta-fix-gap

**Added**: 2026-04-14
**Status**: backlog
**Priority**: medium

Mirror the existing `/metta-fix-gap` workflow for the issues store. A `/metta-fix-issues` skill should:

- List outstanding issues in `spec/issues/` (filterable by severity, like fix-gap has `--severity`).
- For a chosen issue (or `--all`), drive a full metta change lifecycle (propose → plan → execute → verify → finalize → ship) that addresses the issue.
- Archive the fixed issue (move/rename to indicate resolution) when the change ships.

Context: we currently have several issues accumulated (`spec-merger-strips-inline-backticks-...`, `tasks-in-tasks-md-arent-getting-checked-off-...`, `metta-install-should-not-touch-claude-md-...`). Fixing them one at a time via `metta propose` is manual. `metta fix-gap --all` already demonstrates the pattern for reconciliation gaps.

Implementation likely involves:
- New CLI command `metta fix-issue <slug>` / `metta fix-issues --all --severity <level>`
- Corresponding skill at `src/templates/skills/metta-fix-issues/SKILL.md`
- Issue archival semantics (where do resolved issues go? `spec/issues/resolved/`? merge into change archive?)
