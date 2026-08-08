# UAT: fix-remaining-skills-still-direct-subagents-session-cwd

- **Change**: fix-remaining-skills-still-direct-subagents-session-cwd
- **Generated**: 2026-08-08
- **Source**: intent + summary (reduced)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

*Reduced script — derived from intent/summary; steps are confirmation prompts.*

### Intent proposal

#### Step 1.1
- **Do**: Confirm: metta-uat — resolve `change_root` for the target change (from the change's hosting checkout; for archived documents the target lives on main, where `change_root` is the main repo root) and rewrite step 5's commit to `git -C "{change_root}" add "<path>" && git -C "{change_root}" commit -m "docs(<change-name>): UAT run record" -- "<path>"`. The step-2 snapshot (`git status --porcelain`), step-4 diff sanity check (`git diff`), and whole-worktree porcelain check must likewise run with `-C "{change_root}"` so pre/post checks inspect the same checkout the commit targets.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: metta-quick — capture `change_root` from the `metta quick`/`metta instructions` JSON payloads; rewrite step 5d (summary.md write + commit), step 7 (review.md write + commit, review-fix loop), and step 8 (summary.md merge + commit) to use `{change_root}/spec/changes/<change>/...` absolute paths and `git -C "{change_root}"` commits; state the "use verbatim, never re-derive from session cwd" rule that metta-propose already carries.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: metta-auto — same treatment for steps 3–7: researcher output paths (`{change_root}/spec/changes/<change>/research-<slug>.md`), research synthesis, `tasks.md` read, summary.md and review.md writes, and all associated commits via `git -C "{change_root}"`.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.4
- **Do**: Confirm: metta-fix-issues — same treatment for the Single Issue Pipeline steps 3–8 (per-artifact loop context, researcher paths, research synthesis, tasks.md read, summary.md/review.md writes and commits).
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.5
- **Do**: Confirm: metta-fix-gap — same treatment for the Single Gap Pipeline steps 3–8 (identical structure to fix-issues).
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.6
- **Do**: Confirm: metta-execute — rewrite step 2 (`tasks.md` read) and step 5 (summary.md write) to `{change_root}/...` absolute paths, with `change_root` taken from the `metta instructions` payload, and make the summary commit (where the skill implies one) use `git -C "{change_root}"`.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.7
- **Do**: Confirm: Every path handed to a spawned subagent (executor prompts, reviewer/verifier output instructions) must be absolute under `{change_root}`, matching PR #59's subagent-prompt convention.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.8
- **Do**: Confirm: Both mirrors are updated in lockstep: `src/templates/skills/<skill>/SKILL.md` and `.claude/skills/<skill>/SKILL.md` for each of the six skills. The two copies of each skill must remain byte-identical in the edited regions per the project's template-mirroring convention.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.9
- **Do**: Confirm: Wording follows the established PR #59 pattern (e.g. the metta-plan line: "always `git -C \"{change_root}\"` with the paths quoted, never plain git from your cwd") so the guidance is consistent across all skills.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Fixed the remaining wrong-tree family of skill instructions (issue `remaining-skills-still-direct-subagents-to-session-cwd`, major): six skills still directed subagents to session-cwd-relative `spec/changes/<change>/` paths and plain `git add`/`git commit`, which writes/commits into the wrong checkout when a main-rooted session drives a worktree-hosted change. All six now consume the change root — absolute `{change_root}/spec/changes/<change>/...` paths for reads/writes and `git -C "{change_root}"` for git operations — matching the PR #59 pattern already established in metta-plan, metta-propose, and metta-check-constitution.

#### Step 2.1
- **Do**: Confirm: `457efd139` intent
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: `2f23f66d9` metta-fix-issues + metta-fix-gap
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: `ec57cdb3a` metta-quick + metta-auto
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.4
- **Do**: Confirm: `cae50e375` metta-execute + metta-uat
- **Observe**: behaves as described
- [ ] Pass
