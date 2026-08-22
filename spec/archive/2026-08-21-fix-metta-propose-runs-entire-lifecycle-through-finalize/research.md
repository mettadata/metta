# Research: fix-metta-propose-runs-entire-lifecycle-through-finalize

## Decision: Skill-level PR-open default + `ship` sentinel value

### Approaches Considered

1. **Skill-level default + `ship` sentinel** (selected) — The PR-open default lives in the propose skill text (Step 8 stops after `gh pr create` unless `STOP_AFTER = "ship"`); `propose.ts` accepts `ship` as a validation sentinel that short-circuits the `buildOrder` membership check; the skill maps a `--ship` argument token to `--stop-after ship`. No schema change (`stop_after: z.string().optional()` already validates `ship`), no boundary-logic change (`ship` never matches a planning artifact id, so the loop naturally runs to `all_complete`), ~6 lines in `propose.ts`. See `research-skill-level-default.md`.
2. **Persisted default (`stop_after: pr-open` written when flag absent)** — rejected. Fatal flaw: the skill's persisted-stop_after boundary check only matches artifact ids passed to `metta complete`; `pr-open` is not an artifact, so new Step-8 skill logic is needed anyway — the approach's sole advantage evaporates. It also contaminates `/metta-auto` and `/metta-fix-issues` change records (same CLI path), flips the semantic meaning of field-absence across epochs, and contradicts 4–5 existing propose-stop-after requirements (~half-rewrite of the capability). See `research-persisted-default.md`.

### Rationale

The selected approach is the minimal-change path that satisfies the recorded user decision exactly: default stop at PR-open, merge only via `--ship`/`stop-after=ship` through the existing propose-stop-after machinery, all existing stop-after values untouched, `/metta-auto` and `/metta-fix-issues` unchanged. All load-bearing claims were verified in-tree:

- The two SKILL.md copies are byte-identical and sync is already test-enforced (`tests/template-deploy-sync.test.ts`, `tests/skill-discovery-loop.test.ts:71`, `tests/grounding.test.ts:35-36`) — edit both copies identically, no new sync mechanism.
- `src/schemas/change-metadata.ts:116` accepts any string — `stop_after: ship` persists with zero schema changes; absent-flag behavior (no field written) is preserved, keeping the living spec's line-70 requirement intact.
- `src/cli/commands/propose.ts` needs only help-text plus a `ship` short-circuit before the `buildOrder` checks and `ship` added to the valid-value error lists. No CLI `--ship` boolean flag — the skill owns the alias, keeping a single source of truth.
- **CLAUDE.md's workflow section is generated**: wording must land in `src/cli/commands/refresh.ts:131` (Lifecycle-skills bullet) together with the checked-in `CLAUDE.md`, or the next `/metta-refresh` reverts it. `src/delivery/workflow-primer.ts` entry-point bullet makes no merge claim — untouched unless wording demands it.
- The living spec's scenario "skill behaves identically when no stop_after is set … finalize, and merge exactly as it does today" (`spec/specs/propose-stop-after/spec.md:104-107`) mandates the old behavior — the spec delta in this change already MODIFIES that requirement.

### Test strategy (from `research-docs-and-tests.md`)

New `tests/skill-propose-ship-gate.test.ts` modeled on `skill-discovery-loop.test.ts` (readFile + `toContain`/`not.toContain`):
1. Split content on the ship-gate heading; assert `gh pr merge` absent before it, present after it.
2. Assert removal of exact strings `Do NOT stop after the last artifact`, `finalize + ship must happen`, and the heading `Critical: You MUST verify, finalize, and ship`.
3. Assert one canonical new-default phrase (chosen at implementation, used verbatim in skill text and test — same literal anchor to avoid brittleness).
4. Assert the `Direct local merge of the change branch into main` prohibition survives.
5. Scope guard: assert `metta-auto` and `metta-fix-issues` templates still contain `gh pr merge` (run-to-merge preserved). Never glob over all skills — auto/fix-issues legitimately keep unconditional merge text.
Plus `tests/cli-propose-stop-after.test.ts` additions: `--stop-after ship` accepted and persisted; unknown-value error lists `ship`.

### Change surface

`.claude/skills/metta-propose/SKILL.md` + `src/templates/skills/metta-propose/SKILL.md` (Step 1 `--ship` alias, Step 3 clarifier, Step 8 split, Critical-section reword — byte-identical), `src/cli/commands/propose.ts`, `src/cli/commands/refresh.ts` + `CLAUDE.md`, `tests/skill-propose-ship-gate.test.ts` (new), `tests/cli-propose-stop-after.test.ts`. No changes to schemas, workflow YAMLs, metta-auto, or metta-fix-issues skills.

### Risks

- Grep-assert brittleness — mitigated by anchoring skill text and tests on the same literal marker (ship-gate heading / canonical phrase), authored in the same commit.
- CLAUDE.md regeneration clobber — mitigated by changing `refresh.ts` and `CLAUDE.md` together.
- Skill-level default is instruction-level, not runtime-enforced — an orchestrator could still merge; the tests guard the instructions, UAT covers the runtime behavior.
- Stale clause "unless the user asked to leave it open" must not survive on the default path where it reads as merge-by-default.

### Artifacts Produced

- [Research: skill-level default](research-skill-level-default.md)
- [Research: persisted default](research-persisted-default.md)
- [Research: docs and tests](research-docs-and-tests.md)
