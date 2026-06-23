# Implementation: write-comprehensive-user-contributor-documentation-guide

Filled the human-facing documentation gap identified by a codebase review: the
spec store and `docs/workflows/` reference were strong, but there was no
connective "explain it to a human" layer for users or contributors.

## New documentation (~2,750 lines)

### User guide — `docs/guide/`
- `concepts.md` — mental model + glossary (lifecycle, workflow tiers, artifacts, gates, skills vs agents, spec store).
- `getting-started.md` — first-run tutorial with a full worked example (typo fix) through propose → review → verify → ship.
- `cli-reference.md` — all 38 top-level commands grouped, args/flags derived from `src/cli/**`.
- `configuration.md` — `.metta/config.yaml` documented exactly from `ProjectConfigSchema`, plus custom gates and verification strategies.
- `troubleshooting.md` — Symptom→Cause→Fix recovery (guard blocks, gate failures, locks, conflicts) with real error text + exit codes.

### Contributor internals — `docs/internals/`
- `architecture.md` — 24-subsystem map, layering, lifecycle flow, functional-core/imperative-shell.
- `data-model.md` — schemas, on-disk layout, state lifecycle, validation discipline.
- `extending.md` — add a command / gate / workflow / skill / provider, with real examples + the byte-identity rule.
- `guard-hooks.md` — the skill-enforcement model (bash + edit guards, trust signals).

### Connective / meta
- `docs/README.md` — documentation index by audience (users / contributors / reference / generated).
- `CONTRIBUTING.md` (root) — setup, build, testing, conventions, the dogfooded metta workflow, byte-identity rule.
- `docs/proposed/README.md` — historical banner (April-2026 design docs may not match current code).
- `QA-TEST-GUIDE.md` — refreshed headline count (185 → 1015 tests / 78 files) + pointer to CONTRIBUTING.

## Approach
Each content doc was written by an independent agent grounded in specific source
files (no invented commands/flags/behavior). Existing `docs/workflows/` kept and
linked, not duplicated. The 4 generated `docs/*.md` were not touched.

## Verification performed
- Mechanical link check: all internal `.md` links across the new docs resolve.
- Content-accuracy review against source found 5 concrete inaccuracies — all fixed:
  1. `architecture.md` artifact-status `accepted` → real enum / `complete`.
  2. `concepts.md` spec persona `specifier` → `metta-proposer` (no separate specifier agent).
  3. `cli-reference.md` `iteration record` missing the **required** `--phase` flag.
  4. `getting-started.md` finalize gate claim ("alphabetical, incl. stories-valid") → declaration-order, quick set is tests/lint/typecheck/build.
  5. `getting-started.md` fabricated `stories.md` sentinel (quick has no stories-valid gate) → removed.
- `tsc`/build unaffected (docs only). Out of scope: LICENSE/SECURITY (project-hygiene workstream), auto-generating the CLI reference.
