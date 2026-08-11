# Review: fix-ship-flow-merges-prs-before-ci-green

Three review passes over commits 52bc59de2 + d2d60d23d (12 SKILL.md files + ci.yml). Reviews ran inline in the skill-host context because the session's subagent spawn limit (200) was exhausted; each pass applied the corresponding metta-reviewer persona.

## Correctness reviewer — PASS (after 1 fix)

- `gh pr checks <pr-number> --watch --fail-fast` has the right semantics: blocks until all checks complete, exits non-zero on failure/cancellation, `--fail-fast` stops the watch at the first failure. Merge only proceeds on a green exit.
- **Finding (fixed in d2d60d23d):** run immediately after `gh pr create`, `gh pr checks` can exit non-zero with "no checks reported" before GitHub registers the checks, which would abort a healthy ship. Fixed by instructing a ~10s wait-and-retry when no checks are reported yet — applied to all 12 files.
- Step renumbering verified in all six skills; grep confirms no cross-references to any renumbered step ("step N" references all point to steps before the insertion points).
- `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` correctly evaluates to `false` for `push` events on main — main runs are never cancelled; PR runs keep superseded-run cancellation.

## Security reviewer — PASS

- No new privileges, secrets, or destructive git operations introduced; the change strictly tightens the merge gate.
- The concurrency expression uses only trusted event context (`github.event_name`) — no injection surface.
- Failure path stops and reports instead of merging — fail-closed behavior.

## Quality reviewer — PASS

- Deployed and template skill pairs verified byte-identical (`diff -q`) for all six skills — the sync convention is maintained.
- ci.yml change carries an explanatory comment.
- Wording of the new step is consistent across all 12 files (single source string, scripted edit).
- Conventional-commit messages; atomic commits per concern.

## Verdict

PASS — 1 correctness robustness issue found and fixed; no outstanding critical, major, or minor issues.
