# Review — fix-json-output-c1-control-passthrough-json-stringify

Iteration 1 — commits 99d49ac (helper) + ac67dd902 (edge wiring). Three parallel reviewers.

| Reviewer | Verdict |
|----------|---------|
| Correctness | PASS |
| Security | PASS_WITH_WARNINGS |
| Quality | PASS_WITH_WARNINGS |

No critical or major findings. Correctness verified regex exactness, lowercase hex formatting, idempotence, structure safety (keys covered), exact three-edge wiring with no missed stdout site, scalar branch untouched, no double-escaping with text-mode sanitizers. Security independently audited all 20 src stringify sites, fuzzed the helper (toJSON injection, C1 keys, lone surrogates, backslash adjacency, 200 random hostile strings — zero leaks/corruption), confirmed C0/UTF-16 reasoning and no ReDoS.

## Warnings and disposition

1. (Security, pre-existing residuals outside this change's spec) Text-mode/stderr C1 vectors: install.ts:151 stderr warning, config.ts:59 scalar branch, helpers.ts:266-276 text-mode error paths. Disposition: logged as follow-up issue `text-mode-stderr-c1-sanitization-residuals-1-src-cli` (commit a0d56cf) before ship, per research recommendation.
2. (Quality, planning-scoped coverage gap) Three spec scenarios (error envelopes, config get edge, tasks renderer edge) covered structurally (shared helper unit tests + one-line wiring) rather than by dedicated end-to-end hostile tests — tasks.md deliberately scoped tests this way. Disposition: accepted; spec scenario wording satisfied by construction per the coverage verifier.
3. (Informational) Latin-1 terminal continuation-byte display quirk — unfixable without breaking byte fidelity; acceptable for a UTF-8 threat model.

Review loop clean on iteration 1 — exit.
