# Roadmap and milestones are disconnected views over the same issue store — no milestone-aware next or drift surfacing

**Captured**: 2026-08-25
**Status**: logged
**Severity**: minor

## Symptom
Reported by the zeus session (2026-08-26): the roadmap draws only from issues with `backlog: true` frontmatter (11 items in zeus) while 22 zeus issues carry `milestone:` tags, and no view reconciles the two. There is no way to ask "what is next in M2" — `metta roadmap next` pops the first healthy entry globally across milestones, and the milestone view reports only unordered open/resolved buckets. Issues with milestones but no backlog/roadmap membership (and vice versa) are invisible to every rollup, so the two systems silently drift apart.

## Root Cause Analysis
Roadmap and milestones were built as independent views over the shared issue store with no cross-linkage. The roadmap is a flat ordered slug list in `spec/roadmap.md` whose entry grammar carries only slug + free-text note — no milestone dimension exists in the data model, so `roadmap next` cannot filter or group by milestone. Milestone membership lives solely in issue frontmatter (`milestone:` key) and is consumed only by `computeMilestoneRollups`, a pure counting function with no ordering concept; the milestone CLI exposes only `create | list | show`, so there is no `milestone next`. Nothing computes the set difference between roadmap membership and milestone membership, so no status/progress surface can report the divergence. This is a design gap, not a regression: the backlog rework (d51a1934) introduced milestone/priority at log time while the roadmap feature evolved separately (5d184af2, 991f5ed0), and the two never gained a reconciling surface. Needs design-level reconciliation rather than a point fix.

### Evidence
- `src/roadmap/roadmap-store.ts:23` — `RoadmapEntrySchema` is `{ slug, note? }` only; the roadmap data model has no milestone field to be aware of.
- `src/cli/commands/roadmap.ts:190` — `roadmap next` walks entries from the top globally and pops the first healthy one; no milestone filter or `--milestone` option exists.
- `src/cli/commands/milestone.ts:50` — the milestone CLI registers only `create`/`list`/`show`, and `computeMilestoneRollups` (`src/milestones/milestone-rollup.ts:25`) buckets and counts without any ordering or "next" notion, warning only on unknown milestone slugs, never on roadmap/milestone divergence.

## Candidate Solutions
1. **Milestone-aware roadmap** — add `metta roadmap next --milestone <slug>` (filter the walk to entries whose issue frontmatter carries that milestone), render the roadmap grouped by milestone, and warn when the activation candidate belongs to a not-yet-current milestone. Tradeoff: grouping is derived from frontmatter while the roadmap file stays milestone-blind, so the rendered order can diverge from the raw file and every walk must read issue frontmatter.
2. **Milestone-native next surface** — add `metta milestone next <slug>` selecting the next open issue in a milestone, respecting roadmap ordering where an issue appears in both and falling back to a deterministic order (priority, then capture date) otherwise. Tradeoff: introduces a second "next" verb whose semantics can disagree with `roadmap next`, which still pops globally; users must know which to reach for.
3. **Divergence surfacing in rollups** — extend `computeMilestoneRollups` plus status/progress to report issues with a milestone but no backlog/roadmap membership and vice versa, without changing either next verb. Tradeoff: makes drift visible but does not answer "what is next in M2" — a reporting patch, not a reconciliation.
