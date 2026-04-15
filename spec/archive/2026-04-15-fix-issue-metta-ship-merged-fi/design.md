# Design: fix-issue-metta-ship-merged-fi

## Approach
Add `finalize-check` as the first step of `MergeSafetyPipeline.run()` in `src/ship/merge-safety.ts`. Skip when source branch isn't a metta change branch; otherwise glob `spec/archive/*-<change>/` and fail fast if zero matches.

## Components
- `src/ship/merge-safety.ts` — modify `run()`. Add ~15 lines at the top.
- `tests/merge-safety.test.ts` — add 2-3 cases:
  1. metta/foo with no archive → failure, no git ops
  2. metta/foo with archive → step pass, advances
  3. non-metta/foo branch → skip, advances

## Data Model / API Design
None.

## Dependencies
None new. `node:fs/promises.readdir` already imported.

## Risks
- Risk: archive directory naming convention drift (date prefix format changes). Mitigation: glob is loose — `*-<change>/`.
- Risk: existing tests that use branch names like `feature` get the skip path — no behavior change for them. Verified.

## Test Strategy
Add 3 cases to `tests/merge-safety.test.ts`. Use existing tmp-dir fixture pattern.
