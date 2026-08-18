# Design — fix-json-output-c1-control-passthrough-json-stringify

Adopted approach: **post-stringify text escape** (research synthesis, Approach 1 — recommend; Approach 2 rejected). Spec refs: issue-logging ADDED requirements "CLI JSON output escapes DEL and C1 control characters" (US-1), "JSON escaping preserves parsed-value fidelity and never mutates stored data" (US-2), "Shared pure escape helper applied at every CLI stdout JSON edge" (US-3).

## Architecture

One new pure module (functional core), three call-site edits (imperative shell). No classes, no state, no new dependencies, no vendor lock-in.

### New module: `src/util/escape-json-controls.ts`

```ts
export function escapeJsonControls(jsonText: string): string
```

- Pure, total, idempotent. Replaces every UTF-16 code unit in U+007F–U+009F with its six-character JSON escape — a backslash followed by `u` and 4 lowercase hex digits (e.g. `\u009b` for U+009B). All other code units pass through untouched. Empty string returns empty string.
- Implementation shape: single global regex replace over `[\x7f-\x9f]` (no `u` flag — must match lone C1 code units, mirroring the `sanitize-text.ts` precedent), formatting each match as `\u` + 4-digit lowercase hex of `charCodeAt(0)`.
- Sibling of `src/util/sanitize-text.ts` in placement, doc-comment style, and export discipline. **No barrel change** — `sanitize-text.ts` is not re-exported from the root `index.ts` and this helper follows that precedent (research-edge-inventory finding).

### Call sites (exactly three, per the 29-site audit in research-edge-inventory)

| Edge | File / location | Change |
|------|-----------------|--------|
| `outputJson` | `src/cli/helpers.ts:234` | `console.log(escapeJsonControls(JSON.stringify(data, null, 2)))`. Covers all `--json` command output **and** the `handleError` JSON error envelopes — both `handleError` branches already route through `outputJson`, so no separate wiring (research corrected the intent on this point). |
| `config get` object branch | `src/cli/commands/config.ts:58` | Wrap only the `typeof value === 'object'` arm's `JSON.stringify(value, null, 2)`. The scalar `String(value ?? 'undefined')` arm is untouched (ADR-4). |
| Tasks `--json` plan | `src/cli/commands/tasks-renderer.ts:82` (`renderJsonPlan`) | `return escapeJsonControls(JSON.stringify(plan, null, 2))`. |

Non-edges (must NOT get the escape, per audit): file-writing stringify sites (e.g. `install.ts` settings writes), hashing inputs, hook logs, YAML state writes.

## Data flow

```
.metta/ + spec/ stored data (bytes on disk — never touched)
        │  read + Zod-validate
        ▼
   in-memory value (may contain raw U+007F–U+009F in strings/keys)
        │  JSON.stringify(value, null, 2)      — escapes C0 per JSON spec;
        ▼                                        passes DEL/C1 through raw
   serialized JSON text
        │  escapeJsonControls(text)            — U+007F–U+009F → \u00xx
        ▼
   escaped JSON text  ──► console.log ──► stdout (terminal / pipe / JSON.parse consumer)
```

## ADRs

### ADR-1: Post-stringify text escape, not a `JSON.stringify` replacer

**Decision:** Escape the already-serialized JSON text; do not attempt to influence encoding via a replacer or value pre-transform.
**Rationale (research-stringify-replacer, empirically verified):** a replacer cannot change stringify's character encoding — returning escape text gets its backslash re-escaped (double-escape: `\u009b` becomes `\\u009b` in the output), breaking parsed-value fidelity and the four byte-faithful test suites; replacers never visit object keys, so raw C1 in keys (reachable via `config get` on user-edited YAML) would survive; the only working marker variant still required a post-stringify pass while adding a verified marker-collision corruption hazard. Post-stringify replacement has none of these failure modes and measured ~0.6ms on a 180KB hostile payload (research-post-stringify-escape).
**Consequence:** the escape operates on text, so structure safety must be argued from the JSON grammar — see Invariants.

### ADR-2: Escape exactly U+007F–U+009F, as lowercase six-char `\u00xx`, nothing else

**Decision:** The helper's domain is precisely DEL + C1. C0 handling stays with `JSON.stringify` (already spec-mandated). U+007E and below, U+00A0 and above — including all multi-byte UTF-8 and U+2028/U+2029 — pass through unchanged. Escapes use lowercase hex to match `JSON.stringify`'s own `\u` output style.
**Rationale:** matches the spec requirement verbatim (boundary scenarios pin U+007E/U+00A0 as pass-through); the range is exactly what `sanitize-text.ts` treats as terminal-honored bare controls (`\x7f-\x9f`), keeping text mode and JSON mode aligned on the same threat model. U+2028/U+2029 et al. are explicitly out of scope per intent.
**Consequence:** narrow, auditable regex; no risk of over-escaping legitimate Unicode content.

### ADR-3: Emission-edge-only placement — never at write time

**Decision:** The helper is applied only at the three stdout edges. Stored data in `.metta/` and `spec/` remains byte-untouched; no write-path, schema, or store code changes.
**Rationale:** render/emission-edge-only treatment is the established invariant of this codebase (PR #86 render-edge sanitization); write-time mutation is the exact data-corruption failure mode that work was designed to avoid, and the spec forbids it ("MUST NOT be applied to stored data at write time"). Escaping at the edge preserves parsed-value fidelity by construction — `JSON.parse` maps `\u009b` back to the identical code unit.
**Consequence:** any future JSON stdout edge must remember to call the helper; mitigated by the shared-helper requirement (US-3) and the audit inventory as the checklist.

### ADR-4: `config get` scalar branch untouched

**Decision:** In `config.ts:58`, only the object branch (which emits JSON text) is wrapped. The scalar branch prints `String(value)` — plain text, not JSON.
**Rationale (research-edge-inventory):** the structure-safety argument of ADR-1/Invariant 3 holds only for `JSON.stringify` output; applying a JSON escape to non-JSON plain text would emit literal `\u00xx` sequences into human-readable output with no parser to decode them. Scalar config values are leaf values of metta-controlled config keys; if a text-mode sanitization gap is ever identified there, it belongs to `sanitize-text.ts` treatment, not this helper.
**Consequence:** a raw-C1 scalar config value would still print raw in non-JSON text mode — same status as before this change, tracked under text-mode sanitization scope, not this fix.

## Invariants

1. **Idempotence** — `escapeJsonControls(escapeJsonControls(s)) === escapeJsonControls(s)`. The output contains no code units in U+007F–U+009F (all replaced) and the replacement text (`\u00xx`) is pure ASCII below 0x7F, so a second pass matches nothing. Empirically verified on Node 22 including pre-existing `\u` escapes and lone surrogates.
2. **Parsed-value fidelity** — `JSON.parse(escapeJsonControls(JSON.stringify(v)))` is deep-equal to `JSON.parse(JSON.stringify(v))`, with string values byte-identical to stored originals. `\u00xx` is the JSON grammar's canonical alternative encoding of the same code point; only the text encoding changes. This is the invariant the four existing byte-faithful suites actually assert (they all `JSON.parse` before comparing), which is why they must and do pass unmodified.
3. **Structure safety** — in `JSON.stringify` output, code units in U+007F–U+009F can occur **only inside string literals**: every structural character (`{}[],:"`), all inserted indentation/whitespace, and every character of numbers, `true`/`false`/`null` is ASCII < 0x7F. Therefore a global text replace over the range cannot touch structural text and cannot corrupt the JSON (grammar analysis in research-post-stringify-escape).

## Test design

Near 1:1 test-to-source ratio maintained.

### `tests/escape-json-controls.test.ts` (new, unit — mirrors `tests/sanitize-text.test.ts` precedent)

- **Range boundaries:** U+007E passes through; U+007F escapes to `\u007f`; U+009F escapes to `\u009f`; U+00A0 passes through. U+009B (single-byte CSI) escapes to `\u009b`.
- **Non-targets intact:** ordinary ASCII, multi-byte UTF-8 (e.g. emoji, CJK), existing `\uXXXX` escape text, structural JSON characters.
- **Idempotence:** double application equals single application on a hostile mixed input.
- **Empty string:** returned unchanged.
- **Large payload smoke:** ~100–200KB JSON text laced with the full U+007F–U+009F range escapes correctly and round-trips through `JSON.parse` to the original values (also guards Invariant 2 at scale; research measured ~0.6ms at 180KB).

### CLI round-trip: `tests/cli-issue-backlog.test.ts` (render-edge suite)

- New `it` with a **fresh hostile fixture** (do not mutate `HOSTILE_ISSUE` — existing suites depend on it): seed an issue whose title contains raw U+009B and U+007F; run `metta --json issues show <slug>`.
- Assert: (a) stdout contains no code units in U+007F–U+009F (`/[\x7f-\x9f]/` never matches); (b) `JSON.parse(stdout)` yields the exact stored title, byte-identical; (c) stored file on disk unchanged after emission.

### Regression guard (no edits)

The existing byte-faithful `--json` suites — `tests/cli-issue-backlog.test.ts`, `tests/cli-gaps.test.ts`, `tests/cli-roadmap.test.ts`, `tests/cli-status.test.ts` — MUST pass with zero modification. Per the audit, all assert `JSON.parse`d values (Invariant 2) and all raw-`\x9b` negative assertions target text mode only, so zero breakage is expected.

## Dependencies and risks

- **Dependencies:** none added. Node 22 built-ins only.
- **Vendor lock-in:** none — pure string transform, standard JSON.
- **Risks:**
  - A future stdout JSON edge bypassing the helper (mitigation: shared helper + spec requirement US-3 makes it an auditable spec violation; the 29-site inventory is the review checklist).
  - Raw-byte consumers of `--json` text see the six-character `\u009b` escape instead of a raw `0x9b` byte — intended, legal JSON, documented in intent as the point of the fix.
  - Out-of-scope side finding from research (`install.ts:151` text-mode stderr gap) is a separate issue, deliberately not addressed here.

## Conventions compliance

kebab-case filename (`escape-json-controls.ts`); `.js` extension on all import paths (Node16 ESM); pure function in `src/util/` (functional core), I/O confined to the three CLI shell edges; no barrel export change (sanitize-text precedent); no string-literal templates; matching test file for the new source file.
