# Research: fix-milestone-status-write-once-dead-field-no-close

## Decision: Full store-level update (`MilestonesStore.update` + `milestone close` / `milestone update` CLI verbs + `abandoned` enum)

### Approaches Considered

1. **Full store-level update** (selected) — `MilestonesStore.update(slug, patch)` mirroring the proven sibling `IssuesStore.updateFrontmatter` pattern (`src/issues/issues-store.ts:223-234`), two new CLI verbs (`close`, `update`) cloned from the `create` action shape, `abandoned` added to the status enum, guard/mint hook scope extension. Satisfies all six spec.md requirement blocks; every sub-decision has a cited in-repo precedent. Details: `research-store-update.md`.
2. **Derived status from issue rollups** — compute closed-ness from `computeMilestoneRollups`. Rejected: satisfies **0 of 6** spec requirements, cannot represent `abandoned`, auto-closes zero-issue milestones vacuously (or reproduces the write-once bug via a special case), leaves stale bodies uneditable, converts the persisted `status` field into an actively contradicted source of truth, and violates the byte-compat scenario by design. Also explicitly out of scope per `intent.md`. Details: `research-derived-status.md`.
3. **Minimal close-only + advisory** — only `milestone close` plus an "eligible for close" warning. Rejected: fully satisfies **0 of 5** ADDED spec requirements (close verb is 4/5 minus `--abandoned`), leaves the stale-body half of the reported defect unfixed with hand-editing (unvalidated writes) as the only recourse, introduces an irreversible close with no reopen, and the advisory contradicts both `intent.md`'s out-of-scope list and spec.md's byte-compat scenario. The implied follow-up change re-touches the identical file set, roughly doubling lifecycle cost. Details: `research-close-only.md`.

### Rationale

The full-update approach is the smallest design that makes the already-modeled lifecycle reachable and closes **both** halves of the reported defect (permanently-open status and stale body text) through a validated, auto-committed path:

- **Proven pattern**: read → patch → full-frontmatter Zod re-validate → write mirrors `IssuesStore.updateFrontmatter`; validation precedes I/O, so byte-identical-on-failure is structural, satisfying "no unvalidated state writes" with zero extra machinery.
- **Patch shape**: `MilestonePatch` with a `clearTarget: boolean` (not `target: null`) — `YAML.stringify`'s `keepUndefined: false` drops the key naturally; keeps the type free of null unions.
- **Commit at the CLI edge**: extract `create`'s swallow-on-failure commit block (`src/cli/commands/milestone.ts:77-87`) into a shared `commitMilestones` helper; messages `chore: close milestone <slug>` / `chore: update milestone <slug>`.
- **Rollup sort** (`src/milestones/milestone-rollup.ts:77-80`) must become a rank comparator (open=0, terminal=1) — provably behavior-identical for open/closed-only inputs, preserving the spec's byte-compat requirement.
- **Markers**: export a shared `MILESTONE_MARKERS` map (`▸` open, `✓` closed, `✗` abandoned) to de-duplicate three render sites (`milestone.ts:121`, `status.ts:33`, `progress.ts:216`).
- **Guard**: add `close`/`update` to `BLOCKED_TWO_WORD` in `metta-guard-bash.mjs:81` (scope keys auto-derive) and extend `SKILL_SCOPES['metta-backlog']` in `metta-session-mint.mjs:35` — **each edit mirrored byte-identically into `src/templates/hooks/`** (pinned by `tests/hooks-byte-identity.test.ts`), plus `close`/`update` branches in `.claude/skills/metta-backlog/SKILL.md`.
- **Test gap found**: `tests/metta-guard-bash.test.ts` has zero milestone-specific cases — new verbs need block/allow coverage following the `backlog add` pattern.

Accepted risks (documented in intent): `status: abandoned` is a one-way forward-compat door for older builds; full YAML re-serialization normalizes hand-edited frontmatter (acceptable — milestone frontmatter is three metta-owned keys and hand-editing is the workflow being eliminated). Commander `.conflicts()` availability for `--target`/`--clear-target` mutual exclusion is resolved during planning by reading `package.json`.

Suggested implementation order: schema enum → store `update` + tests → rollup/renderers + tests → CLI verbs + tests → hooks/skill + guard tests. Footprint: ~10 source files plus 5-6 test files, all small edits.

### Artifacts Produced

- [Research: full store-level update](research-store-update.md)
- [Research: derived status from rollups](research-derived-status.md)
- [Research: minimal close-only](research-close-only.md)
