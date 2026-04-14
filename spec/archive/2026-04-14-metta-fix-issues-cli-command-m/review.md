# Review: metta-fix-issues-cli-command-m

Three reviewers ran in parallel.

## Correctness — PASS_WITH_WARNINGS → applied
- Branch order, archive exists-guard, severity sort, exit codes, commit format all correct.
- Warning: `--all` empty-list JSON missing `severity_filter` key — **applied**, now emits `{issues: [], severity_filter: options.severity ?? null}`.
- Minor: hardcoded `'logged'` status — accepted per design (Issue.status is literal `'logged'`, brittle if widened but correct today).

## Security — NEEDS_CHANGES → applied
**Critical**: slug was not validated → path traversal via `--remove-issue '../../etc/passwd'` would archive+delete arbitrary files within or outside `spec/issues/`. `IssuesStore.exists/show/archive/remove` used raw slug in `join()` with no sanitization.

**Fix applied**: added `SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/` and `assertSafeSlug()` in `src/issues/issues-store.ts`. All four external methods (`show`, `exists`, `archive`, `remove`) now call `assertSafeSlug(slug)` first, throwing `Error('Invalid issue slug ... — must match ...')` on any violation. Added `tests/issues-store.test.ts` case that exercises all four methods with 6 hostile inputs (`../escape`, `..\\escape`, `/abs/path`, `a/b`, `Foo`, empty string).

Pass-through on `execFile` argv form (no shell injection) reconfirmed safe.

## Quality — PASS_WITH_WARNINGS → applied
- Faithful mirror of fix-gap, no over-copying, severity taxonomy correctly diverged.
- Warning: duplicate skill line 107/108 — **applied**, dropped.
- Deferred: extracting a `runFixCommand()` helper between fix-gap and fix-issue — YAGNI until a third consumer.
- Accepted: hardcoded `Status: logged` in single-slug branch (see correctness section).

## Verdict
All three reviewers PASS after fixes. Full suite: 349/349 (+1 traversal test).
