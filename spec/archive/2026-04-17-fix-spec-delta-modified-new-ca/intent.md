# fix-spec-delta-modified-new-ca

## Problem

When a change's `spec.md` uses `## MODIFIED: Requirement: <name>` (or `REMOVED:` / `RENAMED:`) against a capability that doesn't exist yet in `spec/specs/`, the error only surfaces at `metta finalize` time — via `spec-merger.ts:63-72` returning a conflict with reason `"Capability '<name>' does not exist"`. The human-readable finalize output may not make it obvious what the author did wrong, and at that point the change has already gone through research/design/tasks/implementation/review/verification — many commits spent on a spec that was malformed from the start.

## Proposal

Add a pre-complete validation pass for the `spec` artifact (same pattern as Batch A's stories-valid pre-complete gate in `complete.ts`):

1. When `artifactId === 'spec'`, parse the change's `spec.md` via the existing `parseSpec` machinery.
2. For each delta with operation `MODIFIED` / `REMOVED` / `RENAMED`, derive the target capability name (same logic as `spec-merger.ts:48`).
3. Check whether `spec/specs/<capability>/spec.md` exists. If not, throw a clear error with the intended fix: `Delta targets unknown capability '<name>'. Did you mean 'ADDED: Requirement: <name>'?` (the operation name is the single most-obvious fix in 99% of cases).
4. If all deltas are `ADDED`, or all `MODIFIED`/`REMOVED`/`RENAMED` targets exist, the check passes.

## Impact

- `src/cli/commands/complete.ts` — extend the existing pre-complete validation block (added in batch A) to include spec-delta validation when `artifactId === 'spec'`.
- `tests/cli.test.ts` — new test cases: bad MODIFIED targeting unknown capability fails, ADDED for new capability passes, MODIFIED for existing capability passes.
- No schema changes. No change to finalize or spec-merger (defense-in-depth).

## Out of Scope

- Auto-converting MODIFIED → ADDED (leave as a suggestion in the error, not an automatic rewrite — spec edits stay author-intended).
- Validating spec syntax beyond capability existence (the existing `parseSpec` covers that).
- Changes to merge-safety or finalize's error output.
