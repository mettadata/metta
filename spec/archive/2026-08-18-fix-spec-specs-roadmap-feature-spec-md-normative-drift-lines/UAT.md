# UAT: fix-spec-specs-roadmap-feature-spec-md-normative-drift-lines

- **Change**: fix-spec-specs-roadmap-feature-spec-md-normative-drift-lines
- **Generated**: 2026-08-18
- **Source**: intent + summary (reduced)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

*Reduced script — derived from intent/summary; steps are confirmation prompts.*

### Intent proposal

#### Step 1.1
- **Do**: Confirm: Repoint resolution to the issue store. Replace every `BacklogStore.exists` / `BacklogStore.show` / `spec/backlog/<slug>.md` reference (lines 5, 25, 50, 53, 65, 68, 73, 138, 145) with `IssuesStore.exists` / `IssuesStore.show` against `spec/issues/<slug>.md`, where a "backlog item" is an issue carrying `backlog: true` frontmatter. Requirement intent — read-only consumption, existence check before write, `not_found` rejection with unchanged roadmap file, dangling entries surfaced not fatal — carries over unchanged.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Restate `roadmap next` activation as decoupled from `backlog promote`. Drop the shared-path invariant; specify that `roadmap next` resolves the top entry via `IssuesStore.show` and emits the `metta propose "<title>"` handoff through the dedicated `buildPromoteHandoff` helper, while `backlog promote` independently hands off to `/metta-fix-issues <slug>`. Pop-after-handoff, auto-commit, and the empty-roadmap `{"next": null}` no-op are unchanged.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: Specify the shipped dangling-top-entry behavior of `roadmap next`. Add a requirement/scenario capturing the ADR-4 decision: a dangling top entry fails `not_found` (exit 4) with a recovery hint, without popping, writing, or committing.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.4
- **Do**: Confirm: Align the error contract with the shipped discriminators. Keep `not_found`, `duplicate_entry`, `invalid_reorder`, `branch_guard` as the primary types; acknowledge the defensive `roadmap_error` fallback for unclassified failures, and note that `roadmap next` can itself fail `not_found`.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.5
- **Do**: Confirm: Fix collateral stale phrasing in the wiring requirement (line 145: "modeled on" reference, promote-semantics preservation clause) and any scenario Given-clauses that stage fixtures under `spec/backlog/`.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Spec-only reconciliation. `spec/specs/roadmap-feature/spec.md` rewritten to match the shipped issuesStore-backed implementation (PR #85 repointed roadmap.ts from the deleted BacklogStore to IssuesStore). Commit `c24364136`; no production code changed.

#### Step 2.1
- **Do**: Confirm: L5: dropped reference to deleted `src/backlog/backlog-store.ts`; fixed stale test path to `tests/roadmap-store.test.ts`
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: L25/30: title resolution now `IssuesStore.show` from `spec/issues/<slug>.md` (backlog items are issues with `backlog: true`) — roadmap.ts:53, backlog-view.ts:29
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: L50/53: dangling = missing issue file in `spec/issues/`, surfaced via failed `IssuesStore.show` — roadmap.ts:52-57
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.4
- **Do**: Confirm: L65/68/73: `roadmap add` existence check → `IssuesStore.exists`; fixtures/read-only clauses repointed — roadmap.ts:85-88, issues-store.ts:270-273
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.5
- **Do**: Confirm: L98-105: `roadmap next` decoupled from `backlog promote` — next emits `metta propose "<title>"` via `buildPromoteHandoff`; promote independently emits zero-write `/metta-fix-issues <slug>` — roadmap.ts:153-167, promote-handoff.ts, backlog.ts:212-235
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.6
- **Do**: Confirm: New normative coverage: ADR-4 dangling-top `not_found` no-pop failure (exit 4, no write/commit) and `roadmap_error` fallback discriminator — roadmap.ts:19-25, 157-165
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.7
- **Do**: Confirm: L130/138/145/155: error contract, scenario premise, wiring clause, promote-handoff semantics updated accordingly
- **Observe**: behaves as described
- [ ] Pass
