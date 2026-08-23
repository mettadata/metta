# Research: surface `uat.enforce_on_ship` in `metta finalize --json` output

## Approach

Add the effective `uat.enforce_on_ship` value to the finalize success payload — a `uatEnforceOnShip: boolean` field on `FinalizeResult` (src/finalize/finalizer.ts) emitted alongside the existing `uatPath` in `metta finalize --json` (src/cli/commands/finalize.ts). Ship-path skills learn both the archived UAT path and the enforcement toggle from the single finalize call they all already make; no guard-hook change of any kind.

## How it works (concrete file/line evidence)

### Producer side

- `FinalizeResult` (src/finalize/finalizer.ts:12–39) already carries `uatPath: string | null` (line 29) and `uatError?` (line 31). A `uatEnforceOnShip: boolean` field slots in beside them.
- Config is already loaded exactly where needed: Step 5b (finalizer.ts:192–197) does `configLoader.load()` and branches on `config.uat.enabled`. The same load yields `config.uat.enforce_on_ship` once the field is added to `UatConfigSchema` (src/schemas/project-config.ts:45–47, currently `{ enabled: z.boolean().default(true) }.strict()` — the schema addition is mandated by the delta spec regardless of which read mechanism wins, so it is not a cost unique to this approach).
- The value flows into the final success return (finalizer.ts:296–308) next to `uatPath`. Mechanical detail: `FinalizeResult` has six early-return sites (incomplete-artifacts line 91, conflict lines 111/175, gate-failure line 137, dry-run line 154) that must also populate the field if it is typed required. On those paths config was never loaded; hardcoding `true` (the schema default) is safe because every abort path exits non-zero and no skill reaches its UAT gate. Alternative: type it `boolean` and hoist nothing — just literal `true` on aborts, real value on success.
- Degraded path: when the Step 5b config load throws, `uatError` is set and `uatPath` is null (finalizer.ts:209–215) — skills skip the gate on null `uatPath` anyway, so the toggle value is moot there; emit the default `true`.

### CLI side

- JSON success payload (src/cli/commands/finalize.ts:159–170) already emits `uatPath: result.uatPath` (line 166); add `uatEnforceOnShip: result.uatEnforceOnShip` one line down. This is purely additive — satisfies the delta-spec scenario "pre-existing finalize success-payload fields are unchanged" (spec.md, "Finalize-output mechanism outcome").
- Human output (finalize.ts:194) prints `UAT script: <path>`; an optional companion line (e.g. `UAT enforcement: off` only when false) keeps human parity cheap.
- `FinalizeResult` has exactly one consumer — src/cli/commands/finalize.ts:73. No other module reads the interface, so the change has no ripple.

### Consumer side — who calls `metta finalize --json` today

All six ship-path skills already invoke it and already parse its JSON (they need `uatPath` from the same payload under this change):

| Skill | Finalize call site (template SKILL.md) |
|---|---|
| metta-ship | lines 15–16 (`--dry-run --json` then `--json --change <name>`) |
| metta-propose | line 281 (Step 8a) |
| metta-quick | line 198 |
| metta-auto | line 74 |
| metta-fix-issues | line 84 |
| metta-fix-gap | line 84 |

So on every fresh run of every ship-path skill, the toggle arrives in-context in the exact payload the skill must already read to locate `uatPath`. Zero extra Bash invocations, zero new command surface.

### Guard-hook implications: none

`finalize` sits in `BLOCKED_SUBCOMMANDS` (src/templates/hooks/metta-guard-bash.mjs:68) — Tier-2, authorized by verified fork caller identity OR a valid session credential (guard comments at lines ~852–856). Every ship-path skill invokes it successfully today (fork-tier hosts for ship/propose/quick/auto/fix-issues; session-tier for fix-gap), so adding a JSON field changes nothing the guard inspects. By contrast, `config` appears in no allowlist (`ALLOWED_BARE`, two-word allow map, or blocked maps) → `metta config get` is fail-closed "unknown" today; the competing approach must widen both hook copies of an enforcement-sensitive file.

## Pros

- **Zero guard changes.** The `metta-guard-bash` hook — the most enforcement-sensitive file pair in the repo — stays byte-untouched. The delta requirement "guard hook's enforcement guarantees MUST NOT be weakened" is satisfied vacuously.
- **One call, already made, already parsed.** Skills need `uatPath` from finalize JSON no matter what; the toggle rides the same payload. No second `metta` invocation per skill, no new failure mode from a separate read.
- **Schema-validated by construction.** The value flows through `ConfigLoader.load()` → strict `UatConfigSchema` with `.default(true)` — omitted keys resolve correctly, unknown keys/non-booleans reject. Satisfies "without hand-parsing config YAML" directly.
- **Strong precedent fit.** `uatPath`/`uatError` and `tokensPath`/`tokensError` established the exact pattern: finalize surfaces UAT-related facts to callers via `FinalizeResult` → JSON payload. Tests for those fields (tests/finalizer.test.ts:60, 471, 657–690; tests/cli-finalize.test.ts:123–195) are templates to extend.
- **Atomic snapshot semantics.** The toggle is captured at finalize time — the same moment `uatPath` becomes real — so the gate decision and the artifact it gates on come from one consistent read.

## Cons

- **Dead on the re-ship path.** `metta-ship` on an already-finalized change (propose's default PR-open stop → user later runs `/metta-ship`) cannot re-run finalize: the change is archived, `artifactStore.getChange()` throws, the CLI exits 4 (finalize.ts:224–232). metta-ship's SKILL.md (steps 1–2) has no already-finalized branch today. On that path there is no finalize JSON — no toggle *and* no `uatPath`. See failure modes.
- **In-context only, no re-query.** If the finalize output is lost (context compaction, resumed session), there is no read-back mechanism — finalize cannot be re-run post-archive. `metta config get` would be re-queryable at any time. Same exposure `uatPath` already has, so this is a shared, accepted weakness rather than a new one — but the toggle inherits it.
- **Six return sites to touch.** The required-field interface change forces edits to all abort-path returns in finalizer.ts — mechanical but noisy in the diff.
- **Dry-run payload won't carry a meaningful value** (dry-run returns at finalizer.ts:153–165 before config is read, mirroring `uatPath: null` there). metta-ship runs `--dry-run` first (SKILL.md:15); skills must be instructed to gate on the *real* finalize output only.

## Complexity

**Low.** Estimated surface:

- src/schemas/project-config.ts: +1 line in `UatConfigSchema` (shared cost with any approach).
- src/finalize/finalizer.ts: interface +1 field with doc comment; ~7 return-site touches (6 aborts + success); 1 line reading `config.uat.enforce_on_ship` in Step 5b scope.
- src/cli/commands/finalize.ts: +1 line JSON payload; +1 optional human line.
- tests/finalizer.test.ts (1105 lines): extend the existing uatPath describe blocks — default-true success case, explicit-false case, abort-path cases assert the default. ~4–6 assertions on existing fixtures.
- tests/cli-finalize.test.ts (585 lines): extend the success-payload test (line 123) and the `uat.enabled: false` test (line 170, which already demonstrates writing `uat:` config into the fixture — the exact hook needed for an `enforce_on_ship: false` case).
- Skill text: each of the six pairs mentions reading `uatEnforceOnShip` from the finalize JSON it already parses — folded into the gate wording those files gain anyway.

No new files except possibly none; no new dependencies; no hook edits; no template-deploy pairs beyond the skills already in scope.

## Failure modes

1. **Re-ship of an already-finalized change (the critical one).** Propose finalizes, runs UAT at its PR-open stop, hands back; `/metta-ship` later processes the branch with no finalize call available. Sub-cases:
   - *Toggle true (default), run record exists:* covered — the delta's "Idempotent UAT Recording" requirement lets ship reuse the existing dated `## UAT run` record as gate evidence when the branch head is unchanged; the archived UAT.md is discoverable without `uatPath` via `spec/archive/*-<slug>/UAT.md`.
   - *Toggle false:* propose skipped the run, so no record exists; ship cannot read the toggle and cannot distinguish "enforcement disabled" from "run missed." Fail-safe behavior (run UAT anyway) over-enforces and technically brushes against the "Disabled enforcement skips the ship-path UAT run" scenario — though that scenario is worded "reaches its post-finalize step," and a re-ship has no post-finalize step, giving the design honest wiggle room to declare fail-safe re-run the defined behavior there.
   - Mitigation options for the design phase: (a) define re-ship semantics as "reuse record if present; else run" (over-enforcement accepted as fail-safe), (b) have propose's hand-back message carry the toggle state so ship inherits it textually, or (c) hybridize later with a read-only `config get` allowlist if the gap proves painful in practice. Note metta-ship must gain an already-finalized branch in its SKILL.md under *any* mechanism — today it would just crash finalize with exit 4.
2. **Config load failure at Step 5b** → `uatError` set, `uatPath: null`, toggle defaults true. Skills skip the gate on null `uatPath`; behavior degrades exactly as UAT generation already degrades. No new failure class.
3. **Skill parses dry-run output by mistake** → sees no/placeholder toggle. Guarded by skill wording ("gate on the real finalize payload") plus the grep-assert ordering tests placing the gate after the real finalize step.
4. **Context loss between finalize and gate** → toggle unrecoverable in-session. Identical blast radius to losing `uatPath`; the run fails loudly (skill cannot locate UAT.md either) rather than silently skipping enforcement.
5. **`uat.enabled: false`** → `uatPath: null`, gate skipped regardless of toggle value. Consistent and already spec'd; tests should pin that `uatEnforceOnShip` still reports the configured value for observability.

## Verdict

**Fit: 4/5.** Recommend this approach as the primary mechanism: it is additive, schema-validated, rides a payload all six skills already parse, matches the established `uatPath`/`tokensPath` FinalizeResult pattern, and — decisively — leaves both copies of the enforcement-critical guard hook untouched, whereas the `config get` alternative must widen the guard's fail-closed allowlist in a file whose entire value is being hard to change. The one real gap is the re-ship-without-finalize path, which needs explicit design regardless of mechanism (metta-ship currently has no already-finalized branch at all); define it as "reuse existing run record if branch head unchanged, else fail-safe re-run," and the finalize-JSON approach covers every reachable path without weakening anything.
