# uat-document-generation-at-finalize-every-finalized-change

## Problem

When a change finalizes today, verification evidence is entirely machine-facing: `summary.md` records what the verification agent checked, and `gates.yaml` (written by finalize Step 6b) records pass/fail results for tests, lint, typecheck, build, and stories-valid. Nothing produced by the lifecycle hands a human — or a fresh AI agent with no session context — a followable, user-side acceptance script: "run this command, observe this output, check this box." Anyone wanting to accept a finished feature must reverse-engineer the observable behaviors from `stories.md` acceptance criteria, `spec.md` scenarios, and the summary prose, then improvise their own checklist. That is exactly the gap user acceptance testing exists to close, and it affects every consumer of a finalized change: the project owner accepting work, a reviewer sanity-checking a merge, and future agents auditing archived changes.

There is also unfinished history here: `uat` was one of four phantom gate names that were specced but never built, removed in the fix-gate cleanup (`spec/issues/spec-vs-code-gap-workflow-specs-reference-four-unimplemented.md`, resolved). The idea was sound; the shape was wrong. UAT is not a pass/fail gate the machine can run — it is an artifact the machine can *assemble* so a person or agent can run it. This change is the real implementation of that intent, as an artifact generator.

## Proposal

Generate a `UAT.md` acceptance script for every finalized change, deterministically assembled from the change's structured artifacts — no AI call.

**Source material (mechanical assembly):**
- `stories.md` acceptance criteria (Given/When/Then) and Independent Test Criteria, parsed via the existing `parseStories` (`src/specs/stories-parser.ts`).
- `spec.md` scenarios for additional coverage, parsed via `parseSpec` / `parseDeltaSpec` (`src/specs/spec-parser.ts`).
- `summary.md` and `gates.yaml` as the record of what is already machine-verified, so the script focuses human/agent attention on observable behavior (CLI invocations, file states) instead of re-running unit tests. (The codebase has no `verification.md` — the verification stage generates `summary.md`, and finalize writes `gates.yaml`; those are the machine-verified sources.)

**Generation mode:** a pure TypeScript assembler module rendering through the existing `TemplateEngine` (`src/templates/template-engine.ts`, single-brace `{key}` substitution) from a new external template `src/templates/artifacts/uat.md`, modeled on `verify.md`. The template is picked up by the existing `copy-templates` script (`cp -r src/templates/artifacts dist/templates/artifacts`) — no build change.

**Lifecycle hook:** inside `Finalizer.finalize` (`src/finalize/finalizer.ts`), after gates pass (Step 4) and after the real spec merge (Step 5), immediately before archive (Step 6, `artifactStore.archive`). `UAT.md` is written into `spec/changes/<name>/` so the archive move sweeps it into `spec/archive/<date>-<name>/`. Because every failure exit (incomplete artifacts, merge conflict, gates failed) returns before this point, a failed finalize never leaves a stray `UAT.md`. Exact insertion-point ordering relative to Step 5's return paths is finalized in design.

**Output surfacing:** the finalize success `--json` object (`src/cli/commands/finalize.ts`) gains a field carrying the generated UAT path, and the human-readable success output gains a corresponding line.

**Format:** numbered steps grouped by user story. Each step carries: what to do (derived from Independent Test Criteria where they name CLI invocations), what you should observe (THEN clauses), a checkbox, and a "machine-verified" annotation on steps whose scenario is already covered by gates/verification — cross-referenced by requirement/story id where derivable, best-effort, and simply absent when not derivable. The header records the change name, generation date, and how to report a failure (log a metta issue).

**Tier behavior:** standard/full changes (where `stories.md` exists and parses to `kind: 'stories'`) get the full story-grouped script. Quick/trivial changes (no stories artifact, or a sentinel stories document) get a reduced script derived from `spec.md` scenarios if present, else from `intent.md` Proposal bullets plus summary highlights — generation is never skipped entirely by tier.

**Config:** a new `uat.enabled` toggle (default `true`) via a strict Zod `UatConfigSchema` in `src/schemas/project-config.ts`, mirroring `DocsConfigSchema`, read through `ConfigLoader` the same way `config.docs` is already read in `finalizer.ts`.

**Spec target:** delta spec extends the existing `finalize-ship` capability (`# finalize-ship`).

**Constraints honored:** no new dependencies (remark + existing `TemplateEngine` only); Zod validation on the config addition; template as an external file, never a string literal; full test suite green per batch; near 1:1 test-to-source ratio — expected new tests `tests/uat-generator.test.ts`, `tests/uat-template-contract.test.ts`, plus additions to `tests/cli-finalize.test.ts`.

## Impact

- **`src/finalize/finalizer.ts`** — new generation step between the real spec merge (Step 5) and archive (Step 6); `FinalizeResult` gains a field reporting the generated UAT path. All existing early-return failure paths are untouched and continue to exit before UAT generation.
- **`src/cli/commands/finalize.ts`** — success `--json` shape gains a new field (additive; existing fields unchanged) and human output gains one line. Error JSON shapes (`incomplete_artifacts`, `conflict`, `gates_failed`, `finalize_locked`, `finalize_error`) are unchanged.
- **`src/schemas/project-config.ts`** — new `UatConfigSchema` and a `uat` key on the strict `ProjectConfigSchema`. Because the root schema is `.strict()`, this is the change that makes a `uat:` key in `.metta/config.yaml` valid; existing configs without the key keep working via the default.
- **`src/templates/artifacts/`** — new `uat.md` template, swept to `dist/` by the existing `copy-templates` script.
- **Archive contents** — every newly finalized change's archive directory gains a `UAT.md` alongside `gates.yaml` and `summary.md`. Existing archives are untouched.
- **Parsers and TemplateEngine** — consumed read-only; no behavior changes to `parseStories`, `parseSpec`/`parseDeltaSpec`, or `TemplateEngine`.
- **Tests** — new test files plus additions to `tests/cli-finalize.test.ts` for the JSON field and the `uat.enabled` toggle; `tests/verify-template-contract.test.ts` serves as the model for the template contract test.
- **`finalize-ship` spec** — extended via delta spec with the UAT generation requirements.

## Out of Scope

- **A `uat` gate.** This is an artifact generator, not a pass/fail gate. No gate is registered, and the phantom gate name stays removed.
- **AI-enriched authoring.** Generation is deterministic assembly only — no AI call to polish wording, infer steps, or fill gaps. AI enrichment is noted as follow-up work.
- **Retrofitting `UAT.md` into already-archived changes.** Only changes finalized after this ships get one.
- **Driving UAT execution.** Nothing runs the script, records checkbox results, or reports acceptance outcomes. A `/metta-uat` runner skill that walks a human or agent through the script is future work — recorded here as a future-work note, not built in this change.
- **New dependencies or build-script changes.** Existing remark parsers, `TemplateEngine`, and the existing `copy-templates` step cover everything.
- **Changes to the verification stage.** `summary.md` and `gates.yaml` are consumed as-is; no new verification artifact (e.g. `verification.md`) is introduced.

**Future work note:** two natural follow-ups are (1) a `/metta-uat` runner skill that executes the generated script interactively and logs failures as metta issues, and (2) AI-enriched UAT authoring that upgrades the deterministic draft with richer, context-aware steps.
