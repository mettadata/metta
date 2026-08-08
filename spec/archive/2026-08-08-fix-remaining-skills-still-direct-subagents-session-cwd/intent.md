# fix-remaining-skills-still-direct-subagents-session-cwd

## Problem

Six lifecycle skills still direct orchestrators and subagents to session-cwd-relative change paths and plain (non-`-C`) git, even though quick/auto changes are worktree-hosted. This is the same wrong-tree defect family that PR #59 (`fix-instruction-payload-output-path-cwd-relative`) fixed for the `{output_path}`-interpolating skills (metta-propose, metta-plan, metta-check-constitution) by adding a `change_root` field to the instruction payload — but the fix never reached the remaining skills.

Concretely, in the current skill text:

- `metta-uat/SKILL.md` step 5 commits the UAT run record with plain `git add <path> && git commit ... -- <path>` — no `git -C {change_root}` — so a session rooted at main commits into the main checkout even when the target change lives in a worktree.
- `metta-quick/SKILL.md` (steps 5d, 7, 8) tells the orchestrator to write `spec/changes/<change>/summary.md` and `spec/changes/<change>/review.md` as relative paths and commit them with plain git, while `metta quick` creates the change in a worktree under `.metta/worktrees/`.
- `metta-auto/SKILL.md` (steps 3–7) references `spec/changes/<change>/research-*.md`, `research.md`, `tasks.md`, `review.md`, and summary.md relatively, with plain git commits.
- `metta-fix-issues/SKILL.md` (steps 3–8) and `metta-fix-gap/SKILL.md` (steps 3–8) have the same relative research/tasks/review/summary paths and plain-git commit instructions.
- `metta-execute/SKILL.md` (steps 2, 5) reads `spec/changes/<change>/tasks.md` and writes `spec/changes/<change>/summary.md` relative to the session cwd.

Who is affected: any AI orchestrator session running from the main repo root while driving a worktree-hosted change. Reads silently pick up stale or missing files from the wrong checkout (e.g. `tasks.md` not found, or an old copy from a previously merged change), and writes/commits land in the main checkout instead of the change's worktree and branch. Symptoms range from artifacts committed to the wrong branch (polluting main's working tree, orphaning them from the change's PR) to `metta complete` gates failing because the artifact is absent from the checkout the CLI inspects. Severity was assessed as major; the failure mode has already caused a real wrong-branch incident (see commit `3d697acdb`, "drop stray change dir from wrong-branch incident").

The infrastructure to fix this already exists: since PR #59, `metta instructions <artifact> --json` returns both an absolute `output_path` and a `change_root` (the root of the checkout hosting the change), and metta-propose/metta-plan already model the correct pattern — absolute `{change_root}/spec/changes/<change>/...` paths for reads and writes, and `git -C "{change_root}"` with quoted paths for commits. The remaining six skills simply never adopted it.

## Proposal

Update the instruction text of the six affected skills to consume `change_root` the same way metta-propose and metta-plan already do. This is a docs/skill-instruction change only — no TypeScript, CLI, or payload schema changes.

Per skill:

1. **metta-uat** — resolve `change_root` for the target change (from the change's hosting checkout; for archived documents the target lives on main, where `change_root` is the main repo root) and rewrite step 5's commit to `git -C "{change_root}" add "<path>" && git -C "{change_root}" commit -m "docs(<change-name>): UAT run record" -- "<path>"`. The step-2 snapshot (`git status --porcelain`), step-4 diff sanity check (`git diff`), and whole-worktree porcelain check must likewise run with `-C "{change_root}"` so pre/post checks inspect the same checkout the commit targets.
2. **metta-quick** — capture `change_root` from the `metta quick`/`metta instructions` JSON payloads; rewrite step 5d (summary.md write + commit), step 7 (review.md write + commit, review-fix loop), and step 8 (summary.md merge + commit) to use `{change_root}/spec/changes/<change>/...` absolute paths and `git -C "{change_root}"` commits; state the "use verbatim, never re-derive from session cwd" rule that metta-propose already carries.
3. **metta-auto** — same treatment for steps 3–7: researcher output paths (`{change_root}/spec/changes/<change>/research-<slug>.md`), research synthesis, `tasks.md` read, summary.md and review.md writes, and all associated commits via `git -C "{change_root}"`.
4. **metta-fix-issues** — same treatment for the Single Issue Pipeline steps 3–8 (per-artifact loop context, researcher paths, research synthesis, tasks.md read, summary.md/review.md writes and commits).
5. **metta-fix-gap** — same treatment for the Single Gap Pipeline steps 3–8 (identical structure to fix-issues).
6. **metta-execute** — rewrite step 2 (`tasks.md` read) and step 5 (summary.md write) to `{change_root}/...` absolute paths, with `change_root` taken from the `metta instructions` payload, and make the summary commit (where the skill implies one) use `git -C "{change_root}"`.

Cross-cutting scope rules:

- Every path handed to a spawned subagent (executor prompts, reviewer/verifier output instructions) must be absolute under `{change_root}`, matching PR #59's subagent-prompt convention.
- Both mirrors are updated in lockstep: `src/templates/skills/<skill>/SKILL.md` and `.claude/skills/<skill>/SKILL.md` for each of the six skills. The two copies of each skill must remain byte-identical in the edited regions per the project's template-mirroring convention.
- Wording follows the established PR #59 pattern (e.g. the metta-plan line: "always `git -C \"{change_root}\"` with the paths quoted, never plain git from your cwd") so the guidance is consistent across all skills.

## Impact

- **Skill instruction files (12 files)** — `metta-uat`, `metta-quick`, `metta-auto`, `metta-fix-issues`, `metta-fix-gap`, `metta-execute`, each in both `src/templates/skills/` and `.claude/skills/`. Behavior change: orchestrators driving these skills from a main-root session will now read, write, and commit change artifacts in the change's own worktree checkout instead of the session checkout.
- **Worktree-hosted changes (quick/auto)** — primary beneficiaries; artifact commits land on the change branch in the change's worktree, eliminating the wrong-tree write/commit path.
- **Non-worktree changes** — for changes hosted in the main checkout, `change_root` equals the main repo root, so absolute paths and `git -C` resolve to exactly today's behavior. No regression expected for that case.
- **UAT runs against archived documents** — `spec/archive/` lives on main, so the archived-run commit resolves `change_root` to the main repo root; behavior is unchanged there, but the instruction text becomes explicit about which checkout is targeted.
- **No runtime code impact** — `change_root` already exists in the instruction payload (added in PR #59); no changes to `src/` TypeScript, Zod schemas, CLI commands, or the payload contract. Existing tests are unaffected; the template-mirror consistency check (if enforced by gates) must pass for the six edited skill pairs.
- **Documentation regeneration** — none required; CLAUDE.md and docs/ do not embed the affected skill step text.

## Out of Scope

- Any change to the instruction payload contract or CLI (`metta instructions`, `metta quick`, `metta status`) — `change_root` is consumed as already emitted, not extended.
- Skills already fixed in PR #59 (`metta-propose`, `metta-plan`, `metta-check-constitution`) — no re-edits beyond what already shipped.
- Other skills not named in the issue (`metta-ship`, `metta-verify`, `metta-import`, `metta-issue`, `metta-backlog`, `metta-status`, `metta-next`, `metta-progress`, `metta-refresh`, `metta-init`, `metta-roadmap`) — if they carry similar defects, they are follow-up issues, not this change.
- Runtime enforcement of correct paths (e.g. a guard hook rejecting plain git or relative spec paths from skill-driven sessions) — this change fixes the instructions, not the enforcement layer.
- Worktree lifecycle behavior itself (creation, cleanup, branch management) — unchanged.
- Agent persona files under `.claude/agents/` / `src/templates/agents/` — the fix is confined to skill step text; personas already receive their paths from the orchestrator prompt.
