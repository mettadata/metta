# Summary: fix-issue-metta-install-should

Resolves issue `metta-install-should-not-touch-claude-md-that-should-be-left`. `metta install` no longer regenerates CLAUDE.md; that responsibility moves to the `/metta-init` skill, which calls `metta refresh` after the discovery agent populates `spec/project.md`.

## Files changed
- `src/cli/commands/install.ts` — deleted `runRefresh` import + call block; removed `CLAUDE.md` from `git add`.
- `src/templates/skills/metta-init/SKILL.md` + `.claude/skills/metta-init/SKILL.md` — added post-discovery step that runs `metta refresh` and commits CLAUDE.md separately as `chore: generate CLAUDE.md from discovery`.
- `src/templates/agents/metta-discovery.md` + `.claude/agents/metta-discovery.md` — removed `CLAUDE.md` from agent's `git add` and dropped CLAUDE.md generation claim from role description.
- `tests/cli.test.ts` — added negative assertion (`CLAUDE.md` does not exist after install), `not.toHaveProperty('claude_md')` on JSON, skill content + byte-identity check, `runRefresh` init unit test.

## Gates
- `npm run build` — PASS
- `npx vitest run` — 352/352 PASS (was 349, +3 new tests)
- Smoke in mktemp -d: `metta install --git-init` produces no CLAUDE.md, commit `chore: initialize metta` does not stage CLAUDE.md.

## Architecture impact
Clean separation now mirrors the install/init split: `install` = scaffold + claude-code wiring + commit. `init` (via `/metta:init` skill) = discovery + refresh + CLAUDE.md commit. No code path produces CLAUDE.md without prior discovery.

All 6 task checkboxes flipped to `[x]` in tasks.md as work happened — second confirmation of the executor checkbox-fix shipped earlier this session.
