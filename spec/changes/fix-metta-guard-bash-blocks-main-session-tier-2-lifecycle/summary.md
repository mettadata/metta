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
