# Summary: metta-fix-issues-cli-command-m

Added `metta fix-issue` CLI command + `/metta-fix-issues` skill modeled on `metta fix-gap`.

## Files changed
- `src/issues/issues-store.ts` — added `archive(slug)` and `remove(slug)` methods
- `src/cli/commands/fix-issue.ts` — new (four-branch handler mirroring fix-gap.ts)
- `src/cli/index.ts` — registered `fix-issue` command adjacent to `fix-gap`
- `src/templates/skills/metta-fix-issues/SKILL.md` — new (mirror of metta-fix-gap skill with 11 token substitutions)
- `.claude/skills/metta-fix-issues/SKILL.md` — byte-identical deployed copy
- `tests/issues-store.test.ts` — new (5 unit tests for archive/remove)
- `tests/cli.test.ts` — appended 12 tests (9 CLI + 3 skill template)

## Gates
- `npm run build` — PASS
- `npx vitest run` — 348/348 PASS (was 331, +17 new tests)
- `metta --help` includes `fix-issue` command

## Behavior
- `metta fix-issue` (no args) → prints usage hint pointing at `/metta-fix-issues`
- `metta fix-issue <slug>` → prints pipeline instructions, JSON includes issue fields
- `metta fix-issue --all [--severity <level>]` → sorts `critical → major → minor`, optional filter
- `metta fix-issue --remove-issue <slug>` → archives to `spec/issues/resolved/<slug>.md`, deletes source, commits `fix(issues): remove resolved issue <slug>`
- Errors with exit 4 for not-found / remove errors

## Task completion
All 6 tasks marked `[x]` in `tasks.md` (executor agents flipped each as it went — first live confirmation of the executor-agent-must-check-off change from earlier this session).
