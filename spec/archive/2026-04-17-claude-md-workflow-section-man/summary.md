# Summary: claude-md-workflow-section-man

## What changed

The `## Metta Workflow` section rendered into every project's `CLAUDE.md` now mandates invoking `/metta-*` skills and explicitly forbids AI orchestrators from calling the `metta` CLI directly. The mandate is backed by a reference to the logged framework-gap issue (`spec/issues/metta-complete-accepts-stub-placeholder-artifacts-on-intent-.md`) so future readers can see the concrete failure mode that motivated it.

## Files added

- `src/delivery/workflow-primer.ts` — shared source of truth for the workflow primer text, with `workflowPrimerShort()` / `workflowPrimerLong()` helpers

## Files modified

- `src/cli/commands/refresh.ts` — `buildWorkflowSection()` now delegates to `workflowPrimerLong()`; Lifecycle / Status / Specs & Docs / Organization / System reference tables preserved
- `src/delivery/claude-code-adapter.ts` — `formatContext()` delegates to `workflowPrimerShort()`
- `src/cli/commands/discovery-helpers.ts` — `context_template` interpolates `workflowPrimerShort()` output
- `src/index.ts` — barrel export
- `tests/delivery.test.ts` — assertion tightened from `'metta propose'` to `'/metta-propose'` plus the mandate sentence

## Verification

- `npx tsc --noEmit`: clean
- `npm test`: 526/526 pass (42 files)
- 3-reviewer pass (correctness / security-quality / gate-runner): PASS_WITH_WARNINGS; all warnings addressed in the `13979a202` refactor

## Resolves

Motivated by — but does not close — `spec/issues/metta-complete-accepts-stub-placeholder-artifacts-on-intent-.md`. This change is the instructional half of the defense-in-depth for that issue; the programmatic content-validation in `metta complete` is a separate follow-up.

## Deliberate non-goals

- No changes to the skill definitions themselves
- No changes to non–Claude-Code tool adapters
- No automated migration of existing projects — they pick up the new text on their next `metta refresh`
