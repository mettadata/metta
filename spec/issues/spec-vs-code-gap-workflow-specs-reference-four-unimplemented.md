# Spec-vs-code gap: workflow specs reference four unimplemented quality gates (spec-quality, design-review, task-quality, uat)

**Captured**: 2026-06-23
**Status**: logged
**Severity**: minor

## Symptom
The workflow specs describe four quality gates — `spec-quality`, `design-review`, `task-quality`, and `uat` — as part of the spec/design/tasks/verification stages, but none of these gates exist in the implementation. There is no gate YAML for them, no workflow YAML references them in an active `gates:` array, and at runtime they would resolve to no-ops. A documentation audit corrected the docs to match the code; the specs are now ahead of the implementation, describing gates that were never built.

## Root Cause Analysis
Spec/implementation drift: the specs were authored describing a programmatic gate model that was never implemented (or was removed). Quality rigor for spec/design/task/UAT stages is actually enforced by AI reviewer/verifier subagent personas, not by registered gates. The gate registry treats any unregistered gate name as a silent skip, so the specs could reference these names indefinitely without surfacing a runtime error — the drift stays invisible until a manual audit. Notably the `fix-gate-infrastructure-bundle` spec already mandates removing these names from workflow YAMLs (and the workflows comply), yet the spec text still names the four gates, and `workflow-engine/spec.md` still lists `uat` as the verification stage gate.

### Evidence
- `src/templates/gates/` — only `build`, `lint`, `stories-valid`, `tests`, `typecheck` gate YAMLs exist; none of the four named gates is defined.
- `src/gates/gate-registry.ts:103` — `run()` returns `status: 'skip'` for any name not in the registry, so referenced-but-unregistered gates are silent no-ops rather than errors.
- `spec/specs/workflow-engine/spec.md:241` — the full workflow table still lists the verification stage gate as `[uat]`, a gate that is never registered or defined.

## Candidate Solutions
1. **Update specs to persona-enforced model (recommended)** — Remove the four unimplemented gate names from `workflow-engine/spec.md` and `fix-gate-infrastructure-bundle/spec.md`, and document that spec/design/task/UAT rigor is enforced by reviewer/verifier subagent personas rather than registered gates. Tradeoff: loses the option of future programmatic enforcement from the spec record; reviewers must understand the rigor lives in persona prompts, not a gate registry.
2. **Implement the four gates** — Add gate definitions and a programmatic enforcement mechanism, then wire them into the appropriate workflow stages to fulfill the spec as written. Tradeoff: significant net-new work for checks that are inherently judgment-based (spec quality, design review, UAT) and map poorly onto command-exit-code gates; risks shipping shallow gates that duplicate persona review.
3. **Resolve via metta-fix-gap** — Run the formal reconciliation lifecycle to pick a direction and close the gap with full artifacts. Tradeoff: heavier process for what is a minor doc/spec wording correction if direction 1 is chosen.
