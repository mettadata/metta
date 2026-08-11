# fix-spec-vs-code-gap-workflow-specs-reference-four

## Problem

The living workflow specs describe quality gates that do not exist in the implementation. Issue `spec-vs-code-gap-workflow-specs-reference-four-unimplemented` (severity: minor) documents four gate names — `spec-quality`, `design-review`, `task-quality`, and `uat` — that have no gate YAML under `src/templates/gates/` (only `build`, `lint`, `stories-valid`, `tests`, `typecheck` exist) and appear in no workflow YAML's active `gates:` array. Because `GateRegistry.run()` (`src/gates/gate-registry.ts:103`) returns `status: 'skip'` for any unregistered gate name, a spec referencing these names never surfaces a runtime error — the drift stays invisible until a manual audit.

The concrete remaining drift in the active spec store is in `spec/specs/workflow-engine/spec.md`, section 7.2 (Bundled Workflows), quick-workflow table:

- The `verification` row lists gates `[uat]` — the actual `src/templates/workflows/quick.yaml` verification stage has `gates: []`, and no `uat` gate exists.
- The `implementation` row lists gates `[tests, lint, typecheck]` — the actual quick.yaml implementation stage has `gates: [tests, lint, typecheck, build]` (adjacent drift in the same table, corrected in passing).

Anyone reading the spec as the source of truth — including AI subagents grounding their work in it — is misled into believing programmatic UAT gating exists at the verification stage.

## Proposal

Adopt the issue's recommended candidate solution 1: update the spec to the persona-enforced model.

1. In `spec/specs/workflow-engine/spec.md` §7.2, correct the quick-workflow table to match `src/templates/workflows/quick.yaml` exactly: `implementation` gates become `[tests, lint, typecheck, build]`; `verification` gates become `[]`.
2. In the same section, add a short note documenting that quality rigor for the spec, design, task, and UAT/verification stages is enforced by AI reviewer/verifier subagent personas orchestrated by the metta skills — not by registered gates — and that programmatic gates cover only mechanical checks (`tests`, `lint`, `typecheck`, `build`, `stories-valid`).

This is a spec-text-only change. No runtime code, no workflow YAMLs, no gate YAMLs are modified.

## Impact

- `spec/specs/workflow-engine/spec.md` — table rows corrected, one explanatory note added. No requirement or scenario headings change, so `spec.lock` scenario IDs are unaffected.
- No behavior change anywhere: the code already matches what the corrected spec will say.
- Readers of the spec (human and AI) stop being told a nonexistent `uat` gate runs at verification.

## Out of Scope

- Implementing the four gates (issue candidate solution 2) — rejected: judgment-based checks map poorly onto command-exit-code gates and would duplicate persona review.
- Editing `spec/specs/gate-runner/spec.md` — its "Workflow YAMLs MUST NOT reference unimplemented gates" requirement names the four gates only to prohibit them; it is a correct, implementation-matching regression guard and stays as-is.
- Editing anything under `spec/archive/` — archived change artifacts are historical records.
- Changes to `src/` code, workflow YAMLs, gate YAMLs, or docs under `docs/` (docs were already corrected by a prior audit).
