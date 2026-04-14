# Verification: fix-metta-next-gap-detect-unme

## Spec Scenarios

| Scenario | Covered by | Status |
|---|---|---|
| S1: next after finalize on a metta branch | `CLI > metta next post-finalize > returns ship when on metta/* branch ahead of main` | PASS |
| S2: next on main with no active changes | `CLI > metta next post-finalize > returns propose when on main` | PASS |
| S3: metta branch with no unmerged commits | `CLI > metta next post-finalize > returns propose when on metta/* branch with zero commits ahead` | PASS |
| S4: main branch is missing | `CLI > metta next post-finalize > returns propose when main branch is missing` | PASS |
| S5: skill advances from ship response | `CLI > metta-next skill template > template and deployed copy handle ship action and are byte-identical` | PASS |

## Gate Results

- `npm run build`: PASS (0 TS errors)
- `npx tsc --noEmit` lint: PASS
- `npx vitest run`: 329/329 PASS (previously 322/324 — the 2 pre-existing refresh.test.ts failures were fixed by `8c18df1` on the upstream split-metta-install-metta-init branch and those commits are stacked beneath this branch)
- Manual smoke on this branch: `metta next --json` currently returns `next: "implementation"` because the change is still active; ship detection will trigger after finalize archives the change.

## Summary

The `metta next` command now detects when HEAD is on a `metta/<name>` branch with commits ahead of `main` (or the configured `config.git.pr_base`), and emits `next: "ship"` with a ready-to-run `metta ship --branch metta/<name>` command. The `/metta-next` skill body was updated in both locations (`src/templates/skills/metta-next/SKILL.md` and `.claude/skills/metta-next/SKILL.md`, byte-identical) to route ship responses through the same `/metta-ship` handler as finalize.

Error tolerance: detached HEAD, missing base branch, and non-`metta/` branches all fall through to the existing propose response without throwing.

Change is ready to finalize and ship.
