# fix-spec-specs-roadmap-feature-spec-md-normative-drift-lines

## Problem

The living spec `spec/specs/roadmap-feature/spec.md` still normatively requires the retired `BacklogStore` and `spec/backlog/<slug>.md` resolution model, but the shipped code was repointed to the issues store in the backlog/milestones rework (PR #85). A normative document now contradicts the implementation it governs, which poisons every downstream consumer: verification against this spec would flag correct code as non-compliant, `/metta-import` reconciliation would report false gaps, and an AI agent implementing a roadmap change from this spec would reintroduce deleted infrastructure.

Concrete drift, verified against the worktree (line numbers in the current spec):

- **Line 5** — `RoadmapStore` is required to be "modeled on `src/backlog/backlog-store.ts`". That file no longer exists; `src/backlog/` now holds only `backlog-view.ts` (a pure frontmatter view) and `backlog-migrate.ts` (legacy migration). `BacklogStore` survives only as a historical comment reference.
- **Line 25** — the status view must resolve titles "from the referenced `spec/backlog/<slug>.md` item". Shipped code (`src/cli/commands/roadmap.ts:53`) resolves titles via `ctx.issuesStore.show(slug)` against `spec/issues/<slug>.md`; backlog items are issues with `backlog: true` frontmatter, and `spec/backlog/` does not exist.
- **Lines 50, 53** — the dangling-entry requirement defines "dangling" as a slug missing from `spec/backlog/` "checked via `BacklogStore.exists` or an equivalent failed `BacklogStore.show` resolution". Shipped behavior: a failed `issuesStore.show` marks the row dangling.
- **Lines 65, 68, 73** — `roadmap add` must verify existence "via `BacklogStore.exists`", reject slugs "not present in `spec/backlog/`", and consume `BacklogStore` read-only. Shipped code (`roadmap.ts:85`) calls `ctx.issuesStore.exists(slug)` and never touches `spec/issues/` files.
- **Lines 98–105** — `roadmap next` must activate "via the exact same path `backlog promote` uses — resolving the item with `BacklogStore.show` and emitting the `metta propose "<title>"` handoff — such that any future change to promote's activation semantics automatically applies to `roadmap next`". That coupling was deliberately severed: `backlog promote` now performs zero writes and emits a `/metta-fix-issues <slug>` handoff, while `roadmap next` is the sole consumer of `buildPromoteHandoff` (`src/cli/promote-handoff.ts`), resolving via `issuesStore.show` and emitting `metta propose "<title>"` itself. The spec's shared-path invariant is not just stale — it now describes a guarantee that no longer exists and was intentionally removed.
- **Line 138** — error-contract scenario premises on "the slug `nope` does not exist in `spec/backlog/`".
- **Lines 145, 152–155** — the wiring requirement mandates "`BacklogStore` is consumed read-only (`exists`, `show`) and MUST NOT be modified" and that the backlog suite shows "no change to promote's propose-handoff activation semantics" — promote no longer has propose-handoff semantics to preserve.

Additionally, shipped behavior includes two elements the spec does not cover at all, discovered during verification: (1) `roadmap next` with a dangling top entry fails typed `not_found` with exit 4 and **no pop, no write, no commit** (an explicit ADR-4 decision in `roadmap.ts:157–165` — silently popping would destroy roadmap intent), and (2) the error mapper carries a defensive `roadmap_error` fallback discriminator beyond the four types the error-contract requirement enumerates.

## Proposal

Route this through spec reconciliation as a dedicated change: author a spec delta at `spec/changes/fix-spec-specs-roadmap-feature-spec-md-normative-drift-lines/spec.md` that merges into `spec/specs/roadmap-feature/spec.md` on finalize, rewriting the stale requirements to describe the shipped issuesStore-backed behavior while preserving each requirement's intent wherever behavior is equivalent.

Specifically, the delta will:

1. **Repoint resolution to the issue store.** Replace every `BacklogStore.exists` / `BacklogStore.show` / `spec/backlog/<slug>.md` reference (lines 5, 25, 50, 53, 65, 68, 73, 138, 145) with `IssuesStore.exists` / `IssuesStore.show` against `spec/issues/<slug>.md`, where a "backlog item" is an issue carrying `backlog: true` frontmatter. Requirement intent — read-only consumption, existence check before write, `not_found` rejection with unchanged roadmap file, dangling entries surfaced not fatal — carries over unchanged.
2. **Restate `roadmap next` activation as decoupled from `backlog promote`.** Drop the shared-path invariant; specify that `roadmap next` resolves the top entry via `IssuesStore.show` and emits the `metta propose "<title>"` handoff through the dedicated `buildPromoteHandoff` helper, while `backlog promote` independently hands off to `/metta-fix-issues <slug>`. Pop-after-handoff, auto-commit, and the empty-roadmap `{"next": null}` no-op are unchanged.
3. **Specify the shipped dangling-top-entry behavior of `roadmap next`.** Add a requirement/scenario capturing the ADR-4 decision: a dangling top entry fails `not_found` (exit 4) with a recovery hint, without popping, writing, or committing.
4. **Align the error contract with the shipped discriminators.** Keep `not_found`, `duplicate_entry`, `invalid_reorder`, `branch_guard` as the primary types; acknowledge the defensive `roadmap_error` fallback for unclassified failures, and note that `roadmap next` can itself fail `not_found`.
5. **Fix collateral stale phrasing** in the wiring requirement (line 145: "modeled on" reference, promote-semantics preservation clause) and any scenario Given-clauses that stage fixtures under `spec/backlog/`.

No production code changes: reading `src/roadmap/roadmap-store.ts`, `src/cli/commands/roadmap.ts`, `src/cli/promote-handoff.ts`, and `src/cli/commands/backlog.ts` against the spec surfaced no true defect — the shipped behavior is internally coherent and matches the reworked backlog model. Every discrepancy found is spec-side drift, resolved by rewriting the spec, not the code.

## Impact

- **`spec/specs/roadmap-feature/spec.md`** (73 requirements-scenarios capability) — the affected requirements are rewritten; the capability's requirement count may grow by one if the dangling-top behavior lands as a new requirement rather than a scenario on the existing `roadmap next` requirement.
- **Verification and import fidelity** — `/metta-verify`, `/metta-import`, and gap reconciliation stop producing false mismatches for the roadmap capability; the spec becomes a trustworthy implementation reference again.
- **No runtime impact** — no source, test, template, hook, or skill files change; no behavior visible to CLI users changes.
- **Docs** — `docs/api.md` roadmap scenarios regenerate from the corrected spec at finalize if the pipeline covers them; no manual doc edits in this change.
- **Risk** — low. The main risk is over- or under-correcting a requirement so it no longer matches either the old intent or the shipped code; mitigated by anchoring every rewrite to the verified source readings cited above.

## Out of Scope

- **Production code changes** of any kind — `src/`, `test/`, hooks, skills, templates. If review of the spec delta surfaces a genuine code defect, it gets logged as a separate issue, not fixed here.
- **Re-coupling `roadmap next` to `backlog promote`** or otherwise redesigning the activation handoff — the decoupled design shipped in PR #85 is treated as the accepted baseline.
- **Backlog/milestones capability specs** — any parallel drift in other specs (e.g. backlog-as-frontmatter-view requirements living elsewhere) is not audited or fixed by this change.
- **`buildPromoteHandoff` naming** — the helper's name references the retired promote coupling; renaming it is a code refactor and stays out.
- **Guard hook and skill requirements** (spec lines 158–205) — verified against the worktree as still accurate (`backlog add/done/promote` Tier 2 entries, `/metta-roadmap` skill flow, `backlog list --json` slug sourcing); no rewrite needed, so they are untouched.
- **General docs sweep** — no edits to `docs/architecture.md`, `docs/getting-started.md`, README, or CLAUDE.md beyond whatever finalize regenerates automatically.
