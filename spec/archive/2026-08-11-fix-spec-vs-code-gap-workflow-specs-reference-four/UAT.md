# UAT: fix-spec-vs-code-gap-workflow-specs-reference-four

- **Change**: fix-spec-vs-code-gap-workflow-specs-reference-four
- **Generated**: 2026-08-11
- **Source**: intent + summary (reduced)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

*Reduced script — derived from intent/summary; steps are confirmation prompts.*

### Intent proposal

#### Step 1.1
- **Do**: Confirm: In `spec/specs/workflow-engine/spec.md` §7.2, correct the quick-workflow table to match `src/templates/workflows/quick.yaml` exactly: `implementation` gates become `[tests, lint, typecheck, build]`; `verification` gates become `[]`.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: In the same section, add a short note documenting that quality rigor for the spec, design, task, and UAT/verification stages is enforced by AI reviewer/verifier subagent personas orchestrated by the metta skills — not by registered gates — and that programmatic gates cover only mechanical checks (`tests`, `lint`, `typecheck`, `build`, `stories-valid`).
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Trivial-workflow change (no spec.md artifact). Verified against the issue's acceptance intent and existing regression scenarios:

#### Step 2.1
- **Do**: Confirm: [x] `spec/specs/workflow-engine/spec.md` §7.2 quick table matches `src/templates/workflows/quick.yaml` exactly — implementation `[tests, lint, typecheck, build]`, verification `[]` (checked by direct comparison).
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: [x] No active spec describes `spec-quality`, `design-review`, `task-quality`, or `uat` as an existing/registered gate — remaining mentions in `spec/specs/gate-runner/spec.md` are prohibition scenarios (regression guard) and `uat`/UAT mentions in `finalize-ship`/`uat-execution` refer to the implemented UAT.md generation/execution feature, not a gate.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: [x] Persona-enforced quality model documented in §7.2, cross-referencing the gate-runner spec's normative prohibition.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.4
- **Do**: Confirm: [x] Gate-runner prohibition scenarios (standard/full/quick YAMLs contain none of the four names) still hold — covered by the existing test suite, all passing.
- **Observe**: behaves as described
- [ ] Pass
