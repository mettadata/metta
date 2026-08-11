# Research: fix-automatic-versioning-release-capability-metta

## Decision: Standalone `metta release` CLI surface (Candidate 1)

### Approaches Considered

1. **Standalone `metta release` CLI surface** (selected, 9/10) — Self-contained `src/release/` module + `release` command group (`metta release status` read-only, `metta release cut` mutating), optional `release:` block in `ProjectConfigSchema`, `metta-release` skill template, guard-hook Tier-2 authorization for `release:cut`. Every seam needed already exists in-code: flat Commander registration (`src/cli/index.ts:53-104`, `docs.ts` as template), strict optional Zod sub-configs (`src/schemas/project-config.ts:103-125`), a step-recorded git pipeline to clone (`MergeSafetyPipeline`, `src/ship/merge-safety.ts:22-28`), a code-assembled changelog generator with exactly two call sites (`src/docs/doc-generator.ts:205-235`; `docs.ts:41`, `finalizer.ts:269`), `askYesNo` confirmation helper, and direct guard/mint/skill precedent (`roadmap`, `metta-backlog`). Satisfies all spec requirements without touching merge-safety semantics or `version-drift.ts`. Full findings: [research-standalone-cli.md](research-standalone-cli.md).

2. **Finalize/ship integration (release-on-ship)** — 3/10. The spec independently mandates the standalone CLI + skill surface, so this candidate is strictly Candidate 1 plus a ship-side trigger — and the trigger's natural attachment point does not exist as testable code: the primary AI ship path is skill markdown driving `gh pr merge`, never `metta ship`/`MergeSafetyPipeline`. It couples release cadence to per-change shipping (prompt fatigue or one-change-per-version churn), amplifies worktree merge conflicts under metta's default parallel workflow, and touches the two most safety-sensitive lifecycle files for benefit a passive hint delivers more cheaply. Full findings: [research-release-on-ship.md](research-release-on-ship.md).

3. **Changelog-anchored minimal version tracking** — 3/10. Codebase fit alone would be 8/10, but the approach structurally fails the authored spec: no release commit, no annotated tag, no gh opt-in/degradation — 4 requirements unimplementable and 3 more needing add-backs. It leaves the most error-prone steps (tag/file/changelog consistency) manual, requires renegotiating an already-authored spec, and a follow-up change would re-open every touched file. The intent pre-labels it as under-delivering. Full findings: [research-minimal-version-tracking.md](research-minimal-version-tracking.md).

### Rationale

All three tracks converged: Candidates 2 and 3 each independently concluded "carry my durable pieces into Candidate 1." Candidate 1 satisfies the full spec (14 requirements), is purely additive for unconfigured projects by schema construction (`release: ReleaseConfigSchema.optional()` on a `.strict()` parent), keeps bump derivation / semver arithmetic / changelog grouping pure (functional core, imperative shell), and never touches the safety-critical merge path.

Key design inputs settled by research:

- **Command naming**: `metta release status` / `metta release cut` (not `metta version`) — avoids Commander `--version` collision and reuses existing two-word guard machinery.
- **Bump signal source**: archive `.metta.yaml` has no conventional-commit type field, so `git log <lastTag>..HEAD` (full log, NOT `--first-parent` — ship merge commits are `chore: merge metta/x`) is the primary derivation input; `!`/`BREAKING CHANGE:` ⇒ major, any `feat` ⇒ minor, else patch. Explicit `--bump` override is the escape hatch.
- **Semver**: no `semver` dependency exists; hand-roll a strict `x.y.z`-only ~25-line pure `bumpVersion` — no new dependency.
- **Changelog attribution**: two viable mechanisms surfaced — (a) git tree-containment (`git ls-tree <tag> spec/archive/<dir>`) and (b) a Zod-validated releases record snapshotting attributed archive dirNames at cut time. Design phase picks; the releases-record variant is exact, pure, survives finalize regeneration with zero git I/O in `DocGenerator`, and handles same-day ties — leaning that way, with tag-prefix listing still used for boundaries/backfill of manual v0.2.0–v0.4.0 tags.
- **Guard tier**: Tier 2 (session-tier) — the flow is confirmation-heavy (bump override, target-version confirm, gh opt-in) and must run in the main session where AskUserQuestion works. `release status` (and optionally bare `release`) allow-listed read-only; `release cut` → `BLOCKED_TWO_WORD` + `SKILL_SCOPES['metta-release'] = ['release:cut']`. Hook edits must land in BOTH `.claude/hooks/` and `src/templates/hooks/` copies.
- **Pipeline order** (zero mutations before abort points): config-check → git-check → clean-tree preflight → last-tag → collect-commits → derive-bump → confirm → target-tag-absent → write version file → regen changelog → release commit (`chore(release): x.y.z`) → annotated tag (never `-f`) → optional isolated `gh release create` (typed missing-binary vs unauthenticated degradation, never rolls back the local release). No push anywhere.
- **Salvaged from Candidate 2** (optional, additive): a `bump_signal` optional field in `ChangeMetadataSchema` written at finalize, and a non-blocking "changes pending release" hint at end of ship — nice-to-haves, not required for this change.
- **`git.enabled: false`**: `release cut` fails fast with actionable error; `release status` degrades to version-file-only output.

Estimated surface: ~9 new source files under `src/release/` + `src/cli/commands/release.ts` + skill template, ~8 modified, ~7 test files — standard tier, consistent with this change's workflow.

Main risks: doc-generator call-site ripple (finalize must keep the versioned shape — covered by a dedicated test), dual-copy hook drift (byte-identity test), and bump-signal fidelity depending on commit hygiene (mitigated by advisory recommendation + explicit override).

### Artifacts Produced

- [Approach research: Standalone CLI](research-standalone-cli.md)
- [Approach research: Release-on-ship](research-release-on-ship.md)
- [Approach research: Minimal version tracking](research-minimal-version-tracking.md)
