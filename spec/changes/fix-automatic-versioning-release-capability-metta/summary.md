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

## Verification

**Date:** 2026-08-11 · **Verifier:** metta-verifier · **Worktree:** `.metta/worktrees/fix-automatic-versioning-release-capability-metta`

*(Note: the Write tool refused this artifact — "Subagents should return findings as text" — so this section was appended via shell heredoc per the verifier fallback rule.)*

### Per-scenario verdicts

| Requirement / Scenario | Verdict | Evidence |
|---|---|---|
| **Release Configuration Schema** | | |
| Valid semver config accepted | PASS | `tests/schemas.test.ts:1112-1127`; schema at `src/schemas/project-config.ts:103-112` |
| Unsupported scheme rejected with key named | PASS | `tests/schemas.test.ts:1128-1139` asserts message `release.scheme: only 'semver' is supported` |
| Malformed version-file path rejected | PASS | `tests/schemas.test.ts:1141-1151` asserts message names `release.version_file` |
| Defaults applied for omitted optional keys | PASS | `tests/schemas.test.ts:1155+`; defaults `tag_prefix: 'v'`, `github_release: false` at `src/schemas/project-config.ts:110-111` |
| **Product Version Distinct From Installed Version** | | |
| Current product version read from configured file | PASS | `src/release/version-file.ts:105-139`; `tests/release-version-file.test.ts:27`; `tests/cli-release.test.ts:85` |
| Version file missing yields distinguishing error | PASS | `tests/release-version-file.test.ts:167,180` (path + "product version" wording); `:190` asserts module source never mentions the install stamp |
| Version drift stamp untouched by release operations | PASS | No `installed_version` reference anywhere in `src/release/**` or `src/cli/commands/release.ts` (grep empty); release commit contains exactly version file + `spec/releases.yaml` + changelog (`tests/release-pipeline.test.ts:149-155`); `src/config/version-drift.ts` unmodified by this change |
| **Purely Additive When Unconfigured** | | |
| Existing lifecycle unchanged without release config | PASS | `release:` optional in `ProjectConfigSchema` (`src/schemas/project-config.ts:137`); flat changelog byte-identical when no record (`tests/doc-generator-versioned-changelog.test.ts:65`); no lifecycle command imports release modules |
| Release command without config fails actionably | PASS | `ReleaseConfigMissingError` names `release.scheme` + `release.version_file` (`src/release/release-pipeline.ts:35-44`); `tests/cli-release.test.ts:122,132,238` (incl. no files modified) |
| **Bump Derivation From Shipped Changes** | | |
| Only fixes recommend patch | PASS | `tests/release-bump-derivation.test.ts:71` |
| Feature present recommends minor | PASS | `tests/release-bump-derivation.test.ts:76` |
| Breaking marker recommends major | PASS | `tests/release-bump-derivation.test.ts:81,86` (`feat!:` and `BREAKING-CHANGE:` footer) |
| Derivation is deterministic and pure | PASS | `tests/release-bump-derivation.test.ts:117-130` (same output twice, input not mutated); `src/release/bump-derivation.ts` imports no I/O modules |
| **User Override Of Recommended Bump** | | |
| Override recommendation with explicit level | PASS | `tests/release-pipeline.test.ts:168` (records `bump_source: override`, recommendation passed to confirm); CLI `--bump` at `src/cli/commands/release.ts:79,124` |
| Accepting the recommendation | PASS | `level = opts.bumpOverride ?? recommended` (`src/release/release-pipeline.ts:300`); derived path exercised in `tests/release-pipeline.test.ts:108` |
| **Release Cut Operation** | | |
| One invocation produces consistent release artifacts | PASS | `tests/release-pipeline.test.ts:108-165` (version file, changelog section, commit file list, tag→HEAD); CLI end-to-end `tests/cli-release.test.ts:143-178` |
| Tag annotation carries release identity | PASS | `tests/release-pipeline.test.ts:155-159` — `cat-file -t` is `tag` and annotation contains the version |
| **Release Cut Safety Constraints** | | |
| Nothing pushed without explicit confirmation | PASS | No `git push` invocation anywhere in `src/release/**`; CLI prints manual command only (`src/cli/commands/release.ts:30`) |
| Existing tag aborts without force | PASS | `tests/release-pipeline.test.ts:276-296` (error names tag, pre-existing tag SHA unchanged, no commit created); no `-f`/delete in pipeline |
| Mid-cut failure is reported with the failing step | PARTIAL | Implemented: each mutation step records a named failure, restores files, and returns before `annotated-tag` (`src/release/release-pipeline.ts:449-458`). No test induces a mid-mutation (e.g. regen-changelog) failure — verified by code inspection only |
| **First Release Without Prior Tag** | | |
| First release derives from all shipped changes | PASS | `tests/release-pipeline.test.ts:107-165` (cut with no prior tags); `:480` (no matching tag is not an error); `collectCommitsSince` uses `HEAD` when tag undefined (`src/release/git-release-tags.ts:64`) |
| Manual tag treated as release boundary | PASS | `tests/release-pipeline.test.ts:196-238` (backfill of manual `v0.1.0`, remaining dirs attributed to new release); range `tag..HEAD` (`src/release/git-release-tags.ts:64`) |
| **Version-Anchored Changelog Generation** | | |
| Changes split across release boundary | PASS | `tests/release-changelog-grouping.test.ts:31,88` (each entry exactly once); `tests/doc-generator-versioned-changelog.test.ts:114` |
| Multiple versions render in release order | PASS | `tests/release-changelog-grouping.test.ts:49`; `tests/doc-generator-versioned-changelog.test.ts:88` (newest first) |
| Versioned shape survives finalize regeneration | PASS | `tests/doc-generator-versioned-changelog.test.ts:156` (new change lands under Unreleased, versioned sections retained) |
| **Pre-Existing Manual Release History Rendering** | | |
| Manual tags render without losing entries | PASS | Backfill attributes dirs to earliest containing tag (`src/release/git-release-tags.ts:97-123`); unattributed dirs stay Unreleased (`tests/release-pipeline.test.ts:239-260`); grouping guarantees no entry dropped (`src/release/changelog-grouping.ts:26-31`, `tests/release-changelog-grouping.test.ts:105`) |
| **Opt-In GitHub Release Publication** | | |
| No confirmation means no gh invocation | PASS | `tests/release-pipeline.test.ts:397` (not requested) and `:416` (config disabled even if requested); gate at `src/release/release-pipeline.ts:497` |
| Confirmed opt-in publishes release notes | PASS | `tests/release-pipeline.test.ts:375` (notes from version section); `tests/release-gh-release.test.ts:12` |
| **Graceful Degradation When gh Unavailable** | | |
| Missing gh binary degrades gracefully | PASS | `tests/release-gh-release.test.ts:39` (missing-binary, install guidance + manual retry); `tests/release-pipeline.test.ts:354` (local release intact) |
| Unauthenticated gh degrades gracefully | PASS | `tests/release-gh-release.test.ts:60` (unauthenticated outcome, `gh auth login` remedy, no release-create attempted) |
| **Release CLI Command Surface** | | |
| Human runs release CLI directly | PASS | `registerReleaseCommand` wired at `src/cli/index.ts:106`; `tests/cli-release.test.ts` drives the CLI end-to-end with no skill/credential; guard scopes only AI sessions |
| Version status command reports version and recommendation | PASS | `tests/cli-release.test.ts:85` (version, last tag, recommended bump) and `:132` (modifies no files) |
| **Release Skill And Guard Authorization** | | |
| Skill-mediated release is authorized | PASS | `tests/cli-metta-guard-bash-integration.test.ts:485-508` — minted `metta-release` token grants exactly `release:cut`; credentialed cut exits 0; out-of-scope `finalize` still blocked |
| Unauthorized AI invocation is blocked | PASS | `tests/cli-metta-guard-bash-integration.test.ts:468-475` (uncredentialed cut exit 2 pointing at skill path); `tests/metta-guard-bash.test.ts:704+` (status allowed read-only, unknown subcommands fail-closed) |
| Skill delivered as template file | PASS | `dist/templates/skills/metta-release/SKILL.md` present after `npm run build`; deployed copy byte-identical to template (`cmp` clean); no `metta-release` string in any `src/**/*.ts` |

### Gates

| Gate | Result |
|---|---|
| `npm test` | PASS — 115 files, 2035/2035 tests passed (294.5s) |
| `npx tsc --noEmit` | PASS — clean |
| `npm run build` | PASS — clean; templates copied to `dist/` incl. `dist/templates/skills/metta-release/SKILL.md` |

Both hook copies verified byte-identical to their `src/templates/hooks/` sources (`metta-guard-bash.mjs`, `metta-session-mint.mjs`).

### Overall verdict

**PASS** — all 33 scenarios verified; 32 PASS with test evidence, 1 PARTIAL ("Mid-cut failure is reported with the failing step": behavior implemented and code-inspected at `src/release/release-pipeline.ts:449-458` but not exercised by an induced-failure test). No FAIL. All three gates green.
