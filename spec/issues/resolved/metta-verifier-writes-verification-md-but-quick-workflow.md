# metta-verifier writes verification.md but quick workflow complete expects summary.md

**Captured**: 2026-06-19
**Status**: resolved
**Severity**: minor
**Resolved by**: change `fix-metta-verifier-output-filename-match-workflow-generates` (2026-06-19) — candidate solution #2: pinned the verifier persona's output filename to the workflow `generates` contract (`summary.md`) in `src/templates/agents/metta-verifier.md`.

## Symptom
During the `exclude-vendored-referrences` quick-workflow change, the metta-verifier produced a complete, valid verification artifact named `verification.md`, but `metta complete verification` failed with "Artifact file 'summary.md' not found". The verifier content was correct; only the filename mismatched. The change was unblocked by manually renaming `verification.md` to `summary.md`, which is why the archived change now contains `summary.md`.

## Root Cause Analysis
There is a naming-convention drift between the verification artifact filename declared by the workflow definitions and the filename the metta-verifier persona is biased to author. Every workflow YAML (quick/standard/full/trivial) declares the verification artifact as `generates: summary.md`, and `metta complete verification` validates that this exact filename exists on disk. The metta-verify skill correctly instructs the verifier to write `spec/changes/<change>/summary.md`. However, the metta-verifier agent persona never pins an output filename — it describes itself as producing a "verification summary" with artifact type `verification`, so when the orchestration prompt is paraphrased or the persona authors freeform, the agent gravitates to `verification.md`. The `generates` field is the contract `metta complete` enforces, and nothing in the verifier persona binds the agent to that exact filename, so the two can diverge silently until completion fails.

### Evidence
- `src/templates/workflows/quick.yaml:25` — verification artifact declares `generates: summary.md`, the exact filename `metta complete verification` requires (also standard.yaml:65, full.yaml:81, trivial.yaml:25).
- `src/templates/agents/metta-verifier.md:12` — verifier persona only says it "produces a verification summary" with no filename binding, leaving the output name underspecified relative to the YAML contract.
- `spec/archive/2026-06-19-exclude-vendored-referrences-dependency-manifests-git/summary.md` — archived change contains `summary.md` (the post-rename file), confirming the workaround was applied to clear the completion failure.

## Candidate Solutions
1. **Make `metta complete` accept either filename** — when validating the verification artifact, fall back to accepting `verification.md` if `summary.md` is absent (and vice versa), normalizing on read. Tradeoff: tolerates ambiguity rather than fixing it, so two filenames remain valid forever and other tooling that hardcodes `summary.md` (skills, ship merge) still breaks; pushes the inconsistency downstream.
2. **Pin the filename in the verifier persona** — add an explicit, non-negotiable instruction to `metta-verifier.md` that the verification artifact MUST be written to the exact path provided by the orchestrator, which is `summary.md`. Tradeoff: relies on persona discipline (the same soft constraint that already drifted once), so it reduces but does not eliminate the chance of recurrence without a hard check.
3. **Echo the expected `generates` filename into the verifier invocation and assert it post-write** — have the skill/orchestrator pass the exact `generates` value from the active workflow YAML into the verifier prompt, then have `metta complete` emit the expected vs found filenames in its error. Tradeoff: requires plumbing the workflow artifact name through the instructions payload and a small CLI change, more work than a one-line persona edit.
