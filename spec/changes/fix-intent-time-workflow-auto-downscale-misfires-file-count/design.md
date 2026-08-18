# Design: fix-intent-time-workflow-auto-downscale-misfires-file-count

## Approach

Three small, complementary fixes at three layers, implemented exactly per the research
synthesis (`research.md`): prevention at the scorer (Fix 1), fail-closed decision-making
at the prompt call site (Fix 2), and audit-trail symmetry in metadata (Fix 3). Each fix
is independently correct; together they close the Jupiter-incident failure chain
(greenfield 0-file intent → `trivial` recommendation → silent non-interactive default-Yes
→ unrecorded workflow collapse).

Design principles applied:

- **Functional core, imperative shell** — Fix 1 lives entirely in the pure scorer;
  Fixes 2–3 live at the CLI edge in `complete.ts`.
- **No unvalidated state writes** — the decision record rides the existing
  `updateChange` → `StateStore.write` → Zod `safeParse` pipeline; no new write path.
- **Proven patterns over novel ones** — the fail-closed branch reuses the existing No
  path (escalation + banner) verbatim; `DownscaleDecisionSchema` clones the shape of the
  shipping `EscalationSchema`; the non-interactive predicate is the exact predicate
  `askYesNo` already uses internally.
- **Composition over inheritance** — `askYesNo` becomes a thin wrapper composing
  `askYesNoDetailed`; no class hierarchies, no shared base schema extraction (ADR-3).

All three fixes touch `complete.ts` only in the intent-time downscale branch
(lines ~273–358). Fixes 2 and 3 overlap there and MUST be implemented in one pass to
avoid conflicting edits (research cross-cutting note). Fix 1 requires **zero** caller
changes: both the persist write (`complete.ts:252`) and the entire
downscale/upscale/banner block (`:256`) are already gated on `score !== null` (verified).

### Architecture Decision Records

#### ADR-1: `scoreFromIntentImpact` returns `null` on 0 parsed files

- **Status:** Accepted (research Fix 1, Option A).
- **Context:** `scoreFromIntentImpact` currently returns `null` only when `## Impact` is
  absent; a present-but-fileless section returns `buildScore(0)` → `trivial`. Spec
  requirement `ComplexityScoreComputation` (MODIFIED) defines 0 parsed files at intent
  time as no-signal: no recommendation, no persisted `complexity_score`, no prompt.
- **Decision:** Return `null` whenever the parsed count is 0, merging with the
  missing-heading case. The `hasH2Heading` pre-check is dropped from this function
  (`parseFileCountFromSection` already returns 0 for an absent heading);
  `hasH2Heading` itself stays — `scoreFromSummaryFiles` still uses it.
- **Consequences:** Zero caller changes; type-honest (`ComplexityScore` keeps
  `recommended_workflow` required — "a score exists" still implies "a recommendation
  exists"); `scoreFromSummaryFiles`, `buildScore`, `tierFromFileCount`, `isScorePresent`
  untouched, so the summary-time 0→`trivial` signal
  (`zero_files_at_summary_time_remains_real_signal`) holds by construction. The
  doc-comment-only distinction "intent not authored" vs "impact not yet listed"
  collapses intentionally — no caller ever branched on it (verified: sole caller is
  `complete.ts:248`).
- **Rejected:** score object with `recommended_workflow` unset — would weaken the shared
  `ComplexityScoreSchema` (also validates `actual_complexity_score`), break
  unconditional dereferences in `renderBanner`/`renderStatusLine`/`complete.ts`, and
  still need an extra persist guard to satisfy "MUST NOT persist".

#### ADR-2: Explicit fail-closed `else if (nonInteractive)` branch routed through the existing No path

- **Status:** Accepted (research Fix 2, Option B).
- **Context:** The downscale call passes `defaultYes: workflow_locked !== true` to
  `askYesNo`, whose non-TTY/`--json` early return converts that into a silent
  auto-accept. The upscale branch's static `defaultYes: false` trick cannot be copied:
  spec scenario `interactive_unlocked_shows_yes_default` requires the TTY default to
  **stay** Yes, so a single static default cannot express "Yes when TTY, No when not" —
  the call site must compute interactivity itself.
- **Decision:** Insert `const nonInteractive = !process.stdin.isTTY || json` and an
  explicit `else if (nonInteractive) { takeYes = false }` branch strictly **between**
  the `autoAccept` check (stays first, unchanged — the sole sanctioned non-interactive
  Yes) and the `askYesNo` call (reached only when interactive; its options unchanged:
  `defaultYes: workflow_locked !== true`). `takeYes = false` falls into the **existing
  No path**, which already writes the escalation record and prints the
  `renderBanner` advisory to stderr — the spec requires the fail-closed keep to be
  recorded and advisory-bannered, not silent. The No-path justification gains a third
  cause with `workflow_locked` keeping precedence:
  `workflow_locked` → `non-interactive fail-closed` → `declined downscale`.
- **Consequences:** `askYesNo` untouched (intent Out of Scope honored); upscale branch,
  release-cut confirm, summary-time recompute untouched; the predicate
  `!process.stdin.isTTY || json` now appears twice in the codebase (here and inside
  `askYesNo`) — accepted, since the alternative is changing `askYesNo`'s contract.
- **Rejected:** (a) wiring interactivity only into `defaultYes` — fail-closed cause
  invisible to the No path, producing a misleading `declined downscale` audit entry;
  (b) extending `askYesNo` with a `nonInteractiveDefault` option — explicitly out of
  scope per intent.md.

#### ADR-3: Standalone strict `DownscaleDecisionSchema`, single optional field, atomic write

- **Status:** Accepted (research Fix 3, Option A + single object + atomic write).
- **Context:** Spec `DownscaleDecisionSchema` (ADDED) mandates a parallel field "not
  reusing" `escalation`, whose decline semantics (`no_escalation_on_downscale_accept`
  in the base spec) forbid accept-path reuse. `ChangeMetadataSchema` is `.strict()`,
  and the whole scoring block sits in an advisory `try/catch` (`complete.ts:429`).
- **Decision:** New standalone `DownscaleDecisionSchema` — four fields identical in
  shape to `EscalationSchema` (`from_tier`/`to_tier` inline tier enums,
  `justification: z.string().min(1)`, `timestamp: z.string().datetime()`), `.strict()`
  — mounted as `downscale_decision: DownscaleDecisionSchema.optional()` adjacent to
  `escalation`. **Single object, not array**: double collapse is structurally impossible
  (downscale fires only from `standard`/`full`, goes directly to the scored tier, and
  intent scoring is write-once per `score_not_recomputed_on_intent_edit`; summary-time
  recompute never downscales). The record is **folded into the existing accept-path
  `updateChange` call** (`complete.ts:331`) alongside `workflow` and `artifacts` — one
  atomic validated write, so "a workflow collapse without a validated decision record
  MUST NOT occur" holds both-or-neither via `StateStore.write`'s pre-persist `safeParse`.
  The cause is encoded in the justification string (no separate `cause` enum field —
  the ADDED requirement fixes the shape to exactly four fields).
- **Consequences:** Legacy `.metta.yaml` files validate unchanged (`.optional()` on a
  strict schema accepts absence); statusline is regex-based and tolerant; four lines of
  tier-enum duplication, matching the established inline-enum pattern
  (`ComplexityScoreSchema`, `EscalationSchema`).
- **Rejected:** aliasing `EscalationSchema` (couples records the spec declares
  parallel); extracting a shared `WorkflowTierEnum` (churn across three schemas and
  their consumers, disproportionate for a bugfix — fine as a later refactor); array
  shape (models an impossible repetition); a second decline-style `updateChange` call
  (creates a window where the collapse persists without the record).

#### ADR-4: Bless `askYesNoDetailed` as an additive helper (explicit-yes vs default-Yes cause detection)

- **Status:** **Accepted** — this design blesses the researcher's proposal.
- **Context:** Spec `DownscaleDecisionSchema` requires the justification to identify
  which of three accepting causes fired: `auto_accept_recommendation`, interactive
  explicit yes, or interactive TTY default-Yes. `askYesNo` returns a bare `boolean` and
  cannot distinguish an explicit `y` from an empty-Enter default. intent.md's Impact
  section says "`askYesNo` itself is expected to be unchanged".
- **Decision:** Add `askYesNoDetailed(question, opts): Promise<{ value: boolean;
  viaDefault: boolean }>` to `src/cli/helpers.ts`, carrying the existing readline logic;
  `askYesNo` becomes a thin wrapper returning `.value`. `viaDefault` is `true` when the
  result came from the non-TTY/jsonMode early return, an empty answer, or an
  unrecognized answer — i.e. any resolution via `defaultYes` rather than an explicit
  y/n. The downscale call site switches to `askYesNoDetailed` (interactive-only after
  ADR-2, so `viaDefault: true` there means exactly "interactive TTY default-Yes").
- **Rationale for blessing:** every alternative fails a hard constraint —
  (b) collapsing the two interactive causes into one string contradicts the ADDED
  requirement's three-cause enumeration; (c) inlining readline in `complete.ts`
  duplicates helper logic at a call site and violates the imperative-shell convention.
  The wrapper preserves `askYesNo`'s signature and behavior to the letter for all other
  call sites (upscale ×2, release-cut, install), keeping the intent's "unchanged"
  promise in substance. This is the **one deliberate scope addition** beyond intent.md's
  Impact list; it is surfaced here (and must be echoed in tasks/plan) rather than
  silently expanded.
- **Consequences:** one new export in `helpers.ts`; new unit tests in
  `tests/cli-helpers.test.ts`; no other call site changes.

### Spec conformance mapping

| spec.md requirement / scenario | Component satisfying it |
|---|---|
| `ComplexityScoreComputation` — 0 files at intent = no-signal, no persist, no prompt | `scorer.ts` `scoreFromIntentImpact` null return (ADR-1) + existing `score !== null` gates in `complete.ts` (no edit needed) |
| `zero_file_intent_is_no_signal` | Same; verified by new cli-complete integration test T-C1 |
| `single_file_intent_still_scores` | `buildScore`/`tierFromFileCount` unchanged; new scorer test T-S2 |
| `zero_files_at_summary_time_remains_real_signal` | `scoreFromSummaryFiles` untouched; new scorer test T-S3 |
| `score_absent_before_intent_written`, `score_not_recomputed_on_intent_edit` | Unchanged code paths; existing tests remain green |
| `AutoDownscalePromptAtIntent` — non-interactive fails closed, advisory printed, No regardless of `workflow_locked` | `complete.ts` `nonInteractive` fail-closed branch → existing No path (ADR-2) |
| `non_tty_downscale_fails_closed` / `json_mode_downscale_fails_closed` | Inverted tests T-I1/T-I2 + new TTY+`--json` test T-C2 |
| `auto_accept_opt_in_still_collapses_non_interactively` | `autoAccept` branch unchanged and checked first; regression guards T-R1/T-R2 extended with record assertions |
| `interactive_unlocked_shows_yes_default` / `locked_change_defaults_to_no` | `askYesNoDetailed` call with `defaultYes: workflow_locked !== true` (interactive path only); regression guards T-R3/T-R5 |
| `DownscaleDecisionSchema` (all 3 scenarios) | `change-metadata.ts` new schema + optional mount (ADR-3); schema tests T-D1–T-D4 |
| `DownscaleDecisionRecording` — record on every Yes, same metadata update as `workflow` rewrite, validated pre-persist | Accept-path `updateChange` fold-in (ADR-3) + cause plumbing (ADR-4); tests T-R1, T-C3, T-R4 |
| `decline_path_unchanged_writes_escalation_not_decision` | Decline path code unmodified except third justification cause; asserted in T-I1/T-I2/T-R3 (`downscale_decision` undefined, `escalation` defined) |

## Components

### 1. `src/complexity/scorer.ts` (modified — Fix 1)

`scoreFromIntentImpact` becomes:

```ts
export function scoreFromIntentImpact(intentMd: string): ComplexityScore | null {
  const count = parseFileCountFromSection(intentMd, '## Impact')
  if (count === 0) return null
  return buildScore(count)
}
```

Doc-comment rewrites (required, not optional):

- `scoreFromIntentImpact` — replace the current promise ("Returns a score (with
  file_count 0 and tier 'trivial') when the heading exists but the section is empty…").
  New contract: returns `null` whenever the `## Impact` section yields 0 parsed file
  references — whether the heading is absent or present-but-empty. Zero files at intent
  time is absence of evidence, not evidence of triviality; contrast explicitly with
  `scoreFromSummaryFiles`, where 0 is a real signal.
- `scoreFromSummaryFiles` — extend one line: 0 files here **is** a real `trivial`
  signal (files exist at summary time); intentionally asymmetric with the intent scorer.
- `buildScore` — add a short comment: maps raw counts including 0 through the canonical
  thresholds; zero-file no-signal gating is the intent scorer's responsibility.
- `complete.ts` comment near line 251 — note that a `null` score also covers the
  greenfield 0-file case (reader aid; optional but cheap while editing the block).

Unchanged by design: `tierFromFileCount` (thresholds, including `0 → trivial`),
`hasH2Heading`, `scoreFromSummaryFiles`, `isScorePresent`.

### 2. `src/cli/commands/complete.ts` (modified — Fixes 2+3, one pass)

Only the intent-time downscale branch changes. Target shape (illustrative — exact
banner/prompt strings unchanged):

```ts
const autoAccept = currentMetadata.auto_accept_recommendation === true
const nonInteractive = !process.stdin.isTTY || json
let takeYes = false
let acceptCause: 'auto_accept_recommendation' | 'interactive explicit yes' | 'interactive default-Yes' | null = null

if (autoAccept) {
  // unchanged stderr banner; MUST stay first — sole sanctioned non-interactive Yes
  takeYes = true
  acceptCause = 'auto_accept_recommendation'
} else if (nonInteractive) {
  // Fail closed: never resolve a workflow-collapsing decision via default-Yes
  // without a human. AutoDownscalePromptAtIntent: non_tty/json scenarios.
  takeYes = false
} else {
  const { value, viaDefault } = await askYesNoDetailed(
    color(`Scored as ${recommendedTier} (${fileCount} files) -- collapse workflow to /metta-${recommendedTier}?`, 33),
    { defaultYes: currentMetadata.workflow_locked !== true, jsonMode: json },
  )
  takeYes = value
  if (value) acceptCause = viaDefault ? 'interactive default-Yes' : 'interactive explicit yes'
}
```

Accept path — fold the record into the **existing** `updateChange` call (one atomic
validated write; `from_tier: currentWorkflow` typechecks via the existing
`downscaleEligibleChosen` aliased-condition narrowing, no cast):

```ts
await ctx.artifactStore.updateChange(changeName, {
  workflow: recommendedTier,
  artifacts: rebuilt,
  downscale_decision: {
    from_tier: currentWorkflow,
    to_tier: recommendedTier,
    justification: `collapsed ${currentWorkflow} -> ${recommendedTier}: ${acceptCause}`,
    timestamp: new Date().toISOString(),
  },
})
```

Decline path — code otherwise unchanged; justification ternary gains the third cause
with `workflow_locked` keeping precedence (the existing non-TTY-locked test asserts it):

```ts
const justification = currentMetadata.workflow_locked === true
  ? `kept ${currentWorkflow}: workflow_locked`
  : nonInteractive
    ? `kept ${currentWorkflow}: non-interactive fail-closed`
    : `kept ${currentWorkflow}: declined downscale`
```

Untouched: the misleading line-292 comment block is replaced (it documents the bug);
the `autoAccept` ordering; the artifact-map rebuild logic; the escalation write shape;
`renderBanner` advisory emission; the upscale branch; the full-tier cap; summary-time
recompute; the advisory `try/catch`.

### 3. `src/schemas/change-metadata.ts` (modified — Fix 3)

See Data Model. New exports: `DownscaleDecisionSchema`, `DownscaleDecision`. One new
optional field on `ChangeMetadataSchema`. Re-export through the `src/` barrel per the
schemas convention (match how `EscalationSchema` is surfaced).

### 4. `src/cli/helpers.ts` (modified — ADR-4)

`askYesNoDetailed` carries the current `askYesNo` body, returning
`{ value, viaDefault }`; `askYesNo` delegates:

```ts
export async function askYesNoDetailed(
  question: string,
  opts?: { defaultYes?: boolean; jsonMode?: boolean },
): Promise<{ value: boolean; viaDefault: boolean }>

export async function askYesNo(
  question: string,
  opts?: { defaultYes?: boolean; jsonMode?: boolean },
): Promise<boolean> {
  return (await askYesNoDetailed(question, opts)).value
}
```

`viaDefault` mapping inside `askYesNoDetailed`: non-TTY/jsonMode early return →
`{ value: defaultYes, viaDefault: true }`; empty answer → `{ value: defaultYes,
viaDefault: true }`; explicit y/Y → `{ value: true, viaDefault: false }`; explicit
n/N → `{ value: false, viaDefault: false }`; unrecognized → `{ value: defaultYes,
viaDefault: true }`. Prompt-suffix rendering and readline mechanics are unchanged, so
the test suite's `vi.mock('node:readline')` harness keeps working.

### 5. Test files (modified/extended)

`tests/complexity-scorer.test.ts`, `tests/cli-complete.test.ts`,
`tests/schemas.test.ts`, `tests/cli-helpers.test.ts`. Full matrix below.

#### Test matrix

Line numbers refer to the current worktree test files (from research; re-verify at
implementation time).

**Inverted tests (5 total — 1 scorer, 4 cli-complete):**

| ID | File / current test | Old assertion | New assertion |
|---|---|---|---|
| T-S1 | `complexity-scorer.test.ts:68–83` "returns a score with file_count 0 when ## Impact heading exists but section is empty" | `file_count: 0`, `recommended_workflow: 'trivial'`, `score: 0` | `expect(scoreFromIntentImpact(md)).toBeNull()`; rename to state the no-signal contract |
| T-I1 | `cli-complete.test.ts:290` "non-TTY, workflow unlocked: downscale resolves Yes silently" | workflow → `trivial`, planning artifacts dropped, no `Advisory:`, no escalation | workflow stays `standard`; `stories`/`spec` artifacts kept; stderr contains `Advisory:` + `downscale recommended` and does **not** contain `collapse workflow` (no prompt text); escalation `{from_tier: 'trivial', to_tier: 'standard', justification ~ 'non-interactive fail-closed'}`; `downscale_decision` undefined |
| T-I2 | `cli-complete.test.ts:325` json-mode downscale | workflow → `trivial`, no Advisory, no escalation | workflow stays `standard`; stdout still `JSON.parse`-able; stderr contains `Advisory:`; escalation defined; `downscale_decision` undefined |
| T-I3 | `cli-complete.test.ts:347` "three-file impact under standard: downscale to quick fires by default" | workflow → `quick`, artifacts dropped | workflow stays `standard`; artifacts kept; escalation `{from_tier: 'quick', to_tier: 'standard'}` |
| T-I4 | `cli-complete.test.ts:836` "downscale fires by default, upscale does NOT fire" | `not.toContain('Advisory:')`, workflow → `quick` | workflow stays `standard`; stderr **contains** the downscale Advisory; keep `not.toContain('upscale recommended')` |

**Regression guards (7 — must pass unchanged in behavior; T-R1/T-R2/T-R4 gain record
assertions):**

| ID | File / test | Guards |
|---|---|---|
| T-R1 | `cli-complete.test.ts:250` auto_accept collapses without prompting (non-TTY) | autoAccept checked before fail-closed branch. **Add:** `downscale_decision` defined with `from_tier: 'standard'`, `to_tier: 'trivial'`, justification containing `auto_accept_recommendation`, parseable ISO timestamp; `escalation` undefined; asserted via a single re-read of `.metta.yaml` together with the `workflow` assertion (atomicity/silent-failure guard). This test also lands the `auto_accept_opt_in_still_collapses_non_interactively` record assertion — once, here, not duplicated |
| T-R2 | `cli-complete.test.ts:581` auto_accept via fixture after propose | same auto-accept path from a propose-created change; add same record assertions |
| T-R3 | `cli-complete.test.ts:376` workflow_locked, non-TTY keep | passes only if `workflow_locked` cause keeps precedence over `non-interactive fail-closed` in the justification ternary; add `downscale_decision` undefined |
| T-R4 | `cli-complete.test.ts:492` interactive empty answer → default-Yes collapse | canonical "TTY default-Yes still works" guard. **Add:** record present, justification containing `interactive default-Yes` |
| T-R5 | `cli-complete.test.ts:458` interactive decline (`n`) | `[Y/n]` suffix, escalation `declined downscale`; add `downscale_decision` undefined |
| T-R6 | `cli-complete.test.ts:519,543` quick-tier guards | downscale branch never entered for quick |
| T-R7 | `cli-complete.test.ts:707–834` upscale suite | upscale branch untouched |

Also unchanged and load-bearing in `complexity-scorer.test.ts`: missing-`## Impact` →
`null` (lines 85–96 — same outcome, second reason; keep as a distinct case so the
collapsed distinction stays documented), the 3-file intent test, all `tierFromFileCount`
tests including `0 → trivial` (thresholds unchanged), existing `scoreFromSummaryFiles`
and `isScorePresent` tests.

**New tests:**

| ID | File | Test |
|---|---|---|
| T-S2 | `complexity-scorer.test.ts` | 1-file intent → `file_count: 1`, `recommended_workflow: 'trivial'` — proves no-signal is strictly `count === 0` (`single_file_intent_still_scores`) |
| T-S3 | `complexity-scorer.test.ts` | `scoreFromSummaryFiles` with `## Files` present but empty → `file_count: 0`, `recommended_workflow: 'trivial'` — the now-load-bearing asymmetry (`zero_files_at_summary_time_remains_real_signal`), currently untested |
| T-C1 | `cli-complete.test.ts` | Integration: greenfield intent whose `## Impact` has prose/inline-code but no file tokens → after `complete intent`, `.metta.yaml` has no `complexity_score` key, `workflow` unchanged, stderr has no downscale prompt and no `Advisory:` line (`zero_file_intent_is_no_signal`) |
| T-C2 | `cli-complete.test.ts` | **In-process TTY + `--json` fail-closed** — isolates the `json` half of the `nonInteractive` predicate, which subprocess (`runCli`) tests can never exercise alone (child stdin is always a pipe). Reuse `runCompleteInteractive` mechanics (`Object.defineProperty` forces `isTTY = true`) with `['--json', 'complete', 'intent', …]` and **no** queued readline answer; assert `ttyPrompt.questions` stays empty, workflow kept, escalation written, `downscale_decision` undefined. Requires a small harness tweak: let the helper accept pre-args (or add a sibling helper) — `--json` is already registered on the in-process program |
| T-C3 | `cli-complete.test.ts` | Interactive explicit yes (`runCompleteInteractive`, answer `'y'`) → workflow collapses; record present with justification containing `interactive explicit yes` (`interactive_yes_collapse_writes_decision_record`) |
| T-D1 | `schemas.test.ts` | `ChangeMetadataSchema` accepts populated `downscale_decision` (`standard`→`quick`, non-empty justification, ISO timestamp); object round-trips (`schema_accepts_populated_downscale_decision`) |
| T-D2 | `schemas.test.ts` | Legacy document omitting `downscale_decision` parses; field absent (`schema_accepts_legacy_file_without_downscale_decision`) |
| T-D3 | `schemas.test.ts` | `downscale_decision` present with `escalation` absent — independent parallel fields (`downscale_decision_coexists_with_escalation_semantics`) |
| T-D4 | `schemas.test.ts` | Rejections: empty `justification`, invalid tier, non-datetime `timestamp`, unknown key inside the record (`.strict()`) |
| T-H1 | `cli-helpers.test.ts` | `askYesNoDetailed`: `viaDefault` for empty answer (true), explicit `y` (false), explicit `n` (false), garbage input (true), non-TTY/jsonMode early return (true, value = defaultYes); `askYesNo` wrapper still returns the bare boolean |

**Fixture note:** existing downscale fixtures use `oneFileIntent` (1 → trivial) and
`threeFileIntent` (3 → quick), so they still score under the zero-is-no-signal rule —
no fixture changes needed for Fixes 2/3. The `metta instructions` banner tests pre-write
`complexity_score` directly and bypass the scorer — unaffected.

## Data Model

New schema in `src/schemas/change-metadata.ts`, adjacent to `EscalationSchema`:

```ts
export const DownscaleDecisionSchema = z.object({
  from_tier: z.enum(['trivial', 'quick', 'standard', 'full']),
  to_tier: z.enum(['trivial', 'quick', 'standard', 'full']),
  justification: z.string().min(1),
  timestamp: z.string().datetime(),
}).strict()

export type DownscaleDecision = z.infer<typeof DownscaleDecisionSchema>
```

Mounted on `ChangeMetadataSchema` next to `escalation`:

```ts
escalation: EscalationSchema.optional(),
downscale_decision: DownscaleDecisionSchema.optional(),
```

Notes:

- `timestamp` uses `.datetime()` — strictly compatible with the delta's "string" and
  consistent with every other timestamp field in this file.
- Inline tier enums duplicate the literal a fourth time — the established pattern here
  (no shared-enum extraction in a bugfix; see ADR-3 rejected options).
- Single optional object, not an array — double collapse is structurally impossible;
  matches the singular `escalation` sibling and the delta spec's singular wording. If a
  second collapse path ever appears, `object?` → `array?` is a normal optional-field
  evolution, and `updateChange`'s shallow merge gives latest-wins in the interim.
- Justification string grammar (cause-keyed, mirroring the decline path's style):
  - Accept: `collapsed <from> -> <to>: auto_accept_recommendation` |
    `collapsed <from> -> <to>: interactive explicit yes` |
    `collapsed <from> -> <to>: interactive default-Yes`
  - Decline (escalation, existing field): `kept <chosen>: workflow_locked` |
    `kept <chosen>: non-interactive fail-closed` | `kept <chosen>: declined downscale`
- Non-interactive default-Yes ceases to exist as an accepting path under Fix 2, so no
  cause value exists for it — by construction, not by convention.
- Backward compatibility: optional field on a strict schema → all legacy `.metta.yaml`
  files (changes, archives, worktrees) parse without migration. The statusline template
  regex-extracts only `status`/`current_artifact`/`workflow` and ignores unknown keys.
  No reader enumerates fields outside the shared Zod schema (verified in research).

## API Design

No public CLI surface changes — no new flags, commands, or JSON payload fields. The
observable contract changes are behavioral:

1. **`scoreFromIntentImpact(intentMd: string): ComplexityScore | null`** — signature
   unchanged; contract narrowed: `null` for any 0-file parse (heading absent OR
   present-but-empty). `scoreFromSummaryFiles` contract unchanged.
2. **`askYesNoDetailed(question, opts?): Promise<{ value: boolean; viaDefault: boolean }>`**
   — new export in `src/cli/helpers.ts`. `askYesNo` keeps its exact signature and
   behavior as a wrapper.
3. **`metta complete intent` observable behavior:**
   - Greenfield (0-file `## Impact`): no `complexity_score` persisted, no prompt, no
     advisory; first real recommendation arrives at summary time.
   - Non-interactive (non-TTY or `--json`) with a downscale recommendation and no
     `auto_accept_recommendation`: workflow and artifacts kept; advisory banner on
     stderr; `escalation` written with the `non-interactive fail-closed` cause
     (or `workflow_locked` when locked); exit code unchanged. `--json` stdout payload
     remains valid JSON (advisory goes to stderr — existing separation).
   - `auto_accept_recommendation: true`: collapses as before, now also writing
     `downscale_decision`.
   - Interactive TTY: prompt and defaults unchanged (`[Y/n]` unlocked, `[y/N]` locked);
     an accepted collapse writes `downscale_decision` with the explicit-yes or
     default-Yes cause.

Decision matrix (authoritative target behavior, from research Fix 2 §4):

| autoAccept | TTY | json | workflow_locked | Result |
|---|---|---|---|---|
| true | any | any | any | Yes — collapse + `downscale_decision` (`auto_accept_recommendation`) |
| false | no | any | any | No (fail closed) — keep; escalation `non-interactive fail-closed` (or `workflow_locked`); advisory |
| false | yes | true | any | No (fail closed) — `--json` counts as non-interactive even on a TTY |
| false | yes | false | !== true | Prompt `[Y/n]`; Yes → collapse + record (explicit-yes or default-Yes cause) |
| false | yes | false | === true | Prompt `[y/N]`; default No — unchanged |

`workflow_locked` no longer influences the non-interactive outcome (both resolve No);
it only selects the escalation justification and the TTY default — matching scenario
`locked_change_defaults_to_no`.

Spec-wording note (from research, carried forward for the implementer):
`AutoDownscalePromptAtIntent`'s "or auto mode is off" disjunct is implemented implicitly
by `autoAccept` collapsing first — a non-auto-accept, non-TTY run fails closed. Accepted
reading; no code flag and no spec change needed.

## Dependencies

- **No new packages.** Zod (existing), Node stdlib (`process.stdin.isTTY`, `readline`),
  Vitest (existing). No vendor lock-in introduced anywhere in this change — all
  additions are filesystem + stdlib + already-adopted libraries.
- **Internal ordering constraint (hard):** the `DownscaleDecisionSchema` field MUST land
  in the same change as — and in the task ordering, before or together with — the
  `complete.ts` accept-path write. Writing the record against an un-extended strict
  schema fails validation inside the advisory `try/catch`, silently losing **both** the
  record and the workflow rewrite (see Risks R1).
- **Internal coupling:** Fix 2's `nonInteractive`/branch restructure and Fix 3's
  `acceptCause` plumbing edit the same ~60 lines of `complete.ts` — implement as one
  task, not two parallel ones. Fix 1 (`scorer.ts`) and the schema/helpers edits are
  file-independent and parallelizable.
- **Spec merge dependency:** `spec/specs/adaptive-workflow-tier-selection/spec.md`
  receives the MODIFIED/ADDED requirements from this change's delta spec at ship time
  (standard metta spec-merge flow; no design work needed).

## Risks & Mitigations

- **R1 — Silent-failure trap (highest risk):** the intent-scoring block's advisory
  `try/catch` swallows all errors, and `ChangeMetadataSchema` is `.strict()` with
  pre-persist validation in `StateStore.write`. If the accept-path write ever includes a
  key the schema doesn't declare, the *entire* write — including the workflow rewrite —
  is rejected and the failure is invisible. **Mitigation:** (a) strict
  `DownscaleDecisionSchema` declared in the same change (Dependencies); (b) every
  accept-path test (T-R1, T-R2, T-R4, T-C3) MUST assert the `downscale_decision` record
  and the `workflow` rewrite via a single re-read of `.metta.yaml` — asserting the
  record is the only signal that catches this failure mode; "nothing crashed" proves
  nothing here.
- **R2 — Scope addition (`askYesNoDetailed`):** intent.md's Impact list says helpers.ts
  changes only in call-site wiring. ADR-4 deliberately adds one sibling export because
  the spec's three-cause enumeration is unsatisfiable with a bare boolean.
  **Mitigation:** recorded as an ADR, additive-only (wrapper preserves `askYesNo`
  exactly), unit-tested independently (T-H1); flag in tasks.md so verify/review sees it
  as sanctioned.
- **R3 — Pipelines relying on silent auto-collapse break:** any non-interactive caller
  that depended on default-Yes collapse now keeps the chosen tier. **Mitigation:** this
  is the intended breaking behavior change (intent.md documents it); the sanctioned
  opt-in is one metadata flag (`auto_accept_recommendation: true`); the advisory banner
  plus escalation record make the new outcome observable, not silent.
- **R4 — Justification-cause precedence regression:** if `non-interactive fail-closed`
  is checked before `workflow_locked`, the existing non-TTY-locked test (T-R3) fails
  and the audit trail misattributes the cause. **Mitigation:** ternary order specified
  in Components §2 (`workflow_locked` first); T-R3 guards it.
- **R5 — Genuinely trivial greenfield changes lose the intent-time catch:** a real
  one-file greenfield fix no longer gets a `trivial` nudge at intent time.
  **Mitigation:** accepted by spec design — 0 files carries no information at intent
  time; summary-time scoring (unchanged, now explicitly tested by T-S3) catches
  genuinely trivial changes at the later scoring point.
- **R6 — TTY simulation fidelity in tests:** the fail-closed branch reads
  `process.stdin.isTTY` at decision time — the same probe `askYesNo` uses — so the
  existing `runCompleteInteractive` harness (forced `isTTY` + mocked readline) keeps
  working; the only harness change is accepting pre-args for T-C2. **Mitigation:** keep
  the predicate read identical to `askYesNo`'s; T-C2 isolates the `json` disjunct that
  subprocess tests structurally cannot cover.
- **R7 — Doc-comment drift:** the current `scoreFromIntentImpact` comment actively
  promises the behavior Fix 1 removes; leaving it would mislead the next maintainer
  into "fixing" the regression back. **Mitigation:** doc-comment rewrite is a specified
  deliverable (Components §1), not a courtesy; the kept missing-heading test (85–96)
  documents the collapsed distinction in executable form.
