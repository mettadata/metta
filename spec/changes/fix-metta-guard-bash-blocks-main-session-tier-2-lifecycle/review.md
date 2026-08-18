# Review: fix-metta-guard-bash-blocks-main-session-tier-2-lifecycle (round 1)

Three parallel reviewers (correctness, security, quality). All independently re-verified the red-first claim (pre-fix guard exits 2 `credential-expired` on the state the fixed guard authorizes) and byte-identity of both hook mirrors; 297 suite passes confirmed by each.

## Verdicts

| Reviewer | Verdict |
|---|---|
| Correctness | PASS_WITH_WARNINGS |
| Security | PASS_WITH_WARNINGS (1 major) |
| Quality | NEEDS_CHANGES (1 critical) |

## Actionable findings (fix in this change)

### F1 (critical, quality) — Generated workflow guidance still describes the retired model
`src/delivery/workflow-primer.ts:24` — `workflowPrimerLong()` Tier-2 bullet still reads "rotated on a sliding TTL; a call is authorized when any unexpired credential's scope covers it". Fails spec scenario "Generated workflow guidance matches the documented model", and `src/cli/commands/refresh.ts:127` means the next `metta refresh` would regress CLAUDE.md to the stale wording. Fix: update the primer bullet to the two-band/re-prime lifecycle (per-skill credential, 80% slide-rotate, session-bound guard re-prime across delegation windows, dies TTL + GRACE after last mint/re-prime). `tests/delivery.test.ts` does not pin the string.

### F2 (major, security) — Silent re-prime side effect on blocked commands
`.claude/hooks/metta-guard-bash.mjs:493` (re-prime write inside the `find` predicate) + `:502-510` (acceptance logging gated on `!offender`), and mirror. Repro: `metta complete research; metta bogus-subcommand` is blocked (exit 2) yet the token is rewritten with zero `session-credential-reprimed` records — a silent credential keepalive via deliberately-blocked commands. Fix: record `{ inv, reason, staleness_ms, needsReprime }` during the scan; perform `reprimeToken` + acceptance logging only in the `!offender` branch. Add a seam case pinning "blocked command does not rewrite the token".

### F3 (warning, correctness + quality + security-minor) — `staleness_ms` / authorizing-token attribution
`.claude/hooks/metta-guard-bash.mjs:492-497` and mirror — when `inScope` holds a stale re-primable token first and a fresh token later, reason is `session-credential-verified` (correct) but `staleness_ms` logs the stale token's age; the implicit invariant "`viaFresh` ⟺ `inScope[0]` fresh" also depends silently on spread order. Fix: select the authorizing token explicitly (`viaFresh ? inScope.find((t) => fresh.includes(t)) : inScope[0]`) and use it for both `reprimeToken` and `staleness_ms`; add a two-band two-token seeded test.

## Suggestions (non-blocking, not scheduled)
- C2 could additionally assert reason `session-credential-verified` (pins band identity, not just verdict equality).
- Seam case for re-primable-band token with out-of-scope subcommand → `subcommand-not-in-scope`.
- Mint `cleanupSiblings`/staleness check are sessionId-agnostic (hygiene-only; fail-closed).
- Guard header Tier-2 subcommand list omits `roadmap */release cut` (pre-existing; guard-hooks.md is correct).
- Mint-suite `bashEvent` positional params (cosmetic).

## Accepted residuals (recorded, no action)
- R2 forged-token-file residual unchanged (well-formed fabricated token incl. own session_id still self-authorizes; audit-visible).
- R1 active-use lifetime extension — acknowledged in spec/design threat model; the silent variant is fixed by F2.
- `session_id` stability across `--resume`/`--fork` undocumented — UAT item.
- Unhandled-exception exit 1 in `main()` theoretical fail-open — pre-existing, not widened.
