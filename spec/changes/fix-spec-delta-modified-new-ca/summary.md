# Summary: fix-spec-delta-modified-new-ca

## What changed

`metta complete spec` now parses the change's delta spec via `parseDeltaSpec`, derives the target capability name (matching `spec-merger.ts` logic), and rejects any `MODIFIED`/`REMOVED`/`RENAMED` delta that targets a capability with no existing `spec/specs/<name>/spec.md`. The error message suggests the likely fix (`ADDED:` instead of `MODIFIED:`).

## Files modified

- `src/cli/commands/complete.ts` — added pre-complete spec-delta validation branch (fires on `artifactId === 'spec'`)
- `tests/cli.test.ts` — 3 new tests: MODIFIED-rejects-for-unknown-capability, ADDED-accepts, MODIFIED-with-existing-capability-passes

## Resolves

- `spec-deltas-use-modified-for-new-capabilities-finalize-fails` (major)

## Verification

- `npx tsc --noEmit`: clean
- `npm test`: 547/547 pass

## Latent bug surfaced (not fixed)

The executor noted that `parseSpec` is called with a file path (instead of markdown content) in at least two other places — `complete.ts` (previously) and `validate-stories.ts:72`. This silently produces empty requirements; any `fulfills:` refs go unvalidated. Worth logging as a follow-up issue.
