# Research: Persisted default stop point (`stop_after: pr-open` written into the change record)

Approach under evaluation: when no `--stop-after` is supplied, `propose.ts` writes
`stop_after: pr-open` into the change's `.metta.yaml`, so the skill's existing
persisted-stop_after boundary check enforces the PR-open default "with no new skill logic."

## 1. Code trace

- `src/cli/commands/propose.ts:38-54` — `stopAfter` comes from `options.stopAfter`; validated
  against the resolved workflow's `buildOrder` (execution-phase ids `implementation`/`verification`
  rejected; unknown ids rejected). `pr-open` and `ship` are NOT in any `buildOrder`, so today's
  validation would reject them — a lifecycle-stage carve-out would be required.
- `src/cli/commands/propose.ts:67-76` — `stopAfter` passed positionally to
  `ArtifactStore.createChange` (arg 7).
- `src/artifacts/artifact-store.ts:76-134` — `createChange` sets `metadata.stop_after` only when
  `stopAfter !== undefined` (lines 120-122). Injection point choice: propose.ts (`options.stopAfter
  ?? 'pr-open'`) keeps `createChange` and `metta quick` untouched; injecting inside `createChange`
  would leak the default into quick-mode changes too.
- `src/cli/commands/quick.ts:39-48` — quick calls `createChange` with `stopAfter = undefined`
  explicitly. Unaffected only if the default is injected in propose.ts.

## 2. Schema (`src/schemas/change-metadata.ts:116`)

`stop_after: z.string().optional()` — any string validates, so `pr-open`/`ship` need **no schema
change** and no migration for existing records. But: the spec explicitly says the schema accepts any
string and membership validation lives in the CLI, so tightening to an enum is out of scope anyway.
The real back-compat problem is **semantic, not structural**: today "field absent" means "full
lifecycle." Under a persisted default, absent-vs-present flips meaning by creation date — old
records (absent) would mean full lifecycle, new records always carry a value. Any reader that
treats absence as "run to completion" (the propose skill today, future tooling) faces a two-epoch
interpretation problem with no marker distinguishing the epochs.

## 3. Spec contradictions (`spec/specs/propose-stop-after/spec.md`, 71 reqs)

Directly contradicted:
- **Req 1, scenario "option is omitted, full-lifecycle behavior preserved" (lines 19-22):** flag
  absent → JSON `stop_after: null` AND `.metta.yaml` MUST NOT include `stop_after`. Head-on
  contradiction; requirement text (line 6: "behavior MUST be identical to the pre-change
  implementation") must be rewritten.
- **Req 2, validation (lines 25-43):** `--stop-after` MUST validate against `buildOrder`; `pr-open`
  is by definition not in `buildOrder`. Needs a new "lifecycle-stage values" class, new error-message
  wording, updated valid-value lists in help text and scenarios.
- **Req 4, `createChange` (lines 67-80):** "omits `stop_after` when not supplied" survives only if
  injection happens in propose.ts — the scenario stays true but becomes untested-in-practice for the
  propose path.
- **Req 5, scenario "skill behaves identically when no `stop_after` is set" (lines 104-107):**
  becomes vacuous/dead — no propose-created change would ever lack the field.
- **Req 7 handoff determinism (lines 141-155):** resume-command lookup table must gain `pr-open` →
  `/metta-ship` (or similar); boundary semantics change (see 4).

Spec delta: 4-5 of 8 requirements rewritten plus new requirements for the default and the
lifecycle-stage value class — roughly a half-rewrite of the capability spec, plus touches to
finalize-ship spec (merge preconditions) and the status requirement's examples.

## 4. Fatal flaw: the existing boundary check cannot fire on `pr-open`

`.claude/skills/metta-propose/SKILL.md` Step 3 boundary check (lines ~101-115): it runs **after
every `metta complete <artifact>`** and matches when persisted `stop_after` **equals the artifact id
just completed**. `pr-open` is never an argument to `metta complete` — it is not an artifact. The
check can never match it. The premise "no new skill logic" is therefore **false**: Step 8
(finalize/merge) must still gain a new conditional ("if `stop_after` is `pr-open`, stop after PR
creation, print handoff, do not merge") — exactly the skill logic this approach was supposed to
avoid. The persisted field becomes a second copy of state whose only consumer is new skill logic.

## 5. Blast radius: /metta-auto, /metta-fix-issues, /metta-quick

- `/metta-auto` (SKILL.md lines 22-23) and `/metta-fix-issues` (SKILL.md line 35) both create
  changes via the **same** `metta propose` CLI call. A persisted default lands in their change
  records too.
- Today neither skill reads `stop_after`, so they would merge anyway — leaving a **lying record**
  (`stop_after: pr-open` on a merged change). If any shared/future boundary logic honors the field,
  auto and fix-issues silently stop before ship, breaking their contracts.
- Mitigation requires both skills to pass an explicit `--stop-after ship` (or new `--ship`) on
  their propose calls — two more skill files + two `src/templates/skills/` copies + spec updates,
  expanding the change well beyond propose.
- `metta quick` is safe only with propose.ts-level injection; `createChange`-level injection
  contaminates quick-mode records that no skill would honor.

## 6. File-by-file change list (if pursued)

1. `src/cli/commands/propose.ts` — default injection; lifecycle-stage carve-out in validation;
   JSON/text output updates.
2. `src/cli/commands/propose.test.ts` (or test twin) — rewrite omitted-flag assertions.
3. `.claude/skills/metta-propose/SKILL.md` + `src/templates/skills/metta-propose/SKILL.md` — Step 8
   pr-open gate, resume-command mapping additions, handoff line (the "new skill logic" anyway).
4. `.claude/skills/metta-auto/SKILL.md` + template — explicit `--stop-after ship` on propose call.
5. `.claude/skills/metta-fix-issues/SKILL.md` + template — same.
6. `spec/specs/propose-stop-after/spec.md` — rewrite ~4-5 requirements; add lifecycle-stage value
   class and default-behavior requirements.
7. `spec/specs/finalize-ship/spec.md` — merge-precondition touch-ups (audit needed).
8. `src/schemas/change-metadata.ts` — no change required (string already validates).

## 7. Risks

- **False premise** — persisted-stop_after check only matches `metta complete` artifact ids;
  `pr-open` needs new Step-8 skill logic regardless. (High, certain.)
- **Auto/fix-issues contamination** — same CLI path; either lying records now or silent early stops
  later; forces compensating flags in two more skills. (High.)
- **Semantic epoch split** — absence means different things before/after this change; ambiguous for
  all future readers of `.metta.yaml`. (Medium.)
- **Spec churn** — ~half of propose-stop-after rewritten, incl. deleting the load-bearing
  "identical when omitted" guarantees other tooling may assume. (Medium.)
- **Validation surface growth** — two value vocabularies (artifact ids + lifecycle stages) in one
  field, one flag, one error message. (Low-medium, permanent complexity.)

## 8. Verdict

**Feasible but not recommended.** The approach's sole advantage — reusing the existing persisted
boundary check with no new skill logic — does not hold: that check matches only planning-artifact
ids passed to `metta complete`, so `pr-open` enforcement requires new Step-8 skill logic anyway.
Given that, persisting a default buys nothing over a skill-level default (propose SKILL Step 8 stops
at PR-open unless `--ship`/`--stop-after ship` was parsed), while costing: contamination of
auto/fix-issues change records via the shared CLI path, a semantic flip of field-absence that
contradicts 4-5 existing spec requirements, and a dual-vocabulary `stop_after` field. If the
orchestrator wants persistence for auditability, the safe variant is the inverse: persist only the
**opt-in** (`stop_after: ship` when `--ship` is passed) and let absence keep its current documented
meaning, with the PR-open default living in the propose skill alone.
