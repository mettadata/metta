# Research: split `/metta-propose` into `/metta-propose-plan` + `/metta-propose-build` (Option 3)

## Approach

Replace (or supplement) the single `/metta-propose` skill with two skills:

- `/metta-propose-plan <description>` — runs Steps 1–3 of today's propose (CLI invocation, discovery loop, per-artifact planning loop) and exits cleanly after the last planning artifact.
- `/metta-propose-build` (no description) — runs Steps 5–8 against the active change (implementation, review, verification, finalize, merge).

Users who want the current end-to-end behavior either run both skills back-to-back or keep a thin `/metta-propose` orchestrator that calls into both.

## Where it touches the code

- `.claude/skills/metta-propose/SKILL.md` — either replaced wholesale or split into two new skill files. Either way, the existing skill must be either renamed or re-aliased to preserve user muscle memory.
- `.claude/skills/metta-propose-plan/SKILL.md` (new) — Steps 1–3 of today's skill, plus a clean exit message naming `/metta-propose-build` (or `/metta-execute`) as the next step.
- `.claude/skills/metta-propose-build/SKILL.md` (new) — Steps 5–8 of today's skill. Resumes against an active change. Behaviorally similar to today's `/metta-execute` + `/metta-verify` + `/metta-ship` already are.
- `CLAUDE.md` — every reference to `/metta-propose` must be re-evaluated. The "Lifecycle skills" table grows to include the two new skills. The "How to work" section needs to clarify when each is the right entry point.
- `src/cli/commands/propose.ts` — possibly unchanged (the CLI command stays the same), but every metta-* skill that references `/metta-propose` for routing (e.g. `/metta-fix-issues`, `/metta-fix-gap`) must be audited for compatibility.
- Tests — every fixture that currently asserts end-to-end propose behavior must either be split into plan + build halves or rewritten to invoke both skills.

## Pros

- **Explicit boundary.** The skill name itself signals where the workflow stops. No flags to parse, no hidden state on the change record.
- **Smaller per-skill prompts.** Each skill's SKILL.md is shorter and easier to reason about because it has half the responsibilities.
- **Aligns with the existing fragmented lifecycle skills.** `/metta-execute`, `/metta-verify`, `/metta-ship` already split execution from verification from finalize. Splitting propose follows the same shape.
- **Easier to extend.** Future "pause" points (e.g. `/metta-propose-spec` for spec-only) become natural new skills rather than new flag values.

## Cons

- **Doubles the skill surface area for one feature.** Every reader, every search-for-skill, every `/CLAUDE.md` reference, every metta-* documentation page now lists two skills where one used to suffice.
- **Breaks muscle memory.** Users who type `/metta-propose <desc>` today and expect end-to-end behavior must switch to either `/metta-propose-plan` + `/metta-propose-build` or to a re-aliased `/metta-propose`. Either path costs goodwill.
- **Re-entry semantics duplicate `/metta-execute`.** `/metta-propose-build` does what `/metta-execute` already does (resume against an active change). We end up with two skills that overlap heavily, OR we delete one and disrupt existing users.
- **No reduction in code surface.** The CLI command is unchanged; the orchestrator's logic is unchanged; only the skill packaging differs. We pay the cost of two skill files for a packaging concern that a single flag would resolve.
- **CLAUDE.md churn.** Every time the skill catalog appears in CLAUDE.md (currently 3 places: "Primary entry points", "Lifecycle skills", "Forbidden") the new skills must be added consistently. Every demo project's CLAUDE.md must be updated.
- **Migration burden for downstream tools.** `/metta-fix-issues`, `/metta-fix-gap`, `/metta-auto`, and any in-progress issue spec that references `/metta-propose` now reference a name whose semantics changed.
- **Worse for review-then-resume cycles.** With a flag, the user passes one flag and the change record carries the boundary. With a split, the user must remember which "build" skill to run later, possibly minutes or hours after planning. The state lives in the user's head, not the change record.
- **Cannot express partial planning stops.** Splitting at "plan vs build" is a single boundary. The user who wants to stop after spec.md but still run design.md and tasks.md cannot — they would need a third skill (`/metta-propose-spec` or similar). Option 1's `--stop-after <id>` covers all these cases with one flag.

## Complexity

Medium-high. The skill-file work is mechanical, but the cross-cutting documentation, alias-or-rename decision, downstream-skill audit, and migration messaging are real costs. Estimated 15–25 commits across the change set, plus a deprecation cycle if we keep `/metta-propose` as an alias.

## Fit with existing code

Poor. The metta skill catalog is already large. Adding two skills for a feature that a single flag would deliver pushes toward feature creep at the surface area where users are most exposed.

## Risks

- **`/metta-propose` aliasing.** If we keep `/metta-propose` as an alias for "plan + build", we have effectively shipped Option 3 alongside the current behavior, doubling surface area without removing anything.
- **Demo project drift.** `demos/todo`, `demos/trello-clone`, etc., all reference `/metta-propose`. Renaming or splitting requires updating every demo.
- **Documentation drift.** CLAUDE.md, the skill catalog, the project constitution — all must be updated consistently. Easy to miss one and ship a contradictory state.
- **Tests for resume semantics.** The split form requires explicit tests that `/metta-propose-build` correctly picks up an active change started by `/metta-propose-plan` (which `/metta-execute` already does).

## Recommendation strength

Reject. Option 3 is a packaging change masquerading as a feature. The same review gate is achievable with a single `--stop-after <id>` flag (Option 1) at far lower cost. Choose a flag now; revisit a skill split only if real users repeatedly say the flag UX is too discoverable.
