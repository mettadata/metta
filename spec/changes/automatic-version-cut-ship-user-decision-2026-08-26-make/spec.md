# release-versioning

## MODIFIED: Requirement: Release Configuration Schema

The system MUST define version/release configuration keys validated with a Zod schema on every read and write, covering: versioning scheme (only `semver` accepted initially), version-file location (path to the file holding the host project's product version, e.g. `package.json`), tag prefix (defaulting to `v`), a GitHub-release opt-in flag (defaulting to disabled), an on-ship release mode `on_ship` (enum `auto | prompt | off`), and a pre-1.0 major-bump escape hatch `allow_major_pre_1` (boolean). Validation failures MUST name the offending key in the error message.

`release.on_ship` MUST follow the three-legged default-on pattern already used by `uat.enforce_on_ship`: (1) the Zod schema declares `.default('auto')`, (2) an omitted `on_ship` key parses to `auto`, and (3) `metta install` scaffolds the key explicitly as `release.on_ship: auto` in generated project config. `release.allow_major_pre_1` MUST default to `false` via the Zod schema, and an omitted key MUST parse to `false`. Existing configs without either key MUST parse without migration. (Traces: US-1, US-3, US-5; intent proposal item 1.)

### Scenario: Valid semver config accepted
- GIVEN a release config specifying scheme `semver`, version file `package.json`, tag prefix `v`, and GitHub release opt-in `false`
- WHEN the config is loaded
- THEN Zod validation passes and the parsed config exposes those keys with those values

### Scenario: Unsupported scheme rejected with key named
- GIVEN a release config specifying scheme `calver`
- WHEN the config is loaded
- THEN Zod validation fails and the error message names the scheme key and states that only `semver` is supported

### Scenario: Malformed version-file path rejected
- GIVEN a release config whose version-file value is an empty string
- WHEN the config is loaded
- THEN Zod validation fails and the error message names the version-file key

### Scenario: Defaults applied for omitted optional keys
- GIVEN a release config that specifies only scheme and version-file location
- WHEN the config is loaded
- THEN the tag prefix defaults to `v`, the GitHub-release opt-in defaults to disabled, `on_ship` defaults to `auto`, and `allow_major_pre_1` defaults to `false`

### Scenario: Explicit on_ship values accepted
- GIVEN a release config setting `on_ship` to each of `auto`, `prompt`, and `off` in turn
- WHEN the config is loaded
- THEN Zod validation passes for all three values and the parsed config exposes the chosen mode

### Scenario: Invalid on_ship value rejected with key named
- GIVEN a release config setting `on_ship: always`
- WHEN the config is loaded
- THEN Zod validation fails and the error message names the `release.on_ship` key and the allowed values

### Scenario: Install scaffolds on_ship explicitly
- GIVEN a project being initialized via `metta install` with release configuration
- WHEN the project config is scaffolded
- THEN the written config contains an explicit `release.on_ship: auto` key, mirroring the `uat.enforce_on_ship` scaffolding pattern


## ADDED: Requirement: Post-Merge Release Flow On Ship Paths

Every ship-path skill — `metta-ship`, `metta-propose` at its ship opt-in, `metta-quick`, `metta-auto`, `metta-fix-issues`, and `metta-fix-gap` — MUST run the release flow only after the user-approved PR merge and the main fast-forward + rebuild have completed, in this sequence: (1) `metta release status` to establish the current version and unreleased shipped changes since the last tag, (2) derive the bump (major/minor/patch) from the shipped changes since the last tag, (3) `metta release cut --yes` with the derived bump, landing the release commit and annotated tag on main. The flow MUST NOT run at a PR-open hand-back: if a ship path stops at "PR opened, awaiting review," no release activity of any kind occurs. When the cut succeeds, the ship output MUST include the new version number. (Traces: US-1; intent proposal item 2.)

### Scenario: Cut runs after merge and rebuild in auto mode
- GIVEN a project with `release.on_ship: auto` (explicit or defaulted) and a ship-path skill that has completed the user-approved PR merge, main fast-forward, and rebuild
- WHEN the skill continues past the rebuild
- THEN it runs `metta release status`, derives the bump from the unreleased shipped changes, and invokes `metta release cut --yes` with the derived bump, producing a release commit and annotated tag on main

### Scenario: No release activity at PR-open hand-back
- GIVEN `release.on_ship: auto` and a `metta-propose` run that ends at "PR opened, awaiting review" without a merge
- WHEN the skill hands back to the user
- THEN no `release status`, no bump derivation, and no `release cut` has run, and no tag or release commit exists for the change

### Scenario: Ship output reports the released version
- GIVEN a ship-path cut that succeeds and produces version `0.7.0`
- WHEN the ship step reports completion
- THEN the output states that `0.7.0` was released so the developer knows exactly what was cut

### Scenario: All six ship paths carry the flow
- GIVEN each of `metta-ship`, `metta-propose` (ship opt-in), `metta-quick`, `metta-auto`, `metta-fix-issues`, and `metta-fix-gap` completes a user-approved merge with `release.on_ship: auto`
- WHEN each skill's post-merge sequence executes
- THEN each runs the identical status → derive → cut flow after the main fast-forward + rebuild


## ADDED: Requirement: Cut Then Push Then GitHub Release Sequencing

The ship-step release sequence MUST be strictly ordered so the GitHub release is created only after the tag exists on the remote: merge → pull/fast-forward → local cut (release commit + annotated tag, invoked without `--github`) → push main with `--follow-tags` riding the already-authorized main push → then create the GitHub release against the now-pushed tag. The tag push MUST NOT be a force push and MUST NOT be a separate unconfirmed push — it rides the single push the user already authorized. The GitHub-release step MUST run only when the existing `release.github_release` config opt-in is enabled, and MUST degrade gracefully (warn and skip, local release intact) when the `gh` CLI is absent or unauthenticated. This ordering MUST make the v0.5.0/v0.6.0 `--github` double-failure — `gh release create` running before the tag was pushed — structurally impossible. (Traces: US-4; intent proposal item 3.)

### Scenario: GitHub release created only after the tag is pushed
- GIVEN an automatic cut on ship with `release.github_release: true`
- WHEN the release step executes
- THEN the local cut runs without `--github`, the tag reaches the remote via `--follow-tags` on the authorized main push, and only then is the GitHub release created against the already-pushed tag

### Scenario: Absent gh degrades gracefully
- GIVEN the `gh` CLI is not installed or is unauthenticated
- WHEN the ship-step sequence reaches the GitHub-release step
- THEN the version file, changelog, release commit, annotated tag, and tag push all still land, and the skill warns that the GitHub release was skipped and why

### Scenario: Tag-not-on-remote race structurally impossible
- GIVEN the fixed sequencing compared against the v0.5.0/v0.6.0 failure mode
- WHEN a ship-triggered cut executes end to end
- THEN the GitHub-release step cannot run before the tag exists on the remote, because it is ordered after the push rather than inside the cut

### Scenario: No force push and no second unconfirmed push
- GIVEN a ship-step cut whose tag must reach the remote
- WHEN the push executes
- THEN it is the single user-authorized main push with `--follow-tags` appended — no `--force`, and no additional push is issued without user confirmation

### Scenario: GitHub opt-in disabled means no gh invocation
- GIVEN `release.github_release: false` (or the key omitted, defaulting to disabled)
- WHEN a ship-step cut completes and the push lands
- THEN no `gh` command is executed and the local release stands on its own


## ADDED: Requirement: Prompt Mode Ship-Step Confirmation

When `release.on_ship` is `prompt`, the ship-path release step MUST report the number of unreleased changes and the recommended bump, then ask the developer whether to cut before any release mutation occurs. On confirmation the cut MUST follow the same pipeline, sequencing, and tag-push behavior as `auto` mode. On decline no cut MUST occur, leaving the shipped change in the unreleased backlog for a later on-demand release. In non-interactive contexts prompt mode MUST fail closed: the cut is skipped and a loud notice states that the release was skipped and why — the system MUST NOT cut without an answer. (Traces: US-2; intent proposal item 2 mode semantics.)

### Scenario: Interactive prompt reports count and bump before asking
- GIVEN `release.on_ship: prompt` in an interactive session with three unreleased changes recommending a minor bump
- WHEN a ship-path skill reaches the post-merge release step
- THEN it reports "3 unreleased changes, recommended bump: minor" (or equivalent) and asks the developer whether to cut before touching any file

### Scenario: Confirmation proceeds identically to auto
- GIVEN the developer confirms the prompt
- WHEN the cut proceeds
- THEN it uses the same `ReleasePipeline` invocation, cut-then-push-then-GitHub sequencing, and `--follow-tags` behavior as `auto` mode

### Scenario: Decline leaves the backlog for on-demand release
- GIVEN the developer declines the prompt
- WHEN the ship completes
- THEN no cut occurs, no tag is created, and the shipped change remains counted as unreleased for a later `/metta-release`

### Scenario: Non-interactive context fails closed with loud notice
- GIVEN `release.on_ship: prompt` in a non-interactive context where no answer can be collected
- WHEN the ship reaches the release step
- THEN the cut is skipped, the ship still completes, and a loud notice states that the release was skipped because prompt mode could not ask


## ADDED: Requirement: Off Mode Preserves On-Demand Releasing

When `release.on_ship` is `off`, ship-path skills MUST run no post-merge release step at all: behavior is identical to the on-demand-only releasing that existed before this capability change, with releases cut solely via `/metta-release`. (Traces: US-3; intent proposal item 2 mode semantics.)

### Scenario: Off mode ships without any release activity
- GIVEN `release.on_ship: off`
- WHEN a ship-path skill completes the merge and main push
- THEN no release status call, no bump derivation, and no cut runs, and releasing remains fully on-demand via `/metta-release`

### Scenario: Off mode leaves surrounding ship behavior untouched
- GIVEN `release.on_ship: off`
- WHEN the ship completes
- THEN tokens, UAT enforcement, and gates behave exactly as they did before the on-ship release capability existed


## MODIFIED: Requirement: Purely Additive When Unconfigured

Projects whose config contains no `release` key MUST see no behavior change in any existing lifecycle command, with one exception: ship-path skills, on completing a user-approved merge, MUST skip the post-merge release cut with a one-line loud notice stating that no release config is present — the skip MUST NOT be an error and MUST NOT block or fail the ship. Release commands invoked directly without release config MUST continue to fail with an actionable message explaining how to configure the capability. The skip path MUST NOT touch tokens, UAT enforcement, or gates. (Traces: US-3; intent safety rail 3 recorded assumption; intent impact on consumer projects.)

### Scenario: Ship without release config skips with one-line notice
- GIVEN a project with no `release` key in its config
- WHEN a ship-path skill completes the merge and main push
- THEN the release step is skipped with a single-line notice that release config is absent, the ship exits successfully, and no version read, cut, or tag occurs

### Scenario: Absent config skip is not a ship blocker
- GIVEN a project with no release configuration
- WHEN the ship-path release step is reached
- THEN the skip is reported as informational — not as an error — and the ship outcome (merge, push, archive) is identical to a ship on a fully released project

### Scenario: Release command without config fails actionably
- GIVEN a project with no release configuration
- WHEN the user invokes the release command directly
- THEN the command exits with an error stating that release config is missing and naming the keys required to enable it, and no files are modified

### Scenario: Skip paths leave tokens UAT and gates untouched
- GIVEN either skip path (absent config, or `on_ship: off`)
- WHEN the ship completes
- THEN token accounting, UAT generation and enforcement, and gate execution behave exactly as before — the release step touches none of them


## ADDED: Requirement: Pre-1.0 Major Bump Guard

While the current product version is below `1.0.0` and `release.allow_major_pre_1` is `false` (explicit or defaulted), an automatically derived `major` bump MUST NOT be applied by the on-ship flow: `auto` mode MUST cut `minor` instead and MUST prominently report both the original major derivation and the downgrade. When `release.allow_major_pre_1` is `true`, the derived major bump MUST be applied as derived. When the current version is `1.0.0` or above, the guard MUST NOT apply. The guard is a layer on top of the existing bump-derivation rules, which MUST remain unchanged. (Traces: US-5; intent safety rail 1; intent out-of-scope on derivation rules.)

### Scenario: Pre-1.0 major downgraded to minor with prominent report
- GIVEN the current version is `0.6.0`, `release.allow_major_pre_1` is not set, and the shipped changes derive a `major` bump
- WHEN the automatic cut runs
- THEN the applied bump is `minor` (yielding `0.7.0`, not `1.0.0`) and the ship output prominently reports that a major was derived and downgraded because the project is pre-1.0

### Scenario: Escape hatch restores the major bump
- GIVEN `release.allow_major_pre_1: true` on a version below `1.0.0`
- WHEN the automatic cut derives a major bump
- THEN the major bump is applied as derived

### Scenario: Guard inert at 1.0.0 and above
- GIVEN the current version is `1.2.0`
- WHEN a major bump is derived by the on-ship flow
- THEN the guard does not apply and the bump proceeds unchanged to `2.0.0`


## ADDED: Requirement: Warn-And-Continue Cut Failure Posture

A failure at any point in the post-merge release step MUST NOT block, fail, or unwind the completed ship: the merge MUST never be reverted, main MUST be left in its pushed state, and the ship MUST complete with a clear warning. The warning MUST identify what failed and MUST state that `/metta-release` can be run on demand to cut the release manually. This is the same posture as UAT generation failure. (Traces: US-6; intent safety rail 2.)

### Scenario: Failed cut never unwinds the merge
- GIVEN the PR is merged and main is fast-forwarded
- WHEN the automatic cut fails at any step (network, gh outage, pipeline error, dirty tree)
- THEN the ship completes successfully with a warning, the merge is never reverted, and main remains in its pushed state

### Scenario: Warning names the failure and the on-demand remedy
- GIVEN a cut failure during the ship-step release flow
- WHEN the developer reads the ship output
- THEN the warning identifies which step failed and states that the release can be cut later on demand via `/metta-release`


## ADDED: Requirement: Single Cut Path Through ReleasePipeline

The ship-step release cut MUST reuse the existing `ReleasePipeline` (`src/release/release-pipeline.ts`) and the `/metta-release` machinery end to end — status, bump derivation, cut, and safety constraints. No parallel or ship-specific cut implementation MAY be introduced, and the on-demand `/metta-release` path MUST keep working and benefit from the same cut/push/GitHub sequencing fix. (Traces: US-1; intent proposal item 5; intent out-of-scope on a second cut implementation.)

### Scenario: Ship-step cut goes through the existing pipeline
- GIVEN an automatic cut triggered by a ship-path skill
- WHEN the cut executes
- THEN it invokes the same `ReleasePipeline.cut` code path and bump-derivation rules as `/metta-release`, with no second cut implementation in the codebase

### Scenario: On-demand release keeps working with fixed sequencing
- GIVEN a developer running `/metta-release` on demand
- WHEN a cut with GitHub publication is performed
- THEN the release completes using the same pipeline and the GitHub release is created only after the tag is on the remote


## ADDED: Requirement: Guard Authorization For Ship-Path Release Cut

The `metta-guard-bash` and `metta-session-mint` hooks MUST authorize the `release cut` invocation issued by ship-path skills in both fork (Tier-1 `agent_type`) and main-session contexts, without loosening authorization for anything else: a direct `release cut` from an AI orchestrator session holding no valid skill authorization MUST remain blocked, the `metta-release` skill's existing authorization MUST keep working, and no other command's tier or scope MAY be widened by this change. `release status` remains on the guard's read-only allow-list. (Traces: US-6 acceptance criteria; intent proposal item 6.)

### Scenario: Fork-context ship path is authorized to cut
- GIVEN a ship-path skill running in a forked `metta-skill-host` subagent reaches the post-merge release step
- WHEN it issues `metta release status` and `metta release cut --yes`
- THEN the guard permits both calls and the cut proceeds without an authorization failure

### Scenario: Main-session ship path is authorized to cut
- GIVEN a ship-path skill executing in the main session (e.g. `metta-ship`) reaches the post-merge release step
- WHEN it issues the `release cut` call
- THEN the guard authorizes it via the session-tier credential path, so the warn-and-continue posture is exercised only for genuine cut errors, never authorization gaps

### Scenario: Unauthorized direct invocation still blocked
- GIVEN an AI orchestrator session that has invoked no release-authorizing skill
- WHEN it attempts `metta release cut` via Bash
- THEN the `metta-guard-bash` hook blocks the call before execution, exactly as before this change

### Scenario: No other command scope widened
- GIVEN the guard and mint hooks after this change
- WHEN any non-release mutating command is attempted from a context that was previously unauthorized for it
- THEN it is still blocked — the scoping extension covers only the ship-path `release cut` invocation


## ADDED: Requirement: Ship-Step Instructions Include Post-Merge Release Flow

The ship-step instructions of every ship-path skill file (`metta-ship`, `metta-propose` ship opt-in, `metta-quick`, `metta-auto`, `metta-fix-issues`, `metta-fix-gap`) MUST document the post-merge release flow — mode handling for `auto`/`prompt`/`off` and absent config, the status → derive → cut sequence, the safety rails, and the warn-and-continue failure posture — positioned after the merge and main fast-forward + rebuild and before final hand-back. This updates the finalize-ship ship-step wording: the ship step now includes the post-merge release flow as an integral stage. Skill files remain template files copied to `dist/` at build time, never inline string literals. (Traces: US-1; intent proposal item 7 spec deltas.)

### Scenario: Ship skill wording carries the release stage in order
- GIVEN the `metta-ship` skill template after this change
- WHEN its ship-step instructions are read
- THEN the post-merge release flow appears after the merge/fast-forward/rebuild instructions and before hand-back, including mode handling and the warn-and-continue posture

### Scenario: Run-to-merge skills carry the same stage
- GIVEN the `metta-quick`, `metta-auto`, `metta-fix-issues`, and `metta-fix-gap` skill templates and the `metta-propose` ship opt-in path
- WHEN each template's post-merge section is read
- THEN each documents the same release flow with the same ordering constraint (post-merge only, never at PR-open)


## ADDED: Requirement: Grep-Assert Coverage Of Ship-Path Release Step

The test suite MUST include grep-assert tests, in line with the existing skill-content test pattern, verifying that every ship-path skill file carries the post-merge release step. The tests MUST fail when the release step is removed or missing from any of the six ship-path skill files. (Traces: US-1; intent proposal item 7 test deltas.)

### Scenario: All six ship-path skills asserted
- GIVEN the grep-assert test suite for skill content
- WHEN it runs against the built skill templates
- THEN it asserts the presence of the post-merge release step in each of `metta-ship`, `metta-propose`, `metta-quick`, `metta-auto`, `metta-fix-issues`, and `metta-fix-gap`

### Scenario: Removing the step from one skill fails the tests
- GIVEN the post-merge release step is deleted from one ship-path skill file
- WHEN the grep-assert tests run
- THEN the test for that skill fails, naming the file missing the release step


## MODIFIED: Requirement: Opt-In GitHub Release Publication

Creation of a GitHub release via the `gh` CLI MUST remain strictly opt-in via `release.github_release`: when the flag is disabled or omitted, no `gh` command MUST be executed anywhere in the release flow. Publication MUST no longer be a step inside the release cut: `ReleasePipeline.cut()` MUST be purely local (version file, changelog, release commit, annotated tag), the in-cut `gh` step MUST be removed, and the `--github` flag MUST be removed from `metta release cut` — invoking `metta release cut --github` MUST fail with an error that names the removed flag and points to the fixed cut → push → publish sequence, performing no release mutation.

When `release.github_release` is `true`, publication MUST be performed by the skill-side post-push step, only after the tag exists on the remote: the skill MUST first probe `gh release view <tag>` and MUST skip creation when a release for the tag already exists (idempotent re-run), otherwise it MUST run `gh release create <tag> --verify-tag --notes-file -` with the version's changelog section as the notes body. `--verify-tag` MUST be present so `gh` aborts — rather than silently creating a wrong tag from default-branch HEAD — if the tag is not on the remote. To supply the notes body without re-parsing `docs/changelog.md`, `metta release cut --json` MUST emit the extracted changelog-section notes string for the cut version. On the on-demand `/metta-release` path, the same post-push sequence applies and the tag-carrying push preceding publication MUST be gated on explicit per-run user confirmation; on ship paths it rides the single already-authorized main push with `--follow-tags`. (Traces: US-4; research decision "Local-only cut + skill-side verified GitHub publish", adopted riders 1–4 and 6.)

### Scenario: Release created only after the tag is on the remote
- GIVEN `release.github_release: true` and a ship-path release step whose local cut has completed
- WHEN the authorized main push with `--follow-tags` lands the tag on the remote and the publication step runs
- THEN the skill probes `gh release view <tag>`, finds no existing release, and runs `gh release create <tag> --verify-tag --notes-file -` with the version's changelog section as the notes body — and no `gh` command ran at any earlier point in the flow

### Scenario: Removed --github flag errors with a pointer to the fixed sequence
- GIVEN a caller invoking `metta release cut --github`
- WHEN the command is parsed
- THEN it exits with an error stating that `--github` has been removed and pointing to the cut → push → publish sequence, and no version file, changelog, commit, tag, or `gh` invocation occurs

### Scenario: Idempotent probe skips an already-published release
- GIVEN a re-run of the publication step for a tag whose GitHub release already exists
- WHEN the skill probes `gh release view <tag>`
- THEN the probe finds the existing release, `gh release create` is not invoked, and the step completes without error or duplicate release

### Scenario: cut --json supplies the notes body
- GIVEN a cut of version `0.7.0` invoked as `metta release cut --yes --json`
- WHEN the cut completes
- THEN the JSON output includes the extracted changelog-section notes string for `0.7.0`, so the skill passes it to `--notes-file -` without re-parsing `docs/changelog.md`

### Scenario: On-demand release confirms the push before publishing
- GIVEN `release.github_release: true` and a developer running `/metta-release` on demand
- WHEN the local cut completes
- THEN the skill asks for explicit per-run confirmation before running `git push --follow-tags origin main`, and only after that push lands does it run the same probe-then-create publication step


## MODIFIED: Requirement: Graceful Degradation When gh Unavailable

Graceful degradation MUST apply at the skill-side post-push publication step (the in-cut GitHub step no longer exists): when `release.github_release` is `true` but `gh` is missing from PATH, unauthenticated, or the `gh release create` invocation fails, the completed local release (version file rewrite, changelog, release commit, annotated tag) and the already-pushed tag MUST remain intact — the failure MUST NOT roll back or invalidate any of them, MUST NOT unwind or un-merge the ship, and MUST NOT block the ship-path skill or the on-demand `/metta-release` from completing. The skill MUST warn with a message naming the cause (missing binary vs. unauthenticated vs. create failure) and reporting the exact manual command — `gh release create <tag> --verify-tag` with the notes — so the developer can publish later. Because the publication step probes `gh release view <tag>` before creating, a later re-run (on-demand or manual) MUST be able to publish the release for the already-pushed tag without re-cutting and without duplicating an existing release. (Traces: US-4, US-6; research decision "Local-only cut + skill-side verified GitHub publish", adopted rider 6; base US-5 acceptance criteria.)

### Scenario: Missing gh binary warns with the manual command and the ship continues
- GIVEN `release.github_release: true` and `gh` is not installed on PATH
- WHEN a ship-path release step reaches the post-push publication step
- THEN the release commit, annotated tag, and tag push all stand, the skill warns that `gh` was not found and reports the exact `gh release create <tag> --verify-tag` command to run manually, and the ship completes successfully with the merge and main push untouched

### Scenario: Failed gh release create warns and continues, re-runnable later
- GIVEN `gh` is installed and authenticated but `gh release create <tag> --verify-tag` fails (e.g. API outage or transient error)
- WHEN the publication step handles the failure
- THEN the skill warns naming the create failure, the ship (or on-demand release) completes without any rollback of the local release or pushed tag, and a later run of the publication step probes `gh release view <tag>`, finds no release, and publishes it for the same tag without re-cutting

### Scenario: Unauthenticated gh degrades the on-demand release the same way
- GIVEN `gh` is installed but unauthenticated and a developer runs `/metta-release` with `release.github_release: true`
- WHEN the confirmed push lands and the publication step runs
- THEN the local release and pushed tag succeed, the warning identifies the authentication problem and how to authenticate and retry publication, and the on-demand release completes rather than failing
