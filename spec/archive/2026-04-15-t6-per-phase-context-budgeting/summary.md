# Summary — t6-per-phase-context-budgeting

Per-phase context budgeting implemented per spec.

## What shipped

- **Recalibrated `CONTEXT_MANIFESTS`** (`src/context/context-engine.ts`) — tiers now discovery 50K (intent/stories), spec 60K, research 80K, design 100K, tasks 100K, execution 150K per executor, verification 120K.
- **New `stories` manifest entry** with `required: ['intent']`; `spec` required updated to `['intent', 'stories']`.
- **`LoadedContext.warning`** — `'smart-zone' | 'over-budget' | null` derived from utilization + drops/truncations.
- **`LoadedContext.droppedOptionals: string[]`** — optional sources not loaded due to budget.
- **Skeleton-fallback** for oversize optional files — attempts `headingSkeleton` transformation before dropping.
- **`InstructionOutput.budget.warning`** + **`budget.dropped_optionals`** — surfaced in `metta instructions <artifact> --json` iff non-null.
- **`metta context stats` CLI command** — per-artifact utilization table with `ok`/`smart-zone`/`fan-out`/`split-phase` recommendations. Supports `--change`, `--artifact`, `--json`. Exit code 0 regardless (advisory).
- **`ARTIFACT_KINDS` exported** from context-engine for reuse.
- **Living spec synced** — `spec/specs/context-engine/spec.md` updated with §2.1 budgets table, §4.1 skeleton-fallback behavior, §4.4 warning derivation, §4.5 stats CLI, §10.2 new `budget.warning` / `budget.dropped_optionals` fields.

## Verification

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm run build` — clean
- `npx vitest run` — **479 / 479 passed** (up from 465; +14 new tests across context-engine, instruction-generator, context-stats)

## Backwards compatibility

- Additive only: `warning` and `droppedOptionals` are new fields on `LoadedContext`.
- `budget.warning` / `budget.dropped_optionals` only appear when non-null — existing JSON consumers see no diff for under-80% workloads.
- No state-file schema changes. No migration.

## Dogfood touchpoint

This change's own context loads comfortably below new budgets — `metta context stats --change t6-per-phase-context-budgeting` reports all artifacts as `ok`. New budgets will show their value on larger changes where research or design phases start to crowd out optional context.
