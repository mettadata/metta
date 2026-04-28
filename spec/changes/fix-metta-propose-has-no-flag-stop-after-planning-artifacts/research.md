# Research: fix-metta-propose-has-no-flag-stop-after-planning-artifacts

## Decision: Add `--stop-after <artifact>` to `metta propose` and the propose skill (Option 1)

### Approaches Considered

1. **`--stop-after <artifact>` flag (selected)** — One CLI option naming a planning-phase artifact id from the resolved workflow's `buildOrder`. CLI validates the value, persists it on the change record, and the propose skill exits cleanly when the named artifact is the most recently completed one. See `research-stop-after-flag.md`.
2. **`--stop-after-plan` boolean alias** — A sugar boolean that resolves to "stop after the last planning artifact" via a workflow-tail resolver. See `research-stop-after-plan-boolean.md`.
3. **Split `/metta-propose` into `/metta-propose-plan` + `/metta-propose-build`** — Two skills replace the single skill; the boundary is in the skill name rather than a flag. See `research-skill-split.md`.

### Per-Approach Summary

#### Option 1 — `--stop-after <artifact>`

- **Pros:** Expressive (any planning-phase id), deterministic boundary check, composes orthogonally with existing flags, low complexity, fits the existing flag taxonomy, easily testable on string equality and exact handoff line, future-extensible (Option 2 sugar can layer on top).
- **Cons:** Workflow-aware validation lives in the CLI command (small cross-layer coupling), users need to know artifact ids (mitigated by validation error listing them), slightly more typing than a boolean.
- **Complexity:** Low. CLI option + schema field + `createChange` plumbing + skill argument parse + post-`metta complete` check + tests. Estimated 6–10 small commits.
- **Fit with existing code:** Excellent. Every piece of plumbing already exists (option pattern, optional schema fields, skill argument parsing).
- **Risks:** Schema cannot validate against `buildOrder` (acceptable — same as `workflow: string`); minor extra YAML read per planning artifact in skill (negligible).

#### Option 2 — `--stop-after-plan` boolean alias

- **Pros:** One-token UX, hides artifact name space from new users, workflow-portable for the always-stop-at-planning-tail case.
- **Cons:** Hidden mapping (users debugging an unexpected exit must consult docs); workflow-internal coupling (resolver must classify artifacts as planning vs execution); less expressive than Option 1; ends up shipped alongside Option 1 anyway (sugar wrapper); harder to test (requires fixtures across multiple workflows); schema-drift risk if persisted as a boolean rather than a resolved id.
- **Complexity:** Medium. Adds a workflow-tail resolver and the planning/execution classification.
- **Fit with existing code:** Mediocre. The flag plumbing is fine but the resolver lacks a natural home.
- **Risks:** Resolver can be wrong silently on a custom or future workflow that restructures the tail; composability with `--stop-after` requires a precedence rule and tests.

#### Option 3 — split into `/metta-propose-plan` + `/metta-propose-build`

- **Pros:** Explicit boundary in the skill name, smaller per-skill prompts, aligns with existing fragmented lifecycle skills.
- **Cons:** Doubles skill surface area for one feature, breaks muscle memory, `/metta-propose-build` overlaps heavily with `/metta-execute` already, no reduction in code surface, CLAUDE.md and demo-project churn, migration burden for downstream skills (`/metta-fix-issues`, `/metta-fix-gap`, `/metta-auto`), state for "where to resume" lives in the user's head rather than the change record, cannot express partial stops (e.g. stop-after-spec).
- **Complexity:** Medium-high. Skill-file work is mechanical but cross-cutting docs, alias-or-rename decision, and migration messaging are real costs. Estimated 15–25 commits.
- **Fit with existing code:** Poor. The skill catalog is already large; adding two skills for a feature deliverable as one flag pushes toward feature creep where users are most exposed.
- **Risks:** Aliasing keeps both surfaces; demo and documentation drift; tests for resume semantics duplicate work `/metta-execute` already does.

### Rationale

Option 1 wins on every axis that matters here:

- **Smallest surface change.** One CLI flag, one optional schema field, one optional argument on `ArtifactStore.createChange`, one paragraph of skill update. No new skill files, no demo updates, no CLAUDE.md restructuring.
- **Most expressive.** Stops anywhere in the planning phase, not just at the planning-tail. Reviewers who only want to inspect spec.md before letting design.md cost budget can do so with `--stop-after spec`.
- **Composes cleanly.** `--workflow`, `--auto`, `--from-issue`, `--discovery` are all single-purpose orthogonal flags; `--stop-after` slots in next to them with no interaction bugs.
- **Deterministic and testable.** The boundary is a string equality check and an exact handoff line. Tests assert on those primitives — no fixtures needed beyond a temp-dir change.
- **Future-extensible.** If real users later say "I always want to stop at the planning tail and don't want to remember what `tasks` is", Option 2's `--stop-after-plan` becomes a thin sugar that resolves to the same `stop_after: <id>` field. We do not lock anything out.
- **Aligns with the issue's own analysis.** The issue logged on 2026-04-28 names Option 1 as the chosen path for exactly these reasons.

Options 2 and 3 are deferred. Option 2 ships better as a follow-up if real users ask for it; Option 3 is rejected because it pays the cost of two new skills for a feature deliverable as one flag.

### Recommendation

Adopt Option 1. Implement:

1. CLI option `--stop-after <artifact>` on `metta propose`, validated against the loaded workflow's `buildOrder` with `implementation` and `verification` explicitly forbidden.
2. Optional `stop_after: z.string().optional()` field on `ChangeMetadataSchema`.
3. Optional `stopAfter?: string` argument on `ArtifactStore.createChange` that persists the value to `.metta.yaml`.
4. Argument parsing in `.claude/skills/metta-propose/SKILL.md` Step 1 to extract and pass through the flag.
5. Post-`metta complete` boundary check in Step 3 that exits cleanly with the deterministic handoff line: `Stopped after \`<artifact>\`. Run \`<resume-command>\` to <next-action>.`
6. `metta status --json` surfaces `stop_after` when set.
7. Tests covering: schema accept/reject, `createChange` persistence, CLI flag parsing and validation (including unknown values, execution-phase rejection, planning-phase acceptance), end-to-end propose with `--stop-after spec` boundary behavior.

### Artifacts Produced

- [Approach 1: stop-after flag](research-stop-after-flag.md)
- [Approach 2: stop-after-plan boolean](research-stop-after-plan-boolean.md)
- [Approach 3: skill split](research-skill-split.md)
