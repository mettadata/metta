# Research Synthesis — fix-repo-wide-duplicate-requirement-scan

Two approaches evaluated (see `research-replicate-pr76-method.md`, `research-hand-edit-locks.md`).

## Approach A — Replicate the PR #76 statusline repair method

Dedupe spec.md via verified line-range deletion; regenerate each `spec.lock` through the project's own code path (`parseSpec` + `SpecLockManager.update()` run via tsx); regenerate CLAUDE.md counts with `metta refresh`. Proven once already on `claude-statusline`; produces schema-validated locks and an unchanged-per-requirement-hash evidence trail.

## Approach B — Hand-edit the lock YAML

Rejected: the lock's top-level `hash` is a parser-computed content hash that cannot be correctly produced by hand, and hand-editing bypasses the StateStore's Zod validation ("no unvalidated state writes"). Strictly dominated by Approach A.

## Pre-verified facts (this change)

- All duplicate requirement blocks in the three files are **byte-identical** to their first occurrence (differences limited to trailing blank lines) — confirmed by diff before any deletion.
- Expected post-repair unique requirement counts: `fix-issues-command` 4, `install-init` 9, `user-stories` 7.
- Corrupted locks currently mirror the duplication (e.g. install-init lock lists `init-command-drives-discovery` twice), so lock regeneration is mandatory, not optional.
- No TypeScript source changes required; merger guard at `src/finalize/spec-merger.ts:177` already prevents recurrence at the append path.

## Recommendation

**Approach A.** It is the proven, constitution-compliant path with the strongest verification story. The optional duplicate-requirement gate stays out of scope (backlog candidate) per intent.md.
