# fix-metta-propose-runs-entire-lifecycle-through-finalize

## Problem

`/metta-propose` runs the entire change lifecycle through finalize, push, PR creation, CI watch, and **merge to main** with no default stop point. A verb named "propose" autonomously ships and lands code without user consent. This was observed twice: the zeus session's per-DEX-switch change (PR #28, 2026-08-19) and the metta repo's backlog/milestones rework (PR #85) — in both cases the orchestrator expected intent/spec artifacts and at most an open PR, and instead got a merged branch.

Root cause is confirmed as deliberate design, not a wiring bug. The stop-after boundary check IS honored by the fork skill (step 3 checks `STOP_AFTER` after every `metta complete`), but the propose-stop-after capability is scoped as opt-in flag handling only: when the flag is absent, `.metta.yaml` carries no `stop_after` field (`spec/specs/propose-stop-after/spec.md:70`, `src/cli/commands/propose.ts:38-39`), and the skill's default path takes over. That default path is a full ship: step 8 runs `metta finalize` → `git push` → `gh pr create` → `gh pr checks --watch` → `gh pr merge --merge` (`.claude/skills/metta-propose/SKILL.md:272-277`), reinforced by a section titled "Critical: You MUST verify, finalize, and ship" that commands "Do NOT stop after the last artifact — finalize + ship must happen" (`SKILL.md:281-284`), with "leave it open for review" as the opt-out.

Consequences:
- Violates least surprise: "propose" defaults to autonomous merge-to-main.
- Sits in tension with the constitution's "No auto-push to remote without explicit user confirmation."
- Makes `/metta-propose` behaviorally identical to `/metta-auto`, erasing the intended distinction between the two entry points.

## Proposal

Implement the recorded user decision (2026-08-22, candidate solution 1): **flip `/metta-propose`'s default stop point to PR-OPEN.**

1. **Default behavior — stop at open PR.** `/metta-propose` with no stop-after flag runs the full autonomous pipeline (discovery → planning → implementation → verification → finalize → push → `gh pr create`), then STOPS and reports the PR URL for user review. It MUST NOT run `gh pr merge` by default.
2. **Merge stays available as an explicit opt-in.** A `--ship` / `stop-after=ship` opt-in, wired through the existing propose-stop-after machinery, restores run-to-merge behavior. All existing stop-after values keep working unchanged.
3. **Spec delta on propose-stop-after.** Flip the capability's default semantics from opt-in-stop (absent flag → no boundary, skill ships) to stop-at-pr-open (absent flag → boundary at PR-open). Existing stop-after value handling is preserved.
4. **Skill updates in both copies.** Rewrite step 8 and the "Critical: You MUST verify, finalize, and ship" section in both the installed skill (`.claude/skills/metta-propose/SKILL.md`) and the template (`src/templates/skills/metta-propose/SKILL.md`) so the default terminal action is `gh pr create` + report, and merge is conditional on the explicit ship opt-in.
5. **CLAUDE.md workflow wording.** Update the workflow section so `/metta-propose`'s described behavior matches the new default (ends at an open PR unless ship is requested).
6. **Regression guard.** Add grep-assert tests asserting the propose SKILL.md (both copies) contains no unconditional merge instruction — so a future skill edit cannot silently restore auto-merge.

## Impact

- **Capabilities:** `propose-stop-after` (default semantics flipped via spec delta). No other capability's requirements change.
- **Files:**
  - `.claude/skills/metta-propose/SKILL.md` and `src/templates/skills/metta-propose/SKILL.md` — default path ends at PR-open; merge gated on explicit ship opt-in.
  - `spec/specs/propose-stop-after/spec.md` — delta flipping the no-flag default.
  - `CLAUDE.md` — workflow section wording for `/metta-propose`.
  - CLI/schema surface as needed to carry the `--ship` / `stop-after=ship` opt-in through the existing propose-stop-after machinery (`src/cli/commands/propose.ts` and related).
  - New grep-assert tests over both SKILL.md copies.
- **Behavior change (intentional, user-mandated):** `/metta-propose` no longer merges to main by default. Users relying on the old auto-merge default must pass the ship opt-in or use `/metta-auto`.
- **Unchanged:** `/metta-auto` and `/metta-fix-issues` keep run-to-merge behavior; all existing stop-after values (`intent`, `tasks`, etc.) keep their meaning; the stop-after boundary-check wiring in the fork skill is already correct and is reused, not rebuilt.
- **Risk:** low — the change narrows autonomous authority; the failure mode of a wording miss is stopping too early (recoverable via `/metta-ship`), not merging without consent.

## Out of Scope

- **Candidate solution 2 (rejected):** making `STOP_AFTER=tasks` (or any earlier artifact) the default for `/metta-propose`. The pipeline still runs end-to-end through PR creation.
- **Candidate solution 3 (rejected):** config-driven per-verb default stop points (e.g. a `defaults.stop_after` map in metta config). No new configuration surface is added.
- **Changing `/metta-auto` or `/metta-fix-issues`:** both keep their run-to-merge behavior exactly as-is.
- **Removing or renaming existing stop-after values:** all currently accepted values continue to work with unchanged semantics.
- **Redesigning the finalize/ship pipeline itself** (gates, archiving, spec merge, CI watch): only the default terminal action after PR creation changes.
- **Retroactive handling of PR #28 / PR #85:** already merged; no reverts.
