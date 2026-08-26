# UAT: automatic-version-cut-ship-user-decision-2026-08-26-make

- **Change**: automatic-version-cut-ship-user-decision-2026-08-26-make
- **Generated**: 2026-08-26
- **Source**: user stories (stories.md)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

### US-1: Automatic version cut when a change ships

*Independent test:* Running a ship-path skill to completion with `release.on_ship: auto` (or unset, since auto is the default) produces a new version tag on main derived from the unreleased changes, with no manual release invocation.

#### Step 1.1
- **Setup**: a project with release config present and `release.on_ship` set to `auto` (or absent, defaulting to `auto`)
- **Do**: any ship-path skill (metta-ship, metta-propose ship opt-in, metta-quick, metta-auto, metta-fix-issues, metta-fix-gap) completes the PR merge and main fast-forward + rebuild
- **Observe**: the skill runs release status, derives the bump, and cuts the release via the existing ReleasePipeline with `--yes`, and the new tag rides the already-authorized main push via `--follow-tags`
- [ ] Pass

#### Step 1.2
- **Setup**: the cut succeeds
- **Do**: the ship step reports completion
- **Observe**: the output includes the new version number so the developer knows exactly what was released
- [ ] Pass

#### Step 1.3
- **Setup**: the automatic cut runs
- **Do**: it derives the bump
- **Observe**: it reuses the existing ReleasePipeline and bump-derivation rules end to end, with no second cut implementation
- [ ] Pass

### US-2: Prompt mode asks before cutting

*Independent test:* With `release.on_ship: prompt`, an interactive ship presents the unreleased count and recommended bump and only cuts on confirmation, while a non-interactive ship skips the cut with a loud notice.

#### Step 2.1
- **Setup**: `release.on_ship: prompt` in an interactive session
- **Do**: a ship-path skill reaches the post-merge release step
- **Observe**: it reports the number of unreleased changes and the recommended bump and asks the developer whether to cut
- [ ] Pass

#### Step 2.2
- **Setup**: the developer confirms
- **Do**: the cut proceeds
- **Observe**: it follows the same pipeline and tag-push behavior as auto mode
- [ ] Pass

#### Step 2.3
- **Setup**: the developer declines
- **Do**: the ship completes
- **Observe**: no cut occurs and the shipped change remains in the unreleased backlog for a later on-demand release
- [ ] Pass

#### Step 2.4
- **Setup**: `release.on_ship: prompt` in a non-interactive context
- **Do**: the ship reaches the release step
- **Observe**: it fails closed by skipping the cut and emits a loud notice that the release was skipped and why
- [ ] Pass

### US-3: Off mode and absent config preserve on-demand releasing

*Independent test:* With `release.on_ship: off` or with release config entirely absent, a completed ship produces no tag and no cut, emitting only a one-line skip notice in the absent-config case.

#### Step 3.1
- **Setup**: `release.on_ship: off`
- **Do**: a ship-path skill completes the merge and main push
- **Observe**: no release step runs and releasing remains fully on-demand via /metta-release
- [ ] Pass

#### Step 3.2
- **Setup**: a project with no release config at all
- **Do**: a ship completes
- **Observe**: the release step is skipped with a one-line notice and the ship succeeds normally
- [ ] Pass

#### Step 3.3
- **Setup**: either skip path
- **Do**: the ship completes
- **Observe**: tokens, UAT enforcement, and gates behave exactly as before — the release step touches none of them
- [ ] Pass

### US-4: Reliable GitHub release sequencing

*Independent test:* A ship-triggered cut executes strictly in the order merge → pull → local cut (no `--github`) → push main with `--follow-tags` → `gh release create` against the pushed tag, and the GitHub release step never runs before the tag exists on the remote.

#### Step 4.1
- **Setup**: an automatic cut on ship
- **Do**: the release step executes (Run: `gh release create`)
- **Observe**: the local cut runs without `--github`, the tag is pushed via `--follow-tags` on the authorized main push, and only then is the GitHub release created against the already-pushed tag
- [ ] Pass

#### Step 4.2
- **Setup**: the `gh` CLI is absent or unauthenticated
- **Do**: the GitHub-release step is reached
- **Observe**: the step degrades gracefully — the tag and version cut still land, and the skill reports that the GitHub release was skipped
- [ ] Pass

#### Step 4.3
- **Setup**: the fixed sequencing
- **Do**: compared against the v0.5.0/v0.6.0 failure mode
- **Observe**: the tag-not-on-remote race is structurally impossible because the GitHub release is created after the push, not during the cut
- [ ] Pass

### US-5: Pre-1.0 major bump guard

*Independent test:* On a pre-1.0 version, an automatic cut whose derived bump is major produces a minor version instead and prominently reports the downgrade, while setting `release.allow_major_pre_1` restores the major bump.

#### Step 5.1
- **Setup**: the current version is below 1.0.0 and `release.allow_major_pre_1` is not set
- **Do**: the automatic cut derives a major bump
- **Observe**: the bump is downgraded to minor and the ship output prominently reports both the original derivation and the downgrade
- [ ] Pass

#### Step 5.2
- **Setup**: `release.allow_major_pre_1` is enabled
- **Do**: the automatic cut derives a major bump on a pre-1.0 version
- **Observe**: the major bump is applied as derived
- [ ] Pass

#### Step 5.3
- **Setup**: the current version is 1.0.0 or above
- **Do**: a major bump is derived
- **Observe**: the guard does not apply and the bump proceeds unchanged
- [ ] Pass

### US-6: Ship never blocked by a failed cut

*Independent test:* When the post-merge cut fails for any reason, the ship still completes successfully with the merge and main push intact, and the failure is surfaced as a warning telling the developer how to cut on demand.

#### Step 6.1
- **Setup**: the PR is merged and main is fast-forwarded
- **Do**: the automatic cut fails at any point
- **Observe**: the ship completes with a clear warning, the merge is never reverted, and main is left in its pushed state
- [ ] Pass

#### Step 6.2
- **Setup**: a cut failure warning
- **Do**: the developer reads the ship output
- **Observe**: it identifies what failed and states that /metta-release can be run on demand to cut the release manually
- [ ] Pass

#### Step 6.3
- **Setup**: the release step runs in a fork or main-session skill context
- **Do**: it invokes release status and release cut
- **Observe**: the guard/mint scoping authorizes those calls, so the failure posture is only exercised for genuine cut errors rather than authorization gaps
- [ ] Pass

## Additional scenarios

#### Step 7.1: Valid semver config accepted
- **Setup**: a release config specifying scheme `semver`, version file `package.json`, tag prefix `v`, and GitHub release opt-in `false`
- **Do**: the config is loaded
- **Observe**: Zod validation passes and the parsed config exposes those keys with those values
- [ ] Pass

#### Step 7.2: Unsupported scheme rejected with key named
- **Setup**: a release config specifying scheme `calver`
- **Do**: the config is loaded
- **Observe**: Zod validation fails and the error message names the scheme key and states that only `semver` is supported
- [ ] Pass

#### Step 7.3: Malformed version-file path rejected
- **Setup**: a release config whose version-file value is an empty string
- **Do**: the config is loaded
- **Observe**: Zod validation fails and the error message names the version-file key
- [ ] Pass

#### Step 7.4: Defaults applied for omitted optional keys
- **Setup**: a release config that specifies only scheme and version-file location
- **Do**: the config is loaded
- **Observe**: the tag prefix defaults to `v`, the GitHub-release opt-in defaults to disabled, `on_ship` defaults to `auto`, and `allow_major_pre_1` defaults to `false`
- [ ] Pass

#### Step 7.5: Explicit on_ship values accepted
- **Setup**: a release config setting `on_ship` to each of `auto`, `prompt`, and `off` in turn
- **Do**: the config is loaded
- **Observe**: Zod validation passes for all three values and the parsed config exposes the chosen mode
- [ ] Pass

#### Step 7.6: Invalid on_ship value rejected with key named
- **Setup**: a release config setting `on_ship: always`
- **Do**: the config is loaded
- **Observe**: Zod validation fails and the error message names the `release.on_ship` key and the allowed values
- [ ] Pass

#### Step 7.7: Install scaffolds on_ship explicitly
- **Setup**: a project being initialized via `metta install` with release configuration
- **Do**: the project config is scaffolded (Run: `metta install`)
- **Observe**: the written config contains an explicit `release.on_ship: auto` key, mirroring the `uat.enforce_on_ship` scaffolding pattern
- [ ] Pass

#### Step 7.8: Cut runs after merge and rebuild in auto mode
- **Setup**: a project with `release.on_ship: auto` (explicit or defaulted) and a ship-path skill that has completed the user-approved PR merge, main fast-forward, and rebuild
- **Do**: the skill continues past the rebuild (Run: `metta release status`, `metta release cut --yes`)
- **Observe**: it runs `metta release status`, derives the bump from the unreleased shipped changes, and invokes `metta release cut --yes` with the derived bump, producing a release commit and annotated tag on main
- [ ] Pass

#### Step 7.9: No release activity at PR-open hand-back
- **Setup**: `release.on_ship: auto` and a `metta-propose` run that ends at "PR opened, awaiting review" without a merge
- **Do**: the skill hands back to the user (Run: `release status`, `release cut`)
- **Observe**: no `release status`, no bump derivation, and no `release cut` has run, and no tag or release commit exists for the change
- [ ] Pass

#### Step 7.10: Ship output reports the released version
- **Setup**: a ship-path cut that succeeds and produces version `0.7.0`
- **Do**: the ship step reports completion
- **Observe**: the output states that `0.7.0` was released so the developer knows exactly what was cut
- [ ] Pass

#### Step 7.11: All six ship paths carry the flow
- **Setup**: each of `metta-ship`, `metta-propose` (ship opt-in), `metta-quick`, `metta-auto`, `metta-fix-issues`, and `metta-fix-gap` completes a user-approved merge with `release.on_ship: auto`
- **Do**: each skill's post-merge sequence executes
- **Observe**: each runs the identical status → derive → cut flow after the main fast-forward + rebuild
- [ ] Pass

#### Step 7.12: GitHub release created only after the tag is pushed
- **Setup**: an automatic cut on ship with `release.github_release: true`
- **Do**: the release step executes
- **Observe**: the local cut runs without `--github`, the tag reaches the remote via `--follow-tags` on the authorized main push, and only then is the GitHub release created against the already-pushed tag
- [ ] Pass

#### Step 7.13: Absent gh degrades gracefully
- **Setup**: the `gh` CLI is not installed or is unauthenticated
- **Do**: the ship-step sequence reaches the GitHub-release step
- **Observe**: the version file, changelog, release commit, annotated tag, and tag push all still land, and the skill warns that the GitHub release was skipped and why
- [ ] Pass

#### Step 7.14: Tag-not-on-remote race structurally impossible
- **Setup**: the fixed sequencing compared against the v0.5.0/v0.6.0 failure mode
- **Do**: a ship-triggered cut executes end to end
- **Observe**: the GitHub-release step cannot run before the tag exists on the remote, because it is ordered after the push rather than inside the cut
- [ ] Pass

#### Step 7.15: No force push and no second unconfirmed push
- **Setup**: a ship-step cut whose tag must reach the remote
- **Do**: the push executes
- **Observe**: it is the single user-authorized main push with `--follow-tags` appended — no `--force`, and no additional push is issued without user confirmation
- [ ] Pass

#### Step 7.16: GitHub opt-in disabled means no gh invocation
- **Setup**: `release.github_release: false` (or the key omitted, defaulting to disabled)
- **Do**: a ship-step cut completes and the push lands
- **Observe**: no `gh` command is executed and the local release stands on its own
- [ ] Pass

#### Step 7.17: Interactive prompt reports count and bump before asking
- **Setup**: `release.on_ship: prompt` in an interactive session with three unreleased changes recommending a minor bump
- **Do**: a ship-path skill reaches the post-merge release step
- **Observe**: it reports "3 unreleased changes, recommended bump: minor" (or equivalent) and asks the developer whether to cut before touching any file
- [ ] Pass

#### Step 7.18: Confirmation proceeds identically to auto
- **Setup**: the developer confirms the prompt
- **Do**: the cut proceeds
- **Observe**: it uses the same `ReleasePipeline` invocation, cut-then-push-then-GitHub sequencing, and `--follow-tags` behavior as `auto` mode
- [ ] Pass

#### Step 7.19: Decline leaves the backlog for on-demand release
- **Setup**: the developer declines the prompt
- **Do**: the ship completes
- **Observe**: no cut occurs, no tag is created, and the shipped change remains counted as unreleased for a later `/metta-release`
- [ ] Pass

#### Step 7.20: Non-interactive context fails closed with loud notice
- **Setup**: `release.on_ship: prompt` in a non-interactive context where no answer can be collected
- **Do**: the ship reaches the release step
- **Observe**: the cut is skipped, the ship still completes, and a loud notice states that the release was skipped because prompt mode could not ask
- [ ] Pass

#### Step 7.21: Off mode ships without any release mutation
- **Setup**: `release.on_ship: off`
- **Do**: a ship-path skill completes the merge and main push
- **Observe**: no release mutation occurs (no cut, no push, no GitHub release), no bump derivation is applied, and releasing remains fully on-demand via `/metta-release`
- [ ] Pass

#### Step 7.22: Off mode leaves surrounding ship behavior untouched
- **Setup**: `release.on_ship: off`
- **Do**: the ship completes
- **Observe**: tokens, UAT enforcement, and gates behave exactly as they did before the on-ship release capability existed
- [ ] Pass

#### Step 7.23: Ship without release config skips with one-line notice
- **Setup**: a project with no `release` key in its config
- **Do**: a ship-path skill completes the merge and main push
- **Observe**: the release step is skipped with a single-line notice that release config is absent, the ship exits successfully, and no version read, cut, or tag occurs
- [ ] Pass

#### Step 7.24: Absent config skip is not a ship blocker
- **Setup**: a project with no release configuration
- **Do**: the ship-path release step is reached
- **Observe**: the skip is reported as informational — not as an error — and the ship outcome (merge, push, archive) is identical to a ship on a fully released project
- [ ] Pass

#### Step 7.25: Release command without config fails actionably
- **Setup**: a project with no release configuration
- **Do**: the user invokes the release command directly
- **Observe**: the command exits with an error stating that release config is missing and naming the keys required to enable it, and no files are modified
- [ ] Pass

#### Step 7.26: Skip paths leave tokens UAT and gates untouched
- **Setup**: either skip path (absent config, or `on_ship: off`)
- **Do**: the ship completes
- **Observe**: token accounting, UAT generation and enforcement, and gate execution behave exactly as before — the release step touches none of them
- [ ] Pass

#### Step 7.27: Pre-1.0 major downgraded to minor with prominent report
- **Setup**: the current version is `0.6.0`, `release.allow_major_pre_1` is not set, and the shipped changes derive a `major` bump
- **Do**: the automatic cut runs
- **Observe**: the applied bump is `minor` (yielding `0.7.0`, not `1.0.0`) and the ship output prominently reports that a major was derived and downgraded because the project is pre-1.0
- [ ] Pass

#### Step 7.28: Escape hatch restores the major bump
- **Setup**: `release.allow_major_pre_1: true` on a version below `1.0.0`
- **Do**: the automatic cut derives a major bump
- **Observe**: the major bump is applied as derived
- [ ] Pass

#### Step 7.29: Guard inert at 1.0.0 and above
- **Setup**: the current version is `1.2.0`
- **Do**: a major bump is derived by the on-ship flow
- **Observe**: the guard does not apply and the bump proceeds unchanged to `2.0.0`
- [ ] Pass

#### Step 7.30: Failed cut never unwinds the merge
- **Setup**: the PR is merged and main is fast-forwarded
- **Do**: the automatic cut fails at any step (network, gh outage, pipeline error, dirty tree)
- **Observe**: the ship completes successfully with a warning, the merge is never reverted, and main remains in its pushed state
- [ ] Pass

#### Step 7.31: Warning names the failure and the on-demand remedy
- **Setup**: a cut failure during the ship-step release flow
- **Do**: the developer reads the ship output
- **Observe**: the warning identifies which step failed and states that the release can be cut later on demand via `/metta-release`
- [ ] Pass

#### Step 7.32: Ship-step cut goes through the existing pipeline
- **Setup**: an automatic cut triggered by a ship-path skill
- **Do**: the cut executes
- **Observe**: it invokes the same `ReleasePipeline.cut` code path and bump-derivation rules as `/metta-release`, with no second cut implementation in the codebase
- [ ] Pass

#### Step 7.33: On-demand release keeps working with fixed sequencing
- **Setup**: a developer running `/metta-release` on demand
- **Do**: a cut with GitHub publication is performed
- **Observe**: the release completes using the same pipeline and the GitHub release is created only after the tag is on the remote
- [ ] Pass

#### Step 7.34: Fork-context ship path is authorized to cut
- **Setup**: a ship-path skill running in a forked `metta-skill-host` subagent reaches the post-merge release step
- **Do**: it issues `metta release status` and `metta release cut --yes` (Run: `metta release status`, `metta release cut --yes`)
- **Observe**: the guard permits both calls and the cut proceeds without an authorization failure
- [ ] Pass

#### Step 7.35: Main-session ship path is authorized to cut
- **Setup**: a ship-path skill executing in the main session (e.g. `metta-ship`) reaches the post-merge release step
- **Do**: it issues the `release cut` call (Run: `release cut`)
- **Observe**: the guard authorizes it via the session-tier credential path, so the warn-and-continue posture is exercised only for genuine cut errors, never authorization gaps
- [ ] Pass

#### Step 7.36: Unauthorized direct invocation still blocked
- **Setup**: an AI orchestrator session that has invoked no release-authorizing skill
- **Do**: it attempts `metta release cut` via Bash (Run: `metta release cut`)
- **Observe**: the `metta-guard-bash` hook blocks the call before execution, exactly as before this change
- [ ] Pass

#### Step 7.37: No other command scope widened
- **Setup**: the guard and mint hooks after this change
- **Do**: any non-release mutating command is attempted from a context that was previously unauthorized for it (Run: `release cut`)
- **Observe**: it is still blocked — the scoping extension covers only the ship-path `release cut` invocation
- [ ] Pass

#### Step 7.38: Ship skill wording carries the release stage in order
- **Setup**: the `metta-ship` skill template after this change
- **Do**: its ship-step instructions are read
- **Observe**: the post-merge release flow appears after the merge/fast-forward/rebuild instructions and before hand-back, including mode handling and the warn-and-continue posture
- [ ] Pass

#### Step 7.39: Run-to-merge skills carry the same stage
- **Setup**: the `metta-quick`, `metta-auto`, `metta-fix-issues`, and `metta-fix-gap` skill templates and the `metta-propose` ship opt-in path
- **Do**: each template's post-merge section is read
- **Observe**: each documents the same release flow with the same ordering constraint (post-merge only, never at PR-open)
- [ ] Pass

#### Step 7.40: All six ship-path skills asserted
- **Setup**: the grep-assert test suite for skill content
- **Do**: it runs against the built skill templates
- **Observe**: it asserts the presence of the post-merge release step in each of `metta-ship`, `metta-propose`, `metta-quick`, `metta-auto`, `metta-fix-issues`, and `metta-fix-gap`
- [ ] Pass

#### Step 7.41: Removing the step from one skill fails the tests
- **Setup**: the post-merge release step is deleted from one ship-path skill file
- **Do**: the grep-assert tests run
- **Observe**: the test for that skill fails, naming the file missing the release step
- [ ] Pass

#### Step 7.42: Release created only after the tag is on the remote
- **Setup**: `release.github_release: true` and a ship-path release step whose local cut has completed
- **Do**: the authorized main push with `--follow-tags` lands the tag on the remote and the publication step runs
- **Observe**: the skill probes `gh release view <tag>`, finds no existing release, and runs `gh release create <tag> --verify-tag --notes-file -` with the version's changelog section as the notes body — and no `gh` command ran at any earlier point in the flow
- [ ] Pass

#### Step 7.43: Removed --github flag errors with a pointer to the fixed sequence
- **Setup**: a caller invoking `metta release cut --github`
- **Do**: the command is parsed (Run: `metta release cut --github`)
- **Observe**: it exits with an error stating that `--github` has been removed and pointing to the cut → push → publish sequence, and no version file, changelog, commit, tag, or `gh` invocation occurs
- [ ] Pass

#### Step 7.44: Idempotent probe skips an already-published release
- **Setup**: a re-run of the publication step for a tag whose GitHub release already exists
- **Do**: the skill probes `gh release view <tag>` (Run: `gh release create`)
- **Observe**: the probe finds the existing release, `gh release create` is not invoked, and the step completes without error or duplicate release
- [ ] Pass

#### Step 7.45: cut --json supplies the notes body
- **Setup**: a cut of version `0.7.0` invoked as `metta release cut --yes --json`
- **Do**: the cut completes (Run: `metta release cut --yes --json`)
- **Observe**: the JSON output includes the extracted changelog-section notes string for `0.7.0`, so the skill passes it to `--notes-file -` without re-parsing `docs/changelog.md`
- [ ] Pass

#### Step 7.46: On-demand release confirms the push before publishing
- **Setup**: `release.github_release: true` and a developer running `/metta-release` on demand
- **Do**: the local cut completes (Run: `git push --follow-tags origin main`)
- **Observe**: the skill asks for explicit per-run confirmation before running `git push --follow-tags origin main`, and only after that push lands does it run the same probe-then-create publication step
- [ ] Pass

#### Step 7.47: Missing gh binary warns with the manual command and the ship continues
- **Setup**: `release.github_release: true` and `gh` is not installed on PATH
- **Do**: a ship-path release step reaches the post-push publication step
- **Observe**: the release commit, annotated tag, and tag push all stand, the skill warns that `gh` was not found and reports the exact `gh release create <tag> --verify-tag` command to run manually, and the ship completes successfully with the merge and main push untouched
- [ ] Pass

#### Step 7.48: Failed gh release create warns and continues, re-runnable later
- **Setup**: `gh` is installed and authenticated but `gh release create <tag> --verify-tag` fails (e.g. API outage or transient error)
- **Do**: the publication step handles the failure
- **Observe**: the skill warns naming the create failure, the ship (or on-demand release) completes without any rollback of the local release or pushed tag, and a later run of the publication step probes `gh release view <tag>`, finds no release, and publishes it for the same tag without re-cutting
- [ ] Pass

#### Step 7.49: Unauthenticated gh degrades the on-demand release the same way
- **Setup**: `gh` is installed but unauthenticated and a developer runs `/metta-release` with `release.github_release: true`
- **Do**: the confirmed push lands and the publication step runs
- **Observe**: the local release and pushed tag succeed, the warning identifies the authentication problem and how to authenticate and retry publication, and the on-demand release completes rather than failing
- [ ] Pass
