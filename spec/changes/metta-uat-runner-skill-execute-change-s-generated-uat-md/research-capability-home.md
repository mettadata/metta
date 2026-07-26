# Research: Capability Home for UAT Runner Requirements

**Change:** metta-uat-runner-skill-execute-change-s-generated-uat-md
**Question:** Should the 10 ADDED requirements in this change's `spec.md` merge into the existing **finalize-ship** capability (where UAT generation lives), or should a NET-NEW **uat-execution** capability be created via the explicit new-capability marker?

## 1. How the machinery works (facts established from code)

### 1.1 Spec merge at finalize — single target per change

`SpecMerger.merge` (`src/finalize/spec-merger.ts:49-142`) parses the change's `spec.md` with `parseDeltaSpec` and derives the merge-target capability from the document's **single H1**:

- `src/finalize/spec-merger.ts:72` — `const capabilityName = toSlug(deltaSpec.title.replace(/\s*\(Delta\)\s*$/, ''))`. This is computed from `deltaSpec.title`, which `parseDeltaSpec` sets from the depth-1 heading (`src/specs/spec-parser.ts:196-197`). It is constant across the loop over deltas.
- **Consequence — single-target limitation confirmed:** one change's `spec.md` targets exactly one capability. There is no mechanism for one delta document to split requirements across two capabilities. "Extend finalize-ship AND create uat-execution" is not possible within this change; we must pick one home for all 10 requirements. (No archived change splits targets either — every `spec/archive/*/spec.md` has one H1.)

ADDED deltas land as follows:

- Target capability exists → `applyDelta` appends `## Requirement: <name>` sections to `spec/specs/<capability>/spec.md` (`src/finalize/spec-merger.ts:177-186`), idempotent by requirement name (`noop` at lines 179-181), then updates `spec.lock` via `SpecLockManager.update` (lines 260-261). `Fulfills:` lines are part of `delta.requirement.text` and survive the merge (e.g. `spec/specs/finalize-ship/spec.md:9`).
- Target capability does **not** exist and operation is ADDED → `createCapabilitySpec` creates `spec/specs/<capability>/spec.md` fresh with an H1 of the capability slug (`src/finalize/spec-merger.ts:144-158`); subsequent ADDED deltas in the same run see the now-existing file (existence re-checked per delta at line 76) and append via `applyDelta`. A 10-requirement net-new capability merges cleanly in one pass. The `<!-- new-capability -->` marker is **not** copied into the created spec.
- MODIFIED/RENAMED/REMOVED against a nonexistent capability → conflict/hard-fail. **Our delta contains 10 ADDED operations and zero MODIFIED/RENAMED/REMOVED** (verified by grep), so nothing forces the existing-capability path.

### 1.2 The new-capability marker

- Marker regex: `src/cli/commands/complete.ts:63` — `/^<!--\s*new-capability\s*-->\s*$/`. `hasNewCapabilityMarker` (`complete.ts:72-81`) scans **raw lines**: finds the first line starting with `#`, then tests the **first non-blank line after it**. So the marker must be the first non-blank line under the H1.
- The refusal gate at `metta complete spec` (`complete.ts:186-203`) fires only when **all three** hold: resolved capability slug equals the change's own slug, no such capability exists, and no marker. For an H1 of `# uat-execution` (which differs from this change's slug), the CLI gate would not hard-fail even without the marker — merge would silently auto-create the capability.
- However, the governing spec requirement "Explicit Capability Target Selection In Spec Authoring" (`spec/specs/finalize-ship/spec.md:205-208`) mandates that the recorded merge-target decision be **either an existing capability slug or the explicit marker**. Since `uat-execution` is not an existing slug, the marker is required by the authoring contract regardless of the gate's narrow trigger. The template comment agrees (`src/templates/artifacts/spec.md:3`).
- Live end-to-end precedent, 2 days old: `spec/archive/2026-07-26-roadmap-feature/spec.md` — H1 `# roadmap-feature` followed by blank line + `<!-- new-capability -->`; produced `spec/specs/roadmap-feature/spec.md` (12 requirements, 205 lines) with lock, and a new row in CLAUDE.md's Active Specs via refresh. The mechanics are proven current.

### 1.3 Context-loading implications of capability size

Capability specs are loaded as context sources: `existing_specs` resolves to the whole `spec/specs/` directory (`src/context/context-engine.ts:289-290`) and is an optional source for intent/stories/spec/research phases (`context-engine.ts:39-42`). Per-file loading strategy is size-based (`context-engine.ts:330-334`): `full` under ~5,000 tokens, `section` from 5,000-20,000, `skeleton` above.

- `spec/specs/finalize-ship/spec.md` today: **459 lines, 19 `## Requirement:` sections, 33,972 bytes ≈ 8,500 tokens** — already past the `full` band.
- This change's delta bodies: 17,243 bytes. Merging them pushes finalize-ship to ~50,000 bytes ≈ 12,500 tokens — deeper into `section` territory, drifting toward the 20,000-token `skeleton` cliff as UAT evolves.
- A standalone `uat-execution` spec at ~16-17 KB ≈ 4,200 tokens loads with the `full` strategy.

(Note: the "49 requirements" figure in CLAUDE.md's Active Specs table is the refresh counter's metric, not the `## Requirement:` header count; the header count is 19.)

## 2. Cohesion analysis of finalize-ship today

The 19 requirements split into two clusters (`grep -n "^## Requirement:" spec/specs/finalize-ship/spec.md`):

- **Finalize/ship pipeline proper** (10): Spec Delta Merge, Finalizer Orchestration, Merge Safety Pipeline, three finalize-lock requirements, two merge-target requirements, Trivial Workflow Verification Artifact Contract Agreement (lines 3-262).
- **UAT generation** (9): UAT Script Generation At Finalize through UAT Generation Failure Degradation (lines 263-459).

Adding 10 execution requirements would make it 29 requirements, **19 of them (66%) UAT-related**, in a capability named "finalize-ship". Critically, none of the 10 new requirements touch finalize code: no change to `src/finalize/finalizer.ts`, no CLI, no gate. They govern a skill/agent template pair (`/metta-uat`, `metta-uat-runner`), document-mutation semantics, and orchestrator follow-up — executed at arbitrary times after ship, including against archives months later. UAT *generation* is a finalize pipeline step (Step 5b); UAT *execution* is a separate lifecycle phase with different actors.

## 3. Precedents

| Precedent | Decision | Evidence |
|---|---|---|
| UAT generation (2026-07-21) | Extended finalize-ship | `spec/archive/2026-07-21-uat-document-generation.../spec.md` H1 `# finalize-ship` — correct then, because generation is literally a `Finalizer.finalize` step |
| roadmap-feature (2026-07-26) | New capability via marker | H1 + `<!-- new-capability -->`; created 12-req capability cleanly |
| adaptive-workflow-tier-selection (2026-04-19) | New capability (auto-created, pre-gate) | H1 `# Adaptive Workflow Tier Selection` differs from change slug |
| propose-stop-after | Small sibling capability (8 reqs, 155 lines) beside workflow-engine rather than folded in | `spec/specs/propose-stop-after/spec.md` |
| workflow-parallelism-discipline (7 reqs), orchestration-guard (12), gate-runner | Focused single-concern capabilities are the norm | `spec/specs/` listing |

The spec store's grain is **one concern per capability**, with several 7-12-requirement capabilities. A 10-requirement `uat-execution` fits that distribution exactly; a 29-requirement finalize-ship would be an outlier growing in the wrong dimension.

## 4. Options compared

### Option A — Extend finalize-ship (keep H1 `# finalize-ship`)

**Pros**
- Zero edit to the current delta; the 2026-07-21 generation change is a direct same-capability precedent.
- Generation and execution requirements co-located — one document tells the whole UAT story; the execution requirement that rewords `src/templates/artifacts/uat.md` (delta "UAT Step Execution Semantics") sits beside the generation requirement that owns that template ("UAT Template Externality", `finalize-ship/spec.md:427`).
- No new capability naming/registration ceremony.

**Cons**
- Cohesion break: 66% of a capability named "finalize-ship" would be UAT content, half of it describing behavior that never runs during finalize or ship.
- Size: ~50 KB / ~12.5K tokens, the largest hand-authored capability spec, degrading context loading for every future change that touches finalize-ship; and any future UAT-execution work (tier routing is already declared future work in the intent, section 5) compounds it.
- Conflict surface: base-version conflict detection is per capability (`spec-merger.ts:100-119`); UAT-execution changes and genuine finalize-pipeline changes in flight together would contend on one spec.lock unnecessarily.

**Complexity:** none — append-only merge, fully supported.

### Option B — New `uat-execution` capability (change H1, add marker)

**Pros**
- Correct grain: matches the store's precedent of focused capabilities (propose-stop-after, orchestration-guard, roadmap-feature); the capability name describes 100% of its contents.
- Keeps finalize-ship's meaning intact: it remains "what happens at finalize/ship", including UAT *generation*; execution — different trigger, actors, and artifacts — gets its own home where future work (tier-routed runs, richer run semantics) accrues.
- Both specs stay in friendlier context-loading bands (finalize-ship stays ~8.5K tokens; uat-execution ~4.2K loads `full`).
- Independent conflict/lock surface from finalize-pipeline changes.
- Mechanically clean: all 10 deltas are ADDED, so `createCapabilitySpec` + append handles the whole document in one merge pass; the marker path was exercised successfully two days ago.

**Cons**
- Mild cross-capability coupling: two execution requirements reference artifacts governed by finalize-ship requirements (the `uat.md` header template rewording; location rules keyed to where the generator/archiver put `UAT.md`). This is referential, not a MODIFIED delta — no merge-mechanical issue, but readers must follow one cross-reference.
- Requires a two-line edit to the current spec.md before `metta complete spec`.
- One more row in the capability table (negligible; refresh handles it).

**Complexity:** the two-line edit; everything downstream is automatic (spec dir, lock, CLAUDE.md row, docs).

## 5. Recommendation

**Create the NET-NEW `uat-execution` capability (Option B).**

Rationale: the single-target limitation forces one home for all 10 requirements, and none of them are finalize-pipeline behavior — they define a post-ship acceptance-execution concern with its own skill, agent, document-mutation rules, and future roadmap. Folding them into finalize-ship would make UAT two-thirds of a capability whose name says otherwise, push the largest capability spec toward the skeleton-loading cliff, and couple unrelated changes on one lock. The spec store's established grain (propose-stop-after, orchestration-guard, roadmap-feature) is small focused capabilities, and the new-capability marker path is proven as of 2026-07-26. The only real cost — one cross-reference to the `uat.md` template owned by finalize-ship — is far cheaper than the cohesion cost of Option A.

### Required edit to this change's spec.md

The current `spec/changes/metta-uat-runner-skill-execute-change-s-generated-uat-md/spec.md` line 1 reads `# finalize-ship`. **It must change.** Replace the top of the file with:

    # uat-execution

    <!-- new-capability -->

- H1 becomes `# uat-execution` (slugs to `uat-execution` via `toSlug`; no existing capability of that name, and it differs from the change slug, so no gate refusal).
- `<!-- new-capability -->` must be the **first non-blank line after the H1** (per `hasNewCapabilityMarker`, `src/cli/commands/complete.ts:72-81`) to satisfy the Explicit Capability Target Selection contract (`spec/specs/finalize-ship/spec.md:205`). A blank line between H1 and marker is fine (blank lines are skipped; roadmap-feature used exactly this shape).
- No other change to the delta is needed: all 10 requirements are ADDED and merge via `createCapabilitySpec` + append.

Also update the intent's Impact framing when convenient (`intent.md` Impact section says "Default: extend finalize-ship ... research decides" — this document records the decision as: new `uat-execution` capability).
