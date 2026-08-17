# fix-guard-bash-tokenizer-weaknesses — summary

Fixed the four tokenizer weaknesses in `metta-guard-bash.mjs` identified in
`guard-bash-tokenizer-weaknesses-pre-existing-on-main` (severity major).

## What changed

`tokenize()` in `src/templates/hooks/metta-guard-bash.mjs` (mirrored
byte-identically to `.claude/hooks/metta-guard-bash.mjs`) was rewritten:

1. **Separator-first segmentation.** The command string is now split on
   `CHAIN_SEPARATOR_RE = /[;|&]+|\r?\n/` *before* whitespace tokenization, so
   any run of `;`, `|`, `&` (including `&&`, `||`) or a `\n`/`\r\n` is a
   segment boundary whether or not it is whitespace-delimited. This closes
   the glued-separator bypass — `metta backlog --json;metta backlog add x`
   now produces two invocations and the second (write) call is detected and
   blocked exactly as if it were spaced. Each segment is whitespace-tokenized
   independently; because a segment already contains at most one command, the
   old separator-skip walk inside the argument-span loop is no longer needed.
2. **Newline segmentation.** `\n` and `\r\n` are included in
   `CHAIN_SEPARATOR_RE`, so multi-line command strings are also correctly
   segmented.
3. **Wrapper-prefix limitation documented.** A comment above the tokenizer
   now explicitly states that `command metta`, `env metta`, `\metta`, and
   other indirections (`xargs`, `sh -c`, wrapper scripts) are invisible to
   textual guarding, that this is an accepted limitation of the text layer,
   and that defense in depth comes from the two-tier trust model and the
   audit log — not from enumerating wrappers. No mechanical wrapper detection
   was added (explicitly out of scope).
4. **Quote-aware `--` detection.** Added `computeQuoteMask()` and
   `hasUnquotedDoubleDash()`. A bare `--` word is now only treated as
   Commander's operand terminator when it is not inside an open single- or
   double-quoted span (e.g. `metta status "hello -- world"` is no longer
   misclassified as containing the operand terminator and is now allowed).
   An unquoted `--` remains blocked unconditionally, and an unterminated
   quote falls back to the previous quote-unaware check (fail-closed on
   unparseable input).

## Tests

Extended `tests/metta-guard-bash.test.ts` (runs against both the template
and deployed hook copies) with:
- glued `;`, `&&`, `||`, `|`, `&` separator cases (second invocation
  detected and blocked)
- newline- and CRLF-separated invocation cases
- regression cases for existing spaced-separator behavior (block and allow)
- quoted `--` (double and single quote) no longer over-blocking
- unquoted `--` still blocking (policy unchanged)
- unterminated double- and single-quote cases staying fail-closed

All 199 hook tests pass; full suite (`npm test`): 127 files / 2371 tests
pass. `npx tsc --noEmit` and `npm run build` both clean. The template and
deployed hook copies remain byte-identical (`cmp` verified).

## Unchanged

Tier/trust model, credential handling, allow/deny lists, audit logging
semantics, exit codes, and stderr message contracts are untouched, per the
change's Out of Scope section.
