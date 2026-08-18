// JSON-edge escape for DEL and C1 control code units. `JSON.stringify`
// escapes C0 controls (U+0000-U+001F) but passes DEL (U+007F) and the C1
// range (U+0080-U+009F) through verbatim, so serialized output can carry raw
// 8-bit terminal controls (e.g. the C1 CSI `\x9b`). This helper rewrites
// those code units as `\uXXXX` escape text so the JSON stays semantically
// identical while the byte stream is terminal-safe.

/**
 * Matches DEL and every C1 control code unit (U+007F-U+009F).
 *
 * No `u` flag: `\x7f-\x9f` must match lone C1 code units, and the input is a
 * JS string (UTF-16 code units), not raw bytes — same precedent as
 * `sanitize-text.ts`.
 */
// eslint-disable-next-line no-control-regex
const JSON_EDGE_CONTROL_RE = /[\x7f-\x9f]/g

/**
 * Replace every DEL/C1 code unit (U+007F-U+009F) in `jsonText` with its
 * literal six-character `\uXXXX` escape (lowercase hex). Intended for
 * already-serialized JSON text: the rewritten text parses back to values
 * identical to the original. Pure, total, and idempotent — code units at or
 * below U+007E and at or above U+00A0 (including all multi-byte UTF-8 and
 * U+2028/U+2029) pass through untouched.
 */
export function escapeJsonControls(jsonText: string): string {
  return jsonText.replace(JSON_EDGE_CONTROL_RE, (codeUnit) => {
    return '\\u' + codeUnit.charCodeAt(0).toString(16).padStart(4, '0')
  })
}
