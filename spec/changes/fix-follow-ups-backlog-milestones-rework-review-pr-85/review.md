# Review: fix-follow-ups-backlog-milestones-rework-review-pr-85

## Iteration 1 — verdicts

| Reviewer | Verdict |
|---|---|
| Correctness | PASS_WITH_WARNINGS |
| Security | PASS_WITH_WARNINGS |
| Quality | FAIL (1 critical) |

## Findings requiring fixes (iteration 1)

1. **CRITICAL (quality)** — `tests/cli-metta-guard-bash-integration.test.ts:410-413` still pins the old behavior (bare `metta backlog` blocked, exit 2); full suite fails 1/2324. Fix: invert to expect exit 0, rename test.
2. **MAJOR (security, introduced)** — `metta backlog -- add <title>` passes the guard-bash ALLOWED_BARE check (line ~139 treats `--` as a flag) while Commander still dispatches the `add` subcommand after the `--` terminator — a credential-free Tier-2 write bypass. Same latent hole pre-exists for `roadmap`/`release`; this change extends it to backlog mutations the spec promises stay gated. Fix in both hook copies: reject the literal `--` third token (`inv.third !== '--' && inv.third.startsWith('-')`); add tests.
3. **MAJOR (quality) / minor (correctness)** — spec.md scenario for the docs sweep demands a literal "no `spec/backlog/` match" in the five docs files, but legacy-migrate mentions legitimately remain in skills.md:491,525-526, architecture.md:45, state.md:291. Fix: amend the spec scenario to permit legacy/migrate-input mentions (matches design C6 leave-alone rationale).
4. **MINOR (both reviewers)** — spec.md/stories.md misname the third commitPaths call site as "promote" — it is `migrate` (promote performs no writes). Fix artifact wording.
5. **MINOR (both reviewers)** — sanitizer OSC body class `[^\x07\x1b]*` treats 8-bit ST (`\x9c`) as body, over-stripping visible text after it. Fix: `[^\x07\x1b\x9c]` + test.

## Findings accepted without change

- Pre-existing guard tokenizer misses chained invocations glued to operators (`...--json&&metta backlog add x`) — pre-existing bypass class, logged as a follow-up issue at ship time.
- `ESC c` / unterminated-CSI printable residue (`c`, `[`) — neutralized, no control bytes survive; documented accepted residue.
- Swallowed per-path `git add` failure can yield partial auto-commit — pre-existing documented design.
- Commit/message mismatch from the parallel-index incident (deletion rode in f168e3a41; content recommitted in 381102a13) — history-only, documented in summary.md.
- `--json` C1 passthrough, pathspec separator style — follow-ups/suggestions.

## Verified clean (highlights)

Hook pairs byte-identical (both guard-bash and guard-edit); test consolidation lossless (all 9 describe-blocks, 76 assertions carried verbatim); renderBanner cap correct on all tier edges incl. cap-equals-current; sanitizer idempotent, ReDoS-free, applied at exactly the two ADR-1 sites; slug validation blocks pathspec traversal; changedPaths triples correct, empty on no-op/collision-only; dist/ free of compiled tests; CLAUDE.md TOC byte-matches generator; docs accuracy verified against code; conventions (naming, .js imports, 1:1 test ratio, no new deps) upheld.

## Iteration 2 — verdicts (post-fix re-review)

_(pending)_

## Iteration 2 — verdicts (post-fix re-review)

| Reviewer | Verdict |
|---|---|
| Correctness | PASS |
| Security | FAIL — `metta backlog --json -- add x` still bypassed (third-token-only `--` check insufficient) |
| Quality | PASS (full suite 2332/2332) |

Fixes applied in iteration 1→2: commits 8cd86d138 (immediate-`--` rejection + integration test flip), 1a296ae0 (spec/stories scenario amendment + promote→migrate), 175e3376b (sanitizer 8-bit ST), 12f8f48b7 (US-3 criteria alignment).

## Iteration 3 — verdicts (final)

| Reviewer | Verdict |
|---|---|
| Correctness | PASS |
| Security | PASS_WITH_WARNINGS (remaining warnings all pre-existing tokenizer classes) |
| Quality | PASS (full suite 2343/2343) |

Fix applied in iteration 2→3: commit 2ab040e4d — structural full-argument-span `--` scan (`hasDoubleDash`); classify() fails closed unconditionally (no fork identity or credential authorizes `--`); dedicated `double-dash-operand-terminator` audit reason; empirically verified across 16 attack variants incl. fork/credential escalation, chain scoping both directions, quoted/env-prefixed forms.

### Accepted warnings carried to follow-up issue (orchestration-guard, pre-existing on main)
- Glued chain separators (`...;metta backlog add x`, `...&&metta ...`) swallow the second invocation.
- Newline as unhandled command separator.
- Wrapper prefixes (`command metta`, `env metta`, `\metta`) hide the invocation — inherent to textual guarding; credential model is backstop.
- Quote-unaware tokenizer means a quoted standalone `--` argument over-blocks (fail-closed direction; remediation message adequate).

**Review loop exit: CLEAN at iteration 3.**
