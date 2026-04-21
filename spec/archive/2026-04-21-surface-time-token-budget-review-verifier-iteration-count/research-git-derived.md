# Approach: Git-derived metrics only (no schema change)

## Summary

Do not touch `ChangeMetadataSchema` at all. Compute everything at read
time:

- **Artifact wall-clock** from `git log -- spec/changes/<change>/<artifact>.md`
  — earliest commit to latest commit.
- **Token budget** from re-running `context-engine` against each artifact's
  on-disk content (using `countTokens`) at read time, plus re-computing
  the budget from the workflow definition.
- **Review/verify iteration counts** from grepping git log for commits
  whose messages match a convention (e.g. `review-fix(<change>):` or
  `verify-fix(<change>):`).

## Pros

- **Zero schema change.** No new fields, no migration concerns, no write
  paths to update. Only renderers change.
- **Retroactive coverage.** All existing archived changes get the new
  surface for free, as long as their git history is intact.
- **Single source of truth is already git.** Matches the stated
  architecture ("git as the transaction log").

## Cons

- **Iteration counts depend on a commit message convention that does not
  exist.** Skill templates today do not emit "review-fix" commits with a
  distinctive prefix; reviewer agents often don't commit at all (the
  orchestrator commits the merged `review.md`). We would have to
  introduce the convention **and** enforce it, which is a larger change
  than just incrementing a counter.
- **Token budget is not recoverable from git.** The `budget_tokens`
  number the renderer wants is the budget **at the time of the
  instructions call**, which depends on the workflow definition and
  context-engine inputs **at that moment**. Re-running at read time may
  give a different answer (the workflow YAML could have changed, the
  project constitution text could have grown). We'd show a number, but
  it would not be "what the user saw when they ran `metta
  instructions`."
- **Wall-clock is noisy.** `git log` timestamps are the author/committer
  time; for artifacts the user edited, reopened hours later, and
  committed, "duration" would be measured from first commit to last
  commit — not authoring time. For a change with a single commit per
  artifact (common), duration is undefined or zero.
- **Performance.** `metta progress` today is one YAML read per change.
  This approach turns it into (commits × artifacts) git calls per
  change. For a project with 30 active and archived changes, progress
  becomes a perceptibly slower command.
- **Re-computing token estimates at read time means renderers need the
  full context-engine**, which is much more code than reading a number
  from a YAML file.

## Fit with existing code

- `progress.ts` would grow a sizeable `execFile('git', ...)` surface.
- `status.ts` would likewise.
- Nothing in `complete.ts` or `instructions.ts` would change — which is
  the entire argument for this approach, but also its weakness: the
  iteration counters are genuinely not discoverable without new
  convention.

## Complexity

**Medium-to-high** despite the "no schema change" pitch: the renderers do
a lot more work, we'd need to build and enforce a commit-message
convention, and the token-budget number would be approximate / wrong.

## Recommendation

**Rejected for the primary path.** Good as a fallback for timings only
(Approach A explicitly incorporates the git-log fallback for legacy
changes without `artifact_timings`), but insufficient for tokens and
iterations on its own.
