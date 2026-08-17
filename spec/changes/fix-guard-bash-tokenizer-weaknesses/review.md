# Review: fix-guard-bash-tokenizer-weaknesses

Three parallel reviews (correctness, security, quality) — round 1.

## Verdicts

| Reviewer | Verdict |
|----------|---------|
| Correctness | PASS_WITH_WARNINGS |
| Security | PASS_WITH_WARNINGS |
| Quality | PASS_WITH_WARNINGS |

All three confirmed: both hook copies byte-identical, 199/199 hook tests pass, tier-1/tier-2 authorization and audit logging untouched, fail-closed paths intact. Security verified against the `main` baseline that the change genuinely closes three previously-allowed bypasses (single `&`, newline, glued separators) and stops over-blocking the quoted-span `--` case.

## Findings to fix (round 1)

### F1 — MAJOR (correctness): quoted separator in env-var prefix now hides a blocked invocation
`src/templates/hooks/metta-guard-bash.mjs:167` (+ byte-identical `.claude/hooks` copy)
`FOO=';' metta finalize` — verified: main exits 2, new hook exits 0 while bash executes the Tier-2-blocked `metta finalize`. `CHAIN_SEPARATOR_RE` splits inside the quoted env value, so the `metta finalize` segment begins with a stray `'` token and the `tokens[i][0] !== 'metta'` check skips it. Regression vs main.
**Fix:** compute the quote mask over the whole command and split only on unquoted separator runs (fail-closed on unterminated quotes — `computeQuoteMask` already exists).

### F2 — MAJOR (security + correctness): whole-word quoted `--` bypasses the operand-terminator block
`src/templates/hooks/metta-guard-bash.mjs:151-152, 194, 358-361`
`metta backlog --json "--" add x` (and `'--'`, `""-- `) — verified exit 0 on both old and new hooks, yet bash quote-removes to a live `--` and dispatches the Tier-2-blocked `backlog add x`. Pre-existing, but this change advertises quote-aware `--` handling and the classify comment / block message overstate coverage.
**Fix:** unquote each word (strip wrapping/embedded quote chars per the mask) before the `=== '--'` comparison — a word whose quote-stripped form is `--` is a bash operand terminator.

### F3 — MINOR (all three): quote-unaware segmentation over-splits quoted arguments containing separators
Fail-closed direction (over-block, never under-block), e.g. `metta issue "handle -- flag; see docs"` re-triggers the exact self-block that motivated this change; `metta backlog add "see; metta finalize"` phantom-blocks. Largely resolved as a side effect of F1 (unquoted-only splitting). Add pinning tests.

### F4 — MINOR (comments/tests):
- Extend KNOWN LIMITATION comment (lines 113-120): command substitution `$(...)`, backticks, subshells, process substitution, and quoting-based hiding (env prefix with quoted whitespace `FOO="a b" metta ...`, quoted command names).
- Correct the overstated "any `--` fails closed" comment/block-message claims (moot if F2 fixed properly).
- Hedge the "segment contains exactly one command" comment.
- Strengthen glued-separator block tests: assert the block reason cites the second invocation (e.g. stderr contains `backlog add`), not just `code === 2`.

## Accepted limitations (documented, not fixed)
- Wrapper prefixes (`command`/`env`/`xargs`/`sh -c`), command substitution, subshells — inherent to textual guarding; covered by tier model + audit log.
- Env prefix with quoted whitespace hides invocation (pre-existing, same class).

## Round 2 (after fixes)

| Reviewer | Verdict |
|----------|---------|
| Correctness | PASS |
| Security | PASS |
| Quality | PASS |

(To be updated after re-review.)
