# Verification — t6-per-phase-context-budgeting

## Spec scenarios → tests

| Spec scenario | Test | Status |
|---|---|---|
| Intent budget = 50,000 | `tests/context-engine.test.ts` → "returns manifest for known artifact types" | PASS |
| Recalibrated per-phase budgets | `tests/context-engine.test.ts` → "exposes recalibrated per-phase budgets" | PASS |
| Stories required=[intent], spec required=[intent, stories] | `tests/context-engine.test.ts` → "stories required includes intent..." | PASS |
| `warning: null` at <80% util | `tests/context-engine.test.ts` → "under-80% load returns warning null..." | PASS |
| `warning: 'smart-zone'` at 80–100% | `tests/context-engine.test.ts` → "smart-zone warning when utilization is 80-100%" | PASS |
| `warning: 'over-budget'` + drop | `tests/context-engine.test.ts` → "drops optional file and records it..." | PASS |
| Skeleton-fallback loads optional | `tests/context-engine.test.ts` → "loads optional with skeleton strategy..." | PASS |
| Instructions JSON omits warning under 80% | `tests/instruction-generator.test.ts` → "omits budget.warning when utilization is under 80%" | PASS |
| Instructions JSON surfaces over-budget | `tests/instruction-generator.test.ts` → "surfaces over-budget warning and dropped_optionals..." | PASS |
| Context stats JSON shape + recommendation | `tests/context-stats.test.ts` → "emits JSON with per-artifact utilization..." | PASS |
| Fan-out recommendation for execution over-budget | `tests/context-stats.test.ts` → "recommends fan-out for execution..." | PASS |
| Split-phase recommendation for design over-budget | `tests/context-stats.test.ts` → "recommends split-phase for non-execution..." | PASS |
| Non-zero exit when no active changes | `tests/context-stats.test.ts` → "exits non-zero when --change not provided..." | PASS |
| --artifact scopes output | `tests/context-stats.test.ts` → "scopes output to --artifact when provided" | PASS |
| Text-mode table output | `tests/context-stats.test.ts` → "prints a human-readable table in text mode" | PASS |

## Gates

| Gate | Command | Result |
|---|---|---|
| Build | `npm run build` | PASS |
| Typecheck | `npx tsc --noEmit` | PASS (no errors) |
| Lint | `npm run lint` | PASS (no output) |
| Tests | `npx vitest run` | PASS — **479 / 479** |

## User story coverage

- **US-1** (see context utilization via `metta context stats`) — covered by 6 context-stats tests.
- **US-2** (automatic smart-zone warning in instructions) — covered by 2 instruction-generator tests + warning derivation in context-engine.
- **US-3** (section filtering stays under budget) — covered by skeleton-fallback test. `strategy: 'skeleton'` visible on LoadedFile preserves transparency.

## Outcome

All spec scenarios map to passing tests. All gates green. Test count 465 → 479 (+14). Implementation matches design.md. Ready to finalize.
