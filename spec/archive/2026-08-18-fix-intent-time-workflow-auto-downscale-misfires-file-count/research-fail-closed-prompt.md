# Research: Fix 2 — fail closed on non-interactive downscale

Area: the downscale branch of intent-time scoring in `src/cli/commands/complete.ts` (lines ~265–358). Goal: a non-interactive run (`stdin` not a TTY, or `--json`) must never resolve the downscale via default-Yes; only `auto_accept_recommendation: true` may auto-collapse.

## 1. Current behavior (verified at source)

### Call site — `src/cli/commands/complete.ts:279–302`

```ts
const autoAccept = currentMetadata.auto_accept_recommendation === true
let takeYes = false
if (autoAccept) {
  // stderr banner "Auto-accepting recommendation: downscale to ..."
  takeYes = true
} else {
  takeYes = await askYesNo(
    color(`Scored as ${recommendedTier} (${fileCount} files) -- collapse workflow to /metta-${recommendedTier}?`, 33),
    { defaultYes: currentMetadata.workflow_locked !== true, jsonMode: json },  // line 300 — THE BUG
  )
}
```

`json` is `program.opts().json` (complete.ts:98). The Yes path (304–335) rebuilds the artifact map against the target graph and writes `{ workflow, artifacts }`; the No path (336–357) writes an `escalation` record (justification keyed `workflow_locked` vs `declined downscale`) and prints `renderBanner(score, currentWorkflow)` to stderr (`Advisory: current <chosen>, scored <rec> -- downscale recommended`). Whole block is inside a `try {} catch {}` that swallows errors (advisory-only scoring).

### `askYesNo` contract — `src/cli/helpers.ts:377–413`

```ts
const defaultYes = opts?.defaultYes ?? false
if (!process.stdin.isTTY || opts?.jsonMode === true) {
  return defaultYes
}
```

So the non-interactive detection predicate used everywhere in this codebase is exactly `!process.stdin.isTTY || json`. There is no other `isTTY` read in `src/` besides `readPipedStdin` (helpers.ts:422).

### How the upscale branch "fails closed"

Important nuance: the upscale branch (complete.ts:385–391) does **not** explicitly detect non-TTY. It simply passes `defaultYes: false`, and `askYesNo`'s early return does the rest. "Mirroring the upscale branch" therefore means making the effective non-interactive default `false` — not necessarily adding a TTY probe. However, the downscale branch has an extra requirement the upscale branch does not: on the interactive TTY path the default must **stay Yes** when unlocked (spec scenario `interactive_unlocked_shows_yes_default`). A single static `defaultYes` cannot express "Yes when TTY, No when not", so the call site must compute interactivity itself.

## 2. What spec.md requires of the fail-closed path (not silent!)

From the change's delta spec (`AutoDownscalePromptAtIntent`, `DownscaleDecisionRecording`) and the base spec (`EscalationRecording`, spec/specs/adaptive-workflow-tier-selection/spec.md:473):

- Non-interactive (=`process.stdin.isTTY` falsy OR `--json`): decision resolves to **No regardless of `workflow_locked`**, no prompt printed, workflow + artifact list unchanged, and **an advisory line reporting the declined recommendation MUST be printed**. The existing `renderBanner` output satisfies this (it is the exact string the `workflow_locked` non-TTY test already asserts).
- The fail-closed keep is a "No by any path", and per `DownscaleDecisionRecording` + scenario `decline_path_unchanged_writes_escalation_not_decision`, a No path **does write the `escalation` record** (`from_tier: <recommended>`, `to_tier: <chosen>`) — the fail-closed keep is *not* silent and *not* record-free. It must NOT write a `downscale_decision`.
- `auto_accept_recommendation: true` remains the sole sanctioned non-interactive Yes: "the prompt MUST be skipped and Yes MUST be auto-selected regardless of `workflow_locked` or TTY state." The current code already checks `autoAccept` **before** ever reaching `askYesNo`, so the fail-closed check must sit strictly inside/after the `else` — ordering is already correct and must be preserved.
- JSON mode: advisory emitted "without corrupting the JSON output contract" — `renderBanner` goes to stderr, stdout carries the payload; no change needed there.
- Spec wording note: the requirement lists a third disjunct, "or auto mode is off". Since `autoAccept` collapses before the check, `!isTTY || json` in the else branch implements this literally (a non-auto-accept, non-TTY run fails closed). No extra flag is needed; flag this phrasing to the spec author if it was meant to say `auto_accept_recommendation` absent.

## 3. Options

### Option A — wire interactivity into `defaultYes` only (minimal diff)

```ts
const interactive = process.stdin.isTTY === true && !json
takeYes = await askYesNo(prompt, {
  defaultYes: interactive && currentMetadata.workflow_locked !== true,
  jsonMode: json,
})
```

- Pros: one-line change; askYesNo untouched (intent.md requires this); non-interactive → returns `false` → falls into the existing No path, which already writes the escalation and prints the banner — the entire fail-closed behavior comes for free.
- Cons: the fail-closed cause is invisible to the No path, so the escalation justification would read `declined downscale` for a run where nobody declined anything — misleading audit trail (the audit trail is the whole point of this change). Fixing that requires the `interactive` flag in the No path anyway, eroding the "minimal" advantage. Also duplicates askYesNo's internal predicate implicitly rather than explicitly (a reader must know askYesNo's early-return to see why this fails closed).

### Option B — explicit fail-closed branch at the call site (recommended)

```ts
const nonInteractive = !process.stdin.isTTY || json
if (autoAccept) {
  // unchanged: banner + takeYes = true  (MUST stay first — sanctioned auto-accept)
} else if (nonInteractive) {
  // Fail closed: never resolve a workflow-collapsing decision via default-Yes
  // without a human. See AutoDownscalePromptAtIntent (non_tty / json scenarios).
  takeYes = false
} else {
  takeYes = await askYesNo(prompt, {
    defaultYes: currentMetadata.workflow_locked !== true,  // TTY default-Yes unchanged
    jsonMode: json,
  })
}
```

No path justification gains a third cause (precedence matters — the existing non-TTY locked test asserts `workflow_locked` appears, so lock stays first):

```ts
const justification = currentMetadata.workflow_locked === true
  ? `kept ${currentWorkflow}: workflow_locked`
  : nonInteractive
    ? `kept ${currentWorkflow}: non-interactive fail-closed`
    : `kept ${currentWorkflow}: declined downscale`
```

- Pros: self-documenting; the fail-closed decision is visible at the decision site and traceable 1:1 to the `non_tty_downscale_fails_closed` / `json_mode_downscale_fails_closed` scenarios; the `nonInteractive` flag is available for the cause-keyed justification (and Fix 3's cause-keyed `downscale_decision.justification` on the TTY accept path needs the same flag to distinguish explicit-yes… actually explicit-yes vs default-Yes needs the raw answer, but interactive-vs-auto needs this flag); askYesNo unchanged; escalation + banner reuse the existing No path untouched.
- Cons: ~6 more lines than Option A; the predicate `!process.stdin.isTTY || json` is now written twice in the codebase (here and inside askYesNo). Acceptable — the intent explicitly forbids changing askYesNo, and the upscale/release-cut sites don't need the predicate because their default is statically `false`.

### Option C — extend `askYesNo` (e.g. `nonInteractiveDefault` option or return a discriminated result)

Rejected: intent.md Out of Scope — "Changing `askYesNo`'s general non-TTY contract… other call sites already use it correctly and are untouched." A richer return type would also touch the upscale and release-cut call sites for no behavioral gain.

**Recommendation: Option B.**

## 4. Interaction matrix (target behavior)

| autoAccept | TTY | json | workflow_locked | Result |
|---|---|---|---|---|
| true | any | any | any | Yes (banner, collapse, `downscale_decision` per Fix 3) — unchanged ordering, checked first |
| false | no | any | any | **No (fail closed)**: keep workflow+artifacts, escalation `non-interactive fail-closed` (or `workflow_locked` if locked), Advisory banner |
| false | yes | true | any | **No (fail closed)** — `--json` counts as non-interactive even on a TTY |
| false | yes | false | !== true | Prompt `[Y/n]`, default Yes — unchanged |
| false | yes | false | === true | Prompt `[y/N]`, default No — unchanged |

`workflow_locked` no longer influences the non-interactive outcome (both resolve No); it only selects the escalation justification and the TTY default. That matches spec scenario `locked_change_defaults_to_no` ("either an interactive or a non-interactive environment… default is No").

Upscale branch, summary-time recompute (complete.ts:439+), and the full-tier cap are untouched (Out of Scope).

## 5. Test impact — `tests/cli-complete.test.ts`

### How the suite simulates TTY vs non-TTY (verified)

- **Non-TTY:** `runCli` → `execFile` subprocess; child stdin is a pipe, so `process.stdin.isTTY` is `undefined` inside the real CLI. All `runCli`-based tests are inherently non-interactive.
- **TTY:** `runCompleteInteractive` (test file lines 421–456) runs the command **in-process**: forces `process.stdin.isTTY = true` via `Object.defineProperty`, and a `vi.mock('node:readline')` (lines 14–36) replays a queued answer, recording the rendered question in `ttyPrompt.questions`. Because Option B reads `process.stdin.isTTY` at decision time (same as askYesNo does), this simulation keeps working with no harness changes.

### Tests that must be INVERTED (currently assert silent auto-accept)

| Test (line) | Current assertion | New assertion |
|---|---|---|
| `non-TTY, workflow unlocked: downscale resolves Yes silently…` (290) | workflow → `trivial`, planning artifacts dropped, no `Advisory:`, no escalation | workflow stays `standard`, `stories`/`spec` artifacts kept, stderr contains `Advisory:` + `downscale recommended`, escalation `{from_tier: trivial, to_tier: standard, justification ~ 'non-interactive fail-closed'}`, no `downscale_decision`. Rename accordingly. |
| `json mode with downscale condition…` (325) | workflow → `trivial`, no Advisory, no escalation | workflow stays `standard`, stdout still `JSON.parse`-able, stderr contains `Advisory:`, escalation defined |
| `three-file impact under standard: downscale to quick fires by default` (347) | workflow → `quick`, artifacts dropped | workflow stays `standard`, artifacts kept, escalation `{from_tier: quick, to_tier: standard}` |
| `standard workflow + 3-file impact: downscale fires by default, upscale does NOT fire` (836, in the upscale describe) | `not.toContain('Advisory:')`, workflow → `quick` | workflow stays `standard`, stderr **contains** the downscale Advisory (keep the upscale-absence assertions: `not.toContain('upscale recommended')` still holds since `renderBanner` emits the downscale form) |

Note on Fix 1 interaction: these fixtures use `oneFileIntent` (1 file → trivial) and `threeFileIntent` (3 → quick), so they still score under the new zero-is-no-signal rule — no fixture changes needed for Fix 2.

### Tests that must PASS UNCHANGED (regression guards)

- `auto_accept: downscale fires and mutates workflow without prompting` (250) and `auto_accept set via fixture after propose` (581) — both run via `runCli` (non-TTY), proving autoAccept still collapses non-interactively and is checked *before* the fail-closed branch. (Fix 3 will add `downscale_decision` assertions here — other research area.)
- `workflow_locked, non-TTY` (376) — already asserts keep + `workflow_locked` justification; passes only if the lock cause keeps precedence over the fail-closed cause in the justification ternary.
- `interactive decline (answer n)` (458) — TTY, `[Y/n]` suffix, decline escalation `declined downscale`.
- `interactive empty answer: Yes default collapses workflow` (492) — TTY default-Yes unchanged; this is the canonical "TTY default-Yes still works" guard.
- Quick-tier guards (519, 543) — downscale branch never entered; unaffected.
- Upscale suite (707–834) — untouched branch.

### NEW tests needed

1. **`--json` on a TTY fails closed (isolates the `json` half of the predicate).** All existing `--json` coverage runs through `runCli`, where non-TTY is *also* true, so the disjunction is never exercised on `json` alone. Add an in-process test: reuse `runCompleteInteractive` mechanics (force `isTTY = true`) but parse `['--json', 'complete', 'intent', …]` with **no** queued readline answer; assert `ttyPrompt.questions` stays empty (no prompt fired), workflow kept, escalation written. Requires a small harness tweak to accept extra pre-args (or a sibling helper) — `program.option('--json')` is already registered there (line 441).
2. **Fail-closed emits no prompt text non-interactively** — cheap addition to the inverted test 290: `expect(stderr).not.toContain('collapse workflow')`.
3. (Owned by Fix 3's area but worth co-locating): fail-closed keep writes `escalation` and **not** `downscale_decision` — fold into inverted tests 290/325 as `expect(meta.downscale_decision).toBeUndefined()` once the schema field exists.

## 6. Recommendation

Implement **Option B**: an explicit `nonInteractive = !process.stdin.isTTY || json` guard between the (unchanged, first-checked) `autoAccept` branch and the `askYesNo` call, forcing `takeYes = false` and routing through the existing No path — which already provides everything spec.md demands of the fail-closed outcome (workflow/artifacts untouched, escalation record, stderr advisory) — plus a third justification cause `non-interactive fail-closed` with `workflow_locked` retaining precedence. Leave `askYesNo`, the upscale branch, and summary-time scoring untouched. Invert the four silent-auto-accept tests, keep the seven regression guards as-is, and add the TTY+`--json` isolation test so both halves of the non-interactive predicate are independently covered.

No external grounding required for this area — all findings are from source in this worktree (`process.stdin.isTTY` semantics for piped subprocess stdin are stable Node behavior).
