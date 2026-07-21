# Research: uat-document-generation-at-finalize-every-finalized-change

Consolidated from three parallel research tracks:
- [research-finalize-hook.md](research-finalize-hook.md) — hook placement, `FinalizeResult`/CLI surfacing, config read
- [research-rendering.md](research-rendering.md) — template engine strategy and placeholder contract
- [research-source-assembly.md](research-source-assembly.md) — step derivation, tier fallback, machine-verified predicate, error ladder

## Decision: Pre-archive Step 5b generation + TemplateEngine skeleton + AC-driven pure assembler

### Approaches Considered

**Hook placement (research-finalize-hook.md):**
1. **Option A — write `UAT.md` into `spec/changes/<name>/` immediately before `artifactStore.archive()`** (selected) — `archive()` is a `rename` (move), so the file is swept into the archive for free; all five failure/dry-run exits sit upstream of the insertion point, so "no stray UAT.md" needs zero extra guards; the assembler keeps the `ArtifactStore` read/write API. Report the final path *after* `archive()` returns via `join(specDir, 'archive', archiveName, 'UAT.md')` (avoids stale-path and date-rollover hazards).
2. **Option B — write into the archive dir after `archive()`** — rejected: violates two pinned spec scenarios, loses the `ArtifactStore` path helpers, and buys nothing (the path-known-at-write advantage is recovered in A by deriving from `archive()`'s return).

**Rendering (research-rendering.md):**
1. **Option A — existing `TemplateEngine` + external skeleton `src/templates/artifacts/uat.md`; assembler builds story-grouped step blocks in TS and injects them via one `{uat_steps}` placeholder** (selected) — matches the delta spec verbatim, zero engine changes, and sits exactly on the boundary the codebase already enforces (static skeleton/prose in template files; per-item data serialization in code — controlling precedents: `spec-merger.renderRequirementBody`, `issues-store`, `doc-generator`'s live path). Four-placeholder contract: `{change_name}`, `{generated_date}`, `{source_tier}`, `{uat_steps}`.
2. **Option B — `.md.hbs` via doc-generator's `renderTemplate`** — rejected: that renderer is orphaned dead code (zero call sites), a second template syntax, and contradicts the delta spec.
3. **Option C — extend `TemplateEngine` with loops/conditionals** — rejected: blast radius across all 12 artifact templates for a single consumer; loops alone can't express the conditional annotation anyway.

**Source assembly (research-source-assembly.md):**
1. **Option A — one numbered step per acceptance criterion (Setup/Do/Observe/checkbox); Independent Test Criteria as story preamble plus conservative backtick command-hint extraction** (selected) — 1:1 AC→step is deterministic and lossless; ITC commands attach as `Run:` hints (to the story's first step when no AC carries a command).
2. **Option B — ITC as the story's lead step** — rejected: duplicates the ACs it summarizes; ITC sentences can't be split into do/observe deterministically.
3. **Option C — spec scenarios as primary source at tier 1** — rejected: contradicts the fallback-chain requirement and loses story narrative/ITC.

Delta-spec folding: `parseDeltaSpec` (never `parseSpec` — it returns silently-empty on delta files); include ADDED/MODIFIED/RENAMED scenarios only; group under stories via `requirement.fulfills` (confirmed exposed by the parser for both `Fulfills:` and `**Fulfills:**` forms); exact-normalized dedupe only (similarity scoring rejected as brittle); dangling scenarios under `## Additional scenarios`.

### Rationale

- **Failure-path cleanliness by construction.** Every abort (incomplete artifacts, merge conflict, gate failure, dry-run) returns before the new Step 5b, so a failed finalize structurally cannot leave a stray UAT.md.
- **Determinism.** The assembler is a pure function over parser output plus an injected `generatedAt` date and the in-memory Step-4 `GateResult[]`; substitution is single-pass with a function callback, so assembled body text containing braces/`$` is inserted literally — byte-identical output on identical inputs holds.
- **gates.yaml does not exist at generation time** (it is written into the archive dir at Step 6b, after the move). The assembler MUST receive the Step-4 gate results in-memory — the same data serialized to gates.yaml moments later. Design must state this so nobody "fixes" the generator to read a nonexistent file.
- **Honest machine-verified predicate:** annotate only when `gates.length > 0 && gatesPassed` AND normalized summary.md contains the scenario name (≥15 chars), the requirement name (≥15 chars), or a `\bUS-N\b` mention on a verification-context line; silently absent otherwise; structurally skipped for tier-3 scripts (self-referential). The annotation is a cross-reference claim and carries its evidence string.
- **Tier fallback is a warn-and-demote ladder, never an abort:** stories (`kind:'stories'`) → delta-spec scenarios (content-based check: ≥1 non-REMOVED scenario, since `parseDeltaSpec` never throws) → intent Proposal bullets + summary highlights (remark extraction, the house pattern) → floor script (header + one generic confirmation step). A UAT.md always exists on the success path when `uat.enabled`. Only template-load/render/write errors escape the generator; the finalizer catches them and degrades (warn-and-continue) with `uatError`.
- **Result/output shapes:** `FinalizeResult` gains required `uatPath: string | null` (compiler forces all six return literals to state a value) and optional `uatError?: string`. CLI success JSON gains always-present `uatPath` plus conditional `uatWarning`; human mode gains one `UAT script:` line and a yellow stderr warning on degradation. Error JSON shapes and exit codes untouched.
- **Config:** one shared lazily-imported `ConfigLoader` instance serving both Step 5b (`config.uat.enabled`) and Step 7 (`config.docs`), with independent per-step try/catches; `this.projectRoot` guard mirrors Step 7 (no projectRoot → silent skip, keeping library/test constructions green).

### Artifacts Produced

- [Approach: finalize hook and output surfacing](research-finalize-hook.md)
- [Approach: template rendering strategy](research-rendering.md)
- [Approach: source assembly, fallback chain, annotation predicate](research-source-assembly.md)

### Key risks carried into design

1. Non-atomic write: assemble fully in memory, write last; optionally `deleteIfExists` in the catch.
2. Tier-2 detection must be content-based (`parseDeltaSpec` never throws on garbage).
3. Annotation false positives: mitigated by the 15-char floor and US-id context guard; wording carries evidence so readers can judge.
4. Tier 2 (sentinel stories + spec) will not be exercised by dogfooding — needs synthetic fixtures.
5. Making `uatPath` required touches all six `FinalizeResult` return literals — compiler-enforced, low risk.
