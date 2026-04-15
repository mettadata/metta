# Tasks — t6-per-phase-context-budgeting

## Batch 1: Core engine changes (serial — all touch context-engine.ts)

### Task 1.1 — Update CONTEXT_MANIFESTS with new budgets
- **Files:** `src/context/context-engine.ts`
- **Action:** Replace the `CONTEXT_MANIFESTS` record with the new table from design.md (intent 50K, stories 50K, spec 60K, research 80K, design 100K, tasks 100K, execution 150K, verification 120K). Include the new `stories` entry with `required: ['intent']`. Update `spec` required to `['intent', 'stories']`.
- **Verify:** `npx tsc --noEmit` passes.
- **Done:** Manifests constant updated with all 8 entries.

### Task 1.2 — Add warning + droppedOptionals to LoadedContext
- **Files:** `src/context/context-engine.ts`
- **Action:** Add `warning: 'smart-zone' | 'over-budget' | null` and `droppedOptionals: string[]` to `LoadedContext` interface. Refactor `resolve()` so the optional-loader loop tracks `droppedOptionals` and attempts skeleton-fallback per design.md. Compute and return `warning` at end of `resolve()`.
- **Verify:** `npx tsc --noEmit` passes; existing context-engine tests still pass.
- **Done:** `resolve()` returns new fields for all code paths.

## Batch 2: Test engine changes (can run parallel after Batch 1)

### Task 2.1 — Test warning + droppedOptionals in context-engine
- **Files:** `tests/context-engine.test.ts`
- **Action:** Add three tests:
  1. Under-80% load returns `warning: null`, `droppedOptionals: []`.
  2. 80–100% load returns `warning: 'smart-zone'`.
  3. Optional file that exceeds budget and whose skeleton also exceeds → added to `droppedOptionals`, `warning: 'over-budget'`.
  4. Optional file that exceeds budget but skeleton fits → loaded with `strategy: 'skeleton'`, not in droppedOptionals.
- **Verify:** `npx vitest run tests/context-engine.test.ts` passes.
- **Done:** 4 new tests green.

### Task 2.2 — Thread warning into instruction-generator
- **Files:** `src/context/instruction-generator.ts`
- **Action:** Extend `InstructionOutput['budget']` with optional `warning?: 'smart-zone' | 'over-budget'` and `dropped_optionals?: string[]`. In `generate()`, populate these fields only when `context.warning` is non-null.
- **Verify:** `npx tsc --noEmit` passes.
- **Done:** Output includes warning fields conditionally.

### Task 2.3 — Test warning surfacing in instruction-generator
- **Files:** `tests/instruction-generator.test.ts`
- **Action:** Add tests: (a) under-80% → no `warning` field in `budget`; (b) over-budget scenario → `budget.warning === 'over-budget'` and `budget.dropped_optionals` populated.
- **Verify:** `npx vitest run tests/instruction-generator.test.ts` passes.
- **Done:** 2 new tests green.

## Batch 3: CLI command (parallel with Batch 2)

### Task 3.1 — Implement `metta context stats` command
- **Files:** `src/cli/commands/context-stats.ts` (new), `src/cli/index.ts`
- **Action:** Create `registerContextCommand(program, createContext, outputJson)` following the `validate-stories` pattern. Support `--change`, `--artifact`, `--json`. Use `assertSafeSlug` on change name. Return table (text) or structured JSON. Recommendation: `ok`/`smart-zone`/`fan-out` (execution only)/`split-phase`. Exit code 0 always (warnings non-fatal). Wire into `src/cli/index.ts`.
- **Verify:** `npm run build && metta context stats --help` prints help.
- **Done:** Command registered, help output correct.

### Task 3.2 — Test `metta context stats` command
- **Files:** `tests/context-stats.test.ts` (new)
- **Action:** Fixture-based tests: create a synthetic change dir with known-size artifacts, call the command in both JSON and text modes, assert: (a) ok case; (b) smart-zone case; (c) over-budget execution → `fan-out`; (d) over-budget non-execution → `split-phase`; (e) missing --change with 0 active changes → non-zero exit; (f) --artifact filter scopes output to one row.
- **Verify:** `npx vitest run tests/context-stats.test.ts` passes.
- **Done:** 6 tests green.

## Batch 4: Spec sync + validation (serial, after Batches 1–3)

### Task 4.1 — Sync spec/specs/context-engine/spec.md with new budgets
- **Files:** `spec/specs/context-engine/spec.md`
- **Action:** Update the manifest table to match the new budgets (50K/50K/60K/80K/100K/100K/150K/120K). Add a section documenting `warning` and `droppedOptionals` fields. Add section for skeleton-fallback on optional deps.
- **Verify:** Read spec looks consistent; `metta specs list` still works.
- **Done:** spec/specs/context-engine/spec.md reflects implementation.

### Task 4.2 — Full test suite + type check + lint
- **Files:** _(verification only)_
- **Action:** Run `npm run build`, `npx tsc --noEmit`, `npm run lint`, `npx vitest run` in sequence.
- **Verify:** All green. Test count ≥ 465 + (4 + 2 + 6) = 477.
- **Done:** Build clean, all gates pass.
