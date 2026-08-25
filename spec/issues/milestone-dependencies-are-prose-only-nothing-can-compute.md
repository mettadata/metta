# Milestone dependencies are prose only — nothing can compute readiness or warn about out-of-order work

**Captured**: 2026-08-25
**Status**: logged
**Severity**: minor

## Symptom
Milestone dependencies exist only as prose in the milestone description body (e.g. "Depends on M1+M2+M3" in zeus's milestone files). Because the framework never parses that text, it cannot compute readiness (blocked/ready/complete), cannot warn when work is activated for a milestone whose dependencies are unmet (e.g. M4 work starting before M2 lands), and cannot render a dependency-ordered milestone view. In zeus this ordering is load-bearing — milestones gate real-funds trading — so out-of-order activation is a silent correctness risk.

## Root Cause Analysis
The milestone data model has no structured dependency field. `MilestoneFrontmatterSchema` is a strict Zod object accepting only `name`, `target`, and `status` — any `depends_on` key a user added would be rejected by `.strict()`, so dependencies can only live in the free-form description body, which `MilestonesStore.parseMilestone` slices off as an opaque string. Downstream, `computeMilestoneRollups` derives everything it reports (open/resolved counts, percent) purely from issue bucketing per milestone; there is no input or output concept of inter-milestone ordering, so `milestone list/show`, `status`/`progress` rollups, and the issue-activation paths (`backlog promote`, `fix-issues`, `roadmap next`) have nothing to consult. This is by design of the original backlog rework (milestones were introduced as flat issue buckets), not a regression.

### Evidence
- `src/schemas/milestone-frontmatter.ts:20` — `MilestoneFrontmatterSchema` is `.strict()` with only `name`/`target`/`status`; no `depends_on` field exists and unknown keys are rejected, forcing dependencies into prose.
- `src/milestones/milestones-store.ts:55` — the body below frontmatter becomes the opaque `description` string; nothing parses "Depends on ..." text.
- `src/milestones/milestone-rollup.ts:25` — `computeMilestoneRollups` consumes only milestones + issues and emits counts/percent; no readiness or dependency-closure derivation exists anywhere for consumers (`milestone list/show`, `status`, `progress`) to render.

## Candidate Solutions
1. **Structured `depends_on` frontmatter with readiness derivation** — Add an optional `depends_on: [<slug>...]` array to `MilestoneFrontmatterSchema`, validate at load time that each slug names an existing milestone and that the graph is acyclic (DFS cycle detection in `MilestonesStore.list`), then extend `MilestoneRollup` with a derived `readiness: 'blocked' | 'ready' | 'complete'` computed from the dependency closure plus the milestone's own rollup. Consume it in `milestone list/show` rendering, in `status`/`progress` rollups (show the chain), and emit a warning when `backlog promote` / `roadmap next` / `fix-issues` activates an issue whose milestone has unmet dependencies. Migration is parse-nothing: existing prose stays prose; adopters opt in by adding frontmatter. Tradeoff: widest surface of the three — touches schema, store, rollup, and four command paths, and cycle/existence validation adds a cross-file check to what is today a per-file parse.
2. **Schema + rendering only, defer activation warnings** — Add the validated `depends_on` field and readiness rendering in `milestone list/show` and rollups, but skip hooking `backlog promote` / `roadmap next` / `fix-issues`. Tradeoff: does not deliver the out-of-order-work warning, which is the load-bearing zeus need (real-funds gates), so the silent-risk window remains.
3. **Parse prose conventions ("Depends on: ...") from the description body** — Recognize a documented line format in the existing body text, requiring no frontmatter change. Tradeoff: fragile inference over free-form text (false positives/negatives, no Zod validation, awkward cycle/existence errors), and it violates the project's validate-all-state-with-Zod convention.
