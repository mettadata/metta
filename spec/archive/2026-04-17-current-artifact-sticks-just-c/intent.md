# current-artifact-sticks-just-c

## Problem

`current_artifact` in `.metta.yaml` permanently lags behind the actual active stage
after any intermediate `metta complete` call.

In `src/artifacts/artifact-store.ts`, `markArtifact()` only advances `current_artifact`
when the incoming status is `'in_progress'` or `'complete'`:

```typescript
if (status === 'in_progress' || status === 'complete') {
  metadata.current_artifact = artifactId
}
```

In `src/cli/commands/complete.ts`, the complete command issues two sequential calls:

1. `markArtifact(change, artifactId, 'complete')` — sets `current_artifact` to the
   just-completed artifact (correct at this instant).
2. `markArtifact(change, nextId, 'ready')` — transitions the next artifact to `'ready'`
   but does NOT match the conditional, so `current_artifact` is never updated.

No other code path transitions artifacts to `'in_progress'` in the current lifecycle;
the real progression is `pending → ready → complete`. The result is that after every
intermediate completion, `current_artifact` stays pinned to the artifact that was just
finished rather than advancing to the next artifact that is now `'ready'`.

Observed symptoms on a standard workflow change:

- After `metta complete intent`: statusline displays `[metta: intent]` even though
  `stories` is now `ready` and is the active stage.
- After `metta complete stories`: statusline displays `[metta: stories]` even though
  `spec` is now `ready`.
- The pattern repeats for every non-terminal stage — always one stage behind.

The statusline reads `current_artifact` directly from `metta status --json`
(`src/templates/statusline/statusline.mjs` lines 95-96), so the stale value surfaces
in every shell prompt during the change lifecycle. `metta status` JSON output is equally
wrong, giving contributors and orchestrators false signal about which stage is active.

## Proposal

Expand the guard in `markArtifact()` in `src/artifacts/artifact-store.ts` to also fire
when status becomes `'ready'`:

```typescript
if (status === 'ready' || status === 'in_progress' || status === 'complete') {
  metadata.current_artifact = artifactId
}
```

This is correct because `metta complete` always calls `markArtifact(next, 'ready')`
AFTER `markArtifact(current, 'complete')`. The final write wins, so `current_artifact`
ends up on the next artifact. On the terminal completion (e.g., `verification`) there is
no next artifact, so `markArtifact(next, 'ready')` is never called and `current_artifact`
correctly remains on `verification` as the terminal state.

The change is a single-line conditional expansion. No schema changes are required —
`current_artifact` is already typed as `z.string()` and the artifact IDs written to it
are unchanged. No callers of `markArtifact()` require updates; the fix is wholly
internal to the method's guard logic.

## Impact

- `src/artifacts/artifact-store.ts`: one line changed (the guard conditional).
- Statusline in every shell prompt reflects the correct active stage immediately after
  each `metta complete` call.
- `metta status --json` `.current_artifact` matches the artifact the operator or
  orchestrator should be acting on.
- Any existing test that asserts `current_artifact === lastCompletedArtifactId` after
  completing an intermediate (non-terminal) stage will break. These tests must be
  updated to assert `current_artifact === nextReadyArtifactId` instead. Verification
  must enumerate and fix all such cases.

## Out of Scope

- Introducing a formal `'in_progress'` transition into the active lifecycle. Artifacts
  continue to follow `pending → ready → complete`; the `'in_progress'` enum value
  remains defined in the schema for future use but is not wired into the workflow.
- Making `current_artifact` nullable or optional in `ChangeMetadataSchema`. The field
  stays `z.string()` and its semantics (points to the most-recently-activated artifact)
  are preserved.
- Changing the order or shape of calls in `src/cli/commands/complete.ts`. The fix lives
  entirely in `markArtifact()`.
- Modifications to the statusline template (`statusline.mjs`). The template already
  reads `current_artifact` correctly; fixing the source value is sufficient.
- Handling `'failed'` or `'skipped'` artifact transitions — those statuses are out of
  scope for `current_artifact` tracking and remain unaffected by this change.
