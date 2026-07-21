# Test Gate Report — uat-document-generation-at-finalize-every-finalized-change

GATE: PASS

## Full suite (`npm test`)

| Metric | Value |
|---|---|
| Test files | 90 passed (90) |
| Tests | 1525 passed (1525) |
| Failures | 0 |
| Duration | 271.13s (transform 30.25s, collect 79.63s, tests 1491.82s, prepare 26.53s) |

## Targeted new/changed suites (`npx vitest run ...`)

| Suite | Tests | Result | Duration |
|---|---|---|---|
| tests/uat-template-contract.test.ts | 6 | pass | 59ms |
| tests/config-loader.test.ts | 17 | pass | 172ms |
| tests/uat-generator.test.ts | 22 | pass | 294ms |
| tests/finalizer.test.ts | 18 | pass | 627ms |
| tests/cli-finalize.test.ts | 6 | pass | 71.35s |
| **Total** | **69 passed (69)** | **5 files passed (5)** | 72.70s overall |

Notable cli-finalize.test.ts coverage observed in output:
- finalize exit-code ordering: spec-merge conflict exits 2; incomplete artifact exits 3 and names the artifact
- finalize UAT output: success JSON carries `uatPath` into archive + human UAT script line; `uat.enabled false` yields `uatPath: null` with no `uatWarning`; degraded path emits `uatWarning` with success shape and exit 0 (human warning on stderr); error payloads unchanged (exit 3, no `uatPath`)

## Failures

none
