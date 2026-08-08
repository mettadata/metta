# Enforce PR-Based Shipping on All Ship Paths

## Problem

Every metta ship path currently instructs the executing agent to merge a feature branch straight into `main` with a local `git merge metta/<change-name> --no-ff`, never opening a pull request. Two recent fork-run features — `uat-runner` (shipped 2026-07-26) and `token-tracking` (shipped 2026-08-08) — went through this local-merge path and landed on `main` with no PR record at all. The user has now asked "did a PR get pushed?" twice after these ships, expecting every shipped change to leave a reviewable PR trail on the remote. The gap is systemic, not a one-off: the local-merge instruction is duplicated across the `metta-ship` skill and every fork-tier lifecycle skill that performs its own ship step (`metta-propose`, `metta-quick`, `metta-auto`, `metta-fix-issues`, `metta-fix-gap`), each in both the source template and its deployed `.claude/skills/` copy, so the behavior is baked into six skill pairs. Left unfixed, this will keep producing merges to `main` with no PR history, undermining the review/audit trail the user relies on.

## Proposal

Rewrite the merge step in every skill that currently issues `git merge metta/<change-name> --no-ff` — confirmed present in `metta-ship`, `metta-propose`, `metta-quick`, `metta-auto`, `metta-fix-issues`, and `metta-fix-gap` (both `src/templates/skills/<skill>/SKILL.md` and the deployed `.claude/skills/<skill>/SKILL.md` copy for each) — to a PR-based flow:

1. Push the feature branch to the remote.
2. `gh pr create` with a title derived from the change name and a body built from `summary.md` highlights plus the standard metta footer.
3. `gh pr merge --merge` to land the PR. If the user has asked to leave the PR open for review, stop after step 2 and report the PR URL instead of merging.
4. `git pull --ff-only` on `main`, followed by branch and worktree cleanup.

Explicitly forbid direct local merge-to-main (`git merge ... main` outside a PR) in each skill's Rules section. `metta-next` and `metta-verify` reference "merge to main" only as user-facing status language pointing at `/metta:ship` — no instruction change needed there, but their prose should be checked and left as informational-only, not restated as literal merge commands. Also inspect `src/delivery/workflow-primer.ts` for local-merge shipping wording; none was found in the current pass, but if regenerated primer text reintroduces it, correct it there too (`CLAUDE.md` is regenerated from the primer at `/metta-refresh`, not hand-edited).

## Impact

- Six skill pairs updated (source + deployed, 12 files total): `metta-ship`, `metta-propose`, `metta-quick`, `metta-auto`, `metta-fix-issues`, `metta-fix-gap`.
- `tests/cli-skills.test.ts` needs new grep-based assertions confirming `gh pr create` (and `gh pr merge` or the open-PR stop condition) appears in each ship step, and that no direct `git merge metta/<change-name> --no-ff -m ... main` instruction remains in any skill.
- `src/delivery/workflow-primer.ts` checked; update only if local-merge wording is found there (propagates to `CLAUDE.md` via `/metta-refresh`, not directly).
- No change to `metta finalize` internals — finalize continues to run on the feature branch producing the spec merge; only the branch-to-main ship step changes.

## Out of Scope

- CI checks or required status checks on PRs.
- Branch protection rules on `main`.
- Changing `metta finalize` behavior (archive + spec merge on the feature branch).
- Retrofitting PR records for `uat-runner` or `token-tracking`, which already shipped without one.
