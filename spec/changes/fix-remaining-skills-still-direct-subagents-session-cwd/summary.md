# Summary: fix-remaining-skills-still-direct-subagents-session-cwd

## What changed

Fixed the remaining wrong-tree family of skill instructions (issue `remaining-skills-still-direct-subagents-to-session-cwd`, major): six skills still directed subagents to session-cwd-relative `spec/changes/<change>/` paths and plain `git add`/`git commit`, which writes/commits into the wrong checkout when a main-rooted session drives a worktree-hosted change. All six now consume the change root — absolute `{change_root}/spec/changes/<change>/...` paths for reads/writes and `git -C "{change_root}"` for git operations — matching the PR #59 pattern already established in metta-plan, metta-propose, and metta-check-constitution.

## Files changed (both mirrors: src/templates/skills/ and .claude/skills/)

| Skill | Fix |
|-------|-----|
| metta-quick | Steps 1/3/5/7/8: payload `change_root` used verbatim; intent, tasks, review.md, summary.md reads/writes and commits anchored |
| metta-auto | Steps 1/3-7: researcher output paths, research synthesis, tasks.md, review.md, summary.md anchored; subagent prompts must carry `change_root` |
| metta-fix-issues | Pipeline steps 3-8, 10a: artifact paths, research outputs, review/summary writes, branch push anchored; payload-provenance note added |
| metta-fix-gap | Same fixes to its Single Gap Pipeline steps 3-8, 10a |
| metta-execute | Steps 2/5: tasks.md read, summary.md write/commit anchored; executor prompts must carry `change_root` |
| metta-uat | Change root resolved per target (live change -> its worktree if present, archived -> main root); UAT.md lookups, snapshot/diff/porcelain checks, and run-record commit all `git -C`-anchored |

## Commits

- `457efd139` intent
- `2f23f66d9` metta-fix-issues + metta-fix-gap
- `ec57cdb3a` metta-quick + metta-auto
- `cae50e375` metta-execute + metta-uat

## Notes / assumptions

- metta-uat resolves its change root itself (worktree for live changes, main root for archived) since UAT runs outside the artifact-instruction payload flow.
- Plain git left intentionally where it operates on main after cleanup (`git pull --ff-only` on main) or is prohibition prose (`git merge` ban).
- metta-quick step 3's pre-existing "subagent commits it" wording contradicts its Subagent Rules section; preserved as-is (anchored only) per minimal-edit rule — pre-existing inconsistency, not introduced here.

## Verification

Doc-only change (markdown skill files). Mirror pairs verified byte-identical by each executor. Gates (tests, lint, typecheck, build) run by the orchestrator before completing implementation.

## Verification results (3 parallel verifiers, iteration #1)

| Verifier | Result |
|----------|--------|
| Test suite | PASS — 102/102 files, 1792/1792 tests |
| Typecheck / lint / build | PASS — tsc clean, lint clean, build clean; dist template copy verified identical to src |
| Intent coverage | PASS — all 6 intent commitments implemented with file:line evidence; mirrors byte-identical; provenance claims cross-checked against quick.ts/propose.ts/instruction-generator.ts; Out of Scope respected (diff = 12 skill files + change artifacts only) |

All major review findings confirmed resolved in the verified tree (commit `a0dbbbf75`).
