---
priority: low
---
# Five src-side test files still live outside tests/: src/config/build-stamp.test.ts, src/config/config-writer.test.ts, src/config/repair-config.test.ts, src/config/version-drift.test.ts, src/finalize/finalize-lock.test.ts. PR #86 excluded src test files from the tsc build (no more dist pollution) but the repo convention keeps tests under tests/ near 1:1; relocating restores convention consistency. Mechanical move + import-path rewrite.

**Captured**: 2026-08-17
**Status**: logged
**Severity**: minor

Five src-side test files still live outside tests/: src/config/build-stamp.test.ts, src/config/config-writer.test.ts, src/config/repair-config.test.ts, src/config/version-drift.test.ts, src/finalize/finalize-lock.test.ts. PR #86 excluded src test files from the tsc build (no more dist pollution) but the repo convention keeps tests under tests/ near 1:1; relocating restores convention consistency. Mechanical move + import-path rewrite.
