---
priority: medium
---
# spec-merger RENAMED delta re-key silently loses a requirement on name collision: in src/finalize/spec-merger.ts (reconcileDelta RENAMED branch, ~lines 281-288 in the fix-finalize-dry-run-diverges-applying-run-spec worktree; same logic on main pre-refactor), renaming requirement A to a name that already exists as requirement B overwrites the Map entry — either the renamed body or the pre-existing section is dropped — and the merge still reports status clean. Silent data loss in the living spec store (spec/specs/), the framework's source of truth. Pre-existing behavior carried unchanged through the stage-then-commit refactor; found by the security reviewer of that change. Candidate fix: detect the collision in the compute phase and return a MergeConflict (rename-target-exists) instead of overwriting; needs a pinning test for RENAMED-onto-existing-name in both dry-run and apply modes.

**Captured**: 2026-08-18
**Status**: logged
**Severity**: minor

spec-merger RENAMED delta re-key silently loses a requirement on name collision: in src/finalize/spec-merger.ts (reconcileDelta RENAMED branch, ~lines 281-288 in the fix-finalize-dry-run-diverges-applying-run-spec worktree; same logic on main pre-refactor), renaming requirement A to a name that already exists as requirement B overwrites the Map entry — either the renamed body or the pre-existing section is dropped — and the merge still reports status clean. Silent data loss in the living spec store (spec/specs/), the framework's source of truth. Pre-existing behavior carried unchanged through the stage-then-commit refactor; found by the security reviewer of that change. Candidate fix: detect the collision in the compute phase and return a MergeConflict (rename-target-exists) instead of overwriting; needs a pinning test for RENAMED-onto-existing-name in both dry-run and apply modes.
