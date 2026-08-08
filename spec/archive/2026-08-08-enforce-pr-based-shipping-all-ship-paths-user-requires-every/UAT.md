# UAT: enforce-pr-based-shipping-all-ship-paths-user-requires-every

- **Change**: enforce-pr-based-shipping-all-ship-paths-user-requires-every
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
- **Do**: Confirm: Push the feature branch to the remote.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: `gh pr create` with a title derived from the change name and a body built from `summary.md` highlights plus the standard metta footer.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: `gh pr merge --merge` to land the PR. If the user has asked to leave the PR open for review, stop after step 2 and report the PR URL instead of merging.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.4
- **Do**: Confirm: `git pull --ff-only` on `main`, followed by branch and worktree cleanup.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

All six ship-path skills (`metta-ship`, `metta-propose`, `metta-quick`, `metta-auto`, `metta-fix-issues`, `metta-fix-gap`) were rewritten — in both `src/templates/skills/<name>/SKILL.md` and the deployed `.claude/skills/<name>/SKILL.md` copy (12 files) — to replace the direct local `git merge metta/<change> --no-ff` ship step with a PR-based flow: `git push -u origin` → `gh pr create` → `gh pr merge --merge` (with an open-for-review stop condition that reports the PR URL instead) → `git pull --ff-only` on main plus branch/worktree cleanup. Each skill's Rules section now explicitly forbids direct local merge of the change branch into main. `tests/cli-skills.test.ts` gained a "PR-based shipping across all ship paths" describe block asserting `gh pr create` presence and `git merge metta/` absence for all six skill templates.
