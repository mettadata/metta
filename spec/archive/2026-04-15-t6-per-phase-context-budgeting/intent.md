# t6-per-phase-context-budgeting

## Problem
Context budgets exist in `src/context/context-engine.ts` (CONTEXT_MANIFESTS) but are set low and inconsistent with research recommendations. Operators have no way to see how close a phase is to its budget, when to fan-out executors, or whether context rot is occurring. Current budgets (intent 20K, spec 40K, research 50K, design 60K, tasks 40K, execution 10K, verification 50K) were set pre-research and don't match the Ralph/GSD-grounded tiers (Discovery 50K, research 80K, planning 100K, execution 150K per executor, verification 120K).

## Proposal
1. **Recalibrate `CONTEXT_MANIFESTS` budgets** to research-grounded tiers — intent 50K (discovery), stories 50K, spec 60K, research 80K, design 100K, tasks 100K, execution 150K, verification 120K.
2. **Add `metta context stats [--change <name>] [--artifact <kind>]`** — shows bytes/tokens loaded per artifact vs budget, a utilization percentage, and a recommendation (`fan-out`, `split-phase`, `ok`). JSON mode for scripting.
3. **Section-filtering strategies** in `ContextEngine.buildContext()`: support `skeleton` (headings only), `section` (named-section extraction), `full` (current default). Filters apply to optional dependencies when loading them would exceed budget, instead of silently truncating.
4. **Surface budget-exceeded warnings** in artifact instructions JSON when context load exceeds 80% of budget ("smart zone warning").

## Impact
- `src/context/context-engine.ts` — new budgets, filtering strategies, load metadata.
- `src/context/instruction-generator.ts` — warning surfacing.
- New `src/cli/commands/context-stats.ts` + `src/cli/index.ts` wiring.
- Tests for each strategy + stats output.
- No schema changes to state files (budgets remain in-code constants/manifests).

## Out of Scope
- Dynamic budget learning from prior runs.
- Per-user configurable budgets (defer to config-loader theme).
- Token-cost telemetry / billing integration.
- Rewriting existing artifacts to fit new budgets (existing changes keep their loaded context as-is).
