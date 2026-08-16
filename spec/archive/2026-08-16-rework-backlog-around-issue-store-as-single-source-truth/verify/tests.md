# Gate: tests — PASS

- Command: `npm test` (vitest run)
- Test files: 127 passed (127)
- Tests: 2292 passed (2292)
- Duration: 376.14s (transform 33.76s, collect 95.67s, tests 2852.76s cumulative)
- Failures: none

Backlog/issue-store coverage observed passing in `tests/cli-issue-backlog.test.ts` (50 tests), including: `backlog add --new` idea minting, slug-collision rejection (active and resolved), `backlog list` sorted by priority and never reading `spec/backlog/`, `backlog show/promote/done` (archive to `spec/issues/resolved/`, Shipped-in stamping, conventional commit), `backlog migrate` (convert + archive + idempotent no-op + collision reporting), and branch-safety guards for issue/backlog commands.
