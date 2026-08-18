# Summary: fix-metta-guard-bash-blocks-main-session-tier-2-lifecycle

## What changed

Fixes the guard falsely blocking main-session Tier-2 lifecycle commands (`metta complete`, `metta finalize`) with `credential-expired` after subagent-delegation windows, and the same-event mint/guard parallel-hook race.

Mechanism: guard-integrated deterministic re-prime, session-bound, with a 60-minute grace horizon (`GRACE_MS = 3_600_000` shared across both hooks).

## Commits

- `e51f162de` — mint hook: `sessionId: event.session_id ?? null` stamped into tokens; `cleanupSiblings` horizon extended to `ttlMs + GRACE_MS`; atomic temp+rename writes; stale `.tmp` orphan cleanup; header rewritten (+ byte-identical template mirror, extended mint suite — 43/43).
- `63bdc0753` — guard hook: two-band freshness (fresh `age < ttlMs`; re-primable `sessionId === event.session_id && age < ttlMs + GRACE_MS`); `reprimeToken` (authorize-then-write, atomic, swallow-all — write failure never revokes); `readSessionTokens` returns `{tok, file}` for read/write path symmetry; audit gains `session-credential-reprimed` reason and `staleness_ms` on session-tier acceptances and `credential-expired` blocks (+ mirror, 3 sanctioned seed deepenings only — 344/344).
- `d12b00b00` — new `tests/metta-guard-mint-seam.test.ts` (480 lines): A1–A4 regression armor, B1 re-prime bug pin, B2 sliding refresh, C1/C2 ordering invariance, C3 gated stress smoke, E1–E7 fail-closed armor, ADR-4 GRACE_MS constant pin across all four hook copies. Pre-fix red-check recorded: B1 and C1 both exit 2 `credential-expired` against the merge-base guard (`0873e03c5`).
- `2fa949149` — docs: CLAUDE.md Tier-2 bullet corrected to per-slug two-band lifecycle; `docs/internals/guard-hooks.md` Bash-guard portion rewritten to the landed model (retired mechanisms marked retired).

## Gates (Task 3.1, from change root)

- `npm test`: 130 files, 2537 passed, 2 skipped, 0 failed
- `npx tsc --noEmit`: exit 0
- `npm run lint`: exit 0
- `npm run build`: exit 0 (template->dist copy exercised for both hooks)
- Hook/template byte-identity: `cmp` silent for both pairs

## Behavior preserved (fail-closed boundary)

Tier-1 fork identity, scope lists, tokenizer, `--` handling, `missing-credential`/`subcommand-not-in-scope` paths, retired single-file credential unhonored, block message text — all unchanged. Missing/non-string `session_id` degrades to exact pre-fix behavior. Old-format tokens (no `sessionId`) are never re-primable.

## Open items

- UAT: confirm `session_id` stability across `--resume`/`--fork` (undocumented; both outcomes fail-closed-safe).
- Deviation note (Task 2.2): `docs/internals/guard-hooks.md` was stale beyond the lifecycle paragraph (retired inline `METTA_SKILL=1` bypass presented as current); the whole Bash-guard portion was rewritten to match the landed hooks.

## Review (2 rounds)

Round 1: correctness PASS_WITH_WARNINGS, security PASS_WITH_WARNINGS (M1), quality NEEDS_CHANGES (F1). Fixes landed: `24ef746b4` (F2 deferred re-prime to `!offender` branch + F3 authorizing-token attribution, with seam pin tests), `4f3099488` (F1 workflow-primer Tier-2 wording + delivery test pins). Round 2: all three reviewers PASS. Details in review.md.

## Verification (3 parallel verifiers)

- Full suite: 130 files, 2543 passed, 2 skipped (env-gated stress smokes), 0 failed; `npm run build` exit 0. (One vitest-internal worker RPC timeout note; no test implicated.)
- `npx tsc --noEmit` and `npm run lint`: zero errors; both hook mirrors byte-identical (`cmp` silent).
- Spec sweep: all 34 scenarios across R1–R8 discharged with cited test/doc evidence; zero gaps. Evidence notes (non-gaps): fork-tier audit `tier` field rests on code inspection + block-record test; B1/C1 red-pre-fix is documented verification (merge-base extraction), not an automated bi-version CI run.
