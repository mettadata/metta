# Research: ANSI/control-character sanitization of issue titles in list renderers

## Decision

Add a small shared pure utility — `stripControlSequences(text: string): string` in a new
`src/util/sanitize-text.ts` — that removes ANSI CSI/OSC/DCS escape sequences and all raw
C0/C1 control characters via a single regex, and apply it at the human-readable render
sites (the terminal edge). No new dependency. Test file: `tests/sanitize-text.test.ts`
(matching the existing `src/util/slug.ts` → `tests/slug.test.ts` pattern).

Minimum fix scope per the defect: `src/cli/commands/backlog.ts:75` and
`src/cli/commands/milestone.ts:176`. Recommended fix scope: all title/name render sites
listed below — they share the identical vulnerability and the helper makes each fix a
one-word wrap.

## Findings

### 1. Render sites that print user-controlled title strings verbatim

Titles originate from issue/gap/milestone markdown frontmatter and headings
(`src/issues/issues-store.ts`, `src/gaps/gaps-store.ts`, `src/milestones/`), i.e. anything
that can write a file into `spec/` controls these strings. Human-readable (non-JSON)
`console.log` sites that echo them raw:

| File:line | What it prints |
|---|---|
| `src/cli/commands/backlog.ts:75` | backlog list row — `${e.title}` (**defect site**) |
| `src/cli/commands/backlog.ts:103` | backlog show heading — `# ${issue.title}` |
| `src/cli/commands/backlog.ts:110` | backlog show body — `issue.description` |
| `src/cli/commands/milestone.ts:176` | milestone show issue row — `${issue.title}` (**defect site**) |
| `src/cli/commands/milestone.ts:163` | milestone show heading — `# ${item.name}` (frontmatter `name`, same trust level) |
| `src/cli/commands/milestone.ts:170` | milestone show body — `item.description` |
| `src/cli/commands/issue.ts:89, 105` | issue list row / show heading |
| `src/cli/commands/fix-issue.ts:86, 142` | fix-issue show heading / list row |
| `src/cli/commands/gaps.ts:18, 33` | gaps list row / show heading |
| `src/cli/commands/fix-gap.ts:93, 159` | fix-gap show heading / list row |
| `src/cli/commands/roadmap.ts:64` (label from `row.title`, set at :53, :155) | roadmap row |
| `src/cli/commands/validate-stories.ts:105` | story titles parsed from spec markdown |

The `--json` paths are already safe for the primary vector: `outputJson`
(`src/cli/helpers.ts:220`) uses `JSON.stringify`, which escapes all of `\x00–\x1f`
(including ESC `\x1b`) as `\uXXXX`. Known residual gap: `JSON.stringify` does **not**
escape `\x7f–\x9f`, so a raw C1 CSI (U+009B) in a title would pass through JSON output;
most modern UTF-8 terminals ignore C1 controls, so this is noted, not fixed here.

### 2. Existing utilities and idiomatic home

- `src/util/` is the established home for small shared pure helpers: `slug.ts`,
  `format-zod-error.ts`, `duration.ts`, `errors.ts`, etc.
- **Direct precedent exists**: `src/util/format-zod-error.ts:9` has a private
  `escapeControlCharacters` that neutralizes the exact same attack ("a raw ESC byte
  enabling ANSI escape injection" per its own doc comment) by rewriting
  `[\x00-\x08\x0b-\x1f\x7f]` to visible `\uXXXX` escapes. It is not exported and its
  escape-to-visible behavior is wrong for padded list columns (a color sequence would
  render as noisy `[31m` and break `padEnd(30)` alignment), so it is a precedent
  for *where* and *how* (private regex constant + small pure function + 1:1 test file:
  `tests/format-zod-error.test.ts`), not a helper to reuse as-is.
- There is no existing `stripControlChars`/`sanitizeTitle` anywhere in `src/`.
- Barrel note: `src/index.ts` re-exports only `./util/archive-dirs.js` from `util/`
  (line 16); `slug.ts` and `format-zod-error.ts` are imported directly by consumers
  (e.g. `backlog.ts:9` imports `../../util/slug.js`). Direct import is the norm for
  util helpers — do not add a barrel export unless the public API needs it.
- No terminal-string deps installed: `package.json` has no `strip-ansi`, `chalk`, or
  `picocolors`.

## Approaches Considered

### (a) Shared pure utility in `src/util/sanitize-text.ts` — RECOMMENDED

New file exporting one pure function; render sites wrap the interpolation:
`console.log(\`  [...] ${e.slug.padEnd(30)} ${stripControlSequences(e.title)}\`)`.

- Pros: matches "functional core, imperative shell" (pure logic in a module, applied at
  the I/O edge); one regex to audit; trivially unit-testable to the 1:1 ratio
  (`tests/sanitize-text.test.ts`); fixes all 15+ sites with a one-word wrap each;
  mirrors the existing `slug.ts`/`format-zod-error.ts` pattern exactly.
- Cons: each render site must remember to call it (a future site can forget — mitigate
  with a test in `tests/cli-issue-backlog.test.ts`/`tests/cli-milestone.test.ts` that
  feeds a hostile title through the CLI and asserts clean output).

Variant considered and rejected: sanitize upstream in the data layer
(`src/backlog/backlog-view.ts:33`, `src/milestones/milestone-rollup.ts:60-63`, or
`issues-store` parse). Rejected because (1) it silently mutates data that also feeds
`--json` output, which should stay byte-faithful to the store (JSON.stringify already
neutralizes it for machine consumers), and (2) sanitization is a *terminal rendering*
concern, so it belongs at the render edge, not in the functional core's data model.

### (b) Per-call-site inline strip

Repeat `.replace(/.../g, '')` at each `console.log`.

- Pros: no new file; zero indirection.
- Cons: the regex is non-trivial (CSI + OSC + bare controls) and would be duplicated
  15+ times — exactly the duplication `src/util/slug.ts` was created to eliminate (its
  header comment: "Single source of truth — was duplicated in issues-store.ts,
  milestones-store.ts, and cli/commands/backlog.ts"). Untestable in isolation without
  spinning the whole CLI. Violates the codebase's demonstrated direction. Rejected.

### (c) Add `strip-ansi` dependency

`strip-ansi` (chalk org) is the canonical ANSI stripper; its underlying `ansi-regex`
pattern also handles OSC terminators and C1 CSI (``).[^1]

- Pros: battle-tested pattern maintained against terminal edge cases; handles
  malformed-sequence corner cases.
- Cons: **insufficient alone** — `strip-ansi` removes escape *sequences* but not bare
  C0 controls (`\x07` BEL, `\x08` backspace, `\x0d` CR overwrite tricks), so a second
  pass would still be needed; adds a runtime dependency to a project whose
  `package.json` runtime deps are deliberately minimal, for ~5 lines of regex; project
  convention is no new deps without justification. Rejected — but its published regex is
  the reference for our CSI/OSC branches.

## Rationale

Approach (a) is the only one consistent with all four relevant conventions at once:
functional core / imperative shell, near-1:1 test ratio, the `src/util/`
single-source-of-truth precedent set by `slug.ts`, and no-new-deps. The
`format-zod-error.ts` precedent confirms the maintainers already treat control-character
neutralization as a `util/` concern; this generalizes it for display strings where
*stripping* (clean columns) beats *escaping* (forensic visibility).

## Recommended implementation

`src/util/sanitize-text.ts`:

```ts
// Strips ANSI escape sequences and raw control characters from text destined
// for human-readable terminal output. Alternation order matters: complete
// ESC-introduced sequences (CSI, OSC, DCS/SOS/PM/APC, two-byte Fe) must match
// before the bare-control class, otherwise the lone ESC is consumed and the
// sequence tail (e.g. `[31m`) leaks as visible text.
// eslint-disable-next-line no-control-regex
const CONTROL_SEQUENCE_RE =
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[PX^_][^\x1b]*(?:\x1b\\)?|\x1b[@-Z\\-_]|[\x00-\x1f\x7f-\x9f]/g

export function stripControlSequences(text: string): string {
  return text.replace(CONTROL_SEQUENCE_RE, '')
}
```

Branch by branch:

1. `\x1b\[[0-?]*[ -/]*[@-~]` — CSI: ESC `[`, parameter bytes `0x30–0x3f`, intermediate
   bytes `0x20–0x2f`, final byte `0x40–0x7e`. Kills colors, cursor movement, screen
   clear (`\x1b[2J`), line erase.
2. `\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?` — OSC (title-set, OSC 8 hyperlinks), terminated
   by BEL or ST (`ESC \`); terminator optional so an *unterminated* OSC strips to end of
   string instead of leaking its payload / arming the terminal.
3. `\x1b[PX^_][^\x1b]*(?:\x1b\\)?` — DCS/SOS/PM/APC string sequences, same
   unterminated-tolerant shape.
4. `\x1b[@-Z\\-_]` — remaining two-byte Fe escapes (e.g. `ESC c` full reset is actually
   `\x1b c` = Fs, caught by the bare-ESC fallback below; `ESC D`, `ESC M` index moves
   are caught here).
5. `[\x00-\x1f\x7f-\x9f]` — all remaining C0 controls (BEL, backspace, CR, LF, TAB,
   vertical tab), DEL, and raw C1 controls including U+009B (single-byte CSI) and
   U+009D (single-byte OSC). Also mops up any lone ESC left by a truncated sequence.

### Edge cases

- **Truncated CSI** (`"title\x1b[31"` — no final byte): branch 1 fails, branch 5
  removes the ESC; residue `[31` stays visible. Harmless (no live control), acceptable.
- **Newlines/tabs are stripped**, which is correct for single-line padded list rows
  (`padEnd(30)` alignment survives). If the helper is later applied to multi-line
  `description` bodies (`backlog.ts:110`, `milestone.ts:170`), either add a
  `keepNewlines` option or reuse the escape-style approach from `format-zod-error.ts`
  (which deliberately exempts `\n`/`\t`). Descriptions are a recommended follow-up, not
  part of the two defect sites.
- **Normal unicode is untouched**: the regex only targets code points ≤ `0x9f`; emoji,
  CJK, and accented characters pass through. (Without the `u` flag, `[\x7f-\x9f]`
  matches UTF-16 code units, which for this range is equivalent to code points — no
  surrogate issues below U+00A0.)
- **Not covered (out of scope)**: Unicode bidi overrides (U+202E) and zero-width
  characters — display-spoofing, not terminal control; and the `--json` C1 passthrough
  noted in Findings.
- **`padEnd` note**: sanitization applies to `title`; the `slug.padEnd(30)` columns are
  already safe because slugs are validated against `SLUG_RE` (`src/util/slug.ts:5`).

### Test plan (1:1 ratio)

- `tests/sanitize-text.test.ts` — unit: color CSI, cursor-move CSI, `\x1b[2J`,
  OSC title-set with BEL and with ST, unterminated OSC, OSC-8 hyperlink, DCS, raw
  `\x9b` C1 CSI, BEL/backspace/CR, lone trailing ESC, plain unicode/emoji passthrough,
  empty string.
- Extend `tests/cli-issue-backlog.test.ts` and `tests/cli-milestone.test.ts` — integration:
  seed an issue whose title contains `\x1b[31mEVIL\x1b[0m` and assert the `backlog list`
  / `milestone show` stdout contains `EVIL` but no `\x1b`.

[^1]: https://raw.githubusercontent.com/chalk/ansi-regex/main/index.js accessed 2026-08-17 — ansi-regex matches OSC (with BEL/ST/0x9C terminators) and CSI introduced by either `` or ``, confirming C1 CSI must be handled; it does not match bare C0 controls, confirming strip-ansi alone is insufficient for this defect.
