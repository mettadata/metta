# metta-propose has no flag to stop after planning artifacts

**Captured**: 2026-04-28
**Status**: logged
**Severity**: minor

## Symptom
The `/metta-propose` skill runs the full change lifecycle — intent, stories, spec, research, design, tasks, implementation, review, verification, finalize, merge — end-to-end with no built-in pause point. There is no flag (e.g. `--stop-after-plan` or `--stop-after <artifact>`) that lets the orchestrator create the change, complete the planning artifacts, and exit so the user can review the diffs before resuming with implementation. `/metta-plan` cannot fill this gap because it only operates on an already-active change and cannot create one. Today's workaround is to embed pause instructions in the propose description, which is lossy and depends on the orchestrator following ad-hoc text.

## Root Cause Analysis
The propose pipeline has two layers — the CLI command (`src/cli/commands/propose.ts`) and the skill orchestration (`.claude/skills/metta-propose/SKILL.md`) — and neither layer exposes a planning/execution boundary. The CLI command accepts `--workflow`, `--from-gap`, `--from-idea`, `--from-issue`, `--discovery`, and `--auto`, but no `--stop-after` option; it just creates the change record and returns. The real lifecycle driver is the skill: its Steps 3 (planning artifacts), 5 (implementation), 6 (review), and 7 (verification) run as a single linear sequence with no early-exit branch between Step 3 (planning artifacts complete and committed) and Step 5 (implementation begins). The fragmented lifecycle skills (`metta-execute`, `metta-verify`, `metta-ship`) exist for resumption — `metta-execute` Step 1 simply checks `metta status` to confirm implementation is ready — so the resumption side already works. What's missing is the explicit gate in `/metta-propose` to stop at that boundary in the first place.

### Evidence
- `src/cli/commands/propose.ts:14-19` — defines the propose CLI options; no `--stop-after` or equivalent boundary flag exists alongside `--workflow`, `--from-gap`, `--from-idea`, `--from-issue`, `--discovery`, `--auto`.
- `.claude/skills/metta-propose/SKILL.md:66-117` — Step 3 produces planning artifacts then Step 5 immediately begins parallel implementation in the same orchestrator session; nothing between them inspects a stop-after flag or hands control back to the user.
- `.claude/skills/metta-execute/SKILL.md:12-22` — `/metta-execute` Steps 1-6 are fully self-contained (status check, read tasks, run batches, write summary, complete) and do not require additional propose state, confirming a clean resume point already exists if propose stopped after tasks.

## Candidate Solutions
1. **Add `--stop-after <artifact>` to `metta propose` and the propose skill.** The CLI accepts and stores the stop point in change metadata; the skill orchestrator checks the value after each `metta complete <artifact>` call in Step 3 and exits cleanly when the named artifact is reached, printing the resume command (`/metta-execute` for stop-after-tasks, or `/metta-plan` to inspect status). Tradeoff: the artifact name space is workflow-dependent (the `full` workflow uses different stages), so the flag value must be validated against the loaded workflow's `buildOrder`, adding a small amount of cross-layer coupling.
2. **Add a sugar `--stop-after-plan` boolean alias.** Same mechanism as Option 1 but expressed as a single boolean that resolves to "stop after the last planning artifact in the workflow's planning phase" (e.g. `tasks` for standard, the last pre-implementation stage for `full`). Tradeoff: hides which artifact is actually the boundary, so users debugging an unexpected exit must consult docs to learn what "plan" maps to in their workflow; less expressive than Option 1.
3. **Split `/metta-propose` into `/metta-propose-plan` and `/metta-propose-build` skills.** Reviewers run the first to get all planning artifacts, review the diffs, then run the second (or `/metta-execute`) to drive implementation. Tradeoff: doubles the skill surface area, breaks muscle memory for users who want the existing one-shot behavior, and requires every orchestrator/agent reference and CLAUDE.md table to be updated; the same review gate is achievable with a flag at far lower cost.

