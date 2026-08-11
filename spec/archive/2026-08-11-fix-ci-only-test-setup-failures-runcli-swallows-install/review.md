# Review: fix-ci-only-test-setup-failures-runcli-swallows-install

Three parallel reviews (correctness, security, quality) of the diff vs main. No critical or major issues.

## Verdicts

| Reviewer | Verdict |
|---|---|
| Correctness | PASS |
| Security | PASS |
| Quality | PASS |

## Correctness (PASS)

- `runCli` contract preserved: marker string byte-identical (newline-join + `signal=... ?? 'unknown', timeout=...ms`), kill detection equivalent, resolve-on-failure and `?? 1` coercion preserved; edge cases (code 0 error, killed with code 0) traced identical.
- `runCliOrThrow` throws on exactly `code !== 0 || signal !== null || killed === true`; no path lets a non-CliSetupError escape (`execCliRaw` owns the sole try/catch; formatters are throw-free).
- `installFixture` post-check sound: gitInit default logic correct, args threaded into diagnostics, no race, correct path join.
- All 147 migrations byte-mechanical; every remaining bare install site outside `cli-install.test.ts` verified result-captured (`cli-version-drift.test.ts:38,166`, `cli-metta-guard-bash-integration.test.ts:606,623,625` — incl. an idempotency re-install correctly left alone). No test relied on silent install failure.
- All 6 spec requirements satisfied (table in reviewer report); `git diff main --stat -- src/` empty.
- MINOR (no fix needed): non-numeric exec `code` (e.g. 'ENOENT') now normalizes to 1 instead of leaking a string — type-soundness improvement, unreachable today; spec's "full stderr/stdout" vs 8 KiB message tails is a documented design refinement (full streams on error fields).

## Security (PASS)

- No injection surface: single `execFile` path with args array, no `shell: true`; `installFixture` args built only from a boolean.
- Error-message stream tails bounded at 8192 bytes; CI-log exposure no worse than the CLI's own output.
- Temp-dir handling sound (`mkdtemp`, mode 0700, `rm` non-symlink-following); TOCTOU in test-owned dirs not exploitable.
- `process.env.CI` misuse fail-safe (worst case: slower serial local run).
- No new deps, network, or privileges — Node builtins only.
- MINOR: byte-boundary `tail()` can bisect a UTF-8 char (cosmetic); `CI=0` treated as CI-on (conservative direction).

## Quality (PASS)

- Strict-mode clean, naming/import conventions followed, `catch (err: unknown)` with narrow structural cast.
- `CliSetupError` well-formed (override readonly name, typed readonly fields, shared diagnostic formatter).
- Comments accurate: tsx contract comment retained with rationale; vitest comment explains why + `CI=1 npm test` repro.
- New helper tests: temp-dir isolation with retry cleanup, `rejectionOf` helper, field + message assertions; effectively deterministic timing tests (both kill outcomes satisfy assertions).
- Migrations uniform: exactly 147 `installFixture` sites, import-only additions, zero formatting churn.
- MINOR suggestions (not blocking): unused `gitInit: false` branch untested; `verifyInstallWrote`'s timeoutMs only decorative in its diagnostic; 8 KiB tail truncation unexercised by tests; follow-up candidate — migrate silent setup-phase `propose`/`quick` runCli calls to `runCliOrThrow`.

## Disposition

All three reviewers PASS with only MINOR, non-blocking notes. No fix iteration required. Follow-up candidates recorded (non-install setup-call sweep; process-cost reduction from research).
