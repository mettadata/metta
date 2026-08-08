# spec/specs/adaptive-workflow-tier-selection/spec.md contains a large duplicated block of requirements — roughly lines 139-339 repeated verbatim around lines 462-655+. Found 2026-07-13 by the proposer agent while authoring the delta spec for change enforce-workflow-tier-routing-so-ceremony-actually-scales, which merges into this capability at finalize — so the corruption should be cleaned before that ship to avoid compounding it or double-matching MODIFIED requirements. Likely cause worth investigating during RCA: the spec merger appending instead of replacing on some earlier merge (this capability has been merged into repeatedly; it carries 309 requirements per CLAUDE.md, plausibly inflated by the duplication). Fix should deduplicate the file and, if the merger append bug is confirmed, log/fix that separately or fold it into the fix.

**Captured**: 2026-07-13
**Status**: resolved
**Severity**: minor

## Symptom

`spec/specs/adaptive-workflow-tier-selection/spec.md` contains large verbatim-duplicated blocks of requirements (reported as roughly lines 139-339 repeated around lines 462-655+). Inspection shows the corruption is fourfold, not twofold: every one of the capability's 13 unique requirements (`ComplexityScoreComputation`, `TierThresholds`, `StatusCommandSurface`, etc.) appears exactly 4 times, for 52 `## Requirement:` headings in a 1428-line file. This inflates the capability's requirement count (reported as 309 in CLAUDE.md) and risks double-matching MODIFIED deltas when the in-flight change `enforce-workflow-tier-routing-so-ceremony-actually-scales` merges into this capability at finalize.

## Root Cause Analysis

The duplication was produced by re-running `metta finalize` for the archived change `2026-04-19-adaptive-workflow-tier-selection-emit-complexity-score-after`. That change's delta spec contains each of the 13 requirements exactly once, all as `## ADDED:` operations, yet the merged capability file gained exactly 4 copies in a single commit: `eb35f7895` added 1292 lines onto the 136-line rubric doc from `cba91710a`, and 1292 / 4 = 323 lines — one full merge pass of the 13-requirement delta, applied four times before the archive commit landed.

Three code paths conspire to allow this. First, `Finalizer.finalize()` applies the spec merge to disk (step 1-2) before running quality gates (step 2), and when gates fail it returns early without rolling back the already-written merge — so every retried finalize re-applies the delta. Second, `SpecMerger.applyDelta()`'s ADDED branch blindly appends the requirement to the capability file with no check for whether a section with that name already exists, even though the function's docstring claims idempotency (the MODIFIED/RENAMED/REMOVED branches are idempotent via the section-keyed map; ADDED is not). Third, the base-version conflict guard that would otherwise flag the re-merge is skipped entirely, because this change created the capability's requirements, so `metadata.base_versions` carries no entry for `adaptive-workflow-tier-selection/spec.md` and the `baseVersion && currentHash` precondition is falsy — every re-run merges "clean". Four non-dry finalize invocations (e.g. gate failures on earlier attempts) therefore each appended all 13 requirements, and the final successful run committed the accumulated file.

### Evidence

- `src/finalize/spec-merger.ts:147` — the ADDED branch does `content += ...` with no already-exists check against `splitRequirements(content)`, so re-applying the same ADDED delta duplicates the requirement despite the idempotency claim in the docstring at line 136.
- `src/finalize/finalizer.ts:75` — on gate failure the finalizer returns early after `merger.merge()` has already written specs to disk at line 50, leaving un-rolled-back merge output that a retry appends onto again.
- `src/finalize/spec-merger.ts:80` — the conflict check requires `baseVersion && currentHash`; a capability first populated by the change itself has no `base_versions` entry, so `baseVersion` is undefined and the duplicate-detecting conflict path is never reached on re-runs.

## Candidate Solutions

1. **Deduplicate the file and make ADDED idempotent** — Clean `spec/specs/adaptive-workflow-tier-selection/spec.md` down to one copy of each of the 13 requirements (keeping the rubric preamble), regenerate the spec lock, and change `applyDelta`'s ADDED branch to use `splitRequirements()` like the other operations: if a section with the requirement's name already exists, replace it (or no-op) instead of appending, making the documented idempotency true. Tradeoff: a silent replace could mask a genuine name collision where two different changes legitimately ADD distinct requirements under the same name; surfacing that case as a conflict adds a little more logic.

2. **Reorder finalize so gates run before the merge writes** — Run `merger.merge()` with `dryRun: true` for conflict detection, run gates, and only apply the merge to disk after gates pass, so a failed finalize never leaves half-applied spec state to be re-appended by a retry. Tradeoff: larger behavioral refactor of the finalize pipeline (gates that inspect merged specs would break), and it does not by itself fix the non-idempotent ADDED append, so a crash between merge and archive could still corrupt on retry.

3. **Cleanup plus a duplicate-detection gate** — Deduplicate the file now and add a finalize/post-merge gate that fails when any capability spec contains two `## Requirement:` headings with the same name, catching future recurrences without touching merge semantics. Tradeoff: detection rather than prevention — the merger stays non-idempotent, and the gate fires after corruption is written, requiring manual cleanup each time it triggers.


## Resolution

**Resolved**: 2026-08-08 (stale-issue sweep)

Fixed by the v0.2 spec store reset: file deduplicated (109 requirements, no repeated blocks; verified via uniq sweep 2026-08-08).
