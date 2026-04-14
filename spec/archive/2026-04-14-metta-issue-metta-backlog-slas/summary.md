# Verification: metta-issue-metta-backlog-slas

## Spec Scenarios

| ID | Scenario | Coverage | Result |
|----|----------|----------|--------|
| S1 | issue skill template exists and invokes the right CLI | `src/templates/skills/metta-issue/SKILL.md` + static test `tests/cli.test.ts` | PASS |
| S2 | issue skill deployed by install | byte-identical to `.claude/skills/metta-issue/SKILL.md`; tmp-repo smoke deployed it on `metta install` | PASS |
| S3 | backlog skill template covers all subcommands | `src/templates/skills/metta-backlog/SKILL.md` documents list/show/add/promote; static test | PASS |
| S4 | backlog skill deployed by install | byte-identical; tmp-repo smoke deployed it | PASS |
| S5 | `metta idea` no longer exists | live run: `metta idea foo` → exit 1, `error: unknown command 'idea'` | PASS |
| S6 | idea store and tests deleted | `src/ideas/`, `src/cli/commands/idea.ts`, `tests/ideas-store.test.ts` all ENOENT | PASS |
| S7 | idea references removed from docs and templates | grep of `src/templates/`, `src/cli/commands/refresh.ts`, `README.md`, `QA-TEST-GUIDE.md`, `CLAUDE.md` → zero matches after README + QA-TEST-GUIDE cleanup | PASS |
| S8 | refresh no longer emits Ideas row | `CLAUDE.md` grep for `metta idea` and `[Ideas]` → zero matches | PASS |

S7 scope was clarified mid-verification: historical records (`spec/changes/`, `spec/archive/`, root `tasks.md` v0.1 build log, `docs/proposed/`) are exempt — they are immutable artifacts of past design and build work. Spec amended in same commit.

## Gate Results

| Gate | Result |
|------|--------|
| `npm run build` | PASS |
| `npx vitest run` | PASS — 325/325 across 25 files |
| `npx tsc --noEmit` | PASS |
| skill byte-identity (issue, backlog) | PASS |
| install smoke in mktemp -d | PASS (idea rejected, issue logged, backlog empty, both skills deployed) |

## Summary

Shipped: two new Claude Code skills (`/metta-issue`, `/metta-backlog`) with frontmatter-declared names, deployed copies byte-identical to templates, static tests covering content + identity. Full removal of `metta idea`: command registration, `src/ideas/` store, `IdeasStore` from `CliContext` and barrel exports, idea row + bullet from `metta refresh` output, ideas-store unit tests, idea CLI tests, and `metta idea` references from live docs (`README.md`, `QA-TEST-GUIDE.md`). Generated `CLAUDE.md` regenerated and clean.

The `/metta-issue` skill was used successfully in-band during this change to log a separate usability bug about task checkbox tracking — first real end-to-end exercise of the new skill.

Change is ready to finalize and ship.
