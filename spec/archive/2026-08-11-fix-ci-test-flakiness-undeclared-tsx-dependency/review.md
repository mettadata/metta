# Review: fix-ci-test-flakiness-undeclared-tsx-dependency

Three-pass review of implementation commits d28708446, 182739d41, aef8d8100,
a2c457e6a (diff vs main).

## Correctness review — PASS

- `runCli` kill-marker condition (`killed === true || signal non-null`) fires
  only for killed subprocesses; ordinary nonzero CLI exits (asserted routinely
  by tests) have `killed=false, signal=null` and get no marker — no false
  positives across existing call sites. Return shape and default 10s timeout
  unchanged; optional `timeoutMs` param is backward compatible.
- Guard test semantics verified: 1ms timeout deterministically kills the
  subprocess after spawn (execFile timer), marker asserted on stderr including
  `timeout=1ms`; version regex matches `^4.23.12`.
- Evidence: `npx tsc --noEmit` clean; `tests/cli-status.test.ts` 36/36;
  `tests/cli-runtime-declared.test.ts` 2/2.

## Security review — PASS

- tsx added as dev-only dependency, locked (`tsx@4.23.12`); transitive esbuild
  requirement already satisfied by existing locked `esbuild@0.28.1` — minimal
  new supply-chain surface, none at production runtime.
- `execFile` with array args (no shell interpolation); marker string embeds
  only signal name and numeric timeout — no injection vector. Temp dirs
  cleaned with `rm(..., { recursive, force })`.
- No secrets, no network calls added; the change removes a network dependency
  from the test path.

## Quality review — PASS_WITH_WARNINGS

- Comments explain the invariant (tsx must stay declared) and the why of the
  marker; conventional commits; docs (`spec/project.md`, `CLAUDE.md`)
  reconciled — `grep` confirms no stale "not currently part of the dev loop"
  text survives.
- Warning (accepted, out of scope per design): ~18 test files exec
  `npx tsx` directly instead of using the shared helper; they are fixed by the
  dependency declaration but do not get the kill marker. Consolidation is a
  backlog candidate.
- Warning (minor): `tests/cli-runtime-declared.test.ts` is a repo-level guard
  with no 1:1 src counterpart — acceptable for infra guard tests.

## Verdict

PASS / PASS / PASS_WITH_WARNINGS — no critical issues; no fix loop required.
