# fix-guard-bash-tokenizer-weaknesses

## Problem

The `metta-guard-bash` PreToolUse hook enforces the two-tier skill-authorization model by tokenizing every Bash `command` string and classifying each `metta` invocation. Its `tokenize()` function splits on whitespace first (`command.split(/\s+/)`) and then looks for chain separators (`&&`, `;`, `||`, `|`) only as standalone tokens. This produces four concrete weaknesses, confirmed during the PR #86 security review and pre-existing on main:

1. **Glued chain separators bypass invocation detection.** In `metta backlog --json;metta backlog add x`, the token `--json;metta` is a single whitespace-delimited word, so the tokenizer never sees a separator and never detects the second invocation. Bash still executes the Tier-2-blocked write (`backlog add`) while the hook allows the command. The `&&`-glued equivalent (`--json&&metta backlog add x`) bypasses the same way. This is a real enforcement hole in a security hook — any AI orchestrator session can mutate metta state without a skill credential.
2. **Newlines are not treated as separators.** Bash treats a newline as a command separator, but the separator list is only `['&&', ';', '||', '|']`. A multi-line command string hides subsequent invocations from the argument-span walk in the same way (whitespace splitting happens to mask most cases, but the separator-skip loops in `tokenize()` do not model newline boundaries, and quoting work in fix 4 makes this explicit handling necessary).
3. **Wrapper prefixes hide the invocation.** `command metta finalize`, `env metta finalize`, and `\metta finalize` all execute metta but never match the literal token `metta`. This is inherent to textual guarding (arbitrarily many wrappers exist: `xargs`, `sh -c`, scripts) and cannot be fully closed at this layer — but the limitation is currently undocumented in the hook, inviting false confidence.
4. **Quote-unaware tokenization over-blocks quoted `--` arguments.** The `hasDoubleDash` scan treats a bare `--` token anywhere in the argument span as Commander's operand terminator and fails closed. Because the tokenizer is quote-unaware, a *quoted* standalone `--` inside a legitimate argument (e.g. an issue description containing the two characters `--` as a word) is misread as the operand terminator and blocked. This already bit in practice: logging this very issue via `/metta-issue` was blocked by the hook it describes.

Affected users: AI orchestrator sessions on any metta-adopting project (holes 1–3 weaken enforcement; hole 4 blocks legitimate skill work), and metta maintainers relying on the guard as the enforcement layer for the CLAUDE.md "never call the CLI directly" rule.

## Proposal

Fix the tokenizer in `metta-guard-bash.mjs` (both copies — template and installed hook — kept byte-identical):

1. **Separator-first splitting (fixes 1 and 2).** Before whitespace tokenization, split the command string on chain-separator runs and newlines — e.g. split on `/([;|&]+|\n)/` — so `;`, `&&`, `||`, `|`, `&`, and newline act as segment boundaries whether or not they are whitespace-delimited. Each segment is then whitespace-tokenized and scanned for `metta` invocations exactly as today (env-prefix consumption, sub/third extraction, `hasDoubleDash` span walk scoped to the segment). Glued forms like `--json;metta backlog add x` MUST produce two invocations, with the second classified and blocked as it would be if spaced.
2. **Quote-aware `--` detection (fixes 4).** Make the token scan quote-aware enough that a `--` appearing inside single or double quotes is treated as argument text, not as Commander's operand terminator. Only an unquoted bare `--` token sets `hasDoubleDash`. Fail-closed posture is preserved: anything the quote scanner cannot confidently parse (unterminated quotes, etc.) keeps the current strict behavior.
3. **Document the wrapper-prefix limitation (addresses 3).** Add an acknowledging comment in the hook explaining that `command metta` / `env metta` / `\metta` and similar wrappers are invisible to textual guarding, that this is an accepted limitation of the text layer, and that defense in depth comes from the tier model (credentials/agent identity) plus audit logging — not from attempting to enumerate wrappers.
4. **Tests.** Extend the hook's test coverage (near 1:1 test-to-source ratio) with cases for: glued `;` and `&&` chains, `||`/`|`/`&` glued variants, newline-separated invocations, quoted `--` allowed, unquoted `--` still blocked, and regression cases for existing allow/block/tier behavior.

Both `src/templates/hooks/metta-guard-bash.mjs` and `.claude/hooks/metta-guard-bash.mjs` receive the identical change; a byte-identity check between the pair is part of verification.

## Impact

- **`src/templates/hooks/metta-guard-bash.mjs`** — tokenizer rewrite (separator-first splitting, quote-aware `--` scan), new wrapper-limitation comment. This is the copy installed into adopting projects at build/install time.
- **`.claude/hooks/metta-guard-bash.mjs`** — identical edit; this copy actively guards this repo's own Claude Code sessions, so the fix takes effect for metta development immediately.
- **Enforcement tightens:** previously-allowed glued-chain and newline-separated bypasses will now be blocked. No legitimate skill flow uses these forms, so no skill instructions need updating.
- **Over-blocking loosens:** commands with quoted `--` arguments (issue descriptions, propose descriptions) stop failing closed, unblocking `/metta-issue` and similar skills for such text.
- **Unchanged:** the two-tier trust model, allow/block lists, session-credential validation, audit logging, exit codes, and stderr message contracts. `classify()` semantics are untouched except that `hasDoubleDash` becomes quote-aware.
- **Tests:** hook test file gains the new tokenizer cases; existing tests must continue to pass unmodified except where they encoded the buggy behavior.

## Out of Scope

- **Closing the wrapper-prefix hole (weakness 3) mechanically.** `command`/`env`/backslash and every other indirection (`xargs`, `sh -c`, wrapper scripts) remain undetectable by textual guarding; this change only documents the limitation. Structural mitigation belongs to the tier model, not the tokenizer.
- **A full bash grammar parser.** No handling of subshells `$(...)`, process substitution, heredocs, backticks, brace groups, or variable-expanded command names (`$M finalize`). The tokenizer stays a deliberately simple text heuristic with fail-closed posture for what it cannot parse.
- **Changes to the allow/block lists, tier semantics, credential minting (`metta-session-mint.mjs`), TTL handling, or audit-log schema.**
- **Changes to other hooks or to the skill/agent instruction files.**
- **Relaxing the unquoted `--` fail-closed rule** — an unquoted bare `--` in a metta invocation remains blocked unconditionally.
