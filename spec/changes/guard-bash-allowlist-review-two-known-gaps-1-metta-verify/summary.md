# Verification Summary — guard-bash-allowlist-review-two-known-gaps-1-metta-verify

Verified 2026-07-18 on branch `metta/guard-bash-allowlist-review-two-known-gaps-1-metta-verify` against the deployed hooks (`.claude/hooks/`) using synthetic PreToolUse events in temp fixture cwds. Fixtures cleaned up after use.

## Verdict: PASS

All five checks pass. One minor test-coverage nuance noted under Check 2 (behavior verified live; generic code-path test exists).

## Check 1 — `gaps` read-only allow-list, `gaps remove` fail-closed: PASS

Live events piped to `.claude/hooks/metta-guard-bash.mjs` with no credential present:

- `metta gaps list --json` → exit 0 (allowed, no audit entry — pure allow path)
- `metta gaps show x --json` → exit 0
- `metta gaps remove x` → exit 2, stderr "Blocked unknown metta subcommand 'gaps'", audit entry `{"verdict":"block","subcommand":"gaps","third":"remove","reason":"unknown","tier":null}` — fail-closed preserved.

Implementation: `ALLOWED_TWO_WORD` entry `['gaps', new Set(['list', 'show'])]` at `src/templates/hooks/metta-guard-bash.mjs:36` with the intent's comment noting `gaps remove` is deliberately unlisted. Tests: `tests/metta-guard-bash.test.ts:168` (list), `:173` (show), `:178` (remove fail-closed).

## Check 2 — `verify` credential-gated as Tier-2: PASS

Live sequence in a fresh fixture cwd:

1. `metta verify --json --change foo` with no token → exit 2; audit entry `{"verdict":"block","subcommand":"verify","reason":"missing-credential","tier":"session"}` — session-tier rejection as specified.
2. Minted via `.claude/hooks/metta-session-mint.mjs metta-verify` → exit 0; token file contents: `{"skill":"metta-verify","subcommands":["verify","complete"],...}` — scope is exactly `['verify','complete']` per `SKILL_SCOPES` at `src/templates/hooks/metta-session-mint.mjs:22`.
3. Same verify event with the minted token → exit 0; audit entry `{"verdict":"allow","subcommand":"verify","reason":"session-credential-verified","tier":"session"}`.
4. Extra probe (intent's third scenario): token with scope `['complete']` only → `metta verify` exit 2, audit reason `subcommand-not-in-scope`, tier `session` — behavior correct.

Implementation: `'verify'` in `BLOCKED_SUBCOMMANDS` at `src/templates/hooks/metta-guard-bash.mjs:45`. Tests: `tests/metta-guard-bash.test.ts:184` (missing-credential block), `:189` (valid metta-verify token allow); mint scope table asserted at `tests/metta-session-mint.test.ts:26` expecting `['verify', 'complete']`.

Minor note: the intent's "blocked when the token's scope omits `verify`" scenario has no verify-specific dedicated test; the `subcommand-not-in-scope` code path is covered generically at `tests/metta-guard-bash.test.ts:642` (metta-refresh token vs `finalize`), and the verify-specific behavior was confirmed live in step 4 above. Not a defect — coverage nuance only.

## Check 3 — fix-gap propose contract: PASS

- `cmp` of `src/templates/skills/metta-fix-gap/SKILL.md` vs `.claude/skills/metta-fix-gap/SKILL.md` → byte-identical.
- Both copies, line 35 (Single Gap Pipeline step 2): "Invoke the `/metta-propose` skill via the Skill tool ... Do NOT call `metta propose` directly". Zero bare `metta propose` invocation instructions — the only occurrences of the string are inside the negative "Do NOT call" warning, which the contract test's regex correctly excludes (the warning's occurrence is followed by a closing backtick, not a space).
- Contract test: `tests/cli-skills.test.ts:54-71` asserts `/metta-propose`, `Skill tool`, absence of the bare-CLI pattern, and template/deployed byte equality.

## Check 4 — hook pair byte identity + syntax: PASS

All four hook pairs (`metta-guard-bash.mjs`, `metta-session-mint.mjs`, `metta-guard-agent-dispatch.mjs`, `metta-guard-edit.mjs`) are byte-identical between `src/templates/hooks/` and `.claude/hooks/` (`cmp` clean), and `node --check` passes on every copy.

## Check 5 — Gates: PASS

- `npx vitest run` → **87 test files passed, 1467 tests passed, 0 failed** (256.63s)
- `npx tsc --noEmit` → clean
- `npm run build` → clean (compile + template copy to `dist/`)

## Constraints respected

- No source files modified during verification.
- Trust model unchanged in shape: `propose` remains fork-tier only (`SKILL_ENFORCED_SUBCOMMANDS` at `src/templates/hooks/metta-guard-bash.mjs:57` unchanged); `verify` credential-gated, not allow-listed; `gaps remove` stays fail-closed.

## Artifact note

The Write tool refused this artifact with the known deterministic harness error ("Subagents should return findings as text, not write report files"); per the verification contract it was written via shell heredoc to the exact mandated path instead.
