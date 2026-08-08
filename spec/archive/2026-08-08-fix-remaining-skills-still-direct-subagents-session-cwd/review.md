# Review: fix-remaining-skills-still-direct-subagents-session-cwd

Three parallel reviewers (correctness, security, quality) reviewed the diff `c8a306a1e..HEAD` across all 12 skill files (6 skills x 2 mirrors). Review iteration #1.

## Verdicts

| Reviewer | Verdict |
|----------|---------|
| Correctness | PASS_WITH_WARNINGS |
| Security | PASS_WITH_WARNINGS |
| Quality | PASS_WITH_WARNINGS |

No critical findings. All mirror pairs verified byte-identical by all three reviewers.

## Findings and resolutions

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | major | Payload misattribution: `metta quick`/`metta propose` JSON does not emit `change_root` (only `worktree`, nullable; `change_root` comes from `metta instructions`). Claimed in metta-quick:24, metta-auto:24, metta-fix-issues:37, metta-fix-gap:39. | Fixed in `a0dbbbf75` — reworded to source the change root from the payload's `worktree` field (null -> main checkout root), with `change_root` arriving via `metta instructions`. |
| 2 | major | Executor prompts in metta-fix-issues/metta-fix-gap implementation steps lacked the `change_root` hand-off present in metta-auto. | Fixed in `a0dbbbf75` — prompts now carry `change_root`, absolute paths, `git -C` commits. |
| 3 | major | Verifier Agent-3 prompts handed relative `intent.md`/`spec.md` reads to subagents (quick:193/165, auto:64, fix-issues:75, fix-gap:78) — same wrong-tree family on the input side. | Fixed in `a0dbbbf75` — reads anchored to `{change_root}/spec/changes/<change>/...`. |
| 4 | minor | metta-uat steps 2/4 left `<path>` unquoted while step 5 quotes it. | Fixed in `a0dbbbf75` — quoted. |
| 5 | minor | Branch push anchored in fix-issues/fix-gap but plain in quick:199/auto:75. | Fixed in `a0dbbbf75` — `git -C "{change_root}" push` in all four. |
| 6 | minor | metta-uat uses `<change-root>` angle brackets vs `{change_root}` braces elsewhere. | Accepted — metta-uat resolves the value itself (no payload interpolation); style matches its existing placeholders. Both reviewers judged it defensible. |
| 7 | minor | metta-quick step 3 subagent-commit wording contradicts its Subagent Rules section. | Accepted — pre-existing contradiction, out of scope (noted in summary.md). |
| 8 | minor | Unquoted branch name in push examples (pre-existing; machine-generated kebab-case slugs). | Accepted — informational, pre-existing pattern. |

## Follow-up candidates (out of scope, surfaced during review)

- `metta-propose/SKILL.md:269` has the same bare `Read spec.md` verifier prompt; `metta-ship/SKILL.md:16` has an unanchored `git push`.
- Reviewer/verifier gate commands (`npm test`, `npx tsc --noEmit`) carry no working-directory anchoring — gates run in the session checkout, not the change worktree.

## Outcome

All three reviewers PASS_WITH_WARNINGS; all major findings resolved in follow-up commit `a0dbbbf75` and re-verified by grep + mirror diff (no residual `change_root` overclaims, no bare artifact reads, mirrors identical). Exit review loop.
