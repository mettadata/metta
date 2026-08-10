# Implementation Summary — fix-automatic-versioning-release-capability-metta

## What was built

A version/release capability for metta-consuming projects, per design.md's release-on-demand architecture (candidate 1 from the issue RCA, standalone CLI + skill):

- **Pure core** (`src/release/`): strict semver parse/bump, conventional-commit bump derivation (fix→patch, feat→minor, breaking→major), changelog release grouping.
- **Edges**: product version file reader/writer, Zod-validated `spec/releases.yaml` record store, git release-tag helpers, `gh` release module with graceful degradation, version-anchored changelog rendering in DocGenerator.
- **Pipeline**: `ReleasePipeline` orchestrating bump → version write → changelog → releases record → commit → annotated tag, with step records; barrel exports.
- **CLI**: `metta release` (default `status` subcommand: version, last tag, commits since, recommended bump, unreleased count) and `release cut [--bump] [--yes] [--github] [--dry-run] [--json]`. Never pushes — prints the manual `git push --follow-tags` command.
- **Trust model**: guard + mint hook entries for release commands (both hook copies, byte-identical); `metta-release` skill (template + deployed).

## Batches

All 14 tasks across 5 batches landed as atomic commits (Batch 1: `35cd1a404`, `6cbb47f06`, `cd7d05490`+`e443283b0`, `6c08cfc22`; Batch 2: `c7a6e37de`, `f83c9db6d`, `a6f26a738`, `3992ba1df`, `0bdc0bde7`; Batch 3: `11d9e69f1`, `cce238ae1`; Batch 4: `af961d1d4`; Batch 5: `18b872750`).

## Gates

`npm test` 115 files / 2035 tests pass; `npx tsc --noEmit` clean; `npm run build` clean with `dist/templates/skills/metta-release/SKILL.md` and updated hook templates present.

## Notes

- Cut exit codes: aborted/failure → 1; validation/config errors → 4 via `handleError`.
- `--github` with `github_release: false` fails fast before any mutation.
- Non-TTY without `--yes` aborts cleanly (fail-closed).
- Implementation resumed mid-change after a fork interruption; Batches 1–4 were verified commit-by-commit before Batch 5 was built on top.
