# Summary: fix-set-up-github-ci-metta-repo-no-ci-currently-exists

## What changed

Added `.github/workflows/ci.yml` — the metta repo's first server-side CI. The workflow runs on every `pull_request` and on `push` to `main`, with minimal permissions (`contents: read`) and a per-ref concurrency group that cancels superseded runs.

- **Job `gates`** (ubuntu-latest, Node 22, npm cache): `npm ci` -> `npm test` (vitest) -> `npx tsc --noEmit` -> `npm run build` — a one-for-one server-side mirror of the local metta gates.
- **Job `audit`** (parallel): `npm ci` -> `npm audit --audit-level=high` — surfaces high-severity dependency alerts without failing on low/moderate noise.

## Local gate results at implementation time

- `npm test`: 1859 passed across 103 files, 0 failures
- `npx tsc --noEmit`: clean
- `npm run build`: success

Implementation commit: `77bc5b0db` (workflow file only).

## Notes

- No source code, gate templates, or npm scripts changed — new file only.
- `.github/dependabot.yml`'s existing `github-actions` ecosystem entry becomes active once this lands.
- Branch protection / required status checks remain a follow-up once CI is proven green.
