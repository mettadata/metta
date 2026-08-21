# Research: skill-level default + `ship` sentinel value

Approach: no persisted `stop_after` when the flag is absent (PR-open default lives in the skill text); `--stop-after ship` is a validation sentinel accepted by `propose.ts` for every workflow; the skill maps a `--ship` argument token to `--stop-after ship`.

## Findings

### 1. SKILL.md copies — confirmed byte-identical

`diff .claude/skills/metta-propose/SKILL.md src/templates/skills/metta-propose/SKILL.md` → identical. Byte-identity is already test-enforced twice: `tests/skill-discovery-loop.test.ts:71` and `tests/grounding.test.ts:35-36`. Both copies must receive the same edit.

Exact sections to change (line numbers from the current file):

| Lines | Section | Change |
|---|---|---|
| 45–51 | Step 1, `--stop-after` parsing | Add a `--ship` parse rule: if `$ARGUMENTS` contains the token `--ship`, remove it and set `STOP_AFTER = "ship"`. Note `ship` as a valid CLI value alongside planning ids. |
| 53–58 | Step 1, command matrix | No structural change — `--ship` collapses into the existing `--stop-after <value>` invocations (`--stop-after ship`). Update the trailing note if desired. |
| 101–119 | Step 3, stop-after boundary check | Naturally compatible, one clarifying line needed: `ship` never equals a planning artifact id, so the boundary check never fires and the pipeline runs through Step 8 — add "`ship` is not a planning boundary; it is handled in Step 8" so the orchestrator doesn't error hunting for a `ship` artifact. Resume-command mapping (lines 113–116) unchanged. |
| 272–278 | Step 8 | Split: default path ends after 8c (`gh pr create`) + report PR URL naming `/metta-ship`; 8d (`gh pr checks --watch`), 8e (`gh pr merge`), 8f (cleanup) become conditional on `STOP_AFTER = "ship"` (or persisted `stop_after: ship`). |
| 281–288 | "Critical: You MUST verify, finalize, and ship" | Reword title + line 284 ("Do NOT stop after the last artifact — finalize + ship must happen"). Mandate: verify, finalize, push, PR create; merge only when `stop_after = ship`. Keep lines 286–288 (PR-only shipping, orphaning, silent-write) intact. |

### 2. `src/cli/commands/propose.ts` — small, localized change

- Line 17–20: option help string must add `ship` ("…design, tasks, or `ship` to run through merge").
- Lines 38–54: validation. `ship` short-circuits before the `buildOrder` checks (`if (stopAfter === 'ship') { /* accepted */ }`), and `validList` becomes `planningIds.join(', ') + ', ship'` so both error messages name it. Persistence needs zero change — `stopAfter` already flows into `createChange(...)` (line 74) and into JSON output `stop_after: stopAfter ?? null` (line 86); `ship` rides the same path. Exit-code-4 contract (line 113) untouched.
- **No `--ship` CLI flag is needed.** The skill owns the alias (spec scenario "skill parses and forwards `--ship`"); the CLI surface stays single-flag. Adding a CLI `--ship` boolean would create a second source of truth and a flag-conflict question (`--ship` + `--stop-after tasks`) for no requirement.

### 3. Schema — no change required

`src/schemas/change-metadata.ts:116` → `stop_after: z.string().optional()` inside a `.strict()` object. Any string validates; `stop_after: ship` persists with no schema edit, and absent-flag runs omit the field exactly as today (already asserted by `tests/cli-propose-stop-after.test.ts:102-114`). Optional hardening (a `z.enum`) is explicitly NOT wanted — the valid set is workflow-dependent (`domain-research` etc.), so a string is correct.

### 4. Boundary-check fit

The Step 3 check compares the just-completed artifact id against `STOP_AFTER` / persisted `stop_after`. Since no workflow's `buildOrder` contains `ship`, `stop_after: ship` never matches and the loop runs to `all_complete: true` — exactly the desired "run to merge" semantics with zero boundary-logic changes. The only fragility is an orchestrator second-guessing an unknown value; the one clarifying sentence in Step 3 removes that.

### 5. Established grep-assert test pattern

`tests/skill-discovery-loop.test.ts` is the canonical shape: `readFile` template + deployed copies, `expect(contents).toContain(...)` / `.not.toContain(...)`, plus a byte-identity test. New file (e.g. `tests/skill-propose-pr-open-default.test.ts`) should assert over BOTH copies:
- every line containing `gh pr merge` also matches a ship condition (e.g. `/stop_after\s*=?\s*"?ship"?/i` on the same line/step block);
- the unconditional mandate phrase `finalize + ship must happen` is absent;
- `gh pr create` still present (keeps `tests/cli-skills.test.ts:287` "PR-based shipping" test green — it only requires `gh pr create` present and `git merge metta/` absent, both preserved).

**Scoping trap:** `metta-auto/SKILL.md:78,86` and `metta-fix-issues/SKILL.md:90,127` legitimately contain unconditional `gh pr merge` and `finalize + ship must happen`. The grep-asserts MUST target only the two metta-propose files, never a glob over `skills/`.

### 6. CLAUDE.md wording (adjacent finding)

`CLAUDE.md`'s workflow section is generated: primer text lives in `src/delivery/workflow-primer.ts:17` and skill list lines in `src/cli/commands/refresh.ts:131`. Editing only the checked-in `CLAUDE.md` would be reverted by the next `/metta-refresh` — the durable edit is in `workflow-primer.ts` (and/or `refresh.ts` line 131), then regenerate. The spec only mandates the CLAUDE.md text; touching the generator too is the correct implementation of it.

## File-by-file change list

1. `.claude/skills/metta-propose/SKILL.md` — Step 1 `--ship` alias, Step 3 clarifier, Step 8 split, Critical section reword.
2. `src/templates/skills/metta-propose/SKILL.md` — identical edit (byte-for-byte).
3. `src/cli/commands/propose.ts` — help text + `ship` sentinel in validation + `ship` in error valid-lists (~6 lines).
4. `tests/cli-propose-stop-after.test.ts` — add: `--stop-after ship` accepted/persisted (`stop_after: ship` in `.metta.yaml`); unknown-value error lists `ship`.
5. `tests/skill-propose-pr-open-default.test.ts` (new) — grep-asserts per §5, both copies, propose-only scope.
6. `src/delivery/workflow-primer.ts` (+ regenerated `CLAUDE.md`) — PR-open default wording; `refresh.ts:131` propose one-liner optionally updated.

No changes: schemas, workflow YAMLs, state-store, metta-auto / metta-fix-issues skills (requirement explicitly forbids touching them).

## Risks

- **Sync risk (low, test-covered):** forgetting one SKILL.md copy fails two existing byte-identity tests immediately.
- **Grep-assert brittleness (medium):** "merge only in ship-conditioned text" is a heuristic over prose. Mitigate by structuring Step 8's ship sub-steps under an explicit literal marker (e.g. a line containing both `stop_after = ship` and the `gh pr merge` command, or a `**Ship opt-in (`stop_after: ship`):**` heading the test keys on) — write the skill text and the test against the same anchor string.
- **Orchestrator drift (medium, inherent):** a skill-level default is instruction-following, not enforced state — an LLM orchestrator could still merge. The grep-asserts guard the instructions, not runtime behavior; UAT scenario "captured session contains no `gh pr merge`" covers the runtime side.
- **CLAUDE.md regeneration:** editing only CLAUDE.md silently loses the wording on next refresh (see §6).
- **Existing conditional in 8e:** current text already has "unless the user asked to leave it open" — the rewrite must not leave this stale clause on the default path where it would read as merge-by-default.

## Verdict

**Feasible — recommended.** All load-bearing claims verified in-code: schema accepts `ship` with zero changes, `propose.ts` needs ~6 lines, the Step 3 boundary logic needs no modification (only a clarifier), copies are currently identical, and an established grep-assert + byte-identity test pattern exists to guard regressions. Total surface: 2 skill files, 1 CLI file, 1 generator file, 2 test files. The main design caution is anchoring the grep-assert tests and the ship-conditioned skill text on the same literal marker so the tests are robust rather than prose-matching.
