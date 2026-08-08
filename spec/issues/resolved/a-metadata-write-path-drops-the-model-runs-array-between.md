# A metadata write path drops the model_runs array between emission and archive, corrupting the escalation-rate denominator

**Captured**: 2026-07-18
**Status**: resolved
**Severity**: major

## Symptom

The change `2026-07-17-fix-metta-install-deploys-hooks-hardcoded-list-omitting` had a `model_runs` record stamped at instruction time (observed live in `spec/changes/<name>/.metta.yaml` immediately after emission), but its archived `.metta.yaml` contains zero `model_runs` entries, while sibling changes `2026-07-17-fix-two-cli-paper-cuts` and `2026-07-18-fix-two-agent-tooling` retained theirs. As a result `metta progress` reports "Model escalation rate: 50% (1/2)" when the truth is 1/3 — silently corrupting the denominator-integrity property the model-tier design built instruction-side stamping for.

## Root Cause Analysis

The suspected write-path bug (a metadata writer replacing the whole object and dropping optional arrays) is ruled out: `ArtifactStore.updateChange` does a fresh `getChange()` read then a shallow top-level spread merge, so any partial patch that omits `model_runs` preserves it; every caller in `complete.ts`, `iteration.ts`, and `model-escalation.ts` passes a partial patch; `markArtifact` re-reads the full metadata before writing; and `ChangeMetadataSchema` declares `model_runs` as a known optional key, so Zod round-trips it intact. The real defect is a durability gap: the instruction-time stamp is written to the working tree but never committed by any code path. Git archaeology proves it — commit `261be5185` ("complete implementation") has a pre-image that lacks not just `model_runs` but ALL THREE fields written by the same instruction-time `updateChange` (`artifact_timings.implementation.started` and `artifact_tokens.implementation` are also absent), meaning the entire stamp write was reverted from the working tree between emission (22:08:35) and complete (22:18:37). During that window the executor made commit `475965dc6` touching only `src/` and `tests/`; a working-tree revert (e.g. `git checkout -- .`, `git stash`, or `git restore` run by the executor agent to clean the tree before its atomic commit) silently destroyed the uncommitted stamp, and `metta complete`'s auto-commit then blessed the reverted file as truth. The surviving changes confirm this: `fix-two-cli-paper-cuts` only retained its `model_runs` because a separate manual commit `f25c4b65a` ("chore(...): state update") captured the stamp before anything could clobber it — no code path produces that commit (the string "state update" appears nowhere in `src/` or `.claude/`). The stamp's only durability today is surviving uncommitted through the entire implementation window, which is exactly when the executor is most actively running git operations. A secondary hazard: `instructions.ts` computes `updates.model_runs` from a metadata snapshot read at command start, so a concurrent stamp between read and write would be overwritten — but that produces a stale array, not an empty one, and is not the cause here.

### Evidence

- `src/cli/commands/instructions.ts:145` — the stamp (`artifact_timings`, `artifact_tokens`, `model_runs`) is written via `updateChange` with no accompanying git commit; all three fields from this single write are missing from the corrupted change's committed history, proving the loss happened at working-tree level, not in any per-field write path.
- `src/cli/commands/complete.ts:605` — the only auto-commit of change state (`git add spec/changes/<name>`) runs at complete time, committing whatever the working tree holds then; if the uncommitted stamp was reverted during implementation, complete permanently records the stampless file.
- `src/artifacts/artifact-store.ts:80` — `updateChange` re-reads current metadata and shallow-merges the patch, so partial patches omitting `model_runs` cannot erase it; this exonerates the suspected merge-semantics bug in the post-implementation scoring writes.

## Candidate Solutions

1. **Commit the stamp at emission time** — After the best-effort `updateChange` in `instructions.ts` (line 164), auto-commit `spec/changes/<name>/.metta.yaml` using the same guarded `git add` + `git diff --cached --quiet || git commit` pattern `complete.ts:605` already uses (message e.g. `chore(<name>): stamp <artifact> instructions`). The stamp becomes durable the moment it exists, immune to any later working-tree revert, and the fix touches one file. Tradeoff: adds one commit per artifact emission to the change's history, and turns `instructions` — today a read-mostly command — into one that creates commits, which may surprise callers running it purely for inspection (the existing ready/in_progress status guard limits but does not eliminate this).

2. **Reconcile at complete time** — In `complete.ts`'s `implementation` branch, re-resolve the executor model from `.metta/config.yaml` (the same resolution `instructions.ts` performs) and append a `model_runs` record if none exists for the task, before the auto-commit. Tradeoff: duplicates model-resolution logic in a second command, records a potentially wrong model if config changed mid-change, and silently masks the underlying durability gap — `artifact_timings.started` and `artifact_tokens` would still be lost.

3. **Append-only journal outside the working tree** — Write model-run records to an append-only store not subject to working-tree reverts (e.g. `.metta/` project-local state or git notes), and have `ceremony-metrics.ts` read the journal alongside archived metadata. Tradeoff: splits change metadata across two stores, complicates the escalation-rate read path and the archive story, and is significantly more machinery than the one-commit fix in option 1.

## Resolution

**Resolved**: 2026-08-08 (stale-issue sweep)

Fixed: instructions.ts auto-commits the emission stamp (chore: record instruction emission), so model_runs survives executor git hygiene; observed working on today's changes.
