# spec/specs/claude-statusline/spec.md contains a full duplication of all requirements (same corruption family as the previously-fixed adaptive-workflow-tier-selection duplication) — discovered during fix-statusline-reports-idle-while-forked-work-running (PR #71), which had to update both duplicated copies of the requirements it touched and flagged the cleanup as out of scope. Deduplicate the file, verify requirement counts in CLAUDE.md regenerate correctly afterward, and check whether the spec merger's append path can still produce this (the suspected mechanism from the earlier incident) or whether this is legacy corruption predating the merger fix.

**Captured**: 2026-08-11
**Status**: logged
**Severity**: minor

## Symptom

`spec/specs/claude-statusline/spec.md` contains two byte-identical copies of all 9 requirements — 18 `## Requirement:` headers across 510 lines, with the second copy starting at line 258 (`diff` of lines 2–256 vs 257–510 shows the halves are identical apart from the H1). This is the same corruption family as the previously-fixed adaptive-workflow-tier-selection duplication. It was discovered during fix-statusline-reports-idle-while-forked-work-running (PR #71), which had to apply its edits to both duplicated copies of the requirements it touched and flagged the cleanup as out of scope. The duplication also inflates the claude-statusline requirement count reported in CLAUDE.md (currently 86).

## Root Cause Analysis

This is legacy corruption predating the spec-merger idempotency fix, not a live bug in the current append path. The file was born duplicated: at commit d04ea8481 (`chore(custom-claude-statusline-conte): archive and finalize`) the newly created capability spec already had 440 lines and 18 requirement headers — two full copies of the 9 requirements. At that time `SpecMerger.applyDelta` unconditionally appended ADDED deltas, so a repeated finalize/merge pass appended the entire requirement set a second time — the exact mechanism behind the earlier adaptive-workflow-tier-selection incident. The idempotent-ADDED guard (14f66b6fb "idempotent ADDED merges in spec-merger", building on dda391097's applyDelta rewrite) landed only afterwards: `git merge-base --is-ancestor` confirms 14f66b6fb is not an ancestor of d04ea8481. The current merger splits the target spec by requirement header and returns `'noop'` when an ADDED delta's requirement name already exists, so today's append path cannot reproduce this. What remains is data cleanup: dedupe the file, refresh the capability's spec.lock, and regenerate CLAUDE.md so requirement counts are correct.

### Evidence

- `spec/specs/claude-statusline/spec.md:258` — second `## Requirement: Statusline script stdin contract` header; lines 257–510 are a byte-identical repeat of lines 2–256.
- `src/finalize/spec-merger.ts:177` — the ADDED path now checks `sections.has(delta.requirement.name)` and returns `'noop'`, making re-merges idempotent; the corrupting append behavior no longer exists.
- git history — the spec was created already duplicated at finalize commit d04ea8481, which predates idempotency fix 14f66b6fb (2026-07-15); merge-base check confirms the fix is not an ancestor of the corrupting commit, dating this as pre-fix legacy corruption.

## Candidate Solutions

1. **Targeted dedupe change** — Route through /metta-fix-issues: delete the duplicated block (lines 257–510), regenerate the claude-statusline spec.lock via the lock manager, then run the refresh flow so CLAUDE.md requirement counts regenerate from the deduped spec. Tradeoff: one-off manual fix that does not tell us whether any other capability spec carries the same latent duplication.

2. **Repo-wide duplication audit plus dedupe** — Script a scan of every `spec/specs/*/spec.md` for repeated requirement names, dedupe all hits in one change, and refresh locks and CLAUDE.md once. Tradeoff: broader blast radius and more review effort for what may turn out to be a single corrupted file.

3. **Duplicate-requirement gate** — Add a gate-runner check that fails finalize/verify when a capability spec contains duplicate `## Requirement:` names, preventing silent recurrence from any future merger regression. Tradeoff: adds gate surface to maintain and does not by itself repair the existing corrupted file, so it must be paired with option 1 or 2.

