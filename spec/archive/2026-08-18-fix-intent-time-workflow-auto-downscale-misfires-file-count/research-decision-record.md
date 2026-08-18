# Research: Fix 3 — Record accepted downscales (`downscale_decision`)

Area: persist an auditable decision record whenever the intent-time downscale resolves to Yes.
Governing delta requirements: `DownscaleDecisionSchema` and `DownscaleDecisionRecording` (this change's `spec.md`), constrained by the unchanged `EscalationRecording` requirement in `spec/specs/adaptive-workflow-tier-selection/spec.md` (line 473), whose `no_escalation_on_downscale_accept` scenario forbids writing `escalation` on the accept path — hence a parallel field, not reuse.

## Current state (verified against source)

- **Schema** (`src/schemas/change-metadata.ts`): `ChangeMetadataSchema` is `.strict()` (line 115). `EscalationSchema` (lines 48–53) is `{ from_tier, to_tier: z.enum(['trivial','quick','standard','full']), justification: z.string().min(1), timestamp: z.string().datetime() }.strict()`, mounted as `escalation: EscalationSchema.optional()`. The tier enum literal is already duplicated inline in `ComplexityScoreSchema` and `EscalationSchema` — inline duplication is the established pattern here.
- **Accept path** (`src/cli/commands/complete.ts` lines 304–335): on Yes, rebuilds the artifact map and issues one `updateChange(changeName, { workflow: recommendedTier, artifacts: rebuilt })`. **Nothing is recorded.** The decline path (lines 336–350) is the symmetry model: it writes `escalation` with a cause-keyed justification string (`kept ${currentWorkflow}: workflow_locked` / `kept ${currentWorkflow}: declined downscale`).
- **Type narrowing already works**: the branch guard `downscaleEligibleChosen = currentWorkflow === 'standard' || currentWorkflow === 'full'` (line 271) is an aliased-condition narrow, which is why the decline path's `to_tier: currentWorkflow` typechecks against the enum today. The accept path's `from_tier: currentWorkflow` will typecheck the same way — no cast needed.
- **`updateChange`** (`src/artifacts/artifact-store.ts` lines 155–179): reads stored metadata, shallow-merges `{ ...current, ...updates }`, writes through `StateStore.write`, which `safeParse`s against `ChangeMetadataSchema` **before persisting** (`src/state/state-store.ts` line 48). Shallow merge means the `downscale_decision` object is replaced wholesale — no deep-merge hazards.
- **Silent-failure trap**: the entire scoring block is wrapped in `try { … } catch { /* advisory-only */ }` (complete.ts line 429). If the schema is not extended before the write lands, strict-mode validation rejects the unknown key, the throw is swallowed, and **the workflow collapse itself would silently fail too** (it's the same write). Tests must assert the record exists, not just that nothing crashed.
- **Cause detection gap**: `askYesNo` (`src/cli/helpers.ts` lines 377–413) returns a bare `boolean`. It cannot distinguish an explicit `y` from an empty-Enter default-Yes — but `DownscaleDecisionSchema` requires the justification to identify which of three causes fired (`auto_accept_recommendation`, interactive explicit yes, interactive TTY default-Yes).

### Readers of `.metta.yaml` — unknown-field impact

| Reader | Mechanism | Impact of new optional field |
|---|---|---|
| All TypeScript readers (status.ts, progress.ts, finalize, ship, workflow-primer, ceremony-metrics, etc.) | `ArtifactStore.getChange` → `ChangeMetadataSchema` (strict) | Safe **once the field is declared in the schema**; unsafe (parse failure on any read of a collapsed change) if the field is written without the schema change — which strict-mode write validation prevents anyway |
| Statusline (`src/templates/statusline/statusline.mjs` lines 149–159) | Regex scalar grab of exactly `status`, `current_artifact`, `workflow`; explicitly "not a YAML parser" | Tolerant — ignores unknown keys entirely |
| `status.ts` line 195 | Surfaces `metadata.escalation` if present | Unaffected; does not enumerate fields. (Optional follow-up: surface `downscale_decision` similarly — not required by the delta, out of scope) |

No reader enumerates fields strictly outside the shared Zod schema. Backward compatibility for legacy files is automatic: an `.optional()` field on a strict schema accepts absence.

## Decision points

### 1. Schema shape

**Option A — standalone `DownscaleDecisionSchema`, same four fields as `EscalationSchema`, inline tier enum (recommended)**

```ts
export const DownscaleDecisionSchema = z.object({
  from_tier: z.enum(['trivial', 'quick', 'standard', 'full']),
  to_tier: z.enum(['trivial', 'quick', 'standard', 'full']),
  justification: z.string().min(1),
  timestamp: z.string().datetime(),
}).strict()

export type DownscaleDecision = z.infer<typeof DownscaleDecisionSchema>
```

Mounted as `downscale_decision: DownscaleDecisionSchema.optional()` in `ChangeMetadataSchema` (next to `escalation`).

- Pros: exactly the shape the ADDED requirement dictates; independent evolution from `EscalationSchema`; matches the codebase's existing inline-enum duplication (ComplexityScoreSchema, EscalationSchema); distinct Zod error paths in failures.
- Cons: four lines of duplication.

**Option B — alias: `export const DownscaleDecisionSchema = EscalationSchema`**
- Pros: zero duplication.
- Cons: couples two records the spec explicitly declares "parallel to (not reusing)"; a future change to one silently changes the other; weaker signal to readers. Rejected.

**Option C — extract a shared `WorkflowTierEnum` and a shared base record schema**
- Pros: DRY; the tier enum literal appears 3× already.
- Cons: touches `EscalationSchema`/`ComplexityScoreSchema` inferred types and their consumers in a bugfix change; churn disproportionate to the fix. Rejected for this change (fine as a later refactor).

Notes on field choices:
- `timestamp: z.string().datetime()` — the delta says only "string", but `.datetime()` is strictly compatible with that, matches `EscalationSchema`, and every existing timestamp field in this file uses it. Use `.datetime()`.
- Do **not** add a machine-readable `cause` enum field: the ADDED requirement fixes the shape to exactly `from_tier`/`to_tier`/`justification`/`timestamp`, and its scenarios test justification content. Encode the cause in the justification string, mirroring the decline path's style.

Justification strings (cause-keyed, one per accepting path):
- `collapsed ${currentWorkflow} -> ${recommendedTier}: auto_accept_recommendation`
- `collapsed ${currentWorkflow} -> ${recommendedTier}: interactive explicit yes`
- `collapsed ${currentWorkflow} -> ${recommendedTier}: interactive default-Yes`

### 2. Single record vs array

**Single optional object (recommended)** — a change cannot collapse twice:
- The downscale branch only fires when `currentWorkflow` is `standard` or `full` (complete.ts line 271); after an accepted collapse the workflow is the recommended tier (`quick` or `trivial`), which is ineligible. A `standard → quick → trivial` two-step cannot occur: the collapse goes **directly** to the scored tier in one step (`standard → trivial` if scored trivial), and intent-time scoring runs only when completing the `intent` artifact — `complexity_score` is write-once and never recomputed on intent edit (spec: `score_not_recomputed_on_intent_edit`).
- Summary-time recompute never downscales: "Downscale and same-tier cases are no-ops here" (complete.ts lines 457–459).
- Consistent with `escalation`, which is also a singular object.
- If a second collapse path ever appears, migrating `object?` → `array?` is a normal optional-field evolution; and `updateChange`'s shallow merge gives safe latest-wins overwrite semantics in the meantime.

Array rejected: models a repetition that is structurally impossible today and diverges from the sibling `escalation` shape and from the delta spec, which is written in the singular.

### 3. Where the write happens

**Fold into the existing accept-path `updateChange` call (complete.ts line 331) — one atomic write (recommended and spec-mandated):**

```ts
await ctx.artifactStore.updateChange(changeName, {
  workflow: recommendedTier,
  artifacts: rebuilt,
  downscale_decision: {
    from_tier: currentWorkflow,   // narrowed to 'standard' | 'full' by the branch guard
    to_tier: recommendedTier,
    justification,                // cause-keyed string, see above
    timestamp: new Date().toISOString(),
  },
})
```

`DownscaleDecisionRecording` requires the record "as part of the same metadata update that rewrites the `workflow` field", and `StateStore.write` validates the merged document before persisting — so "a workflow collapse without a validated decision record MUST NOT occur" falls out for free: one write, one validation, both-or-neither. A second `updateChange` call (decline-path style) would create a window where the collapse persisted but the record didn't; rejected.

Cause plumbing interlocks with Fix 2 (fail-closed). After Fix 2 the branch has three accepting paths and must know which fired:
- `autoAccept === true` → cause is `auto_accept_recommendation` (already known at the call site).
- Interactive TTY: `askYesNo` returns a bare boolean and cannot distinguish explicit `y` from empty-Enter default-Yes. Options:
  - **(a) Add an additive helper `askYesNoDetailed(question, opts): Promise<{ value: boolean; viaDefault: boolean }>` in `src/cli/helpers.ts`, with `askYesNo` becoming a thin wrapper (recommended).** Non-breaking for all other call sites (`release.ts`, `install.ts`, upscale branches); the existing `askYesNo` contract — which the intent's Impact section says stays unchanged — is preserved to the letter; independently unit-testable in `tests/cli-helpers.test.ts`.
  - (b) Collapse both interactive causes into one justification string — contradicts the ADDED requirement, which enumerates explicit-yes and default-Yes as distinct causes. Rejected.
  - (c) Inline readline logic in complete.ts — duplicates helper logic at a call site. Rejected.
- Non-interactive default-Yes ceases to exist as an accepting path under Fix 2 (fail-closed), so no cause value is needed for it.

**Risk to surface:** the intent's Impact section reads "`askYesNo` itself is expected to be unchanged". Option (a) keeps `askYesNo`'s behavior and signature intact but adds a sibling export to `helpers.ts` — a small, deliberate scope addition required to satisfy the three-cause wording of `DownscaleDecisionSchema`. Flag in the design/plan rather than silently expanding.

### 4. Backward compatibility

- `downscale_decision` is `.optional()` on the strict schema → legacy `.metta.yaml` files (all existing changes, archives, worktrees) parse unchanged; no migration. Covered by delta scenario `schema_accepts_legacy_file_without_downscale_decision`.
- Ordering constraint: the schema field **must** land in the same change as (or before) the complete.ts write — the strict schema plus the advisory `try/catch` at complete.ts line 429 means a write against an un-extended schema fails validation and is silently swallowed, also losing the workflow rewrite itself.
- Statusline template is regex-based and unaffected; no other out-of-schema readers exist.
- `escalation` semantics untouched: decline path code (lines 336–350) is not modified by this fix area, satisfying `EscalationRecording`'s `no_escalation_on_downscale_accept` and the delta's `decline_path_unchanged_writes_escalation_not_decision`.

### 5. Test plan

`tests/schemas.test.ts` (extend the existing `describe('ChangeMetadataSchema')` block, lines 35–456, which already exercises optional-field presence/absence):
1. Accepts a metadata document with a populated `downscale_decision` (`from_tier: 'standard'`, `to_tier: 'quick'`, non-empty justification, ISO timestamp) → parse succeeds, object round-trips. (`schema_accepts_populated_downscale_decision`)
2. Accepts a legacy document omitting `downscale_decision` → parse succeeds, field absent. (`schema_accepts_legacy_file_without_downscale_decision`)
3. Accepts `downscale_decision` present with `escalation` absent — independence. (`downscale_decision_coexists_with_escalation_semantics`)
4. Rejects: empty `justification`, invalid tier value, non-datetime `timestamp`, unknown key inside the record (`.strict()`).

`tests/cli-complete.test.ts` (existing downscale suite, lines ~250–520 — several assertions invert under Fix 2; this area adds record assertions):
5. **Auto-accept** (existing test line 250): add assertions — `meta.downscale_decision` defined with `from_tier: 'standard'`, `to_tier: 'trivial'`, justification containing `auto_accept_recommendation`, parseable ISO timestamp; `meta.escalation` still undefined.
6. **Interactive explicit yes** (new, via the existing `runCompleteInteractive` harness with answer `'y'`): record present with justification identifying the explicit interactive acceptance. (`interactive_yes_collapse_writes_decision_record`)
7. **Interactive default-Yes** (existing empty-answer test line 492): add assertion — record present with justification identifying the default-Yes cause.
8. **Decline paths** (existing tests lines 376, 458; plus Fix 2's new fail-closed non-TTY/json tests): assert `meta.downscale_decision` is `undefined` while `escalation` is written per `EscalationRecording`. (`decline_path_unchanged_writes_escalation_not_decision`)
9. **Atomicity guard**: in every accept-path test, assert the record and the `workflow` rewrite via a single re-read of `.metta.yaml` — this is the test that catches the strict-schema/silent-catch trap (a missing schema field makes both vanish).

`tests/cli-helpers.test.ts`: if `askYesNoDetailed` is added, unit-test `viaDefault` for empty answer, explicit `y`, explicit `n`, garbage input, and the non-TTY/jsonMode early return.

Test-count note: the delta's `auto_accept_opt_in_still_collapses_non_interactively` scenario (Fix 2 area) also asserts "a downscale decision record is persisted" — coordinate so that test lands once, in the Fix 2 test, with the record assertion from this area.

## Recommendation

Implement **Option A + single object + atomic write**:

1. In `src/schemas/change-metadata.ts`: add standalone `DownscaleDecisionSchema` (four fields identical in shape to `EscalationSchema`, inline tier enum, `.strict()`), export the inferred `DownscaleDecision` type, and mount `downscale_decision: DownscaleDecisionSchema.optional()` in `ChangeMetadataSchema` adjacent to `escalation`.
2. In `src/cli/commands/complete.ts`: in the accept branch, compute a cause-keyed justification string (`collapsed <from> -> <to>: <cause>`, causes: `auto_accept_recommendation` / `interactive explicit yes` / `interactive default-Yes`) and add the `downscale_decision` object to the **existing** `updateChange` call at line 331 so the workflow rewrite, artifact rebuild, and decision record persist as one validated write. No second write, no change to the decline path.
3. In `src/cli/helpers.ts`: add additive `askYesNoDetailed` returning `{ value, viaDefault }` (with `askYesNo` delegating to it) so the interactive explicit-yes vs default-Yes causes are distinguishable — flag this as the one deliberate scope addition beyond the intent's Impact list.
4. Tests per the plan above; the accept-path record assertions double as the regression guard against the strict-schema + advisory-catch silent-failure mode.

No external/web grounding was needed: all determinations rest on repository source (Zod strict-object and enum behavior as already exercised throughout `src/schemas/` and `tests/schemas.test.ts`, and TypeScript aliased-condition narrowing as already relied on by the shipping decline path at complete.ts line 346).
