# Summary: fix-issue-metta-ship-merged-fi

Fixes critical issue `metta-ship-merged-a-branch-even-though-metta-finalize-failed.md` (severity: critical). Discovered while shipping T5 — finalize gate failed but ship merged anyway.

## Files changed
- `src/ship/merge-safety.ts` — added `finalize-check` as the first step in `MergeSafetyPipeline.run()`. Strips `metta/` prefix; globs `spec/archive/*-<change>/`. Skip on non-metta branches. Fail-fast if no archive entry exists, before any git operations.
- `tests/merge-safety.test.ts` — 3 new tests (no archive → fail; archive → pass; non-metta → skip). Existing happy-path test loosened to accept `skip` for `finalize-check` step.

## Gates
- `npm run build` — PASS
- `npx vitest run` — 460/460 PASS (was 457, +3 new)

## Behavior
- `metta ship --branch metta/<name>` now refuses to merge if `spec/archive/*-<name>/` doesn't exist. Message: `change not finalized — run metta finalize --change <name> first`.
- Non-metta branches (e.g. `feature/foo`) bypass the check and ship normally — preserves backwards compat.
- Pipeline aborts before any git operation when finalize-check fails — no checkout, no merge attempt, no snapshot tag.

## Out of scope
- Reverting T5's already-shipped merge (the underlying violation was fixed in a follow-up commit; T5 works in production).
- `--force-unfinalized` flag to bypass.
- Auto-running finalize from ship.
