# Review — fix-flaky-ci-test-teardown-enotempty-rmdir-race-temp-git

Review iteration #1. Three lenses applied to commits `3c98965c0` (fix) + summary.
Note: reviewers ran inline in the skill-host context (subagent spawn cap reached);
same checklists as the metta-reviewer persona.

## Correctness reviewer — PASS

- Diff audit (`git diff --unified=0`): every changed line in `tests/` and `src/`
  is an `rm(`/`rmSync(` call — no string literals, templates, or unrelated
  option objects were touched by the mechanical replacement.
- No remaining recursive `rm`/`rmSync` without `maxRetries` in any test file
  (verified by grep); non-recursive single-file removals correctly left alone.
- `fs.rm`/`fs.rmSync` both document `maxRetries`/`retryDelay`, retrying
  `ENOTEMPTY`/`EBUSY`/`EMFILE`/`ENFILE`/`EPERM` — exactly the observed failure class.
- Checked for hazards: no `vi.mock('node:fs')`, no spies asserting rm options,
  no `vi.useFakeTimers()` anywhere in the suite (retry backoff cannot hang on
  mocked timers). Full suite green post-change (2053/2053).

## Security reviewer — PASS

- CI change only sets two additional local `git config --global` values on the
  ephemeral runner; no new permissions, secrets, or network behavior.
- No production code touched; no state writes bypassing schemas.
- Worst-case failure mode of retry options is a bounded ~500ms extra teardown
  delay per erroring cleanup — no unbounded retry loop.

## Quality reviewer — PASS_WITH_WARNINGS

- ci.yml comment explains the why (auto-gc race) — good.
- Warning (non-blocking): the retry options are duplicated across 81 files
  rather than centralized in a shared teardown helper. Consistent with the
  existing per-file teardown convention and explicitly declared out of scope
  in intent.md ("Restructuring test temp-dir management"). Acceptable.

## Verdict

No critical issues. PASS / PASS / PASS_WITH_WARNINGS → review loop exits at iteration 1.
