# make-metta-guard-bash-tokenizer-quote-aware-stop-false

## Problem
The `metta-guard-bash` PreToolUse hook produces a false positive: a legitimate metta command whose quoted free-text argument contains the substring `metta <subcommand>` is wrongly blocked. For example, `METTA_SKILL=1 metta propose "fix metta finalize: bug" --from-issue X` is rejected because the words inside the quoted description are misparsed as a second metta invocation.

The root cause is in `tokenize()`. It is not shell-quote-aware: it splits the whole command string on whitespace and scans for any token equal to `metta`, treating the next two tokens as `sub`/`third`. After recording one `metta <sub>` invocation it runs `i += 3; continue`, which advances only three tokens and immediately re-scans for another `metta` rather than skipping past the current command's argument list to the next chain separator. Consequently the words inside a quoted argument (e.g. `"fix metta finalize: bug"`) are reinterpreted as a fresh invocation, producing a phantom `{ sub: "finalize:" }` that classifies as `unknown` (trailing colon) and the hook blocks it.

Who is affected: AI orchestrators dogfooding metta on metta — any change whose propose/quick/issue free-text describes a metta subcommand. Impact is minor: the hook over-blocks, never under-blocks, so there is no security regression. It only triggers when a metta command's free text mentions a metta subcommand.

This was observed during the fix of issue `metta-finalize-hangs`, where the propose description had to be reworded to avoid the substring. Logged as issue `metta-guard-bash-hook-false-positive-quoted-free-text`.

## Proposal
Make the tokenizer skip to the next chain separator after recording a metta invocation, eliminating the entire observed false-positive class with a minimal diff (Candidate Solution 1 from the issue).

In `tokenize()`, after pushing a metta invocation's `sub`/`third`, advance `i` forward until the next chain separator (`&&`, `;`, `||`, `|`) — then consume that separator — instead of `i += 3; continue`. This means tokens inside the current command's quoted argument list are never reparsed as a new command, so words inside a quoted argument string (e.g. a propose description that references a metta subcommand) cannot be misparsed as a phantom second invocation.

The change must be applied IDENTICALLY to both copies of the hook, which are byte-identical and must stay so:
- `.claude/hooks/metta-guard-bash.mjs` (the active hook)
- `src/templates/hooks/metta-guard-bash.mjs` (the template copied to `dist/` at build time)

Add a regression test to `tests/metta-guard-bash.test.ts` asserting that a `metta propose` / `quick` / `issue` command whose quoted free-text argument contains a metta subcommand substring is NOT blocked (when carrying the correct bypass/agent-type), and that the genuine first invocation still classifies correctly.

This solution is APPROVED.

## Impact
- `tokenize()` parsing semantics change: after a metta invocation, scanning resumes at the next chain separator rather than three tokens later. Real chained commands joined by `&&`, `;`, `||`, `|` are still detected because the skip stops at the separator and the next iteration re-scans from there.
- Both hook copies must remain byte-identical; the patch is applied to both and verified with `diff`.
- A new regression test is added to `tests/metta-guard-bash.test.ts`.
- No change to the ALLOW/BLOCK/SKILL_ENFORCED classification tables or to the agent-type enforcement path — only the tokenization advance logic changes.

## Out of Scope
- A fully shell-quote-aware tokenizer (Candidate Solution 2): replacing the naive `split(/\s+/)` with a parser that honors single/double quotes and escapes. This is a significantly larger change with more review surface, and is deferred. As a consequence, one known and rarer edge case remains unaddressed: a chain separator (`&&`, `;`, `||`, `|`) appearing literally inside a quoted string would still terminate the skip prematurely. This pattern does not occur in practice for the observed false positives and is noted as deferred follow-up.
