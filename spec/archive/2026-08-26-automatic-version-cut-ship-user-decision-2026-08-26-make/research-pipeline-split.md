# Research: ReleasePipeline Phase Split (cut vs. publish)

Approach evaluated: restructure `src/release/release-pipeline.ts` into two distinct phases — a local **cut** (release commit + annotated tag, never touches the network) and a **publish** (GitHub release via `gh`), exposed as separate CLI subcommands so skills can interleave the authorized push between them: `cut` → `git push --follow-tags` → `publish`.

## Approach

Today `ReleasePipeline.cut()` runs a single ordered step list; its `MUTATION_STEPS` constant is `['backfill-record', 'write-version-file', 'write-releases-record', 'regen-changelog', 'commit', 'annotated-tag', 'gh']` (release-pipeline.ts:106–114). The final `'gh'` step (lines 509–528) calls `createGithubRelease()` from `src/release/gh-release.ts` when `release.github_release === true && opts.github === true` — i.e. **inside** the cut, before any push, since the cut never pushes by spec ("Release Cut Safety Constraints"). That embedded ordering is exactly the v0.5.0/v0.6.0 double-failure: `gh release create` ran against a tag that did not yet exist on the remote.

Grounded fact that makes this worse than a mere failure: when the named tag does not exist on the remote, `gh release create` **silently creates one from the latest state of the default branch** (not from the local annotated tag), unless `--verify-tag` is passed to abort instead.[^1] So the current in-cut `gh` step can mint a *wrong* remote tag, not just fail. Any fix should carry `--verify-tag`.

The phase split removes `'gh'` from the cut entirely and adds a second pipeline entry point that is only meaningful after the tag has been pushed.

## How It Would Work

**1. `ReleasePipeline` (src/release/release-pipeline.ts):**

- `cut()` becomes local-only: drop the `'gh'` element from `MUTATION_STEPS`, delete the gh block at lines 509–528, and remove `github`, `ghExec` from `ReleaseCutOptions` and `gh?: GhOutcome` from `ReleaseCutResult`. The step-record style, abort points, and mutation-group restore logic are untouched — `cut()` still ends at `annotated-tag`.
- New method `publishGithub(tagArg?: string, ghExec?: GhExec): Promise<ReleasePublishResult>` on the same class (keeps `extractChangelogSection()` reachable as a private method — no relocation needed). Ordered steps in the existing `ReleaseStep[]` idiom:
  1. `config-check` — `requireReleaseConfig()`; fail if `release.github_release !== true` (mirrors the CLI fail-fast at release.ts:109).
  2. `resolve-tag` — explicit `tagArg`, else `listReleaseTags(projectRoot, release.tag_prefix)[0]` (newest release tag).
  3. `tag-exists-local` — `tagExists()` from `src/release/git-release-tags.ts`.
  4. `tag-on-remote` — `git ls-remote --tags origin <tag>`; fail with an actionable "push first: `git push --follow-tags`" message when absent. Belt-and-braces on top of `--verify-tag`, and gives a typed local failure instead of a gh error.
  5. `notes` — `extractChangelogSection(changelogPath, version)` where `version = tag.slice(tag_prefix.length)`.
  6. `gh` — `createGithubRelease()` (gh-release.ts unchanged in shape; add `--verify-tag` to its `gh release create` argv). The function already never throws — every failure is a typed `GhOutcome` (`missing-binary` / `unauthenticated` / `failed`), which satisfies the spec's graceful-degradation requirement for the ship path with zero new code.

**2. CLI (src/cli/commands/release.ts):**

- `release cut` loses `--github` (and its fail-fast guard at lines 107–111). The "tag was NOT pushed" hint at line 30 stays.
- New subcommand `release publish-github [tag]` with `--json`; renders the step list via the existing `renderSteps()`. Naming: `publish-github` over bare `publish` so the word stays scoped (npm publish etc. remains unclaimed) and the guard rule reads unambiguously.
- Skills then run: `metta release cut --bump <level> --yes` → push `--follow-tags` riding the authorized main push → `metta release publish-github <tag>` (only when `github_release: true`).

**3. Guard/mint hooks (both `src/templates/hooks/` and the live `.claude/hooks/` copies — they are kept identical):**

- `metta-guard-bash.mjs`: `BLOCKED_TWO_WORD` release entry becomes `new Set(['cut', 'publish-github'])`. `release status` stays on `ALLOWED_TWO_WORD`; `release <unknown>` stays fail-closed, so nothing is accidentally opened.
- `metta-session-mint.mjs`: `SKILL_SCOPES` `'metta-release'` entry grows from `['release:cut']` to `['release:cut', 'release:publish-github']`; the ship-path skill scopes gain the same pair (this scoping work is already mandated for `release:cut` by the change's "Guard Authorization For Ship-Path Release Cut" requirement — publish-github rides the identical mechanism, it just doubles the new scope-key count from one to two).
- SYNC obligations: the Forbidden bullet in `src/delivery/workflow-primer.ts` (line 91) must add `release publish-github`; the seam test in `tests/delivery.test.ts` pins drift, and `tests/metta-guard-mint-seam.test.ts` pins hook-template equality.

**4. Skill/spec migration:**

- `.claude/skills/metta-release/SKILL.md` + identical `src/templates/skills/metta-release/SKILL.md`: step 3 drops `--github`; new post-cut steps — if the user opted into GitHub publication, ask for explicit push confirmation (AskUserQuestion), run `git push --follow-tags origin main`, then `metta release publish-github <tag>`. This amends the current "Never run `git push` from this skill" rule to "never push without the user's explicit confirmation," which is what the constitution actually requires and what the change spec's "On-demand release keeps working with fixed sequencing" scenario demands. (Alternative: keep never-push and print both commands for the user to run — but then the GitHub release is manual again and the on-demand fix is only advisory.)
- `spec/specs/release-versioning/spec.md`: the base "Opt-In GitHub Release Publication" requirement (its scenario says the GitHub release exists "WHEN the release cut completes") and "Graceful Degradation When gh Unavailable" both describe gh as an in-cut step — the change spec needs a MODIFIED entry for each; currently the change spec only ADDs the sequencing requirement and does not carry these two MODIFIEDs.

## Pros

- **Structurally enforces the ordering the spec demands.** "Tag-not-on-remote race structurally impossible" is met in code, not just in skill prose: `publish-github` pre-flights `tag-on-remote` and passes `--verify-tag`, so the v0.5.0/v0.6.0 mode cannot recur even if a skill mis-orders the steps — and the silent wrong-tag creation `gh` performs on a missing remote tag[^1] is closed off.
- **Honors "Single Cut Path Through ReleasePipeline" cleanly.** One `cut()`, one `publishGithub()`, both on the existing class; ship path and `/metta-release` call the identical entry points. No second cut implementation, no ship-only branch inside the pipeline.
- **Simplifies `cut()`.** The cut becomes purely local and loses two options (`github`, `ghExec`) and a result field; the CLI fail-fast for `--github` disappears. The mutation group ends at `annotated-tag`, which matches the mental model the spec already teaches ("the cut never pushes").
- **Maximal reuse.** `createGithubRelease()`, `GhOutcome`, `extractChangelogSection()`, `listReleaseTags()`, `tagExists()`, `renderSteps()` are all reused verbatim or nearly so. The graceful-degradation behavior the change spec requires for the ship path is inherited for free.
- **Independently retryable.** A failed publish (gh outage, auth lapse) is re-runnable as `metta release publish-github v0.7.0` without re-cutting — today the only remedy is the hand-typed `gh release create` command from the warning text.
- **Fits the house style.** Ordered `ReleaseStep[]` records, typed outcomes, imperative-shell class method, Commander subcommand, guard fail-closed default for the new word — every piece lands in an existing pattern.

## Cons

- **New Tier-2 mutating CLI surface.** `publish-github` is a network-mutating command that must be guard-blocked and scope-minted. That means edits in four hook/primer locations (guard template + live copy, mint template + live copy, workflow-primer Forbidden bullet) plus their seam tests — mechanical but easy to half-do, and the seam tests will fail loudly until all are consistent.
- **Breaking CLI change: `--github` on `cut` goes away.** Consumers are the metta-release skill (updated in lockstep) and humans' muscle memory. Pre-1.0 this is acceptable, but a human running the old `metta release cut --github` gets an unknown-option error; a one-release stub that errors with "use `release publish-github` after pushing" would soften it at the cost of a little code.
- **Base-spec churn beyond the change spec's current deltas.** Two existing requirements ("Opt-In GitHub Release Publication", "Graceful Degradation When gh Unavailable") describe gh inside the cut and need MODIFIED entries the change spec doesn't yet carry — a spec-authoring follow-up, not just code.
- **The on-demand skill must now touch push.** Either the metta-release skill gains a user-confirmed `git push --follow-tags` step (a behavior change to a skill whose current rule is "never push"), or the on-demand GitHub release stays a manual afterthought. The confirmed-push route is constitution-compliant (explicit confirmation) but is a real semantic change reviewers should see.
- **Two commands where there was one.** The happy on-demand path grows from one CLI call to cut + push + publish. For the ship path this is exactly what's wanted; for a human in a terminal it's one more command to remember (mitigated by the cut's closing hint text naming the next commands).

## Complexity

Moderate. Files touched (~12–14, most already in this change's blast radius):

| Area | Files | Nature |
|---|---|---|
| Pipeline | `src/release/release-pipeline.ts` | Remove gh step; add `publishGithub()` + `ReleasePublishResult` (~90 net new lines) |
| gh edge | `src/release/gh-release.ts` | Add `--verify-tag` to argv; otherwise unchanged |
| CLI | `src/cli/commands/release.ts` | Drop `--github`; add `publish-github` subcommand (~60 lines) |
| Guard | `metta-guard-bash.mjs`, `metta-session-mint.mjs` (template + live copy each) | One set entry + one scope key; already being edited for `release:cut` ship-path scoping |
| Primer | `src/delivery/workflow-primer.ts` | Forbidden-bullet string |
| Skills | `metta-release/SKILL.md` (template + live), 6 ship-path skills | Ship-path edits already required by this change; metta-release rewrite is the only extra |
| Specs | `spec/specs/release-versioning/spec.md` via change-spec MODIFIED deltas | 2 additional MODIFIED requirements |

Test surface: `tests/release-pipeline.test.ts` — the four-test `cut — gh isolation` describe migrates to a new `publishGithub` describe plus ~5 new cases (tag resolution, missing local tag, tag-not-on-remote, config-disabled, notes fallback); `tests/cli-release.test.ts` — remove `--github` cases, add publish-github command cases; `tests/metta-guard-bash.test.ts`, `tests/cli-metta-guard-bash-integration.test.ts`, `tests/metta-guard-mint-seam.test.ts`, `tests/delivery.test.ts` — one blocked/allowed/scope case each; `tests/release-gh-release.test.ts` — one assertion update for `--verify-tag`. Grep-assert skill tests are new in this change regardless. Estimated net-new test cases: ~12–15.

## Fit

Strong. The "no second cut path" constraint is satisfied by construction — the split *narrows* `cut()` rather than duplicating it, and both callers (ship path, on-demand skill, human terminal) hit the same two methods. The step-record pattern, typed `GhOutcome`, guard fail-closed word handling, template-copied skills, and Zod-validated config are all existing conventions this approach extends without bending. The change spec's own wording anticipates it: "local cut … invoked without `--github`" and "the GitHub-release step … is ordered after the push rather than inside the cut" describe precisely a phase split. The main fit friction is procedural, not architectural: the change spec must grow two MODIFIED requirements for the base spec's gh wording, and the metta-release skill's never-push rule must be renegotiated to confirmed-push.

## Verdict

Recommend this approach. It is the only shape that makes the required ordering *structurally* impossible to violate rather than instruction-enforced — `publish-github` cannot run usefully against an unpushed tag (`tag-on-remote` pre-flight + `--verify-tag`), whereas keeping gh inside `cut()` and merely telling skills to omit `--github` leaves the v0.5.0/v0.6.0 failure one flag away and leaves `gh`'s silent wrong-tag creation live for on-demand users. The cost is a bounded, mechanical spread: one new Tier-2 subcommand with its guard/mint/primer sync set (work already opened by this change's `release:cut` scoping), one CLI flag removal whose only real consumer is a skill updated in the same commit, and two additional MODIFIED spec deltas. Reuse is maximal (gh edge, notes extraction, tag helpers, step rendering all unchanged), `cut()` gets simpler, and a failed publish becomes independently retryable — a strict improvement over the current remedy text. Adopt with: `publish-github` as the subcommand name, `--verify-tag` added to `createGithubRelease`, a hard `tag-on-remote` pre-flight, `--github` removed outright (optionally a one-release error stub pointing at the new command), and the metta-release skill updated to confirmed-push → publish.

[^1]: https://cli.github.com/manual/gh_release_create accessed 2026-08-26 — "If a matching git tag does not yet exist, one will automatically get created from the latest state of the default branch"; `--verify-tag` aborts if the tag is missing.
