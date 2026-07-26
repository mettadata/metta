# template-version-drift-detection-consumer-projects-stamp — Review (Round 1)

Merged from `review/correctness.md`, `review/security.md`, `review/quality.md`.

## Verdicts

| Reviewer | Verdict |
|----------|---------|
| Correctness | PASS |
| Security | PASS_WITH_WARNINGS |
| Quality | PASS_WITH_WARNINGS |

No critical findings in any review.

## Correctness (PASS)

All 19 spec scenarios across 5 requirements traced to code and passing tests (192 unit + 45 integration, all green). Reader never throws (double-wrapped in hook); exact-string comparison handles empty/whitespace/non-string stamps; the two preAction gates are independent, phase (b) byte-identical to main; outputJson merge fully guarded; stamp ordering satisfies setProjectField's ENOENT contract; doctor check structurally cannot fail the run. Minor notes: doctor's "run metta install" remedy misleading on corrupt config; install/init fail loudly on corrupt configs without the `doctor --fix` hint (design-accepted); downgrade drift covered only at unit level; pre-existing `update` double-outputJson emission would carry the drift key twice.

## Security (PASS_WITH_WARNINGS)

- **Major (fix before ship, single fix point):** `installed_version` from untrusted `.metta/config.yaml` returned verbatim by `readInstalledVersion` (no charset/length bound) and interpolated raw into (1) the stderr warning in the preAction hook and (2) doctor's terminal output via `templateFreshnessCheck`. Hostile config can inject ANSI/OSC escapes, forged output lines, or megabyte strings. Fix: validate in `readInstalledVersion` against `/^[0-9A-Za-z.+-]{1,64}$/` (treat invalid as absent).
- Minor: unbounded string size into JSON payloads; second config parse per invocation (yaml@2 defaults safe); empty-string stamp yields cosmetically broken warning (resolved by the same validation).
- Clean: YAML parse safety, path handling, write path, git invocations, no secrets.

## Quality (PASS_WITH_WARNINGS)

Four minors: (1) `version-drift.js` missing from the `src/index.ts` barrel while sibling config modules are exported; (2) `resetVersionDrift` is a test-only seam (documented ADR-2, acceptable); (3) integration fixtures exercise only the upgrade direction; (4) spec's "exit code 3" example exercised with exit 4 (invariant still tested). Conventions clean; no dead code; all spec scenarios covered.

## Round 1 disposition

Fix now (before verification):
1. Sanitize/validate `installed_version` in `readInstalledVersion` (security majors + empty-string cosmetic minor).
2. Add `version-drift.js` to the `src/index.ts` barrel (quality consistency minor).

Accepted as-is (documented): test-only reset seam; upgrade-only integration fixtures (downgrade unit-covered); exit-code example variance; pre-existing update double-emission (out of scope, pre-existing).

# Round 2 (post-fix)

Fixes applied: 662c1c48c (VALID_STAMP charset/length bound in readInstalledVersion + 5 adversarial tests), 4253c13fb (version-drift barrel export).

| Reviewer | Verdict |
|----------|---------|
| Correctness | PASS |
| Security | PASS (both round-1 majors closed; regex anchored, all three sinks downstream of the validated read boundary) |
| Quality | PASS |

Non-blocking notes carried forward: schema-side `.max(64)` defense-in-depth suggestion; upgrade-only integration fixtures; test-only reset seam.
