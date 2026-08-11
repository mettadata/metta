# Summary: fix-ship-flow-merges-prs-before-ci-green

## What changed

1. **Ship flows now wait for green CI before merging.** All six ship sequences — metta-ship, metta-auto, metta-quick, metta-propose, metta-fix-issues, metta-fix-gap (deployed `.claude/skills/` + template `src/templates/skills/` pairs, 12 files) — gained a mandatory step between `gh pr create` and `gh pr merge`:

   > `gh pr checks <pr-number> --watch --fail-fast` → wait for all CI checks on the PR to complete before merging. If any check fails or is cancelled, do NOT merge — report the failing check(s) and the PR URL to the user and stop

   Subsequent steps were renumbered; no cross-references to renumbered steps existed (verified by grep).

2. **Main-push CI runs are never cancelled.** `.github/workflows/ci.yml` concurrency changed from `cancel-in-progress: true` to `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`, so superseded PR runs still cancel but every merge commit on main receives a completed CI verdict.

## Why

PR #66 was merged while its `gates` check was still IN_PROGRESS — the ship flow (PR #56) predates CI (PR #62) and merged immediately after opening the PR. The per-ref cancel-in-progress also cancelled main-push runs on rapid follow-up merges.

## Files

- `.claude/skills/{metta-ship,metta-auto,metta-quick,metta-propose,metta-fix-issues,metta-fix-gap}/SKILL.md`
- `src/templates/skills/{metta-ship,metta-auto,metta-quick,metta-propose,metta-fix-issues,metta-fix-gap}/SKILL.md`
- `.github/workflows/ci.yml`

## Out of scope (deliberate)

- Branch protection / ruleset requiring the `gates` check (GitHub admin config, defense-in-depth follow-up)
- `gh pr merge --auto` (only meaningful with required checks)

## Verification

- Grep confirms all 12 create→checks→merge sequences are in place and deployed/template pairs are identical.
- Gates (tests, typecheck, build, lint) run at finalize; no TypeScript code was touched.

## Verification results (2026-08-11)

Three verification passes (run inline in the skill-host context — session subagent limit exhausted):

1. **Tests:** `npm test` — 116 files, 2053 tests, all passed.
2. **Typecheck / build / lint:** `npx tsc --noEmit` clean, `npm run build` clean (dist/ templates regenerated — all 6 dist skill templates carry the new step), `npm run lint` clean.
3. **Intent compliance (trivial workflow — no spec.md):**
   - 12/12 deployed+template SKILL.md files contain `gh pr checks <pr-number> --watch --fail-fast`; scripted check confirms create → checks → merge ordering in every ship section.
   - `.github/workflows/ci.yml:16` — `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`.
   - Deployed/template pairs byte-identical for all six skills.

All gates green.
