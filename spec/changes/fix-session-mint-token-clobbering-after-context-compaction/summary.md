# Summary: fix-session-mint-token-clobbering-after-context-compaction

## What changed

Resolved issue `session-mint-token-clobbering-after-context-compaction` (major): accumulated Tier-2 skill mint hooks fought over the single `.metta/scratch/skill-session.token`, letting a stale skill's hook (first to fire at each TTL rotation window) claim the token and block the genuinely active skill's lifecycle commands with `subcommand-not-in-scope`.

## Design decision

Workflow tier was **trivial** (engine recommendation matched), so no research/design artifacts exist. The orchestrator selected **Candidate 3 — per-skill token files with any-valid-token authorization** because it is the only candidate that eliminates the clobbering race outright (candidates 1 and 2 only narrow it or weaken least-privilege by ratcheting scopes). Tradeoff accepted: because each invoked skill's accumulated mint hook keeps re-minting its credential on every subsequent Bash call, an active session's effective Tier-2 authority is the **union of all Tier-2 skills invoked during the session, for the session's lifetime**; exposure is TTL-bounded only once the session goes idle (all credentials expire one TTL after Bash activity stops).

## Implementation

- `metta-session-mint.mjs` (template `src/templates/hooks/` + installed `.claude/hooks/`, byte-identical): mints only its own `.metta/scratch/skill-session/<slug>.token`; staleness check compares against its own file only; deletes expired/malformed sibling tokens and any lingering legacy single-file token.
- `metta-guard-bash.mjs` (template + installed copy): scans the token directory; authorizes a Tier-2 subcommand when any structurally valid, unexpired token covers it. Denial-reason semantics preserved (`missing-credential` / `credential-expired` / `subcommand-not-in-scope`). Legacy single-file path is a clean cutover — neither written nor honored.
- `src/delivery/workflow-primer.ts` and `CLAUDE.md`: Tier-2 description updated to the per-skill path.
- Specs: `spec/specs/orchestration-guard/spec.md` (per-skill storage, non-interference, any-valid-credential acceptance, new scenario); `spec/specs/roadmap-feature/spec.md` (path references in a MUST clause updated in sync).
- Tests: `tests/metta-session-mint.test.ts`, `tests/metta-guard-bash.test.ts`, `tests/cli-metta-guard-bash-integration.test.ts` — regression coverage for concurrent mints not clobbering, coexisting different-skill fresh token no longer blocking, expired-only denial, sibling cleanup, legacy-token inertness.

## Commits

- `42bc45382` fix(...): per-skill session tokens end cross-skill clobbering
- `429e7a9a5` docs(...): spec per-skill session credentials

## Gates (implementation phase)

- `npm test`: 2051/2051 passed (115 files)
- `npm run lint`: clean
- `npx tsc --noEmit`: clean
- `npm run build`: succeeded (templates recopied to `dist/`)

## Notes / risks

- Clean cutover: any in-flight session holding only a legacy token must re-invoke its skill to mint a per-skill token.
- `spec.lock` hashes for the two edited specs are stale by design; finalize regenerates locks and no gate validates lock freshness.

## Verification (3 parallel verifiers, iteration 1)

- Full suite: `npm test` — 115 files, 2051/2051 passed, no failures.
- Static gates: `npx tsc --noEmit` clean; `npm run lint` clean; `npm run build` succeeded (templates copied to `dist/templates/`).
- Spec scenario coverage vs amended `spec/specs/orchestration-guard/spec.md`: COVERAGE: COMPLETE — every amended clause and the new "Concurrent skill credentials do not interfere" scenario has cited passing test evidence across `tests/metta-session-mint.test.ts`, `tests/metta-guard-bash.test.ts`, `tests/cli-metta-guard-bash-integration.test.ts` (229 tests). One pre-existing observation: the "structurally malformed credential" scenario variant has no dedicated test; guard behavior (skip unparseable file → missing-credential) is spec-compliant.

## Review outcome

Reviewers: correctness PASS_WITH_WARNINGS, security PASS_WITH_WARNINGS, quality PASS — no critical findings. The one major (documentation/threat-model) finding — understated tradeoff wording and a contradicting "no standing authorization" clause — was fixed in commit `287e11aa3` (spec now documents session-lifetime union scope for active sessions explicitly). Minor findings recorded as accepted warnings in `review.md`.
