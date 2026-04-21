# Summary: fix-issue-orchestrator-asks-user-questions-are-answerable

Closes issue `orchestrator-asks-user-questions-that-are-answerable-by` (minor).

## Deliverable

Added a `### Research discipline` section to `spec/project.md` → `CLAUDE.md` "Metta Workflow" block. Rule requires orchestrators to use `WebFetch` / `WebSearch` to resolve deterministic documentation-based research-phase questions **before** asking the user. Escalation to the user is reserved for subjective judgments (scope, cost, tradeoff choice).

Source URL citation expected when presenting findings.

## Files touched

- `spec/project.md` — added `### Research discipline` subsection
- `CLAUDE.md` — regenerated via `metta refresh`
- `spec/issues/orchestrator-asks-user-questions-that-are-answerable-by.md` → `spec/issues/resolved/` (archived)
