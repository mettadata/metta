# Summary: fix-residual-session-cwd-anchoring-gaps-skills-gate

## What changed

Anchored every residual session-cwd-relative command and artifact path in the change-scoped skill templates to `{change_root}`, in both template trees (`.claude/skills/` and `src/templates/skills/`, kept byte-identical), and added a regression lint test so the pattern class cannot silently return.

### Flagged spots from the issue (all fixed)

1. **metta-propose verifier read** — Agent 3 prompt now reads `{change_root}/spec/changes/<change>/spec.md` (was bare `Read spec.md`); the verifier scope list is likewise anchored.
2. **Push steps** — metta-ship step 4 and metta-propose step 8b now run `git -C "{change_root}" push -u origin metta/<change-name>` (were bare `git push`).
3. **Gate commands** — verifier prompts and scope lists now run `cd "{change_root}" && npm test`, `cd "{change_root}" && npx tsc --noEmit`, `cd "{change_root}" && npm run lint`; the review/verify `mkdir -p` and `test -s` preconditions and Output path / Forbidden prompt clauses use `{change_root}/spec/changes/<change>/...`.

### Sweep findings (same pattern class, also fixed)

- metta-propose: research write paths, research synthesis step (now commits with `git -C "{change_root}"`), tasks.md read, review-section mkdir/output/test -s paths, review.md and summary.md merge steps.
- metta-quick: trivial-path verifier prompt, standard-path scope list and Agent 1/2 prompts.
- metta-auto, metta-fix-issues, metta-fix-gap: Agent 1/2 gate prompts.
- metta-verify: spec read, summary write, and commit line anchored; added a `{change_root}` resolution preamble (via `metta status --json` `worktree` field). metta-ship got the same resolution preamble since it previously never defined `{change_root}`.

Intentionally untouched: metta-release (`git push --follow-tags origin main` is a main-checkout release by design), metta-import / metta-init / metta-refresh (session-rooted, no change context), and the elliptical parallelism anti-example blocks (`...npm test...`).

### New test

`tests/skill-template-anchoring.test.ts` — scans `metta-*/SKILL.md` in both trees (excluding the session-rooted allowlist above) and fails on any line matching the unanchored shapes without `{change_root}`: bare `git push -u origin metta/`, `Run/runs` gate commands, `Read spec.md`, `mkdir -p`/`test -s spec/changes/...`, backticked bare `spec/changes/<change>` paths. Also asserts both trees are present in the scan.

## Verification

- `npm test`: 118 files, 2080 tests passed (includes the new regression test and the existing template-deploy-sync byte-identity test, confirming tree parity).
- `npx tsc --noEmit`: clean.
- `npm run lint`: clean.
- `npm run build`: clean; `copy-templates` propagates the skill edits to `dist/templates/skills/`.
- `diff -rq .claude/skills src/templates/skills`: no differences.

## Files

- `.claude/skills/{metta-propose,metta-ship,metta-quick,metta-auto,metta-fix-issues,metta-fix-gap,metta-verify}/SKILL.md`
- `src/templates/skills/` — same seven files
- `tests/skill-template-anchoring.test.ts` (new)

Commit: fc656e7da `fix(skills): anchor residual session-cwd commands and paths to {change_root}`
