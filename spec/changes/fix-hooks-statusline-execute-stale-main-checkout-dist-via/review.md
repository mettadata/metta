# Review: fix-hooks-statusline-execute-stale-main-checkout-dist-via

Iteration 1 — 3 parallel reviewers (correctness, security, quality). Commits reviewed: ae0f1e6d4, b9cbee3f0, bbcb97cee, 8fbc89472.

## Verdicts

| Reviewer | Verdict | Critical | Major | Minor |
|----------|---------|----------|-------|-------|
| Correctness | PASS_WITH_WARNINGS | 0 | 0 | 5 |
| Security | PASS_WITH_WARNINGS | 0 | 0 | 3 |
| Quality | PASS_WITH_WARNINGS | 0 | 1 | 4 |

No critical issues. Loop exits after iteration 1.

## Cross-confirmed findings (fixed post-review)

1. **major (quality) / minor (correctness)** — `src/ship/merge-safety.ts:44-49`: missing `package.json` in the target checkout reported as `rebuild-dist: fail` ("dist is now stale") — false alarm on every successful ship of a non-npm project, plus the hard-coded npm WARNING in `ship.ts`. Should be `skip` with detail, like the no-build-script case; reserve `fail` for corrupt JSON and build-command failure.
2. **minor (quality + correctness)** — `src/ship/merge-safety.ts:68`: `exec('npm run build')` uses the default 1 MB maxBuffer; a chatty build gets killed and misreported as a build failure. Bump maxBuffer.
3. **minor (quality)** — `src/ship/merge-safety.ts:266`: `this.gateRegistry!` non-null assertion; hoist a local instead (strict-mode style, no other `!` in file).

## Accepted / deferred findings (not fixed in this change)

- **security minor (pre-existing)** — `src/ship/merge-safety.ts:25-28`: the legacy `git()` helper shell-interpolates branch names into `exec`; new code correctly used `execFile` arg arrays / constant strings. Follow-up issue recommended to migrate `git()` to `execFile`.
- **security minor** — `build-stamp.ts:489`: for npm-installed metta nested under an unrelated git repo, `git -C packageRoot rev-parse HEAD` can compare against the wrong repo — spurious warn, display-only.
- **correctness minor** — 40-hex SHA-1 regex means SHA-256 repos always stamp `commit: null` (cosmetic today); non-ancestor stamp commits are still labeled "behind HEAD" (wording only); emit-script "never fails the build" comment overstates (covers git absence, not unwritable dist).
- **quality minor** — `build-stamp.test.ts:334` locates the emit script via `process.cwd()`; mtime fallback hardcodes `dist/cli/index.js` (matches `bin` today, cross-ref comment suggested).
- **suggestions** — Zod-parse the ship-side package.json read instead of a cast; doctor still prints "All checks passed." on warn-level drift (pre-existing warn semantics); ship JSON mode surfaces rebuild failure only inside `steps[]`.

## Security confirmations

- `dist/.build-stamp` is Zod-validated at read (40-hex-or-null commit), never fed to a shell; injection-shaped input covered by test.
- New git invocations use `execFile` with arg arrays; ship rebuild command is a constant string with `cwd` as an option.
- No secrets/env leakage in error surfaces; no new destructive git operations.
