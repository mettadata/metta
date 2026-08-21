# Summary: fix-metta-propose-runs-entire-lifecycle-through-finalize

## What changed

`/metta-propose`'s default terminal state is now **PR-open**: the skill runs the full pipeline (discovery → planning → implementation → verification → finalize → push → `gh pr create`) then stops and reports the PR URL. It no longer runs `gh pr merge` by default. Merging is an explicit opt-in via `--ship` (skill alias) or `--stop-after ship`, wired through the existing propose-stop-after machinery. `/metta-auto` and `/metta-fix-issues` keep run-to-merge behavior unchanged.

## Implementation (per task)

- **Task 1.1** (`9018ce0ab`) — Both propose SKILL.md copies (`.claude/skills/` + `src/templates/skills/`, byte-identical): Step 1 `--ship` alias parse rule; Step 3 clarifier that `ship` is not a planning boundary; Step 8 restructured — default path ends after `gh pr create` with the handoff `PR open for review: <pr-url>. Run /metta-ship to land it...`; `gh pr checks --watch` / `gh pr merge` / cleanup relocated under the ship-gate marker (`Ship opt-in — the following sub-steps run ONLY when STOP_AFTER = "ship" ...`); Critical section retitled `Critical: verify, finalize, and open the PR`. Forbidden strings (`Do NOT stop after the last artifact`, `finalize + ship must happen`, `unless the user asked to leave it open`, old Critical title) removed.
- **Task 1.2** (`f78616379`) — `src/cli/commands/propose.ts`: `--stop-after` help names `ship`; `ship` short-circuits `buildOrder` validation; both error valid-lists include `ship`. No schema/persistence changes; absent flag still writes no `stop_after` field.
- **Task 1.3** (`8338af2e1`) — `src/cli/commands/refresh.ts` generator bullet + checked-in `CLAUDE.md` lifecycle bullet updated in lockstep: "ends at an open PR — merge via `--ship` or `/metta-ship`".
- **Task 2.1** (`7ee8d6253`) — New `tests/skill-propose-ship-gate.test.ts` (10 tests): split-on-marker placement of merge commands, default/handoff anchors present, forbidden phrases absent, local-merge prohibition and `gh pr create` survive, scope guard that metta-auto and metta-fix-issues templates still contain `gh pr merge`.
- **Task 2.2** (`57111098e`) — `tests/cli-propose-stop-after.test.ts`: `--stop-after ship` accepted and persisted (`stop_after: ship` in `.metta.yaml`), unknown-value error lists `ship`, `--help` names `ship`.

## Verification

- `npx tsc --noEmit` — clean.
- `npm test` — 134/134 files, 2709 passed, 2 skipped, 0 failed.
- Targeted suite (ship-gate, cli-propose-stop-after, skill-discovery-loop, grounding, template-deploy-sync, cli-skills) — 110/110 passed.
- Change surface confirmed: only the intended 7 files plus change artifacts; no edits to metta-auto/metta-fix-issues, schemas, workflow YAMLs, or workflow-primer.ts.

## Notes / deviations

- Commander wraps help text at 80 columns, so the help test asserts `ship` within the full `--stop-after` option entry (flag line + continuation) rather than one physical line — same intent, robust to wrapping.
- Skill-level default is instruction-level, not runtime-enforced; the grep-assert tests guard the instructions.

## Verify phase (3 verifiers, iteration #1)

- **Test suite:** 134/134 files, 2709 passed, 2 skipped, 0 failed.
- **Typecheck + lint:** `npx tsc --noEmit` clean; `npm run lint` clean.
- **Spec coverage:** PASS — all 8 delta requirements verified, 22/23 scenarios COVERED, 1 PARTIAL (non-default-workflow stop-after id untestable due to known full-workflow template issue; validation is generically buildOrder-driven). Mutation test confirmed the ship-gate grep-assert fails when an unconditional `gh pr merge` is reinjected.

## Review phase

- Round 1: Correctness PASS, Security PASS_WITH_WARNINGS, Quality PASS_WITH_WARNINGS. Two majors fixed in `c53dfe94c`: quick-reroute now carries the PR-open default over; `--ship` parsing constrained to standalone flag token with a mandatory "Ship opt-in detected" announcement. Step 8.d made the exhaustive no-merge else-branch; stale "finalize/merge" label fixed.
- Round 2: Correctness PASS, Security PASS_WITH_WARNINGS, Quality PASS_WITH_WARNINGS. Both majors confirmed closed; residual warnings all fail safe (worst case stops at open PR) — recorded in review.md with a follow-up recommendation.
