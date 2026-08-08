# Research: Capability Mapping for Token-Usage Tracking

**Change:** token-usage-tracking-finalize-report-report-data-only-no
**Question:** Where should this change's requirements permanently live in the spec store?
**Date:** 2026-08-08

## Question

The change spans six surfaces: `token_usage` schema (schemas), `metta tokens record` CLI, guard-hook allowlist (orchestration-guard), skill recording instruction (instruction-contracts), finalize TOKENS.md report + config toggle (finalize-ship / config-loader), and a `metta progress` aggregate. A spec delta must merge somewhere. Three candidate mappings were evaluated.

## Hard Constraints From Merge Tooling

Read directly from `src/finalize/spec-merger.ts` (worktree copy):

1. **One delta file, one capability per change.** `SpecMerger` reads exactly one file, `changes/<name>/spec.md`, and resolves the merge-target capability once from the delta's H1 title (`toSlug(deltaSpec.title...)`, lines 66-72). Every `ADDED/MODIFIED/...` block in that file merges into that single capability. There is no mechanism for one change to fan requirements out to multiple capability specs.
2. **Net-new capabilities require explicit confirmation.** Per the finalize-ship spec requirements *Explicit Capability Target Selection In Spec Authoring* and *Merge Target Confirmation At Completion* (`spec/specs/finalize-ship/spec.md`, lines 205-240), an H1 that names a nonexistent capability is refused by `metta complete spec` unless the `<!-- new-capability -->` marker sits immediately under the H1. So option (c) is possible, but deliberate and ceremonial — never accidental.

Constraint 1 is decisive: any "split" mapping is not a delta-authoring choice, it is a change-decomposition choice (multiple metta changes) or a merger-tooling change.

## Precedent Survey

Three prior multi-surface changes were examined:

### 1. UAT generation at finalize (2026-07-21) — nearest structural analog

`spec/archive/2026-07-21-uat-document-generation-at-finalize-every-finalized-change/spec.md` has **H1 = `finalize-ship`**. It is the direct template for this change: a finalize-time report (UAT.md), a project-config toggle (`UatConfigSchema` — a schemas-file edit), template externality, degradation behavior, and additive `uatPath` output all specified as finalize-ship requirements. All nine of its requirements live in `spec/specs/finalize-ship/spec.md` today (lines 263-460), including the config-schema requirement, with no relocation or reconciliation gap logged since. This change's spec.md deliberately mirrors that delta requirement-for-requirement (report generation, no-stray, content, toggle, degradation, output path).

### 2. Model-escalation record (2026-07-17) — the scope-note pattern

`spec/archive/2026-07-17-model-tier-routing-orchestration-agents-top-tier-models/spec.md` has **H1 = `instruction-contracts`** and opens with an HTML comment functioning as a single-target scope note: it explicitly delegates Rung-2 behavior to `adaptive-workflow-tier-selection` and justifies authoring the escalation-rate `metta progress` metric requirement inside instruction-contracts "because the events it reports on ... are artifacts emitted by this capability" — i.e., a progress-dashboard requirement specified under a non-progress capability, chosen by center of gravity. This is the established "single-target limitation" pattern the current draft spec.md's *Token Tracking Delta Scope Note* requirement follows.

### 3. Iteration-record change (2026-04-21) — the cautionary tale for net-new

`spec/archive/2026-04-21-surface-time-token-budget-review-verifier-iteration-count/spec.md` has **H1 = the change's own slug**, which created a slug-named net-new capability (this predates the explicit-target guard, which exists precisely because of this failure mode). Outcome: `artifact_timings`, `artifact_tokens`, `review_iterations`, and `verify_iterations` appear in **zero** current capability specs — the slug capability was swept away in the 2026-07-16 spec-store reset and its requirements now exist only in the archive. Ad-hoc net-new capabilities for cross-cutting instrumentation have empirically not survived.

Also noted: `spec/specs/schemas/spec.md` uses a legacy numbered-section format (`## 1. ChangeMetadataSchema`) with zero `## Requirement:` headings, so an ADDED delta targeting `schemas` would append a structurally foreign heading style — a further friction point for any mapping that routes schema requirements there.

## Options

### Option (a): Extend finalize-ship as single target, with scope note — user's stated preference

All ~10 requirements merge into `finalize-ship`; a leading scope-note requirement declares the delta binding on the adjacent surfaces (schemas, CLI, guard, skills, config, progress) and permits future relocation via reconciliation.

- **Pros:** Exactly matches the two strongest precedents (UAT delta target + model-escalation scope note). Zero tooling risk — this is the only mapping `SpecMerger` natively supports for a single change. Center of gravity is genuinely finalize-time reporting (6 of 10 requirements are finalizer behavior). One change, one branch, one delta, atomic ship. The scope note makes the off-home requirements discoverable and reversible.
- **Cons:** finalize-ship grows from 94 to ~104 requirements and accumulates non-finalize content (schema, guard, skill wording). A future "where is the token_usage schema specified?" lookup lands in finalize-ship, not schemas. If more token features arrive later, the case for extraction strengthens — deferred, not avoided.
- **Complexity:** Low. **Fit:** High.

### Option (b): Split across finalize-ship + schemas + a CLI capability

- **Pros:** Requirements live at their natural home capabilities; specs stay cohesive per domain.
- **Cons:** **Not supported by current merge tooling within one change** — one `spec.md`, one H1, one capability (`src/finalize/spec-merger.ts`). Realizing this option means either (i) decomposing into 3+ coordinated metta changes with cross-change ordering (schema change must ship before CLI change, etc.) for a feature the intent describes as "four coordinated pieces," or (ii) first building multi-target delta support in the merger — a separate feature. Additional friction: the schemas spec's legacy format does not accept `## Requirement:` deltas cleanly, and there is no existing CLI-surface capability to target (commands are specified under their owning feature capabilities — e.g., escalation CLI under instruction-contracts).
- **Complexity:** High (multi-change orchestration or tooling work first). **Fit:** Poor for this change; the "right" long-term shape but the wrong vehicle.

### Option (c): Net-new capability, e.g. `token-observability`

H1 = `token-observability` with the `<!-- new-capability -->` marker; all requirements land in a fresh spec.

- **Pros:** Domain-cohesive home for record + report + aggregate; room to grow if token work continues (cost estimation, routing evidence); avoids bloating finalize-ship.
- **Cons:** Splits finalize behavior across two capabilities — TOKENS.md ordering, no-stray, degradation, and `tokensPath` requirements are near-verbatim twins of UAT requirements that live in finalize-ship; future finalizer edits would have to reconcile two specs describing one function's step order. The one historical net-new instrumentation capability (iteration-record) was erased in the spec reset. A new capability for a feature explicitly scoped as "report data only, no cost actions" may never gain a second change. Passes tooling (with marker) but adds a permanent top-level capability for ~10 requirements.
- **Complexity:** Low-medium. **Fit:** Medium — defensible, but weaker than (a) on the finalize-coupling problem and against precedent.

## Recommendation

**Option (a) — extend finalize-ship as the single merge target with the scope-note requirement, exactly as the current draft spec.md is already structured.**

Rationale:

1. The instruction to override the user's preference required "hard evidence it breaks merge tooling." The evidence is the opposite: (a) is the only option the merger supports natively for one change; it is (b) that the tooling cannot express.
2. The two closest precedents both chose this shape: the UAT delta put report + config-schema + output requirements under finalize-ship, and the model-escalation delta put a `metta progress` metric under instruction-contracts with a scope-note comment. This change is structurally the union of those two, and its draft delta already mirrors both.
3. The scope note keeps the decision reversible: it explicitly authorizes a future reconciliation to relocate the schema/CLI/guard/skill requirements to their home capabilities if token observability grows. That captures option (b)'s long-term benefit without paying its coordination cost now.
4. Option (c)'s core defect — splitting the finalizer's step-order/degradation contract across two specs while UAT's identical contract stays in finalize-ship — creates a standing consistency hazard, and the only prior net-new instrumentation capability did not survive the spec-store reset.

**Design-phase note carried forward:** if a later change adds a second token feature (e.g., cost estimation), log a backlog item to extract a `token-observability` capability via reconciliation at that point, per the scope note's relocation clause.

## Evidence Index

- `src/finalize/spec-merger.ts` (lines 55-130) — single delta file, single H1-derived capability, `<!-- new-capability -->` marker gate
- `spec/specs/finalize-ship/spec.md` (lines 205-240) — explicit merge-target selection + completion confirmation requirements; (lines 263-460) UAT requirements resident under finalize-ship
- `spec/archive/2026-07-21-uat-document-generation-at-finalize-every-finalized-change/spec.md` — H1 `finalize-ship`, config/schema/output specified in-target
- `spec/archive/2026-07-17-model-tier-routing-orchestration-agents-top-tier-models/spec.md` — H1 `instruction-contracts`, scope-note comment, off-home progress metric
- `spec/archive/2026-04-21-surface-time-token-budget-review-verifier-iteration-count/spec.md` — slug-named capability; its fields absent from all current specs post 2026-07-16 reset
- `spec/specs/schemas/spec.md` — legacy numbered format, no `## Requirement:` headings

No external grounding required — all findings are internal codebase facts verified by direct file reads.
