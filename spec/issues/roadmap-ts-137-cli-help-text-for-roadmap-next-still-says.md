# roadmap.ts:137 CLI help text for 'roadmap next' still says 'Activate the top roadmap entry via the backlog promote path and pop it', contradicting the reconciled roadmap-feature spec (next is decoupled from backlog promote; promote emits /metta-fix-issues, next emits metta propose via buildPromoteHandoff). Cosmetic staleness: update the subcommand description and consider renaming buildPromoteHandoff (src/cli/promote-handoff.ts) to reflect its sole consumer (roadmap next). Found during review of the spec reconciliation change fix-spec-specs-roadmap-feature-spec-md-normative-drift-lines.

**Captured**: 2026-08-18
**Status**: logged
**Severity**: minor

roadmap.ts:137 CLI help text for 'roadmap next' still says 'Activate the top roadmap entry via the backlog promote path and pop it', contradicting the reconciled roadmap-feature spec (next is decoupled from backlog promote; promote emits /metta-fix-issues, next emits metta propose via buildPromoteHandoff). Cosmetic staleness: update the subcommand description and consider renaming buildPromoteHandoff (src/cli/promote-handoff.ts) to reflect its sole consumer (roadmap next). Found during review of the spec reconciliation change fix-spec-specs-roadmap-feature-spec-md-normative-drift-lines.
