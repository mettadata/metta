# Summary: fix-spec-vs-code-gap-workflow-specs-reference-four

## What changed

One file: `spec/specs/workflow-engine/spec.md` (§7.2 Bundled Workflows, quick-workflow table).

- `verification` row gates corrected `[uat]` → `[]` — the `uat` gate has never been registered or defined; `src/templates/workflows/quick.yaml` has `gates: []` for the verification stage.
- `implementation` row gates corrected `[tests, lint, typecheck]` → `[tests, lint, typecheck, build]` — matches quick.yaml (adjacent drift fixed in passing).
- Added a note documenting the persona-enforced quality model: registered gates cover only mechanical checks (`tests`, `lint`, `typecheck`, `build`, `stories-valid`); spec/design/task/UAT rigor is enforced by AI reviewer/verifier subagent personas, and workflow YAMLs MUST NOT reference unregistered gate names (cross-ref: gate-runner spec).

Resolves issue `spec-vs-code-gap-workflow-specs-reference-four-unimplemented` via its recommended candidate solution 1 (update specs to persona-enforced model). Deliberately unchanged: `spec/specs/gate-runner/spec.md` (its mention of the four names is a prohibition/regression guard, not drift), `spec/archive/**` (historical records), all `src/` code and workflow/gate YAMLs (code already matched the corrected spec).

## Verification

Change is spec-text-only; no requirement/scenario headings changed, so `spec.lock` IDs are unaffected.

- `npm test` — 117 files, 2078 tests, all passed
- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm run build` — succeeded (templates copied to dist)
- No remaining references to the four unimplemented gates as active gates in `spec/specs/workflow-engine/spec.md`

## Commits

- `6704e235a` docs(workflow-engine): correct quick-workflow gate table to match quick.yaml; document persona-enforced quality model
