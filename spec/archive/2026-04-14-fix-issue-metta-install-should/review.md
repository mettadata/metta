# Review: fix-issue-metta-install-should

Three reviewers ran in parallel.

## Correctness — PASS
- install.ts: no `runRefresh` import/call; `git add` excludes CLAUDE.md.
- /metta-init skill body invokes `metta refresh` AFTER discovery (step 4), commits separately with message `chore: generate CLAUDE.md from discovery`.
- Skill files byte-identical; discovery agent files byte-identical and exclude CLAUDE.md from git add.
- Suggestions (non-blocking): minor cosmetic — install JSON `directories` could include `.claude/`; skill failure-path could surface louder than "warn and continue".

## Security — PASS
- No new shell-injection surface (commit message + `metta refresh` are static literals).
- Removing `runRefresh` from install slightly reduces surface (one fewer pre-commit write path).
- Same prompt-injection trust boundary as before — relocated, not widened.

## Quality — PASS
- Skill wording clear and discoverable.
- Discovery agent role description accurate (now claims only project.md + config.yaml).
- Test pair forms a reasonable unit + contract: skill text contains `metta refresh` (template assertion) + `runRefresh` produces CLAUDE.md when called on a populated `spec/project.md` (integration assertion).
- No stale CLAUDE.md-after-install references in README, QA-TEST-GUIDE, or install console output.

## Verdict
All three reviewers PASS. No fixes needed.
