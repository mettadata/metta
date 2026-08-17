# UAT: fix-guard-bash-tokenizer-weaknesses

- **Change**: fix-guard-bash-tokenizer-weaknesses
- **Generated**: 2026-08-17
- **Source**: intent + summary (reduced)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

*Reduced script — derived from intent/summary; steps are confirmation prompts.*

### Intent proposal

#### Step 1.1
- **Do**: Confirm: Separator-first splitting (fixes 1 and 2). Before whitespace tokenization, split the command string on chain-separator runs and newlines — e.g. split on `/([;|&]+|\n)/` — so `;`, `&&`, `||`, `|`, `&`, and newline act as segment boundaries whether or not they are whitespace-delimited. Each segment is then whitespace-tokenized and scanned for `metta` invocations exactly as today (env-prefix consumption, sub/third extraction, `hasDoubleDash` span walk scoped to the segment). Glued forms like `--json;metta backlog add x` MUST produce two invocations, with the second classified and blocked as it would be if spaced.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Quote-aware `--` detection (fixes 4). Make the token scan quote-aware enough that a `--` appearing inside single or double quotes is treated as argument text, not as Commander's operand terminator. Only an unquoted bare `--` token sets `hasDoubleDash`. Fail-closed posture is preserved: anything the quote scanner cannot confidently parse (unterminated quotes, etc.) keeps the current strict behavior.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: Document the wrapper-prefix limitation (addresses 3). Add an acknowledging comment in the hook explaining that `command metta` / `env metta` / `\metta` and similar wrappers are invisible to textual guarding, that this is an accepted limitation of the text layer, and that defense in depth comes from the tier model (credentials/agent identity) plus audit logging — not from attempting to enumerate wrappers.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.4
- **Do**: Confirm: Tests. Extend the hook's test coverage (near 1:1 test-to-source ratio) with cases for: glued `;` and `&&` chains, `||`/`|`/`&` glued variants, newline-separated invocations, quoted `--` allowed, unquoted `--` still blocked, and regression cases for existing allow/block/tier behavior.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Trivial workflow — intent.md is the spec. All four issue points verified with test-level evidence in `tests/metta-guard-bash.test.ts` (runs against both hook copies; byte-identity itself is pinned by a test):

#### Step 2.1
- **Do**: Confirm: [x] 1. Glued chain separators detected — `;`-glued (line 302), `&&` (310), `||` (318), `|` (326), `&` (334); block reason cites the second invocation (`backlog add` in stderr, lines 375/384); spaced-separator regressions still block (358) and allowed-only chains still pass (366)
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: [x] 2. Newline/CRLF separators detected — `\n` (342), `\r\n` (350)
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: [x] 3. Wrapper-prefix limitation acknowledged — KNOWN LIMITATION comment in `src/templates/hooks/metta-guard-bash.mjs` (lines 113+) names `command`/`env`/`\metta`/`xargs`/`sh -c` wrappers plus dynamic indirection: `$(...)`, backticks, subshells, process substitution, brace groups, backslash-escaped quotes, quoted-whitespace env prefixes, quoted/split command names
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.4
- **Do**: Confirm: [x] 4. Quote-aware `--` — quoted-span `--` allowed (429, 438); whole-word quoted `--` (`"--"`, `'--'`, `""--`) blocks (470, 479, 488); unquoted `--` still blocks (447, 1103-1129); unterminated quotes fail closed (452, 460)
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.5
- **Do**: Confirm: [x] Review round-2 pins — `FOO=';' metta finalize` blocked (396); `metta status "a;b"` allowed (402); quoted arg with separator + `--` allowed (408); `metta backlog add "see; metta finalize"` blocked for the genuine call (417)
- **Observe**: behaves as described
- [ ] Pass
