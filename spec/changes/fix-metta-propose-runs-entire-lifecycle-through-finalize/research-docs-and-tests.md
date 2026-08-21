# Research: documentation sync + regression test enforcement

Slice for `fix-metta-propose-runs-entire-lifecycle-through-finalize` — /metta-propose default changes
from merge-PR to stop-at-PR-open (merge only via `--ship` / stop-after=ship).

All paths below are relative to the change root
`/home/utx0/Code/metta/.metta/worktrees/fix-metta-propose-runs-entire-lifecycle-through-finalize/`.

## 1. Skill copy sync — already enforced, no new mechanism needed

- `.claude/skills/metta-propose/SKILL.md` and `src/templates/skills/metta-propose/SKILL.md` are
  **byte-identical today** (verified via `diff`).
- `tests/template-deploy-sync.test.ts` auto-discovers every file under `src/templates/{agents,skills,hooks,statusline}`
  and asserts byte-identity with the committed `.claude/` copy, plus no-orphan checks. Any edit to the
  template without the deployed copy (or vice versa) fails CI.
- **Conclusion:** edit BOTH copies identically; no new sync test is required. `tests/skill-discovery-loop.test.ts`
  and `tests/grounding.test.ts` also read both paths, confirming the convention.

## 2. Regression test strategy

### Existing pattern to follow
`tests/skill-discovery-loop.test.ts` is the canonical grep-assert model: `readFile` the **template**
path, then `toContain` / `not.toContain` on stable phrases (byte-identity test covers the deployed copy
transitively). `tests/grounding.test.ts` uses the same shape. No existing test asserts on
`gh pr merge`, `Do NOT stop`, or the "Critical" section wording — new assertions are green-field.

### Recommended host file
**New file `tests/skill-propose-ship-gate.test.ts`** (options considered: extend
`skill-discovery-loop.test.ts` — wrong topic, discovery-loop only; extend `cli-propose-stop-after.test.ts` —
that file exercises the CLI binary in temp dirs, not skill content). A dedicated file matches the
1:1 topic-per-test-file convention and names the invariant.

### Recommended assertions (low-brittleness)
Read `src/templates/skills/metta-propose/SKILL.md` once, then:

1. **No unconditional merge instruction.** Split content on the ship-gate heading (whatever heading the
   new wording introduces, e.g. `## Ship (only when requested)`); assert `gh pr merge` does **not**
   appear in the portion before the gate heading, and appears at least once after it. This is the
   robust form of "merge is ship-gated" without regexing surrounding sentences.
   - Simpler fallback if the section layout stays flat: assert the line containing `gh pr merge` is
     preceded within the file by the gate marker phrase — but the split-on-heading form is less brittle.
2. **Old mandate removed.** `expect(content).not.toContain('Do NOT stop after the last artifact')` and
   `not.toContain('finalize + ship must happen')` — these exact strings exist today at lines 284 (the
   `## Critical: You MUST verify, finalize, and ship` block) and must go. Also
   `not.toContain('Critical: You MUST verify, finalize, and ship')` (assert on the heading text, which
   is the most stable token).
3. **New default stated.** Assert one short canonical phrase the new wording will contain, e.g.
   `toContain('stop after opening the PR')` (pick the exact phrase during implementation and use it
   verbatim — one phrase, not a paragraph).
4. **Preserved invariant.** `toContain('Direct local merge of the change branch into main')` — the
   git-merge prohibition must survive the rewrite.
5. **Scope guard for siblings.** In the same file, assert `src/templates/skills/metta-auto/SKILL.md` and
   `src/templates/skills/metta-fix-issues/SKILL.md` still `toContain('gh pr merge')` — locks in that
   run-to-merge remains their behavior (see §5).

Avoid: regexes over multi-sentence prose, line-number anchoring, asserting full paragraphs.

## 3. Wording touchpoints (exhaustive)

| # | Path | Current wording | Action |
|---|------|-----------------|--------|
| 1 | `src/templates/skills/metta-propose/SKILL.md` | Step 8d–f (`gh pr checks --watch`, `gh pr merge`, post-merge cleanup, ~lines 273–280) + `## Critical: You MUST verify, finalize, and ship` (lines 281–288) + line 110 mention of "Step 8 (finalize/merge)" | Primary edit: gate merge behind `--ship`/stop-after=ship |
| 2 | `.claude/skills/metta-propose/SKILL.md` | identical copy | Same edit, byte-identical |
| 3 | `CLAUDE.md` line 74 | `- /metta-propose <description> — start a new change (standard workflow)` (inside `<!-- metta:workflow-start -->` … `end` markers, lines 39–101 — **generated**) | Update to note stop-at-PR default; must match generator output |
| 4 | `src/cli/commands/refresh.ts` line 131 | pushes the same Lifecycle-skills bullet literally | Generator source for #3 — must change in lockstep |
| 5 | `src/delivery/workflow-primer.ts` line 17 (`ENTRY_POINTS_BULLETS`) | `/metta-propose <description> — anything non-trivial…` (feeds both `workflowPrimerShort` → init scaffold and `workflowPrimerLong` → refresh, surfaces as CLAUDE.md line 48) | Only touch if the new default is mentioned in the entry-point bullet; current text doesn't claim merge behavior — likely no change, decide at implementation |
| 6 | `spec/specs/propose-stop-after/spec.md` line 107 | "THEN the orchestrator MUST proceed through implementation, review, verification, finalize, and merge exactly as it does today" (no-stop-after default scenario) | **Spec conflict** — needs a spec delta in this change; flag to the slice owning spec updates |
| 7 | `docs/api.md` ~lines 1373–1420 (propose-stop-after section) | mirrors #6 scenarios incl. "skill behaves identically when no stop_after is set" | Updated when specs merge at finalize (docs are ship-phase output); no manual pre-edit needed beyond spec delta |
| 8 | `docs/architecture.md` line 231 / `docs/getting-started.md` line 10 / `docs/README.md` line 3 | generic "propose → … → finalize → ship" lifecycle phrasing | No change — describes the framework lifecycle, not propose's default endpoint. Optionally clarify in architecture.md line 231 decision note |

## 4. CLAUDE.md workflow section IS generated

`metta refresh` (`src/cli/commands/refresh.ts`) rewrites the `<!-- metta:workflow-start/end -->` block:
line 127 splices `workflowPrimerLong()` and lines 130–131 emit the hard-coded `### Lifecycle skills`
bullets. **Any wording change must land in `refresh.ts` (and `workflow-primer.ts` if that bullet
changes) AND the checked-in `CLAUDE.md`**, or the next refresh reverts it. `tests/refresh.test.ts`
line 241 and `tests/cli-skills.test.ts` line 62 assert `/metta-propose` presence only (not the
descriptive text) — safe. `tests/delivery.test.ts` asserts primer structure, not the propose bullet.

## 5. Sibling skills — keep vs change

- `src/templates/skills/metta-auto/SKILL.md` (steps 9–13, `## Critical: You MUST review, verify,
  finalize, and ship`, line 86 "Do NOT stop after verification — finalize + ship must happen"):
  **KEEP** — auto is explicitly full-lifecycle run-to-merge.
- `src/templates/skills/metta-fix-issues/SKILL.md` (steps 9–10 incl. `gh pr merge`, line 127):
  **KEEP** — fix-issues runs to merge.
- `src/templates/skills/metta-ship/SKILL.md`: **KEEP** — ship is the merge path; propose's new wording
  should point users here (or to `--ship`) for landing the PR.
- `src/templates/skills/metta-next/SKILL.md`, `metta-quick/SKILL.md`: no merge-behavior claims about
  propose found — no change (verify quick during implementation; it has its own ship steps out of scope).
- Deployed `.claude/skills/` twins of any file touched must be updated identically (§1).

## Recommendation

Host new assertions in `tests/skill-propose-ship-gate.test.ts` using the split-on-heading +
`toContain`/`not.toContain` strategy above (assertions 1–5). Rely on the existing
`template-deploy-sync.test.ts` for copy sync. Update `refresh.ts` line 131 + checked-in `CLAUDE.md`
line 74 together; leave `workflow-primer.ts` untouched unless the entry-point bullet gains
default-behavior wording. Flag the `propose-stop-after` spec scenario (touchpoint #6) to the spec-delta
slice — it currently mandates the old merge-by-default behavior.

## Risks

- **Phrase-anchored assertions couple test to wording**: mitigated by anchoring on short canonical
  tokens (headings, command strings) chosen at implementation time; the test file must be authored in
  the same commit as the wording change.
- **refresh reverts CLAUDE.md** if `refresh.ts`/primer are missed — highest-likelihood regression;
  covered by touchpoints #3/#4 landing together.
- **Spec contradiction** (#6): if the spec delta is skipped, verification against
  `propose-stop-after/spec.md` line 107 will fail the new behavior.
- No web grounding needed — all findings are from in-tree code; no external API claims made.
