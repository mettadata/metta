# metta-guard-bash hook false-positive: quoted free-text argument containing 'metta <subcommand>' substring wrongly blocked

**Captured**: 2026-06-22
**Status**: logged
**Severity**: minor

## Symptom
The `metta-guard-bash` PreToolUse hook produces a false positive: a metta command whose quoted free-text argument contains the substring "metta <subcommand>" is wrongly blocked. For example `METTA_SKILL=1 metta propose "fix metta finalize: bug" --from-issue X` is rejected because the words inside the quoted description are misparsed as a second metta invocation. Observed during the fix of issue metta-finalize-hangs, where the propose description had to be reworded to avoid the substring.

## Root Cause Analysis
`tokenize()` is not shell-quote-aware. It splits the entire command string on whitespace and scans for any token equal to `metta`, treating the next two tokens as `sub`/`third`. After recording one `metta <sub>` invocation it executes `i += 3; continue`, which advances only three tokens and immediately re-scans for another `metta` rather than skipping past the current command's argument list to the next chain separator. Consequently the words inside a quoted argument (e.g. `"fix metta finalize: bug"`) are reinterpreted as a fresh invocation. In the example, a phantom `{ sub: "finalize:" }` is parsed; the trailing colon makes it classify as `unknown` and the hook blocks it (a bare `metta finalize` inside the quotes would instead hit the hard `block` path). Impact is minor: it over-blocks, never under-blocks, so there is no security regression, and it only triggers when a metta command's free text mentions a metta subcommand — almost exclusively metta-on-metta dogfooding.

### Evidence
- `.claude/hooks/metta-guard-bash.mjs:73` — the `if (tokens[i] === 'metta')` branch followed by `i += 3; continue` (lines 73-77) re-scans from `i+3` instead of advancing to the next chain separator, so quoted-argument words become phantom invocations.
- `.claude/hooks/metta-guard-bash.mjs:64` — `command.split(/\s+/)` performs a naive whitespace split with no quote awareness, treating words inside `"..."` as independent tokens.
- `src/templates/hooks/metta-guard-bash.mjs` — confirmed byte-identical to the active hook via `diff` (returns no differences), so the same defect exists in the template and both files must be patched together.

## Candidate Solutions
1. **Skip-to-separator after recording an invocation** — in `tokenize()`, after pushing a metta invocation's `sub`/`third`, advance `i` forward until the next chain separator (`&&`, `;`, `||`, `|`) instead of `i += 3; continue`, so tokens inside the current command's quoted argument list are never reparsed as a new command. Apply identically to both `.claude/hooks/metta-guard-bash.mjs` and `src/templates/hooks/metta-guard-bash.mjs` (they must stay byte-identical) and add a regression test to `tests/metta-guard-bash.test.ts`. Tradeoff: still not a true quote-aware parser — an edge case where a real chained `metta` command is embedded after an unquoted separator inside what was meant as free text could be missed, but that pattern does not occur in practice and this eliminates the entire observed false-positive class with a minimal diff.
2. **Full shell-quote-aware tokenizer** — replace the naive `split(/\s+/)` with a parser that honors single/double quotes and escapes (e.g. a small hand-rolled lexer or a vetted shell-parsing dependency) so quoted arguments are collapsed into single tokens before scanning. Tradeoff: significantly larger change and review surface, adds parsing complexity (and possibly a dependency) for a minor over-blocking bug; better suited as a follow-up than as the fix for this specific false positive.
