# Design: fix-finalize-spec-merge-pipeline-hardening

## Approach

Six minimal-diff fixes, each reusing an existing mechanism rather than refactoring it, per research.md's decisions:

1. **Explicit capability targeting** (US-1/US-2, `Explicit Capability Target Selection In Spec Authoring`, `Merge Target Confirmation At Completion`): H1 pre-fill stays the change name (`instruction-generator.ts:70` unchanged, harmless as a title); a raw-content regex detects a `<!-- new-capability -->` marker in `complete.ts` (parseDeltaSpec can't see it — HTML nodes fall through `spec-parser.ts:191`); existing capability slugs surface via `InstructionOutput.context.existing_specs` (already typed, never populated).
2. **Completeness gate** (US-3, `Finalizer Orchestration`): new step 1 in `Finalizer.finalize()`, using only `metadata.artifacts` already loaded — zero new I/O.
3. **Merge ordering** (US-6, `Finalizer Orchestration`): dry-run → gates → real write → archive, using `SpecMerger.merge`'s existing `dryRun` flag called twice — no merger rewrite.
4. **ADDED idempotency** (US-5, `Spec Delta Merge`): a `sections.has(name)` guard in the ADDED branch, mirroring the MODIFIED branch's lookup — name-only, no content-hash comparison (research rejected hash-based conflict/no-op disambiguation).
5. **Trivial/quick verification contract** (US-4): fix the shared `verify.md` template's instructions, not `generates` — `trivial.yaml`, `quick.yaml`, `standard.yaml` all reference the same template, so one file fixes all three tiers with zero YAML edits.
6. **CLI exit-order bug**: reorder `finalize.ts`'s post-run checks to pipeline order (completeness → conflict → gates), fixing the latent bug where conflicts are misreported as gate failures.

## Components

| Component | Change |
|---|---|
| `src/context/instruction-generator.ts` (~line 67-75) | New private `listExistingCapabilities(specDir)` populates `context.existing_specs` via `readdir(join(specDir, 'specs'), { withFileTypes: true })`, dirs only, `[]` on `ENOENT`. Runs only when `params.artifact.type === 'spec'`. `capability_name` stays `params.changeName`. |
| `src/templates/artifacts/spec.md` | One instructional comment line under the H1 (guidance text, not the marker itself) telling the author to add `<!-- new-capability -->` when the target doesn't yet exist. |
| `src/cli/commands/complete.ts:157-175` | Adds `hasNewCapabilityMarker(raw)` + self-slug refusal check ahead of the existing MODIFIED/REMOVED/RENAMED loop. |
| `src/finalize/finalizer.ts` | New completeness-gate step; workflow-artifact-id load hoisted above gate scoping; merge called twice (dry-run, then real). |
| `src/finalize/spec-merger.ts:147` | ADDED branch gains `sections.has(name)` guard; `applyDelta` return type widens; `MergeResult` gains `noops`. |
| `src/cli/commands/finalize.ts:58-115` | Reorders the three exit checks; adds a fourth (`incompleteArtifacts`, exit 3) ahead of the other two. |
| `src/templates/artifacts/verify.md` | Adds an explicit "save this file as `summary.md`" instruction. |
| `trivial.yaml`, `quick.yaml` | **No changes** — contract satisfied via the shared `verify.md` fix (see Risks). |

## Data Model

- `FinalizeResult` (`finalizer.ts:10-18`) gains `incompleteArtifacts?: Array<{ id: string; status: ArtifactStatus }>`, set only on the new abort path; other fields default like the existing conflict-abort path (`archiveName: ''`, `gates: []`, `gatesPassed: false`).
- `MergeResult` (`spec-merger.ts:15-19`) gains `noops?: string[]` — `${capability}/${requirementId}` entries for ADDED deltas whose requirement name already exists. Optional field; `status`/`merged`/`conflicts` unchanged.
- `InstructionOutput.context.existing_specs` (`instruction-generator.ts:20`) — already-declared field gets its first producer.
- No `ChangeMetadataSchema` changes: `ArtifactStatusSchema` already enumerates `complete` as the sole accepted state; no new frontmatter/artifact field (research rejected frontmatter targeting — it would touch the Zod schema and every `parseDeltaSpec` caller for no benefit over a plain-text marker).

## API Design

**Marker regex & placement.** `NEW_CAPABILITY_MARKER = /^<!--\s*new-capability\s*-->\s*$/`. Must be the first non-blank line after the delta's H1. Detection scans raw lines (already read via `readFile` at `complete.ts:160`): find the first `#`-line, test the next non-blank line against the regex — never touches `parseDeltaSpec`'s AST.

**complete.ts error messages** (inserted before the existing MODIFIED/REMOVED/RENAMED loop at `complete.ts:165`):
- Self-slug landfill, no marker: `Delta spec's merge target '${capabilityName}' matches this change's own slug and no such capability exists yet. Add '<!-- new-capability -->' directly under the H1 to confirm creating a new capability, or change the H1 to name an existing capability (see 'existing_specs' in the spec-authoring instructions).`
- No "unreplaced placeholder" message: per research, the H1 is always a rendered value (never a literal `{capability_name}` token in generated output), so nothing needs detecting as unreplaced here. The pre-existing `{change_name}` check at `complete.ts:124-130` is unrelated, untouched.

**Finalizer step list** (replaces `finalize()` body, `finalizer.ts:31-150`):
1. Load `metadata` via `ArtifactStore.getChange` (unchanged).
2. **NEW**: resolve workflow-required artifact ids (hoist the existing `workflowEngine.loadWorkflow` call from line 40; fallback to `Object.keys(metadata.artifacts)` if the workflow can't load). Abort with `incompleteArtifacts: [{ id, status }, ...]` if any required id isn't `'complete'` — no gates, no merge, no writes. Only `'complete'` counts; `pending|ready|in_progress|failed|skipped` all block.
3. Dry-run merge: `merger.merge(changeName, metadata.base_versions, true)` — conflict detection only, no write. Abort on `status === 'conflict'` (same shape as today's early return).
4. Run gates via `GateRegistry.runAll` (unchanged, `finalizer.ts:64-86`). Abort on `!gatesPassed`.
5. **NEW**: only now, `specMerge = dryRun ? dryRunResult : await merger.merge(changeName, metadata.base_versions, false)` — the real write.
6. If caller's `dryRun` is true, return here (unchanged shape).
7. Archive, write `gates.yaml`, generate docs, return — unchanged.

**Invariant for tests**: a `finalize()` call returning before step 5 — `incompleteArtifacts` set, `specMerge.status === 'conflict'`, or `gatesPassed === false` — MUST NOT have called `merger.merge(..., false)`. A diff of `spec/specs/` (and lock files) before/after is empty. A retried `finalize()` after any abort applies the delta exactly once.

**ADDED idempotency** (`spec-merger.ts:147`, `applyDelta`): before appending, `const { sections } = splitRequirements(content); if (sections.has(delta.requirement.name)) return 'noop'`. `applyDelta`'s return type widens to `MergeConflict | null | 'noop'`; the clean-merge call site (`spec-merger.ts:98-106`) branches: conflict → `conflicts`; `'noop'` → `noops`, excluded from `merged`; `null` → `merged` as today. Match is by requirement **name only** — a same-name-different-content re-add is *not* a conflict (research rejected content-hash comparison as an ambiguity spec.md doesn't require). Holds with or without a `base_versions` entry, since the guard runs unconditionally inside `applyDelta`.

**verify.md / trivial+quick alignment**: `generates: summary.md` stays unchanged in all three workflow YAMLs. `verify.md` gains an explicit instruction to save as `summary.md`. `output_path` is already correct at `instruction-generator.ts:107` — only the template text was stale.

**finalize.ts exit order**: `incompleteArtifacts` (new, exit 3) → `specMerge.status === 'conflict'` (moved up, exit 2) → `!gatesPassed` (moved down, exit 1). Fixes today's bug: a conflict forces `gatesPassed: false, gates: []`, currently misreported as "Quality gates failed" with an empty list instead of "Spec merge conflicts detected."

## Risks & Mitigations

- **`tests/finalizer.test.ts` breaks wholesale.** All cases call `createChange()` (artifacts default `pending`/`ready`) then `finalize()` with no `markArtifact(..., 'complete')` — the new gate aborts every one. Update all cases (`finalizer.test.ts:32,46,77,100,149,174,196,219`) to mark required artifacts `complete` first; add cases for incomplete-artifact abort (assert `incompleteArtifacts` + empty `spec/specs/` diff) and dry-run-then-real-write ordering.
- **`tests/spec-merger.test.ts` lacks a re-apply-into-existing-capability case.** Add one asserting exactly one `## Requirement:` section and a populated `noops` on the second `merge()` call.
- **`tests/cli-complete.test.ts` needs new cases**: self-slug delta without marker (non-zero, no folder), same delta with marker (success), regression guard that MODIFIED/REMOVED/RENAMED against a nonexistent capability still hard-fails.
- **Dry-run's `merged` list can over-report.** Idempotency check only runs when `!dryRun`, so a dry-run pass can report an ADDED delta as "merged" that resolves to a no-op on the real write. Cosmetic, no disk-state risk — document on `MergeResult`.
- **No vendor lock-in**: internal TypeScript, filesystem conventions, repo-owned templates; no new dependency.
- **Scope note vs. intent.md's Impact list**: intent.md names `trivial.yaml` for US-4; research's chosen direction (fix `verify.md`) satisfies the requirement without touching `trivial.yaml`/`quick.yaml` — flagged so the planner doesn't expect a YAML diff for US-4.
