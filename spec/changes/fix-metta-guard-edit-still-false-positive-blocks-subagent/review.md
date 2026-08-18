# Review: fix-metta-guard-edit-still-false-positive-blocks-subagent

Three parallel reviews (correctness, security, quality) — round 1 on the full diff (main...HEAD).

## Verdicts

| Reviewer | Verdict |
|----------|---------|
| Correctness | PASS |
| Security | PASS_WITH_WARNINGS |
| Quality | PASS_WITH_WARNINGS |

No critical or major findings. Review loop exited after 1 iteration (no fail-closed findings; warnings were doc-level and addressed in follow-up commit 6448def52).

## Independent verification performed by reviewers

- Red-run independently reproduced twice (correctness and quality): the pre-fix hook from `main` exits 2 on the exact inverted fixture the R1 test asserts exit 0 for — the regression suite genuinely catches the original defect (R6/US-3).
- `deriveProbeRoot` exercised against 11 path-math edge cases (worktree named `worktrees`/`.metta`, `<H>/.metta/worktrees` itself, nested worktrees, root-degenerate paths, near-misses) — all correct; non-recursive nesting behavior matches design Risk 3 scope.
- Superset claim verified in CLI source (`src/cli/helpers.ts`, `ArtifactStore.discoverChanges`): host-root status aggregates worktree-hosted state with the same presence criterion, so host-visible is a strict superset in both allow and block directions.
- Symlink borrowing defeated: `toPhysicalPath` before `git rev-parse` means a symlink inside `.metta/worktrees/` pointing at an external repo cannot borrow the host's change.
- Byte-identity (template vs `.claude` mirror), R5 invariants (allow-lists/outside-root on `projectRoot`), all four R4 fail-open modes, ADR-4 spec edits, and the recorded ADR-5 Rule-1 deviation all verified sound.

## Warnings and resolutions

- **Security W1** — design Risk 3 understated the metta-host crafted-layout case (repo planted at `<X>/.metta/worktrees/` borrows X's change — allowed, not fail-opened; same trust domain). → Documented honestly in design.md (commit 6448def52).
- **Security W2 / Correctness suggestion** — ADR-3 name-match hardening claimed "logged as backlog candidate" but no entry existed. → Logged as issue `guard-edit-worktree-name-match-hardening-follow-up` (minor/low) in the main checkout; design.md now references the slug.
- **Quality W1** — real-CLI suite adds ~55s to every full test run. Accepted cost per design Risk 5; noted for future gating if it grows.
- Comment-precision items (unreachable `hostRoot !== mettaDir` conjunct comment, dead `demoWorktree` shim branch comment, ADR-5 implementation note) → fixed in 6448def52.

## Deferred / follow-ups

- Issue `guard-edit-worktree-name-match-hardening-follow-up`: cross-change/stale-worktree writes allowed while any change is active at the host (ADR-3 accepted residual).
- Suggested but not required: symlink-inside-worktrees pin test; deterministic init-phase assertions (pre-existing); stale runHook comment (pre-existing).
