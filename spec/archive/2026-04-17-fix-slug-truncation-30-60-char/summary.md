# Summary: fix-slug-truncation-30-60-char

## What changed

1. Change-name slug cap raised from 30 to 60 characters in `artifact-store.ts`'s `slugify()`. Long descriptions keep more tail context in the resulting slug.
2. `/metta-propose` and `/metta-quick` skills now parse `--auto` (alias `--accept-recommended`) from `$ARGUMENTS`. When present, the discovery loop short-circuits — orchestrator picks the first (Recommended) option for every question and proceeds directly to the proposer subagent.

## Files modified

- `src/artifacts/artifact-store.ts` — `.slice(0, 30)` → `.slice(0, 60)`
- `src/templates/skills/metta-propose/SKILL.md` + `.claude/skills/metta-propose/SKILL.md` — `--auto` parsing + discovery-loop short-circuit
- `src/templates/skills/metta-quick/SKILL.md` + `.claude/skills/metta-quick/SKILL.md` — same
- `tests/artifact-store.test.ts` — new case asserting slug length is in (30, 60]

## Resolves

- `metta-propose-slug-truncation-too-aggressive-change-names-li` (minor)
- `no-accept-recommended-mode-for-discovery-rounds-when-driving` (minor)

## Verification

- `npx tsc --noEmit`: clean
- `npm test`: 557/557 pass (byte-identity between source and deployed SKILL.md pairs holds)

## Non-goals

- Retroactive rename of existing 30-char-truncated archived changes
- `/metta-auto`, `/metta-fix-issues`, `/metta-fix-gap` skills (not in scope; `/metta-auto` already non-interactive by design)
