# Research: post-stringify regex escape

## Approach

Run `JSON.stringify(data, null, 2)` exactly as today, then pass the resulting JSON **text** through a pure helper that globally replaces every UTF-16 code unit in U+007F–U+009F (DEL + C1) with its six-character JSON escape (backslash + `uXXXX`, lowercase hex — e.g. backslash + `u009b` for U+009B). No replacer function, no data-tree walking, no changes to stored data.

## How it works

```ts
const DEL_C1_RE = /[\x7f-\x9f]/g
jsonText.replace(DEL_C1_RE, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)
```

The helper operates on already-serialized text, so it is a single linear regex pass regardless of object shape or nesting depth. It is applied at each of the three CLI stdout JSON edges (verified against code in this worktree):

1. `src/cli/helpers.ts` — `outputJson` (line 220–235, `console.log(JSON.stringify(data, null, 2))`). This is the single funnel for all `--json` command output **and** both `handleError` JSON error envelopes (lines 246 and 265 route through `outputJson`), so wrapping here covers the error-envelope scenario for free.
2. `src/cli/commands/config.ts:58` — `config get` non-`--json` branch printing object values via `JSON.stringify(value, null, 2)`. (The `--json` branch at line 56 and the error path at line 62 already go through `outputJson`.)
3. `src/cli/commands/tasks-renderer.ts:81–83` — `renderJsonPlan` returns `JSON.stringify(plan, null, 2)`; its output reaches stdout via `src/cli/commands/tasks.ts:72`. Wrapping inside `renderJsonPlan` keeps the renderer self-contained and keeps `tasks.ts` untouched. (Note: the intent's path `src/cli/tasks-renderer.ts` is stale — the file lives at `src/cli/commands/tasks-renderer.ts`.)

## Correctness analysis

**Can a raw U+007F–U+009F code unit appear in `JSON.stringify` output anywhere other than inside a string literal? No.** Exhaustive case analysis of the output grammar:

- **Structural characters** — `{ } [ ] : ,` are all ASCII ≤ 0x7D.
- **Inserted whitespace** — with `null, 2` indentation, `JSON.stringify` inserts only U+0020 (space) and U+000A (LF); with a string `space` argument it truncates to 10 chars of caller-controlled text, but our call sites all use numeric `2`.
- **Literals** — `true`, `false`, `null` are ASCII letters.
- **Numbers** — serialized from ASCII digits, `-`, `+`, `.`, `e`, `E`.
- **Property names** — always serialized as string literals (same case as below).
- **String literals** — `JSON.stringify` escapes `"` (0x22), `\` (0x5C), and all C0 controls (U+0000–U+001F); everything else, including U+007F–U+009F, is emitted as a raw code unit **inside the quotes**.

Therefore every U+007F–U+009F code unit in the output sits inside a string literal, where replacing it with `\u00xx` is exactly the escape the JSON grammar defines for it — `JSON.parse` yields the identical code point. A global replace cannot corrupt structure, split a token, or collide with an existing escape: the two-character sequence `\u` produced by the replacement is ASCII, and any *pre-existing* `\u00XX` or `\\u00XX` in the text contains no raw C1 code units, so the regex never touches it. Empirically verified in Node 22: hostile fixture round-trips byte-identically through `JSON.parse`, and text containing a literal backslash-u sequence is returned unchanged.

**Idempotence** — after one pass the output contains zero code units in U+007F–U+009F (all replacement text is ASCII), so a second application matches nothing and returns the identical string. Verified empirically. Empty string trivially returns itself.

**Parsed-value fidelity** — the four existing byte-faithful test suites (`tests/cli-issue-backlog.test.ts`, `tests/cli-gaps.test.ts`, `tests/cli-roadmap.test.ts`, `tests/cli-status.test.ts`) all assert via `JSON.parse(stdout)`; since the escape is encoding-level only, they pass unmodified. Confirmed by round-trip check.

**Edge cases:**

- **Lone surrogates** — since ES2019 well-formed `JSON.stringify`, lone surrogates are emitted as `\udXXX` escapes, never as raw code units[^1]; Node 22 confirms (`JSON.stringify('\ud800')` yields the six ASCII characters `"\ud800"`). The regex range U+007F–U+009F does not intersect U+D800–U+DFFF in any case, so surrogate pairs (astral chars like emoji) pass through untouched — verified.
- **U+2028/U+2029** — `JSON.stringify` emits them raw (they are legal in JSON strings); the helper leaves them alone, matching the intent's explicit out-of-scope declaration. No interaction.
- **Boundary precision** — `/[\x7f-\x9f]/` matches exactly the required closed range; U+007E and U+00A0 pass through (spec scenario requirement), verified.
- **No `u` flag needed** — the class is entirely in the BMP below the surrogate range, and matching lone code units is exactly what we want; this mirrors the deliberate no-`u`-flag choice documented in `src/util/sanitize-text.ts:30-34`.

## Tradeoffs

**Pros**

- Smallest possible diff: one pure helper + three one-line wraps; no replacer plumbing through `outputJson`'s drift-injection logic.
- Provably safe by grammar analysis (above); no risk of a replacer changing serialization semantics (e.g. `toJSON` interaction, key ordering).
- Zero interaction with indentation — inserted whitespace is ASCII, and the replacement never inserts or removes line breaks, so `null, 2` pretty-printing is byte-identical outside the escaped code points.
- Performance is a non-issue: measured ~0.6 ms per pass on a ~180 KB hostile payload and ~0.07 ms on a clean 100 KB payload (V8 bails fast when the class never matches); even a pathological 9 MB payload takes ~60 ms. Finalize's ~100 KB JSON emission is unaffected in practice.
- Idempotent by construction — safe if two edges ever compose (e.g. a renderer output later re-emitted through `outputJson`).
- Consistent with the established codebase pattern: pure, total, idempotent text transform in `src/util/` applied at the emission edge only, exactly like `sanitize-text.ts` (PR #86), with a matching 1:1 test file.

**Cons**

- Operates on text rather than values, so it relies on the grammar argument above; a reviewer must accept that reasoning (mitigated: the argument is airtight for `JSON.stringify` output, and unit tests pin it).
- If someone later applies the helper to *arbitrary* text that is not `JSON.stringify` output, the "only inside string literals" guarantee no longer holds — though even then the replacement is harmless for the JSON-emission use case, this should be documented on the helper (input contract: serialized JSON text).
- One extra full string scan per emission (negligible, see numbers above).

## Implementation sketch

`src/util/escape-json-controls.ts` (new, with `tests/escape-json-controls.test.ts`):

```ts
// JSON-emission-edge escaper for DEL and C1 controls. JSON.stringify only
// escapes C0 (U+0000-U+001F); U+007F-U+009F pass through raw and can be
// replayed as terminal control bytes by consumers that cat/jq the output.
// In JSON.stringify output these code units can only occur inside string
// literals (structural chars, indentation, numbers, and keyword literals are
// all ASCII < 0x7F), so a global text-level replace cannot corrupt structure.
//
// Input contract: already-serialized JSON text. Pure, total, and idempotent —
// one pass leaves no code unit in the range, so a second pass is a no-op.
// No `u` flag: the class is BMP-only and must match lone code units.
// eslint-disable-next-line no-control-regex
const DEL_C1_RE = /[\x7f-\x9f]/g

export function escapeJsonControls(jsonText: string): string {
  return jsonText.replace(DEL_C1_RE, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)
}
```

Edge wiring (all imports with `.js` extensions per Node16 ESM convention):

```ts
// src/cli/helpers.ts (outputJson, line 234)
import { escapeJsonControls } from '../util/escape-json-controls.js'
console.log(escapeJsonControls(JSON.stringify(data, null, 2)))

// src/cli/commands/config.ts (line 58, non-json object branch)
console.log(typeof value === 'object' ? escapeJsonControls(JSON.stringify(value, null, 2)) : String(value ?? 'undefined'))

// src/cli/commands/tasks-renderer.ts (renderJsonPlan, line 82)
return escapeJsonControls(JSON.stringify(plan, null, 2))
```

Export from the `src/` barrel `index.ts` if `sanitize-text` is exported there (follow whichever pattern `sanitize-text.ts` uses). Unit tests cover: boundary quartet U+007E/U+007F/U+009F/U+00A0, U+009B CSI, multi-byte/astral neighbors intact, idempotence on already-escaped output, text containing a pre-existing literal backslash-u sequence untouched, empty string, and `JSON.parse` round-trip equality on a hostile fixture.

## Verdict

**Recommend.** Provably structure-safe by JSON output-grammar analysis, empirically verified idempotent and round-trip-faithful on Node 22, sub-millisecond at the 100 KB scale finalize emits, and the smallest, most codebase-consistent change (pure `src/util/` edge helper mirroring `sanitize-text.ts`) across all three verified emission edges.

[^1]: https://tc39.es/ecma262/multipage/structured-data.html#sec-json.stringify (well-formed JSON.stringify, ES2019) accessed 2026-08-18
