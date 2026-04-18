# metta-import-researcher-skill-must-forbid-calling-metta

## Problem

Observed 2026-04-18 on trello-clone demo: `/metta-import` spawned a researcher that wrote 10 `spec/gaps/*.md` files AND left behind a stray `spec/changes/spec-archaeology-write-gap-files-built-not-documented/` directory. Subsequent `metta finalize` on any real change failed the `validate-stories` gate with `Multiple active changes: ...`, forcing driver to `rm -rf` the stray dir before retrying.

Tracked as `metta-import-researcher-agent-occasionally-creates-a-stray` (minor).

## Proposal

Add an explicit prohibition in `src/templates/skills/metta-import/SKILL.md` step 4 bullet list:
> MUST NOT call `metta propose`, `metta quick`, or otherwise create a directory under `spec/changes/`. Import scans produce only `spec/specs/` and `spec/gaps/` outputs.

Mirror the edit to `.claude/skills/metta-import/SKILL.md`.

## Impact

- `src/templates/skills/metta-import/SKILL.md` + deployed mirror
- No code changes
- Future `/metta-import` invocations get a clear forbidden-action rule

## Out of Scope

- CLI-level rejection ("metta import while a change is mid-flight"). Separate follow-up.
- Any other skill template
