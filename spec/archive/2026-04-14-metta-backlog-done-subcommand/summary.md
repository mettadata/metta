# Summary: metta-backlog-done-subcommand

Adds `metta backlog done <slug> [--change <name>]` + extends `/metta-backlog` skill with a 5th `done` option, mirroring the shipped `fix-issue --remove-issue` pattern.

## Files changed
- `src/backlog/backlog-store.ts` — added `SLUG_RE` + `assertSafeSlug`, guards on `show/exists/remove`, new `archive(slug, changeName?)` with optional `**Shipped-in**` metadata append.
- `src/cli/commands/backlog.ts` — new `done` subcommand after `promote`; validates `--change` against SLUG_RE; archives + removes + commits as `chore: archive shipped backlog item <slug>`; JSON includes `{archived, shipped_in, committed, commit_sha}`.
- `src/templates/skills/metta-backlog/SKILL.md` + `.claude/skills/metta-backlog/SKILL.md` — 5th `done` option (byte-identical).
- `tests/backlog-store.test.ts` — 10 new unit tests (archive happy/with-change/missing/hostile slug/hostile changeName, + guard coverage for show/exists/remove).
- `tests/cli.test.ts` — 7 new tests (5 CLI + 2 skill template).

## Gates
- `npm run build` — PASS
- `npx vitest run` — 372/372 PASS (was 356, +16 new)

## Next
After this ships, use it on the pending backlog item: `metta backlog done add-metta-fix-issues-skill-that-works-like-metta-fix-gap --change metta-fix-issues-cli-command-m`.
