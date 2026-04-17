# Summary: current-artifact-sticks-just-c

## What changed

`markArtifact()` in `src/artifacts/artifact-store.ts` now updates `current_artifact` when a stage transitions to `ready` (in addition to `in_progress` and `complete`). This fixes the statusline / `metta status --json` showing the previous stage after completing one — it now advances to the next stage as soon as `metta complete` marks it ready.

## Files modified

- `src/artifacts/artifact-store.ts` — one-line conditional expansion
- `tests/artifact-store.test.ts` — added regression test + negative test (pending/failed/skipped don't move the pointer)
- `spec/specs/artifact-store/spec.md` — updated Requirement text and added "Mark next artifact ready advances current_artifact" Scenario to match the corrected semantics

## Verification

- `npx tsc --noEmit`: clean
- `npm test`: all pass (527 before + 2 new = 528)
- Live end-to-end smoke test: `metta propose` + `metta complete intent` → `current_artifact` correctly advances `intent → stories`. Previously stuck on `intent`.

## User-facing impact

- Statusline (`[metta: <stage>] <ctx>%`) now shows the *current* active stage, not the last-completed one
- `metta status --json` `current_artifact` field reflects reality
- `metta progress` and `metta plan` displays corrected automatically (they read the same field)

## Non-goals

- No change to the artifact lifecycle (still `pending → ready → complete`, no `in_progress` step)
- No change to statusline template
- No handling of `current_artifact` during `pending`/`failed`/`skipped` demotions (deferred; no code path currently writes those statuses during normal lifecycle)
