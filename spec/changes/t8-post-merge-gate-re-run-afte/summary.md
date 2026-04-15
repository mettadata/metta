# Summary: t8-post-merge-gate-re-run-afte

Last of the 5 shipped-research items from `docs/research/2025-04-15/SUMMARY.md`. Sibling to the recently-shipped `finalize-check`. Replaces the `MergeSafetyPipeline.run()` post-merge-gates STUB with real gate execution + snapshot rollback on failure.

## Files changed
- `src/ship/merge-safety.ts` — constructor accepts optional `GateRegistry`. Final step runs `gateRegistry.runAll(...)` against the merged working tree. On any failure: `git reset --hard <snapshotTag>` to rollback, add `rollback: pass` step, return `{status: 'failure', steps, snapshotTag}`. On rollback failure: mark `rollback: fail` with `manual intervention required` detail.
- `src/cli/commands/ship.ts` — loads built-in gates via `loadFromDirectory(...)` and passes the registry to the pipeline.
- `tests/merge-safety.test.ts` — 3 new cases (all-pass; one-fail-rollback; no-gates-configured); existing tests pass via no-registry back-compat path.

## Gates
- `npm run build` — PASS
- `npx vitest run` — **465/465 PASS** (was 462, +3 new)

## Behavior
After merge lands and ancestry is verified, post-merge-gates step runs the configured gate suite (build/lint/tests/typecheck) against the merged working tree:
- All pass → ship succeeds, working tree on merge commit, snapshot tag preserved.
- Any fail → roll back to snapshot SHA, ship returns failure with `<gate> failed; rolled back to <sha>` detail. Main never carries known-broken state.
- Rollback itself fails → loud surface; user must intervene manually.
- No registry / empty gate list → `pass` with `no gates configured` detail (backwards compat).

## Out of scope
- `--skip-post-merge-gates` flag (rejected per discovery).
- Auto-deleting snapshot tags after success.
- Configurable per-gate retry policy.
- Webhook/slack notifications.

## Together with finalize-check
finalize-check (just shipped) blocks ship of unfinalized work BEFORE merge. T8 catches regressions AFTER merge. Together they close the silent-broken-merge loop that motivated metta's existence.

All 4 task checkboxes flipped `[x]`.
