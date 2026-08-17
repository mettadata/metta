# Finalize-time docs regeneration embeds worktree paths in Sources comments when run from a change worktree

**Captured**: 2026-08-17
**Status**: logged
**Severity**: minor

## Symptom
When a worktree-hosted change is finalized (observed during the `fix-guard-bash-tokenizer-weaknesses` ship, main commit 1c0b274, 2026-08-18), the docs regenerated at finalize time — `docs/api.md`, `docs/architecture.md`, `docs/getting-started.md` — carry `<!-- Sources: .metta/worktrees/<change>/spec/... -->` header comments. Those paths point into a change worktree that is deleted minutes later by ship cleanup, so the docs landing on main reference nonexistent checkouts. The symptom was hand-fixed on main with a doc-only sed, but the generator reproduces it on every worktree-hosted finalize.

## Root Cause Analysis
The finalize command deliberately resolves `specDir` from the checkout that hosts the change (worktree-aware, via `artifactStore.specDirFor(name)`) while `projectRoot` remains the session checkout root (`ctx.projectRoot`). The Finalizer forwards both to `new DocGenerator(this.specDir, this.projectRoot, docsConfig)`. DocGenerator then collects source files under `specDir` — for a worktree-hosted change that is `<main>/.metta/worktrees/<change>/spec/...` — but renders the Sources header with `relative(this.projectRoot, p)`, i.e. relative to the main checkout. The result is a repo-relative path that retains the `.metta/worktrees/<change>/` prefix, while the generated output itself is written to `join(this.projectRoot, this.config.output)` — the main checkout's `docs/`. This is the same mixed-roots residue (gates/lock/DocGenerator root notes) flagged in PR #79's review but never logged; commit fe717be01 fixed the specDir/lock split for spec merging without touching the DocGenerator's path rendering.

### Evidence
- `src/docs/doc-generator.ts:514` — `buildHeader` maps source paths with `relative(this.projectRoot, p)`; when the paths live under a worktree `specDir`, the relative result keeps the `.metta/worktrees/<change>/spec/...` prefix embedded in the Sources comment.
- `src/cli/commands/finalize.ts:50` — `specDir` is resolved via `ctx.artifactStore.specDirFor(name)` (worktree-aware) while line 68 passes `ctx.projectRoot` (session checkout root) into the Finalizer, creating the mixed-roots pair.
- `src/finalize/finalizer.ts:280` — the Finalizer constructs `new DocGenerator(this.specDir, this.projectRoot, docsConfig)` at finalize Step 7, wiring the worktree spec dir together with the main-checkout output root in a single generator instance.

## Candidate Solutions
1. **Relativize Sources against the spec store root** — In `buildHeader`, compute paths relative to the spec dir's host root (`dirname(specDir)`) instead of `projectRoot`, so a source under any checkout renders as `spec/specs/...` regardless of which checkout hosted the run. Add a regression test asserting regenerated docs never contain `.metta/worktrees/` in Sources lines. Tradeoff: requires DocGenerator to track a second root (or derive it from `specDir`), and all callers (docs CLI, release pipeline, finalizer) must be audited so the derivation holds for non-standard spec dir layouts.
2. **Pass the canonical repo-relative prefix explicitly** — Extend DocGenerator's constructor/config with a `sourcePrefix` (e.g. `spec`) that the finalize path supplies, and render Sources as `join(sourcePrefix, relative(specDir, p))`. Tradeoff: grows the constructor surface and pushes responsibility onto every caller to supply a correct prefix, with a silent wrong-prefix failure mode if a new call site forgets it.
3. **Post-process the rendered header** — After rendering, strip any `.metta/worktrees/<name>/` prefix from Sources lines before writing docs. Tradeoff: a band-aid that encodes the worktree layout as a magic string; it masks rather than removes the mixed-roots wiring and breaks silently if the worktree directory layout ever changes.

