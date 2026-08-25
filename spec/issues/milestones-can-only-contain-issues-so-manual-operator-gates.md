# Milestones can only contain issues so manual/operator gates are invisible or wrongly shaped

**Captured**: 2026-08-25
**Status**: logged
**Severity**: minor

## Symptom
Milestone completion rollups can only aggregate issues, so manual/operator gates have no first-class representation. In the zeus session (2026-08-26), M6's real prerequisite (fund a fresh wallet, never the burned dev keystore) and M1's UAT mainnet round-trip gate exist only as milestone body prose — `metta milestone list`/`show` and status/progress rollups report 100% once all attached issues are resolved, while a genuine operator gate is still outstanding. The only workaround, `metta backlog add --new`, mints a `type: idea` entry in `spec/issues/`, which is the wrong shape for a manual gate and pollutes issue counts.

## Root Cause Analysis
The milestone data model is issues-only by construction. `MilestoneFrontmatterSchema` is a strict Zod object with exactly `name`, `target`, and `status` — there is no `gates:` (or any checklist) field, and `.strict()` means one cannot even be added ad hoc in frontmatter without a schema change; the body is free-form prose the CLI never parses for semantics. On the rollup side, `computeMilestoneRollups` derives `percent` purely as `resolved / (open + resolved)` over `IssueRecord[]` buckets, so any completion signal that is not an issue file cannot influence readiness. The issue store's only alternative shape is `type: 'issue' | 'idea'` (`IssueFrontmatterSchema`), so a gate parked as `--new` becomes an idea — counted alongside issues in milestone buckets and issue listings, with no operator check-off semantics. Nothing in `milestone show`/`list` renders outstanding non-issue prerequisites, so the 100% figure is structurally guaranteed to be wrong whenever a manual gate exists.

### Evidence
- `src/schemas/milestone-frontmatter.ts:20` — strict frontmatter schema is only `name`/`target`/`status`; no `gates` field exists and unknown keys are rejected, so gates can live only as unparseable body prose.
- `src/milestones/milestone-rollup.ts:71` — `total = open + resolved` and `percent = resolved/total` are computed exclusively from issue buckets, so rollups hit 100% regardless of outstanding operator gates.
- `src/schemas/issue-frontmatter.ts:9` — issue store types are limited to `issue | idea`; `backlog add --new` (src/cli/commands/backlog.ts:122) therefore mints an idea, the wrong shape for a gate and included in issue counts.

## Candidate Solutions
1. **`gates:` checklist in milestone frontmatter** — Extend `MilestoneFrontmatterSchema` with an optional `gates: [{ slug, label, done }]` array; `computeMilestoneRollups` gains gate counts and caps `percent`/readiness below 100 while any gate is unchecked; add `metta milestone gate done <slug> <gate>` to flip a gate, and render outstanding gates prominently in `milestone show`/`list` and status/progress. Tradeoff: milestone files become CLI-mutated state (frontmatter rewrites, merge conflicts on the checklist) and every rollup consumer's JSON shape changes, requiring coordinated updates to status/progress/statusline.
2. **`type: gate` entries in the issue store** — Add `gate` to `IssueFrontmatterSchema`'s type enum; gates attach to milestones via the existing `milestone` field, are excluded from issue counts/listings but included in milestone readiness, and are checked off by resolving them (`metta milestone gate done` as sugar over resolve). Tradeoff: overloads the issue store with a third semantic (every list/count/backlog code path must now filter by type correctly), and a missed filter silently reintroduces the count-pollution problem this is meant to fix.
3. **Documented convention + rollup body parsing** — Keep the schema untouched and have the rollup parse a conventional `## Gates` markdown checklist (`- [ ]` items) out of the milestone body, blocking 100% until all boxes are checked via ordinary file edits. Tradeoff: semantics hinge on fragile markdown-shape parsing with no Zod validation, contradicting the project's "no unvalidated state" convention and inviting silent breakage when prose drifts.
