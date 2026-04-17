# Summary: create-comprehensive-internal

## What changed

Comprehensive internal documentation for metta's workflow system added under `docs/workflows/`. New contributors can now orient themselves through a single hub instead of grepping across SKILL.md files, agent definitions, workflow YAMLs, artifact templates, and gate YAMLs.

## Files added (8)

- `docs/workflows/README.md` — index + "which skill should I use" decision tree
- `docs/workflows/workflows.md` — the three YAML workflows (quick / standard / full), per-stage tables, comparison
- `docs/workflows/skills.md` — all 18 installed `/metta-*` skills, grouped Lifecycle / Status / Organization / Spec-management / Setup
- `docs/workflows/agents.md` — all 10 `metta-*` subagent personas, invocation patterns, input envelopes
- `docs/workflows/artifacts.md` — all 11 artifact template types with section headers + placeholders
- `docs/workflows/gates.md` — 5 YAML gates + 4 code-driven gates; finalize loop; `on_failure` semantics
- `docs/workflows/state.md` — on-disk state model (`.metta/`, `spec/changes/`, `spec/specs/`, `spec/archive/`, `spec/issues/`, `spec/backlog/`, `spec/gaps/`)
- `docs/workflows/walkthroughs.md` — 4 end-to-end walkthroughs (quick, standard, fix-issues, full)

## Files modified (2)

- `src/docs/doc-generator.ts` — added pointer emit in both `generateArchitecture()` and `generateGettingStarted()` so the pointer survives every `metta docs generate` run
- `docs/architecture.md` + `docs/getting-started.md` — pointer blockquote inserted after the H1 (regenerated via the updated generator)

## Verification

- `npx tsc --noEmit`: clean
- `npm test`: 528/528 pass
- Pointer survives regeneration (verified via live `metta docs generate` + grep)
- Post-review fixes landed for factual inaccuracies flagged by 2 of 3 reviewers (see review.md)

## Known latent issues surfaced (not fixed here)

Writing the gates reference surfaced real gaps that deserve separate issues:

1. **Code-driven gates absent** — `spec-quality`, `design-review`, `task-quality`, `uat` are referenced by workflow YAMLs but have no implementation under `src/gates/` — they resolve to `status: skip` via `GateRegistry.run`'s fallthrough.
2. **`on_failure` policies partially honored** — `retry_once` works at execute-time (via `runWithRetry`) but not at finalize (which calls `runAll`); `stop` and `continue_with_warning` are parsed but not honored by the registry at all.
3. **`warn` status asymmetry** — `Finalizer` treats gate `warn` as pass; `verify` treats it as fail; no gate currently emits `warn`.

These are real latent bugs but outside this docs-only change's scope. Should be logged as issues.

## Non-goals (achieved)

- No edits to the existing `docs/api.md`, `docs/changelog.md`, `docs/proposed/`, `docs/research/`
- No new build steps or tooling
- No changes to skills, agents, specs, workflow YAMLs, artifact templates, or gate YAMLs (the source-of-truth files that the new docs describe)
