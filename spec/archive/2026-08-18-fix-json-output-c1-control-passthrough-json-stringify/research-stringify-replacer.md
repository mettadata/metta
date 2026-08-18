# Research: JSON.stringify replacer / value-transform approach

Change: `fix-json-output-c1-control-passthrough-json-stringify`
Approach under evaluation: pass a replacer function to `JSON.stringify` (or pre-walk the value tree) that transforms string values in the U+007F–U+009F range, instead of post-processing the serialized JSON text.

## Approach

Intercept string values during serialization — either via the `replacer` parameter of `JSON.stringify(data, replacer, 2)` or via a recursive pre-walk that clones the value tree with transformed strings — so that DEL (U+007F) and C1 controls (U+0080–U+009F) never appear raw in the emitted JSON text.

## How it works (and where it breaks)

`JSON.stringify`'s own string quoting (ECMA-262 `QuoteJSONString`) escapes exactly: `"` and backslash, C0 code units below U+0020, and lone surrogates (well-formed `JSON.stringify`, ES2019)[^1][^2]. Everything else — including U+007F–U+009F — is emitted as raw code units. Verified locally on Node 22: `JSON.stringify` of an object whose value contains U+009B emits the raw bytes `0xc2 0x9b` in UTF-8 stdout.

A replacer is called per property as `(key, value)` and its **return value is then serialized through the same default quoting**[^2]. This is the structural problem: a replacer can change *which value* gets serialized, but it has zero influence over *how* the serializer encodes the characters of that value. There is no code path by which a replacer produces a six-character `\u009b` escape in the output text. Concretely (all verified on Node 22.x):

1. **Return the raw C1 char unchanged** → serializer emits it raw. No fix.
2. **Return escape-sequence text** (replace U+009B with the six-character string `\u009b`) → the serializer escapes the backslash, the JSON text becomes `"a\\u009bbc"`, which `JSON.parse` round-trips to the *literal nine-character text* `a\u009bbc` (backslash preserved as a character), not the original four-character string containing the real U+009B. This is the double-escape hazard, and it is fatal: it violates the change's core invariant (parsed-value fidelity) and would fail every existing byte-faithful test (`tests/cli-issue-backlog.test.ts`, `tests/cli-gaps.test.ts`, `tests/cli-roadmap.test.ts`, `tests/cli-status.test.ts`).
3. **Strip or substitute the C1 chars** (e.g. replace with U+FFFD) → output is clean but parsed values are no longer byte-identical to stored data. Same fatal fidelity violation; this is exactly the data-mutation failure mode the render-edge design (PR #86, `src/util/sanitize-text.ts`) deliberately avoids at the JSON edge.
4. **Marker technique**: replacer rewrites each C1 char as a marker built from C0 characters (which stringify deterministically escapes, e.g. the two-character marker `\x01\x07` plus four hex digits), then a **post-stringify** regex rewrites the escaped marker text `\u0001\u0007009b` into `\u009b`. Verified working for the happy path — but:
   - it *contains* a post-stringify text pass, so it does not avoid the alternative approach; it adds a serialization-time pass on top of it;
   - it has a **marker-collision injection hazard**: hostile stored data containing literal marker-lookalike text corrupts. Verified: a stored value consisting of the raw characters `\x01` + `M` + `\x01` + `9b99` round-tripped to the single CJK character U+9B99 — silent data corruption from attacker-controlled input, in a change whose entire purpose is hostile-input hardening.

## Correctness analysis

- **Object keys are not covered.** The replacer's return value replaces the *property value* only; there is no mechanism to rewrite keys[^2]. Verified: with a C1 char in an object key and a string-transforming replacer applied, the raw C1 byte survives in the emitted key. `outputJson` serializes arbitrary `unknown` data (e.g. config objects in `config get`, whose keys derive from user-edited YAML), so key coverage is a real requirement, and the replacer approach fails it. The spec's requirement — "Emitted `--json` stdout MUST NOT contain any raw code unit in the U+007F–U+009F range" — is over the whole JSON text, keys included.
- **toJSON interaction is fine (not a differentiator).** Verified: `toJSON` runs before the replacer, so the replacer sees `toJSON`'s output (ECMA-262 `SerializeJSONProperty` order[^1]). Map/Set serialize as `{}` with no string content. No advantage either way vs post-stringify, which by construction sees the final text after all `toJSON`/replacer processing.
- **Idempotency / helper contract mismatch.** The change spec mandates a pure helper `escapeJsonControls(jsonText: string): string` operating on *already-serialized JSON text*, "applied after `JSON.stringify`", idempotent on already-escaped text. A replacer/pre-walk is a different shape (value-tree transform), cannot satisfy that signature, and its natural idempotency story (marker variant) is exactly where the collision bug lives.
- **The post-stringify alternative is provably safe here.** In `JSON.stringify` output, code units in U+007F–U+009F can only occur inside string literals — every structural character, escape introducer, and inserted pretty-print whitespace is ASCII at or below 0x7E — so a global replace over the text with the code-unit class `[\x7f-\x9f]` cannot touch structure, cannot double-escape (it matches raw code units, never backslash-u *text*), covers keys and values uniformly, and is trivially idempotent (its output contains no code units in the matched range). Verified: post-stringify pass over an object with C1 in both key and value removes all raw C1 bytes and `JSON.parse` round-trips both key and value byte-identically.

## Tradeoffs

| Dimension | Replacer / value-transform | Post-stringify text pass (alternative) |
|---|---|---|
| Can emit `\u00XX` escapes at all | No — only via marker + post-replace hack | Yes, directly |
| Parsed-value fidelity | Broken (variants 2–3) or at risk (marker collision, variant 4) | Preserved by construction |
| Object-key coverage | No | Yes |
| Idempotency | Only via fragile marker discipline | Trivial |
| Complexity | Replacer + marker grammar + post-pass + collision defense | One regex replace, ~5 lines |
| Consistency with codebase | New pattern | Mirrors `sanitize-text.ts` edge-sanitizer pattern (pure, total, idempotent, no-`u`-flag code-unit regex) |
| Emission points | Must thread a replacer into 3 call sites' `JSON.stringify` calls | Wraps each site's existing output string |

## Implementation sketch (honest best version of this approach — not recommended)

```ts
// marker variant, shown for completeness; \xNN escapes shown textually here —
// in real source they would be the escape sequences inside string/regex literals
const C1_RE = /[\x7f-\x9f]/g // no `u` flag: match lone code units
const MARK = '\x01\x07' // C0 pair: stringify escapes it deterministically
const MARK_RE = /\\u0001\\u0007([0-9a-f]{4})/g

function replacer(_key: string, value: unknown): unknown {
  return typeof value === 'string'
    ? value.replace(C1_RE, (c) => MARK + c.charCodeAt(0).toString(16).padStart(4, '0'))
    : value
}

export function stringifyEscaped(data: unknown): string {
  return JSON.stringify(data, replacer, 2).replace(MARK_RE, '\\u$1')
}
```

Known defects even in this best version: (a) object keys containing C1 still emit raw — fixing that requires an additional pre-walk that rebuilds every object with transformed keys, growing the code substantially; (b) stored data containing the literal marker sequence corrupts on round-trip (verified) — closing that requires escaping the marker itself first, i.e. a second encoding layer; (c) the final `.replace` *is* a post-stringify pass, so the approach never actually avoids post-processing — it only adds moving parts in front of it.

## Verdict

**Reject.** A replacer cannot influence `JSON.stringify`'s character encoding, so every variant either breaks parsed-value fidelity (double-escape or mutation), misses object keys, or degenerates into the post-stringify text pass with an added marker layer that introduces a verified data-corruption hazard on hostile input — the simple post-stringify `escapeJsonControls(jsonText)` helper the spec already mandates dominates it on every axis.

[^1]: https://tc39.es/ecma262/#sec-quotejsonstring (ECMA-262 `QuoteJSONString` / `SerializeJSONProperty`) accessed 2026-08-18
[^2]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify accessed 2026-08-18
