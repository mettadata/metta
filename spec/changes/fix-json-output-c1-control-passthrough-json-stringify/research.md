# Research Synthesis — fix-json-output-c1-control-passthrough-json-stringify

Three parallel research tracks; per-approach detail in `research-post-stringify-escape.md`, `research-stringify-replacer.md`, `research-edge-inventory.md`.

## Approach 1 — Post-stringify regex escape (`research-post-stringify-escape.md`)

Run `JSON.stringify(data, null, 2)` unchanged, then pass the JSON text through a pure helper replacing every code unit in U+007F-U+009F with its six-character JSON escape. Grammar analysis proves the range can only occur inside string literals in stringify output (all structural characters, indentation, numbers, and keywords are ASCII < 0x7F), so a global text replace is structure-safe. Empirically verified on Node 22: idempotent, round-trip-faithful (including lone surrogates and pre-existing escapes), ~0.6ms on a 180KB hostile payload. Also corrected an intent path: the tasks renderer is `src/cli/commands/tasks-renderer.ts:82`, and `handleError` needs no separate wiring (both branches route through `outputJson`). **Verdict: recommend.**

## Approach 2 — JSON.stringify replacer / value-transform (`research-stringify-replacer.md`)

Empirically disproven: a replacer cannot influence stringify's character encoding — returning escape text double-escapes (breaking parsed-value fidelity and the four byte-faithful test suites), object keys are never visited (raw C1 in keys survives — and `config get` serializes keys derived from user-edited YAML), and the only working marker variant still needs a post-stringify pass while adding a verified marker-collision corruption hazard. **Verdict: reject.**

## Approach 3 — Emission-edge inventory and test impact (`research-edge-inventory.md`)

All 29 `JSON.stringify` sites under src/ classified. Exactly three stdout JSON edges need the escape: `src/cli/helpers.ts:234` (outputJson, incl. error envelopes), `src/cli/commands/config.ts:58` (config get object branch — do NOT wrap the scalar `String(...)` branch), `src/cli/commands/tasks-renderer.ts:82` (renderJsonPlan). File writes, hashing, and hook logs must not get the escape. Zero existing tests break: all byte-faithful `--json` tests assert JSON.parse'd values; raw-`\x9b` negative assertions target text mode only. Test plan: new `src/util/escape-json-controls.ts` + `tests/escape-json-controls.test.ts` (matches the sanitize-text precedent; no barrel change), plus a new U+009B round-trip `it` in the render-edge suite of `tests/cli-issue-backlog.test.ts` with a fresh hostile fixture. Side finding for a separate issue: `install.ts:151` text-mode stderr sanitization gap.

## Recommendation

**Adopt the post-stringify escape**: new pure helper `escapeJsonControls(jsonText)` in `src/util/escape-json-controls.ts`, applied at exactly the three audited stdout edges. Stored data untouched; parsed-value fidelity preserved by construction; all existing byte-faithful suites pass unmodified. Tests per the Approach 3 plan.
