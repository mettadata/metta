# fix-metadata-write-path-drops-model-runs-array-between

## Problem

The instruction-time metrics stamp is not durable, and losing it silently corrupts the escalation-rate denominator that the model-tier design depends on.

When `metta instructions` emits an executor instruction, it stamps the change's `.metta.yaml` with `model_runs`, `artifact_timings.started`, and `artifact_tokens` (src/cli/commands/instructions.ts ~145-164, via `ArtifactStore.updateChange`). That write lands **uncommitted in the working tree**. During the implementation window, routine executor git hygiene — `git checkout -- .`, `git stash`, `git restore` run to clean the tree before atomic commits — can silently erase the uncommitted stamp. Later, `metta complete`'s auto-commit (src/cli/commands/complete.ts ~line 605, the only code path that auto-commits change state) permanently records the stampless file into history and the archive.

This is proven, not hypothetical: the change `2026-07-17-fix-metta-install-deploys-hooks-hardcoded-list-omitting` had a `model_runs` record observed live immediately after emission, yet its archived `.metta.yaml` contains zero `model_runs` entries. Git archaeology shows commit 261be5185's pre-image lacks all three stamp fields — working-tree-level loss, not a merge bug (`ArtifactStore.updateChange`'s fresh-read + shallow spread merge was ruled out by RCA on 2026-07-18). A sibling change survived only because an orchestrator happened to commit manually — a path no code produces.

Who is affected: anyone reading `metta progress` model-tier metrics. The dashboard currently reports "Model escalation rate: 50% (1/2)" when the truth is 1/3 — the denominator-integrity property that motivated instruction-side stamping is silently violated, and every future change whose stamp is erased degrades the metric further with no error or warning.

## Proposal

Make the instruction-time metrics stamp durable by auto-committing it at emission (candidate 1 from the RCA).

In src/cli/commands/instructions.ts, immediately after the existing best-effort `updateChange` in the stamp block, add a best-effort git auto-commit of **only the change's `.metta.yaml`**, mirroring the auto-commit mechanics complete.ts uses at ~line 605:

- Commit message pattern: `chore(<change>): record instruction emission`
- Gated on the `git.enabled` config flag — when git is disabled, no commit is attempted and the stamp is still written to disk
- Never-throw semantics — a commit failure MUST NOT break instruction emission; the stamp block stays best-effort end to end
- No empty commits — when the file has no diff (e.g. repeated emissions within the sliding window), skip the commit entirely

Tests (extend tests/instructions-model-emission.test.ts or a sibling test file):

1. Git-enabled fixture: after an executor emission, the `.metta.yaml` stamp is committed — git log shows the emission commit and the working tree is clean of the stamp diff
2. A second emission with no changes produces no empty commit
3. Git-disabled config: no commit attempted, stamp still written
4. The stamp survives a simulated `git checkout -- .` run after emission — the exact erasure vector from the incident

Expected tier: trivial/quick. One source file plus tests.

## Impact

- **`metta instructions` (executor emissions):** gains a small auto-commit side effect after stamping. Emission behavior is otherwise unchanged; commit failures are swallowed, so emission can never newly fail because of this change.
- **Git history:** each first emission for a change adds one `chore(<change>): record instruction emission` commit. Repeated emissions inside the sliding window add nothing (no-diff skip).
- **`metta progress` metrics:** escalation-rate numerator/denominator become trustworthy going forward — stamps can no longer be erased by working-tree cleanup between emission and `metta complete`.
- **`metta complete`:** unchanged. Its auto-commit at ~line 605 now records a `.metta.yaml` that already has the stamp safely in history.
- **`ArtifactStore.updateChange`:** unchanged — RCA cleared it; its fresh-read + shallow-merge behavior already preserves `model_runs` on partial patches.
- **Git-disabled projects:** behavior identical to today (stamp written to disk, no commit), so the durability gap remains theirs by configuration — acceptable, since without git there is no `checkout`-style erasure vector.

## Out of Scope

- **Candidate 2 — complete-time reconciliation:** re-deriving or repairing missing `model_runs` entries at `metta complete` time. Explicitly rejected in the RCA.
- **Candidate 3 — append-only journal:** moving metrics stamps to a separate append-only journal outside `.metta.yaml`. Explicitly rejected in the RCA.
- **Backfilling corrupted history:** repairing the already-archived stampless `.metta.yaml` for `2026-07-17-fix-metta-install-deploys-hooks-hardcoded-list-omitting` or recomputing past `metta progress` figures.
- **Changing `ArtifactStore.updateChange` merge semantics:** the write path was proven correct; no changes there.
- **Changing executor git-hygiene guidance:** we are not forbidding `git checkout -- .` / `git stash` / `git restore` in executor sessions; the fix makes the stamp immune to them instead.
- **Auto-committing any other change state at emission time:** the commit is scoped to the single change's `.metta.yaml` only.
