# Review: fix-roadmap-entry-lifecycle-dangling-entries

Three parallel reviews (correctness, security, quality) — round 1 on the full diff (main...HEAD).

## Verdicts

| Reviewer | Verdict |
|----------|---------|
| Correctness | PASS_WITH_WARNINGS |
| Security | PASS_WITH_WARNINGS |
| Quality | PASS |

No critical findings. Loop exited after 1 iteration; all warnings resolved in follow-up commit 991f5ed02.

## Independently verified by reviewers

- Plan/mutate `next` correctness: middle-entry activation order-preserving with canonical renumbering, one write/one commit; `--prune` structurally inert with no candidate; warnings in both output modes; position-disambiguation edge cases (0, negative, all-digit) behave per ADR-1.
- Auto-retire same-commit atomicity pinned via `git show --name-status`; conditional staging correct; fail-open retire leaves nothing staged (R6); retire duplicate-tolerant.
- Injection/traversal clean: no path construction from user targets, commit messages embed store-validated slugs only, execFile arg arrays, roadmap slugs double-guarded (ENTRY_RE/Zod + assertSafeSlug in issuesStore).
- JSON strictly additive across all three commands (verified against main); 3 MODIFIED spec names verbatim; ADR-3 supersession citations verified against the archive (untouched); `removeTop` swept to zero; ADR-8 read-only exclusion consistent everywhere (minor issue NOT absorbed).
- Test fixture deviation (`commitDanglingRemoval()` helper) reviewed and judged sound.

## Warnings and resolutions (commit 991f5ed02)

- **Security W1** — catch-all `issuesStore.show` failure classified entries as dangling: a parse failure or EACCES on an EXISTING issue file would be warned as "not found" and, under `--prune`, deleted in a commit. → `next` now checks `issuesStore.exists()` first; only confirmed absence is dangling/prune-eligible; other errors propagate. Two pinning tests (malformed file, with and without `--prune`).
- **Correctness W1** — `roadmap remove` missing from the guard's BLOCKED_TWO_WORD set, mint SKILL_SCOPES, and the metta-roadmap SKILL.md — the remedy `next` prints could not be executed in AI sessions (guard fails closed). → All three surfaces extended (template + byte-identical deployed copies, `cmp`-verified); guard tests extended (missing-credential / scoped-allow / out-of-scope-block); integration scope-array test updated.
- **Security W2** — retire-hit + pre-dirty `spec/roadmap.md` folds user edits into the archive commit. → Accepted and recorded in design.md Risks (whole-file canonical write is the pre-existing store contract; archive commit inspectable), with pointer comments at both staging sites.
- **Security S1** — prune commit subject records only a count. → Pruned slugs now listed in the commit body.
- **S2** — `remove <target>` help text now states the all-digit-is-position rule.

## Follow-ups (not logged as issues)

- Duplicate-slug asymmetry across primitives (`remove` first-match vs `removeSlugs`/`retire` all-match) — documented per-primitive; duplicates only arise from hand edits (`add` rejects them).

## Accepted residuals (pre-existing)

- `StateStore.writeRaw` non-atomic writeFile (crash truncation risk, git-recoverable) — store-wide.
- `fix-issue --remove-issue` unguarded off-main + `spec/issues` directory pathspec sweep — documented inherited posture (ADR-7).
