# Review: metta-backlog-done-subcommand

Three reviewers ran in parallel.

## Correctness — PASS
- Branch ordering, `archive()` metadata append, `assertSafeSlug` on all 4 BacklogStore entry points, CLI + store defense-in-depth for changeName, exit-4 on not-found/invalid, JSON shape, git graceful skip, skill byte-identity — all confirmed.
- Minor: JSON emits richer shape `{archived, shipped_in, committed, commit_sha}` vs spec's literal `{archived}`. Accepted — superset is fine.

## Security — PASS
- Path traversal via slug: covered by `assertSafeSlug` on every path-touching method.
- changeName validation both at CLI and store (belt-and-suspenders).
- `execFile` argv form — no shell interpolation.
- SLUG_RE constraint prevents format-breaking injection into the `**Shipped-in**` line.

## Quality — PASS_WITH_WARNINGS → applied
- Warning 1 (dedup SLUG_RE across 3 files): **Applied**. Extracted to new `src/util/slug.ts` with `SLUG_RE` + parameterized `assertSafeSlug(slug, label)`. All three consumers (issues-store, backlog-store, cli/commands/backlog) now import from there; local helper becomes a thin label-wrapper.
- Warning 2 (archive-then-commit shape duplicated with fix-issue): **Deferred** — YAGNI until a third consumer appears.
- Suggestion 3 (stronger commit-message test): **Applied**. Added `git show --stat HEAD` assertion confirming both `spec/backlog/qux.md` (deletion) and `spec/backlog/done/qux.md` (addition) appear in the commit.
- Suggestion 4 (skill wording re: slug-shaped changeName): **Deferred** — skill already runs through the CLI guard which errors clearly; explaining the constraint in-skill would add noise.
- Suggestion 5 (Commander's default `missing required argument`): accepted as-is; matches the pattern of other metta subcommands with required slugs.

## Verdict
All three reviewers PASS after fixes. Store tests: 24/24 on the new shared util.
