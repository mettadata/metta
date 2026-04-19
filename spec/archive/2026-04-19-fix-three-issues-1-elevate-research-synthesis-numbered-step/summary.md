# Summary: fix-three-issues-1-elevate-research-synthesis-numbered-step

Three independent defects fixed in one quick-workflow change. Files touched per fix are disjoint, so executors ran in parallel.

## Fix 1 — Elevate research synthesis to a numbered step (issue: `metta-propose-research-step-parallel-researchers-write-to`, severity: major)

Four skill templates that fan out parallel `metta-researcher` agents (`metta-propose`, `metta-fix-issues`, `metta-auto`, `metta-fix-gap`) had two related defects: (a) the per-approach output path was unspecified, so researchers wrote to `/tmp/research-*.md`; (b) the synthesis step that writes the canonical `spec/changes/<change>/research.md` was buried as a sub-bullet, so orchestrators routinely skipped it and only discovered the omission when the gate failed.

Changes:
- Per-approach output path is now explicit: `spec/changes/<change>/research-<slug>.md`.
- Synthesis is a standalone numbered step ("Synthesize research") with imperative wording: read all `research-<slug>.md` files, write `spec/changes/<change>/research.md`, commit, then call `metta complete research`.
- Subsequent step numbers renumbered to stay contiguous in all four skills.
- `.claude/skills/` deployed copies updated alongside `src/templates/skills/` originals to keep the byte-identity test contract green (Deviation Rule 2).

Files: `src/templates/skills/metta-{propose,fix-issues,auto,fix-gap}/SKILL.md`, plus matching `.claude/skills/...` copies. Commit `659e92c`.

## Fix 2 — Tick `tasks.md` checkboxes when completing implementation (issue: `tasks-in-tasks-md-aren-t-getting-marked-completed`, severity: minor)

`markTaskComplete` existed in `src/execution/batch-planner.ts:194` but no caller ever invoked it. Archived `tasks.md` files all retained `- [ ]` boxes after their changes shipped, so the checklist was useless as an audit trail. The executor agent contract forbids touching `tasks.md` (per `src/templates/agents/metta-executor.md:27`); marking is the orchestrator's responsibility.

Changes:
- `src/cli/commands/complete.ts` imports `parseTasks` and `markTaskComplete` from `batch-planner.js`.
- In the `artifactId === 'implementation'` branch, after the existing post-impl scoring, a new try/catch reads `tasks.md` (if present), parses every task ID, applies `markTaskComplete` for each, and writes the updated content back via `ctx.artifactStore.writeArtifact`. Advisory-only — failures do not block `metta complete`.
- The existing auto-commit at the end of the action handler already runs `git add spec/changes/<changeName>`, so the ticked file is committed automatically — no change needed there.
- New test `tests/complete-marks-tasks.test.ts` covers happy path, missing tasks.md, and malformed tasks.md (3 tests, all pass).

Files: `src/cli/commands/complete.ts`, `tests/complete-marks-tasks.test.ts`. Commit `dce490b`.

## Fix 3 — Show workflow tier in statusline (issue: `we-need-to-update-the-statusline-to-show-which-workflow-is`, severity: minor)

The custom Claude statusline output `[metta: <artifact>]`. The `metta status --json` response already exposes a `workflow` field (per `src/schemas/change-metadata.ts`) but the statusline ignored it.

Changes:
- `formatStatusLine` accepts a `workflow` parameter. When the artifact is active (not `idle`/`unknown`) AND `workflow` is non-empty, output is `[metta:<workflow>:<artifact>]` (e.g. `[metta:quick:implementation]`). Otherwise the legacy `[metta: <artifact>]` format is preserved (idle/unknown/no-workflow cases unchanged).
- `main()` reads `parsed.workflow` from the status response and forwards it.
- `tests/statusline-format.test.ts` extended with 4 new tests covering the new format and fallback cases. 14/14 pass.

Files: `src/templates/statusline/statusline.mjs`, `tests/statusline-format.test.ts`. Commit `5bc7b87`.

## Verification status

- All targeted unit tests for each fix pass.
- `npm run lint` (`tsc --noEmit`) clean.
- Full `npm test`: pre-existing byte-identity failures between `src/templates/skills/` and `.claude/skills/` were resolved by the Fix 1 sync. Final full-suite verification pending in the verifier stage.

## Out of scope

- Pre-existing YAML duplicate-keys warning in `.metta/config.yaml` is not addressed.
- The two new issues logged by the executor during this change (`metta-propose-review-step-parallel-reviewers-write-their-per`, `metta-propose-verify-step-parallel-verifiers-write-per-agent`) describe the same per-agent-output-path defect in the review and verify fan-outs. They are tracked separately in `spec/issues/` and are not part of this change — they should be picked up by a future `/metta-fix-issues` run.
