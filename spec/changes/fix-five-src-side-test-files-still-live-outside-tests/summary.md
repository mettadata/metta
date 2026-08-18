# Implementation Summary — fix-five-src-side-test-files-still-live-outside-tests

## What changed

Mechanical relocation of the five remaining src-side test files to tests/ (repo convention), restoring convention consistency after PR #86 removed dist pollution but left the files in place. Commit `bf6f9ac3eb13a8f87e028bba4e96c2289a2a267e`.

Moves (git mv, history preserved at 96-99% similarity):
- src/config/build-stamp.test.ts → tests/build-stamp.test.ts
- src/config/config-writer.test.ts → tests/config-writer.test.ts
- src/config/repair-config.test.ts → tests/repair-config.test.ts
- src/config/version-drift.test.ts → tests/version-drift.test.ts
- src/finalize/finalize-lock.test.ts → tests/finalize-lock.test.ts

Diff beyond renames: exactly one relative-import rewrite per file (5 insertions, 5 deletions), `.js` extensions preserved. `tests/build-stamp.test.ts:211` retains its `process.cwd()`-anchored scripts/ path (verified relocation-safe). Per the intent's explicit scope call, tsconfig's src-test exclusion (dist-pollution guard) and vitest's src include (stray tests still run) are both retained — zero config changes, zero test-logic changes.

## Gate results (implementation phase)

| Gate | Result |
|------|--------|
| Five relocated suites | 74/74 pass |
| npx tsc --noEmit | clean |
| npm run build | OK; 0 *.test.* files in dist/ |
| Full npm test | 2439/2439 pass, 129 files |
