# Implementation Summary: automatic-version-cut-ship-user-decision-2026-08-26-make

## What was built

Automatic version cut on ship, default-on, with fixed cut -> push -> publish sequencing.

### Batch 1 (parallel, 4 executors)

- **Task 1.1** (`b98e48193`) — `ReleaseConfigSchema` gained `on_ship: z.enum(['auto','prompt','off']).default('auto')` (errorMap names `release.on_ship`) and `allow_major_pre_1: z.boolean().default(false)`. 6 new schema tests; 199/199 pass; `tsc --noEmit` clean.
- **Task 1.2** (`dc6937da5`) — canonical `### Post-merge release stage` block (frozen sentence containing `metta release status --json`, `metta release cut --bump <level> --yes --json`, `git push --follow-tags origin main`, `gh release view <tag>`, `gh release create <tag> --verify-tag --notes-file -`, warn-and-continue naming `/metta-release`) inserted byte-identically (sha256-verified) into the six ship-path skills in both trees (12 files). metta-propose gets it only inside the `--ship` opt-in. 120/120 skill/byte-identity tests pass.
- **Task 1.3** (`4fb2ceff7`) — metta-release skill rewritten in both trees: cut (no GitHub flag) -> explicit per-run push confirmation -> `git push --follow-tags origin main` -> `gh release view` probe -> `gh release create <tag> --verify-tag --title <tag> --notes-file -`. Zero `--github` occurrences. 71/71 pass.
- **Task 1.4** (`0b775240e`) — `SKILL_SCOPES['metta-fix-gap']` gained `release:cut` in both hook trees; guard comment updated (no table/logic changes). 406 passed across mint/guard/byte-identity/seam/delivery suites.

### Batch 2 (parallel, 3 executors)

- **Task 2.1** (`8f552d948`) — `ReleasePipeline.cut()` is purely local: `'gh'` removed from `MUTATION_STEPS`, gh step and `gh-release.ts` deleted (barrel export removed, zero importers). `ReleaseCutResult.notes` added (changelog section, omitted on dry-run). `ReleaseStatusResult` echoes `onShip`/`allowMajorPre1`/`githubRelease`. CLI: `--github` is an erroring stub (pre-mutation, three-step fixed-sequence message); hint/description updated; `On-ship mode:` in human status. 32/32 pass; `tsc --noEmit` clean.
- **Task 2.2** (`b0ce16bf6`) — install scaffolds the complete release block (`scheme: semver`, `version_file: package.json`, `github_release: false`, `on_ship: auto` with comment) only when `package.json` exists; both branches parse under `ProjectConfigSchema`. 41/41 pass.
- **Task 2.3** (`14dc0b7ed`) — new `tests/skill-release-ship-stage.test.ts`: 57 assertions over the 12-file matrix + metta-release cases (once-only sentence, post-merge/post-pull ordering, `--verify-tag`/`--follow-tags`/probe presence, propose opt-in scoping, push-confirmation-before-create). Mutation check demonstrated (deleting the sentence from one file fails 4 tests naming that file).

## Deviations (all recorded by executors, all justified)

- Task 1.3: the rule text avoids the literal `--github` string ("Never pass a GitHub flag to `cut`") to satisfy the zero-occurrence grep assert.
- Task 1.2: quick/auto/fix-issues/fix-gap have no dist-rebuild step; block inserted after pull/cleanup, before hand-back (governing placement rule). Design-internal "(ADR-2)" cross-reference dropped from deployed skill text.
- Task 1.1: two pre-existing `toEqual` fixtures gained the new defaulted keys (Zod defaults surface in parse output).

## Safety rails delivered

- Pre-1.0 major->minor downgrade gated on `allowMajorPre1` (skill block, driven by `release status --json` echo).
- Warn-and-continue: no failure in the release stage blocks or unwinds a completed ship.
- Absent `release` config -> one-line loud notice, skip.
- `--verify-tag` + `gh release view` probe make the v0.5.0/v0.6.0 wrong-tag/premature-publish failure structurally unreachable.
- Push rides the single authorized `git push --follow-tags origin main`; never force, never a second unconfirmed push.
