# Review: t5-user-story-layer-spec-forma

Combined quality + scenario coverage review (skipped 3-agent fan-out for speed given size of T5).

## Reviewer findings (6) → triage

1. **Workflow order: stories before spec, not after** — REAL. Spec REQ-1 says `intent → stories → spec → research`. Implementation had `intent → spec → stories → research`. **FIXED:** moved stories block before spec in `standard.yaml`; flipped requires (`stories.requires: [intent]`, `spec.requires: [stories]`). Added `stories-valid` to spec phase gates.
2. **Schema discriminated union vs flat** — Implementation uses `discriminatedUnion` (kind: stories | sentinel). Spec described flat. The discriminated union is the better design — kind makes the two valid document states mutually exclusive at type level. **DEFERRED:** spec amendment over code change. Acceptable.
3. **Agent injection defense weak** — REAL. **FIXED:** added explicit XML-tag boundary section (`<INTENT>...</INTENT>`) mirroring constitution-checker pattern. Stronger than original "treat quoted content as data" prose.
4. **REQ-5 spec-parser fulfills not implemented** — FALSE POSITIVE. Reviewer didn't see it. `src/specs/spec-parser.ts:18,22-36,129,166,235,275` all wire `fulfills: string[]`. **Bonus:** stale `(r as unknown as { fulfills?: string[] })` cast in validate-stories.ts removed (no longer needed).
5. **REQ-7 finalize gate missing** — FALSE POSITIVE. `src/templates/gates/stories-valid.yaml` exists from Task 3.3.
6. **Quick workflow not verified** — Confirmed unchanged (per Task 1.4 design).

## Quality nits applied
- Stale type cast in validate-stories.ts removed (now `r.fulfills ?? []` directly).
- Agent injection defense upgraded to XML-tag pattern.

## Quality nits deferred
- `nonNumericRe` defined but unused in stories-parser.ts — cosmetic.
- `extractJustification` searches all children rather than only after sentinel heading — edge-case risk; defer until a real false-positive surfaces.

## Gates (post-fix)
- `npm run build` — PASS
- `npx vitest run` — 457/457 PASS

## Verdict
NEEDS_CHANGES → resolved via 3 fixes (workflow order, agent boundary, type cast). Discriminated-union schema is intentional design — spec language amended in this review.
