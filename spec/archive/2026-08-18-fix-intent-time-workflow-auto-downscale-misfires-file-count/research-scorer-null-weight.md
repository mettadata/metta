# Research: Fix 1 — Null-weight the absent-code signal in `scoreFromIntentImpact`

Area: `src/complexity/scorer.ts` intent-time zero-file contract. Fulfills spec requirement
`ComplexityScoreComputation` (MODIFIED) — 0 parsed files at intent time is no-signal: no
recommendation, no persisted `complexity_score`, no prompt/banner.

## Current behavior (verified against source)

`src/complexity/scorer.ts`:

- `scoreFromIntentImpact(intentMd)` (line 78) returns `ComplexityScore | null`. It returns
  `null` **only** when the `## Impact` H2 heading is absent (`hasH2Heading` check, line 79).
  When the heading exists, it calls `parseFileCountFromSection` and always returns
  `buildScore(count)` — so 0 files produces
  `{ score: 0, signals: { file_count: 0 }, recommended_workflow: 'trivial' }`.
- `buildScore(fileCount)` (line 60) maps any count through `tierFromFileCount`; it has no
  doc comment of its own. The zero-maps-to-trivial documentation lives in the doc comment
  on `scoreFromIntentImpact` (lines 69–77), which explicitly promises: *"Returns a score
  (with file_count 0 and tier 'trivial') when the heading exists but the section is empty,
  so callers can distinguish 'intent not authored' from 'intent authored but impact not
  yet listed'."* That promised distinction is what Fix 1 deliberately removes.
- `parseFileCountFromSection` (`src/complexity/file-count-parser.ts` line 86) already
  returns `0` both when the heading is absent and when it is present with no file-like
  tokens — the `hasH2Heading` pre-check in the scorer is the *only* thing implementing
  the missing-heading vs empty-section distinction.
- `scoreFromSummaryFiles` (line 90) has the identical shape and must remain untouched.
- `isScorePresent` (line 100) checks `metadata.complexity_score` validity; it never calls
  the intent scorer and is unaffected by either option.

## Sole caller and downstream flow

`scoreFromIntentImpact` has exactly one caller in `src/`:
`src/cli/commands/complete.ts:248` (verified by grep; no other imports).

The intent-time block in `complete.ts` (lines 245–432) is structured as:

```
const score = scoreFromIntentImpact(intentMd)          // line 248
if (score !== null && !isScorePresent(currentMetadata))
  await updateChange(..., { complexity_score: score }) // line 252–254 (persist)
if (score !== null) {                                  // line 256
  ... downscale branch (273–358), upscale branch (361–427), banners ...
}
```

Both the persistence write and the *entire* downscale/upscale/banner block are already
gated on `score !== null`. A `null` return for the 0-file case therefore skips
everything cleanly with **zero changes required in `complete.ts` for Fix 1** — no
`complexity_score` persisted, no prompt, no advisory banner, exactly matching the spec's
`zero_file_intent_is_no_signal` scenario. The surrounding `try/catch` (line 429) is
untouched. (Fixes 2 and 3 modify this block for the ≥1-file downscale path; Fix 1 itself
needs no caller edits.)

## Nothing depends on `complexity_score` existing

Every consumer of the persisted field already handles absence (verified by grep across
`src/` and `src/templates/`):

| Consumer | Absence handling |
|---|---|
| `src/cli/commands/instructions.ts:52` | `renderBanner(metadata.complexity_score, ...)` — `renderBanner` returns `''` for `null`/`undefined` (`src/complexity/renderer.ts:41`) |
| `src/cli/commands/status.ts:144,172` | JSON emits `metadata.complexity_score ?? null`; `renderStatusLine` returns `''` for `null`/`undefined` (`renderer.ts:79`) |
| `src/templates/skills/metta-quick/SKILL.md:101,153` | Trivial-detection gates read `complexity_score.recommended_workflow` via `metta status --json` and explicitly route absent scores to the standard multi-reviewer path — fail-safe by design |
| `src/cli/commands/model-escalation.ts:15` | Comment only — declares it never touches the field |
| `src/statusline/*` | No reads of `complexity_score` or `recommended_workflow` (grep empty) |
| Schema (`src/schemas/change-metadata.ts:98`) | `complexity_score: ComplexityScoreSchema.optional()` — absent is already valid |

Spec scenario `score_absent_before_intent_written` also already requires absence to be a
legal steady state. Persisting nothing for 0-file intents is safe everywhere.

## Options

### Option A — return `null` on 0 parsed files (recommended)

Change `scoreFromIntentImpact` so a parsed count of 0 returns `null`, same as the
missing-heading case:

```ts
export function scoreFromIntentImpact(intentMd: string): ComplexityScore | null {
  const count = parseFileCountFromSection(intentMd, '## Impact')
  if (count === 0) return null
  return buildScore(count)
}
```

(The `hasH2Heading` pre-check becomes behaviorally redundant because
`parseFileCountFromSection` returns 0 for an absent heading; it can be dropped from this
function. `hasH2Heading` stays — `scoreFromSummaryFiles` still uses it.)

Pros:
- **Zero caller changes.** `complete.ts` already gates persist + prompt block on
  `score !== null`; Fix 1 ships entirely inside `scorer.ts` plus tests.
- **Type-honest.** `ComplexityScore` keeps `recommended_workflow` required; "there is a
  score" continues to imply "there is a recommendation". No schema change, no optional
  field propagation.
- **Spec-exact.** "MUST NOT persist a `complexity_score` object" falls out of the existing
  `score !== null` guard for free.
- **`scoreFromSummaryFiles` provably untouched:** it does not call
  `scoreFromIntentImpact`; it keeps its own `hasH2Heading` + `buildScore` path, and
  `buildScore(0)` still yields `trivial` — required by scenario
  `zero_files_at_summary_time_remains_real_signal`. The only shared code touched is
  nothing: `buildScore`, `tierFromFileCount`, and the parser are all unmodified.

Cons:
- Collapses the missing-heading vs present-but-empty distinction the current doc comment
  advertises. Verified acceptable: the only caller never used the distinction (both cases
  take the same no-op path in `complete.ts`), and the MODIFIED spec text explicitly
  defines 0 parsed references as no-signal regardless of why. The doc comment must be
  rewritten, not just trimmed.

### Option B — return a score object with `recommended_workflow` unset

Make `recommended_workflow` optional on `ComplexityScore` and return
`{ score: 0, signals: { file_count: 0 } }` for 0-file intents.

Pros:
- Preserves a machine-readable record that scoring ran and found 0 files.

Cons (disqualifying):
- **Schema weakening ripples everywhere.** `ComplexityScoreSchema.recommended_workflow`
  (`change-metadata.ts:29`) becoming `.optional()` also weakens
  `actual_complexity_score` (same schema, line 99), where the recommendation is always
  real — a validation regression for summary-time scores.
- **Caller changes multiply.** `complete.ts:257` (`score.recommended_workflow`) and
  `:452` need undefined guards; `renderBanner` (`renderer.ts:44`) and `renderStatusLine`
  (`renderer.ts:84`) dereference `score.recommended_workflow` unconditionally and would
  need new branches; the metta-quick SKILL.md gates read the field via status JSON.
- **Contradicts the spec.** `ComplexityScoreComputation` says a 0-file intent "MUST NOT
  persist a `complexity_score` object" — Option B either persists one anyway (spec
  violation) or requires an extra `recommended_workflow !== undefined` persist guard in
  `complete.ts`, duplicating what `null` expresses for free.
- Two ways to say "no recommendation" (`null` and recommendation-less object) is a
  standing footgun for future consumers.

## Test changes

`tests/complexity-scorer.test.ts`:

- **Invert** the test at lines 68–83
  (`'returns a score with file_count 0 when ## Impact heading exists but section is empty'`)
  — it asserts `file_count: 0`, `recommended_workflow: 'trivial'`, `score: 0`. New
  assertion: `expect(scoreFromIntentImpact(md)).toBeNull()`, renamed to state the
  no-signal contract (e.g. `'returns null when ## Impact exists but parses to 0 files — zero files at intent time is no-signal'`).
- **Keep unchanged** lines 85–96 (missing `## Impact` heading → `null`) — same outcome,
  now for a second reason; keep as a distinct case so the collapsed distinction stays
  documented in tests.
- **Keep unchanged** the 3-file intent test (49–66), all `tierFromFileCount` tests
  (including `n = 0 → trivial` at line 23 — the threshold table is not changing), the
  `scoreFromSummaryFiles` tests (99–133), and `isScorePresent` tests.
- **Add**: (a) a 1-file intent test (`file_count: 1` → `trivial` recommendation) proving
  the no-signal rule is strictly `count === 0`, per scenario
  `single_file_intent_still_scores`; (b) an explicit `scoreFromSummaryFiles` 0-file test
  (`## Files` present, empty) asserting `file_count: 0` /
  `recommended_workflow: 'trivial'` — currently untested and now the load-bearing
  asymmetry, per scenario `zero_files_at_summary_time_remains_real_signal`.

`tests/cli-complete.test.ts` — **no inversions needed for Fix 1.** All intent fixtures
that exercise the downscale prompt use ≥1 file (`oneFileIntent` at line 213,
`threeFileIntent`, 5- and 15-file bodies), and the `metta instructions` banner tests
pre-write `complexity_score` directly via `writeComplexityField` (fileCount 1 or 5),
bypassing the scorer. **Add** one integration test: greenfield intent whose `## Impact`
has prose but no file tokens → after `complete intent`, `.metta.yaml` has no
`complexity_score` key, `workflow` unchanged, stderr contains no downscale prompt and no
`Advisory:` line (scenario `zero_file_intent_is_no_signal`).

## Doc comments to update

1. `scoreFromIntentImpact` (scorer.ts lines 69–77) — rewrite: returns `null` when the
   `## Impact` section yields 0 parsed file references, whether the heading is absent or
   present-but-empty; zero files at intent time is absence of evidence, not evidence of
   triviality; contrast explicitly with `scoreFromSummaryFiles` where 0 is a real signal.
2. `scoreFromSummaryFiles` (lines 84–89) — extend one line: 0 files here **is** a real
   trivial signal (files exist at summary time), intentionally asymmetric with the intent
   scorer.
3. `buildScore` — no doc comment exists; optionally add one noting it maps raw counts
   including 0 and that zero-file gating is the intent-scorer's responsibility. Optional.
4. `complete.ts` line 251 comment block — optionally note that a `null` score also covers
   the greenfield 0-file case (helps the next reader; not required for correctness).

## Edge cases

- **`## Impact` missing entirely vs present-with-0-files:** both now return `null`. The
  previous distinction was doc-comment-only; no caller branches on it, and the spec
  defines both as no-signal. Do not preserve it — preserving it (e.g. a discriminated
  return) would be speculative API surface with no consumer.
- **`## Impact` present with prose/inline-code that isn't file-like** (e.g.
  `` `askYesNo` ``): parser filters by extension/prefix (`file-count-parser.ts:42`),
  count 0 → `null`. Correct: prose-only impact sections are exactly the greenfield case
  from the Jupiter incident.
- **`intent.md` unreadable:** `readArtifact` throws → caught at `complete.ts:429`;
  unchanged.
- **Idempotent re-complete of intent on an already-scored change:** unchanged — persist
  is still guarded by `!isScorePresent`, and a ≥1-file score still flows.

## Recommendation

**Option A — return `null` from `scoreFromIntentImpact` when the parsed file count is 0,
merging it with the existing missing-heading `null` case.**

Rationale: the only caller (`complete.ts:248`) already treats `null` as "skip persist,
skip the entire downscale/upscale block", so Option A implements the full spec contract
(`zero_file_intent_is_no_signal`) with a ~4-line scorer change, a rewritten doc comment,
and test updates — no schema change, no renderer change, no caller change. Option B
forces `recommended_workflow` optional on a schema shared with `actual_complexity_score`,
touches four downstream dereference sites, and still needs an extra persist guard to
satisfy the "MUST NOT persist" requirement. `scoreFromSummaryFiles`, `buildScore`,
`tierFromFileCount`, and `isScorePresent` are untouched under Option A, keeping the
summary-time 0→trivial signal intact by construction.
