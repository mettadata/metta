// Terminal-output sanitizer for untrusted text (issue titles, backlog
// descriptions, anything echoed back to a TTY). Strips ANSI/VT escape
// sequences and stray control bytes so hostile input cannot repaint the
// screen, move the cursor, set the window title, or inject hyperlinks.

/**
 * Matches every control sequence class we strip. Alternation order is
 * load-bearing: the full multi-byte ESC sequences must come BEFORE the bare
 * control-character class, otherwise the leading `\x1b` would be consumed by
 * `[\x00-\x1f...]` on its own and the sequence body (`[2J`, `]0;title`, ...)
 * would leak through as printable text.
 *
 * Coverage, in order:
 * 1. CSI  — `ESC [` params/intermediates/final (`\x1b[31m`, `\x1b[2J`, ...)
 * 2. OSC  — `ESC ]` body terminated by BEL, ST (`ESC \`), or the 8-bit ST
 *    (`\x9c`); the body excludes all three terminator bytes and the
 *    terminator itself is optional, so an unterminated OSC still gets
 *    stripped instead of eating the rest of the line as "body"
 * 3. DCS/SOS/PM/APC — `ESC P`, `ESC X`, `ESC ^`, `ESC _` string sequences,
 *    ST- or 8-bit-ST-terminated (terminator optional,
 *    unterminated-tolerant like OSC)
 * 4. Two-byte Fe escapes — `ESC @` through `ESC _`. Sequences outside the Fe
 *    range (e.g. `ESC c` reset) are neutralized by the bare-control fallback
 *    below: the ESC byte is stripped, though a printable residue (`c`) may
 *    remain
 * 5. Bare C0 controls, DEL, and C1 controls (`\x00-\x1f`, `\x7f-\x9f`) —
 *    catches raw 8-bit CSI (`\x9b`), BEL, backspace, CR, and any lone ESC
 *    left over after the branches above
 *
 * No `u` flag: `\x80-\x9f` must match lone C1 code units, and the input is a
 * JS string (UTF-16 code units), not raw bytes.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_SEQUENCE_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)?|\x1b[PX^_][^\x1b\x9c]*(?:\x1b\\|\x9c)?|\x1b[@-Z\\-_]|[\x00-\x1f\x7f-\x9f]/g

/**
 * Remove terminal escape sequences and control characters from `text`.
 * Pure, total, and idempotent — printable text (including all Unicode at or
 * above U+00A0) passes through byte-for-byte.
 */
export function stripControlSequences(text: string): string {
  return text.replace(CONTROL_SEQUENCE_RE, '')
}
