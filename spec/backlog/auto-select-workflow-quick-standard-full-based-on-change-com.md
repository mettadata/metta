# Auto-select workflow (quick/standard/full) based on change complexity

**Added**: 2026-04-18
**Status**: backlog
**Priority**: medium

## Problem

Users have to guess up-front which workflow tier fits their change: `/metta-quick` (no planning), `/metta-propose` (full standard), or `/metta-auto` (autonomous full loop). Getting this wrong wastes time in both directions.

Observed 2026-04-18 on zeus: `/metta-fix-issues position-db-load-silently-ignored` triggered the full standard lifecycle for what resolved to a ~5-line `Err` arm replacement plus two tests. ~22 minutes of subagent orchestration (2 researchers, 6 task executors across 4 batches) for a change that `/metta-quick` would have shipped in a fraction of the time. Conversely, a user running `/metta-quick` on a change that touches 4+ files and changes public API gets no planning artifacts and may miss spec updates.

## Proposal

Make workflow selection adaptive. After the proposer authors `intent.md` (or earlier from description+context), the framework should score the change on complexity signals and recommend or auto-route to the right tier.

**Complexity signals:** estimated file count (from intent/design), estimated line delta, whether public API / spec surface changes, number of capabilities touched (`spec/specs/` folders), presence of architectural decisions, issue severity (for fix-issues-driven changes), whether tests are already covered or new tests are needed.

**Routing modes:**

1. **Advisory** (safer default) — print `Recommended workflow: quick | standard | auto` with signal scores after intent is drafted, require confirmation/override.
2. **Auto-downscale** (opt-in) — if complexity falls below `quick` threshold during `propose`/`fix-issues`, prompt to collapse to quick.
3. **Auto-upscale** (opt-in) — if `quick` run encounters design decisions or multiple-capability touches, prompt to promote to standard and replay through planning artifacts.

## Acceptance criteria

- Every `propose`/`fix-issues`/`quick` run emits a complexity score visible in `metta status`
- Advisory mode ships as default
- Auto-downscale/upscale gated behind config flag
- Score rubric documented in `spec/specs/`
- Existing workflows still work if signal missing / override used

## Candidate solutions (added 2026-04-19)

Observed during a 40-feature trello-clone driver session: `/metta-quick` fires 8 subagents (1 proposer + 1 executor + 3 reviewers + 3 verifiers) for every change, including one-attribute tooltip tweaks — ~5 minutes and ~200KB tokens per trivial feature. Two subset fixes that land inside the broader adaptive-routing scope:

**A. Intra-quick downsizing via the skill's existing trivial-detection gate.** The `/metta-quick` skill already has a trivial-detection gate that decides whether to skip the discovery loop. Extend it to also decide review+verify fan-out width: `≤1 file, ≤10 lines → 1 quality reviewer + tests/tsc verifier only`; non-trivial → current 3+3 fan-out. Keeps safety for non-trivial; cuts trivial-change cost roughly in half.

**B. New `metta fast` or `metta instructions trivial` path.** For callers who know up-front the change is a one-liner: intent → implementation → tests + tsc → merge, no review subagents at all. Lower ceiling on safety, lower floor on cost — appropriate when the human has verified scope manually.

**Tradeoff vs doing only the advisory score:** downsizing review risks an edge-case correctness/security bug slipping on changes the heuristic mis-sized as trivial. Mitigation: tests + tsc still run on every change regardless of tier. A single-attribute tooltip getting 3 reviewers is well past the point of diminishing returns on catch rate.

Implementer should pick between A and B (or neither, if the advisory score alone makes this moot) based on whether trivial-mode usage is expected to be common enough to justify a dedicated skill surface.
