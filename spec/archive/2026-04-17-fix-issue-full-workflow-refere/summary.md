# Summary: fix-issue-full-workflow-refere

## What changed

Three new markdown artifact-template stub files were added under `src/templates/artifacts/`, satisfying every stage referenced by `src/templates/workflows/full.yaml` and unblocking the `full` workflow end-to-end.

## Files added

- `src/templates/artifacts/domain-research.md` — 5 sections (Domain Overview, Competitive Landscape, Technology Landscape, Key Findings, Implications for Intent)
- `src/templates/artifacts/architecture.md` — 6 sections (Architecture Overview, Component Breakdown, Interfaces, State & Data Flow, Deployment Topology, Risks)
- `src/templates/artifacts/ux-spec.md` — 6 sections (User Goals, Key Flows, Screens & States, Components & Interactions, Accessibility, Visual Tone)

## No code changes

The existing `copy-templates` rule in `package.json` copies the entire `src/templates/artifacts/` directory into `dist/` — new files are picked up automatically.

## Verification

- `diff`-clean byte-identical source ↔ deployed (build verified)
- `npx tsc --noEmit` clean
- `npm test` — 526/526 pass
- **End-to-end smoke test passed:** `metta propose --workflow full "smoke test" --json` created a change, `metta instructions domain-research --json --change <slug>` returned the template field populated with the domain-research.md contents, `metta changes abandon <slug>` cleaned up.

## Resolves

`spec/issues/full-workflow-references-missing-template-files-domain-resea.md` (severity: major)

## Non-goals

- No changes to `full.yaml` (the references there were already correct — only the files were missing)
- No agent or persona changes
- No docs/tutorial explaining when to choose `full` over `standard` (deferred)
- No cleanup of H1 style drift in pre-existing templates (separate concern)
