# fix-slug-truncation-30-60-char

## Problem

Two open issues in the propose flow:

1. **Slug truncation too aggressive** (`metta-propose-slug-truncation-too-aggressive-change-names-li`): `slugify()` in `src/artifacts/artifact-store.ts:20` hard-caps at 30 characters. Real change names like `drag-card-different-list-via-m` or `checklist-bulk-actions-mark-al` lose the meaningful tail. With 40+ archived changes, slugs are hard to distinguish.

2. **No `--auto` mode** (`no-accept-recommended-mode-for-discovery-rounds-when-driving`): when driving metta via automation or CI, every `AskUserQuestion` in the discovery loop requires manual selection. A flag that accepts the first "(Recommended)" option per question would unblock automated flows.

Both live in the propose/quick entry path so it makes sense to batch them.

## Proposal

1. **Bump slug cap** — change `artifact-store.ts:20` `.slice(0, 30)` to `.slice(0, 60)`. Keeps the existing stop-word filtering. Slugs go from ~30-char to ~60-char tails.

2. **Add `--auto` flag** — parse `--auto` (alias `--accept-recommended`) from `$ARGUMENTS` at the top of the `metta-propose` and `metta-quick` skill orchestrators. When present:
   - Skip the discovery loop's `AskUserQuestion` calls.
   - Automatically pick the first option (which is always the one labeled `(Recommended)` per skill conventions) for each question the orchestrator would have asked.
   - Pass-through to `metta propose`/`metta quick` CLI commands unchanged (the flag is orchestrator-level; the CLI doesn't need to know).

Scope limited to `metta-propose` and `metta-quick` source + deployed skill files. `/metta-auto` already bypasses interactive questions by design.

## Impact

- `src/artifacts/artifact-store.ts` — one-line cap bump (30 → 60)
- `src/templates/skills/metta-propose/SKILL.md` + `.claude/skills/metta-propose/SKILL.md` — add `--auto` parsing step + discovery-loop instruction when flag set
- `src/templates/skills/metta-quick/SKILL.md` + `.claude/skills/metta-quick/SKILL.md` — same pattern
- `tests/` — one test for the new 60-char cap; skill tests already validate byte-identity between source and deployed
- No schema changes, no CLI surface changes

## Out of Scope

- `/metta-auto`, `/metta-fix-issues`, `/metta-fix-gap` — not in this change's scope
- Retroactive rename of existing truncated archived changes
- Smarter slug generation (beyond raising the cap) — the existing stop-word filter is already decent
