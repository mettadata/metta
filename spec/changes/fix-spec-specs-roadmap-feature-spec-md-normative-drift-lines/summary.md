# Implementation Summary — fix-spec-specs-roadmap-feature-spec-md-normative-drift-lines

## What changed

Spec-only reconciliation. `spec/specs/roadmap-feature/spec.md` rewritten to match the shipped issuesStore-backed implementation (PR #85 repointed roadmap.ts from the deleted BacklogStore to IssuesStore). Commit `c24364136`; no production code changed.

## Drift sites rewritten (evidence-grounded)

- L5: dropped reference to deleted `src/backlog/backlog-store.ts`; fixed stale test path to `tests/roadmap-store.test.ts`
- L25/30: title resolution now `IssuesStore.show` from `spec/issues/<slug>.md` (backlog items are issues with `backlog: true`) — roadmap.ts:53, backlog-view.ts:29
- L50/53: dangling = missing issue file in `spec/issues/`, surfaced via failed `IssuesStore.show` — roadmap.ts:52-57
- L65/68/73: `roadmap add` existence check → `IssuesStore.exists`; fixtures/read-only clauses repointed — roadmap.ts:85-88, issues-store.ts:270-273
- L98-105: `roadmap next` decoupled from `backlog promote` — next emits `metta propose "<title>"` via `buildPromoteHandoff`; promote independently emits zero-write `/metta-fix-issues <slug>` — roadmap.ts:153-167, promote-handoff.ts, backlog.ts:212-235
- New normative coverage: ADR-4 dangling-top `not_found` no-pop failure (exit 4, no write/commit) and `roadmap_error` fallback discriminator — roadmap.ts:19-25, 157-165
- L130/138/145/155: error contract, scenario premise, wiring clause, promote-handoff semantics updated accordingly

Guard/skill requirements (L158-205) verified accurate and untouched per intent. Grep confirms zero remaining `BacklogStore`/`spec/backlog` references in the spec.

## Findings

- No true code defect found; shipped behavior matches the corrected spec everywhere
- Cosmetic staleness noted out of scope: roadmap.ts:137 CLI description text; `buildPromoteHandoff` name

## Gates (implementation phase)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | pass |
| `npx vitest run tests/roadmap-store.test.ts tests/cli-roadmap.test.ts` | 36/36 pass |
| Full `npm test` | deferred to finalize (no code change) |
