# Review: harden-metta-config-yaml-lifecycle-across-three-related-bugs

## Verdict: **PASS_WITH_WARNINGS** (all three reviewers)

Per-reviewer detail:
- [review/correctness.md](review/correctness.md) — PASS_WITH_WARNINGS
- [review/security.md](review/security.md) — PASS_WITH_WARNINGS
- [review/quality.md](review/quality.md) — PASS_WITH_WARNINGS

## Findings and resolution

| # | Reviewer | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | Quality | Warning | `tests/agents-byte-identity.test.ts` did not cover `metta-verifier` | **Fixed** (commit `f2a54fed4`) — added to parity array; 3/3 pass |
| 2 | Correctness | Warning | Verifier persona first-run heuristic wording diverges slightly from spec R7 | **Deferred** — wording captures intent; minor spec/persona phrasing gap |
| 3 | Security | Warning | `verification_instructions` injected verbatim, no delimiter or "data not instructions" framing | **Deferred** — project owner is trusted under current threat model; worth a follow-up issue if source ever becomes less trusted |
| 4 | Correctness | Warning | `ConfigParseError.path` named differently than a spec example | **Accepted** — internally consistent across tests and handler |
| 5 | Correctness | Warning | `repairProjectConfig` walks top-level + 1 level (spec suggests "anywhere") | **Accepted** — two levels covers the actual config shape (`project:` + `verification:` top-level siblings + `project.*` children); deeper nesting has no known use case |
| 6 | Correctness | Warning | Re-install on pre-corrupt config throws raw parse error without doctor hint | **Accepted** — install is exempt from preflight; the parse error from yaml library is not a `ConfigParseError`. Follow-up possible |
| 7 | Correctness | Warning | `instructions.ts` double-loads config (preflight + own load) | **Accepted** — microseconds; single cached load |
| 8 | Quality | Warning | No direct unit test for `VerificationConfigSchema.strict()` rejection | **Deferred** — integration tests exercise the contract via `/metta-init` flow; unit tests would be tighter but not blocking |
| 9 | Quality | Warning | `config-writer.test.ts` comment-preservation asserts substring instead of exact-preceding-line | **Accepted** — substring is enough to prove comments survived |

## Final state

- Full test suite: 838/838 (includes new parity test)
- `npx tsc --noEmit` clean
- `diff -q` confirms byte-identical SKILL.md and metta-verifier.md pairs
- No critical issues; 1 warning fixed, rest accepted/deferred
