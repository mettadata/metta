# Summary: metta-import-researcher-skill-must-forbid-calling-metta

## Problem

`/metta-import` researcher occasionally created a stray `spec/changes/<name>/` directory alongside its `spec/gaps/*.md` outputs. A subsequent `metta finalize` on a real change failed `validate-stories` with `Multiple active changes`.

## Solution

Added explicit prohibition in `src/templates/skills/metta-import/SKILL.md` step 4: "MUST NOT call `metta propose`, `metta quick`, or otherwise create a directory under `spec/changes/`." Mirrored to `.claude/skills/metta-import/SKILL.md`.

## Files touched

- `src/templates/skills/metta-import/SKILL.md`
- `.claude/skills/metta-import/SKILL.md`

## Resolves

- `metta-import-researcher-agent-occasionally-creates-a-stray` (minor)
