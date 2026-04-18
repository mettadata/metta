# Review: fix-issue-metta-refresh-leaves-claude-md-uncommitted-metta-r

Three parallel reviewers: correctness, security, quality.

## Combined verdict: PASS_WITH_WARNINGS

No critical issues. Proceed to verification.

## Reviewer findings

### Correctness — PASS_WITH_WARNINGS

- **Major** — tests 2 and 3 in `tests/refresh-commit.test.ts` bypass the Commander action handler (they call `runRefresh` / `autoCommitFile` directly), so the `options.commit !== false` flag gate is not actually exercised end-to-end. A mis-wired flag would still pass these tests. Manual `npm test` / `tsc` / `lint` / `build` gates all green (562/562), and the gate condition matches the Commander `--no-*` convention, so the wiring is correct in fact — the test coverage is just indirect. Deferred as a follow-up enhancement rather than blocking.
- **Minor** — `commit_reason` is `undefined` when the user passes `--no-commit`, so the JSON output drops the field silently. Machine consumers cannot distinguish "opted out" from "suppressed for other reason." Not fixed in this change; noted for a follow-up.
- **Minor** — prose in `src/templates/skills/metta-init/SKILL.md:155` previously said "run `metta refresh`" while the code fence used `--no-commit`. **Fixed** — prose updated to match.

### Security — PASS_WITH_WARNINGS

- **Low** — `autoCommitFile` surfaces raw `git commit` stderr via `commit_reason` (e.g. hook failure messages, gpg-sign errors). Could leak local paths or hook diagnostic output in structured JSON consumed by logs/CI. Not exploitable; noted for hardening.
- **Low** — `git status --porcelain` parser in the helper is brittle against filenames containing spaces, `->`, or non-ASCII. Could under-report "other dirty" files. Correctness concern rather than security; out of scope for this change.
- **Informational** — no symlink / path-traversal guard on `filePath`, but `runRefresh` always computes it as `join(projectRoot, 'CLAUDE.md')` from `process.cwd()`, so there is no attacker-controlled input in this change. Flagged only for any future reuse of `autoCommitFile` with arbitrary paths.
- All other checks clean: `execFile` argv arrays (no shell), only `CLAUDE.md` is staged (`git add --` with explicit sentinel), no new dependencies, test temp-dir isolation with proper cleanup.

### Quality — PASS_WITH_WARNINGS

- **Warning** — `docs/workflows/skills.md` did not mention the new auto-commit default or the `--no-commit` flag. **Fixed** — both documented in the `/metta-refresh` entry.
- **Warning** — `docs/changelog.md` is auto-generated from `summary.md`; will pick up this change on next `metta docs generate` during finalize. No manual edit needed.
- **Suggestion** — extract commit-result surfacing into a small helper if the action handler grows further. Current ~35-line form is readable; deferred.
- **Suggestion** — end-to-end CLI test via compiled binary to lock the `--no-commit` flag wiring. Deferred (same gap the Correctness reviewer flagged).
- Convention adherence: all green — kebab-case filenames, `.js` import extensions, no CommonJS, no `any`, named `AutoCommitResult` type import (not the inline `import('...')` pattern the tasks.md suggested — the implementer correctly deviated).
- Spec scenario coverage: 6 of 6 spec scenarios have corresponding test coverage.

## Fixes applied during review

| Reviewer finding | Resolution | File |
|---|---|---|
| metta-init prose / code inconsistency | Prose updated to say `metta refresh --no-commit` | `src/templates/skills/metta-init/SKILL.md:155` + deployed mirror |
| `docs/workflows/skills.md` missing auto-commit docs | Added auto-commit and `--no-commit` to `/metta-refresh` entry | `docs/workflows/skills.md:672-688` |

## Deferred items (not blocking)

- Synthesize `commit_reason: 'skipped via --no-commit'` when user opts out (minor JSON ergonomics)
- Sanitize raw git stderr from `commit_reason` to avoid info disclosure (security hardening)
- End-to-end CLI test invoking compiled binary to exercise flag wiring (correctness coverage)
- Harden porcelain parser against special filenames (defense-in-depth)

All deferred items should be logged as follow-up issues if pursued.
