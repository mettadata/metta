# Approach: Extend `ChangeMetadataSchema` with optional fields

## Summary

Add four optional fields to the existing Zod schema in
`src/schemas/change-metadata.ts`:

- `artifact_timings?: Record<string, { started?: string; completed?: string }>`
- `artifact_tokens?: Record<string, { context: number; budget: number }>`
- `review_iterations?: number`
- `verify_iterations?: number`

Write sites: `metta complete` (stamps `completed`), `metta instructions`
(stamps `started` + records `budget` block), new `metta iteration record`
(increments counters). Read sites: `metta progress`, `metta status`.

## Pros

- **Zero new storage surface.** Every data point travels with the change
  it belongs to, inside the same YAML file whose writes are already
  atomic and Zod-validated. No new file, no new index, no migration.
- **Back-compat is free.** `.optional()` on all four fields means existing
  `.metta.yaml` files under `spec/archive/` and in-flight `.metta/` load
  unchanged. The `schema_version` constant does not move.
- **Single source of truth.** Everything the renderers need lives in one
  place; no reconciliation problem between "state file says X, sidecar
  says Y."
- **Tiny code delta.** Four schema lines plus small writes in two existing
  commands plus one new small command. Renderers get ~30 lines each.
- **Transactional with the existing metadata write path** — we reuse
  `StateStore.write` which already does atomic rename, Zod validation,
  and backup.

## Cons

- **Metadata file grows.** For a long change with 8 artifacts, up to 8
  timing entries + 8 token entries + 2 counters. Still well under 2 KB
  of YAML — not a real cost.
- **Zod schema accumulates optional fields.** The schema is already
  pragmatic about optional fields (`complexity_score`,
  `auto_accept_recommendation`, `workflow_locked`); four more is
  consistent with existing practice but nudges the schema toward "bag of
  optionals". Mitigated by grouping the two maps logically.

## Fit with existing code

- `ArtifactStore.updateChange(name, updates)` already does a merge-write
  pattern; the same helper handles all four new fields.
- `src/cli/commands/complete.ts` already reads the metadata immediately
  before marking an artifact complete — stamping `completed` is a
  one-liner at that site.
- `src/cli/commands/instructions.ts` already reads the metadata to look
  up the artifact status — stamping `started` + `artifact_tokens` is a
  one-liner there.
- Renderers (`progress.ts`, `status.ts`) already take `ChangeMetadata` as
  input; they just read additional optional fields.

## Complexity

**Low.** Estimated ~150 LoC of source + ~200 LoC of tests. No new modules.

## Recommendation

**Preferred.** This is the smallest code delta that fully satisfies the
spec, and the schema already welcomes small optional extensions.
