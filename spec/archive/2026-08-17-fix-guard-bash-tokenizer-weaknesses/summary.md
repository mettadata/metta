# Verification: fix-guard-bash-tokenizer-weaknesses

## Spec Scenarios

Trivial workflow — intent.md is the spec. All four issue points verified with test-level evidence in `tests/metta-guard-bash.test.ts` (runs against both hook copies; byte-identity itself is pinned by a test):

- [x] **1. Glued chain separators detected** — `;`-glued (line 302), `&&` (310), `||` (318), `|` (326), `&` (334); block reason cites the second invocation (`backlog add` in stderr, lines 375/384); spaced-separator regressions still block (358) and allowed-only chains still pass (366)
- [x] **2. Newline/CRLF separators detected** — `\n` (342), `\r\n` (350)
- [x] **3. Wrapper-prefix limitation acknowledged** — KNOWN LIMITATION comment in `src/templates/hooks/metta-guard-bash.mjs` (lines 113+) names `command`/`env`/`\metta`/`xargs`/`sh -c` wrappers plus dynamic indirection: `$(...)`, backticks, subshells, process substitution, brace groups, backslash-escaped quotes, quoted-whitespace env prefixes, quoted/split command names
- [x] **4. Quote-aware `--`** — quoted-span `--` allowed (429, 438); whole-word quoted `--` (`"--"`, `'--'`, `""--`) blocks (470, 479, 488); unquoted `--` still blocks (447, 1103-1129); unterminated quotes fail closed (452, 460)
- [x] **Review round-2 pins** — `FOO=';' metta finalize` blocked (396); `metta status "a;b"` allowed (402); quoted arg with separator + `--` allowed (408); `metta backlog add "see; metta finalize"` blocked for the genuine call (417)

## Gate Results

| Gate | Result |
|------|--------|
| tests (`npm test`) | PASS — 127 files, 2389/2389 (217 hook tests) |
| typecheck (`npx tsc --noEmit`) | PASS |
| lint (`npm run lint`) | PASS (tsc alias) |
| build (`npm run build`) | PASS |
| hook byte-identity (`cmp`) | PASS — template and `.claude/hooks` copy identical |

Review: 2 iterations, 3 reviewers each (correctness/security/quality). Round 2: correctness PASS; security and quality PASS_WITH_WARNINGS — all warnings resolved in follow-up commits (see review.md).

## Summary

Fixed the four tokenizer weaknesses in `metta-guard-bash.mjs` from issue `guard-bash-tokenizer-weaknesses-pre-existing-on-main` (severity major). Final implementation across commits `c3ee99531`, `95c83da4d`, `60f119809`:

1. **Quote-aware separator-first segmentation.** `splitCommandSegments()` computes a quote mask over the whole command and splits on runs of `;`, `|`, `&` (incl. `&&`, `||`) and `\r?\n` only when the run is entirely unquoted — glued forms like `metta backlog --json;metta backlog add x` now yield two invocations and the write call is blocked, while quoted separators (`metta status "a;b"`, `FOO=';' metta finalize`) neither hide invocations nor over-split. Unterminated quotes fall back to quote-unaware splitting, which can only over-block — it never hides a bash-executable invocation (such inputs are bash syntax errors).
2. **Newline segmentation** — `\n` and `\r\n` are segment boundaries.
3. **Wrapper-prefix limitation documented** — textual guarding cannot see wrapper/indirection forms; defense in depth is the two-tier trust model plus the audit log. No mechanical wrapper detection added (out of scope).
4. **Quote-stripped `--` detection.** `computeQuoteMask()` + `hasUnquotedDoubleDash()` with `stripQuoteChars()`: a `--` inside a longer quoted span (`"hello -- world"`) is allowed, while any boundary-self-contained word whose quote-stripped form is `--` (`"--"`, `'--'`, `""--`, `--""`) is treated as a live operand terminator and blocked, matching bash quote removal. Unquoted `--` blocks unconditionally; unterminated quotes fail closed.

Unchanged: tier/trust model, credential handling, allow/deny lists, audit logging semantics, exit codes.
