# UAT: fix-automatic-versioning-release-capability-metta

- **Change**: fix-automatic-versioning-release-capability-metta
- **Generated**: 2026-08-11
- **Source**: user stories (stories.md)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

### US-1: Configure the host project's product version

*Independent test:* With version config set, metta reports the host project's current product version read from the configured version file, and invalid config is rejected by Zod validation with a clear error.

#### Step 1.1
- **Setup**: a Node project with `package.json` version `0.4.0` and version config pointing at it
- **Do**: the user asks metta for the current product version
- **Observe**: metta reports `0.4.0` from the configured file, not `installed_version`
- [x] Pass

#### Step 1.2
- **Setup**: a config specifying an unsupported scheme or a malformed version-file path
- **Do**: the config is loaded
- **Observe**: Zod validation fails with an error message that clearly names the offending key
- [x] Pass

#### Step 1.3
- **Setup**: a project that has never configured the release capability
- **Do**: the user runs any existing lifecycle command
- **Observe**: behavior is unchanged (purely additive capability)
- [x] Pass

#### Step 1.4
- **Setup**: version config exists
- **Do**: any error or doc mentions the product version
- **Observe**: wording distinguishes it from `installed_version` so the two cannot be confused
- [x] Pass

### US-2: Get a recommended bump level derived from shipped work

*Independent test:* Given a set of shipped changes since the last release tag with known conventional-commit prefixes, the derivation function returns the correct bump level deterministically, and the user can override it.

#### Step 2.1
- **Setup**: only `fix:`-prefixed shipped changes since the last release tag
- **Do**: bump derivation runs
- **Observe**: it recommends a patch bump
- [x] Pass

#### Step 2.2
- **Setup**: at least one `feat:`-prefixed shipped change and no breaking markers
- **Do**: bump derivation runs
- **Observe**: it recommends a minor bump
- [x] Pass

#### Step 2.3
- **Setup**: any shipped change carrying a breaking-change marker
- **Do**: bump derivation runs
- **Observe**: it recommends a major bump
- [x] Pass

#### Step 2.4
- **Setup**: a recommended bump level
- **Do**: the user explicitly chooses a different level
- **Observe**: the release proceeds with the user's choice and the recommendation does not block it
- [x] Pass

#### Step 2.5
- **Setup**: the same inputs (changes, tags, metadata)
- **Do**: derivation runs twice
- **Observe**: the result is identical (pure function, no side effects)
- [x] Pass

### US-3: Cut a release with one operation

*Independent test:* One invocation of the release operation produces a bumped version file, a regenerated changelog with the new version heading, and an annotated git tag — all consistent with each other — with no push to remote.

#### Step 3.1
- **Setup**: a project at version `0.4.0` with shipped changes recommending a minor bump
- **Do**: the user invokes the release operation and confirms
- **Observe**: the version file reads `0.5.0`, `docs/changelog.md` has a `0.5.0` section containing those changes, and an annotated tag for `0.5.0` exists locally
- [x] Pass

#### Step 3.2
- **Setup**: the release operation completes
- **Do**: the user inspects the remote
- **Observe**: nothing was pushed — no branch, no tag — without a separate explicit confirmation
- [x] Pass

#### Step 3.3
- **Setup**: any step of the release cut fails (e.g. tag already exists)
- **Do**: the operation aborts
- **Observe**: the user is told what failed and no `--force` or destructive git operation is attempted
- [x] Pass

### US-4: Read a changelog organized by released version

*Independent test:* After a release cut, the regenerated `docs/changelog.md` shows version-anchored sections where each archived change appears under exactly one version (or the unreleased section), replacing the flat date/changeName list.

#### Step 4.1
- **Setup**: archived changes shipped before and after the last release tag
- **Do**: the changelog regenerates
- **Observe**: pre-tag changes appear under that version's heading and post-tag changes appear under an unreleased/pending heading
- [x] Pass

#### Step 4.2
- **Setup**: multiple releases exist
- **Do**: the changelog regenerates
- **Observe**: version sections appear in release order and no change is listed under more than one version
- [x] Pass

#### Step 4.3
- **Setup**: a project that has adopted the capability
- **Do**: docs regeneration runs during finalize
- **Observe**: the versioned changelog shape is preserved rather than reverting to the flat list
- [ ] Pass

### US-5: Publish an opt-in GitHub release

*Independent test:* A release cut without confirmation never invokes `gh release`; with explicit opt-in confirmation, a GitHub release is created for the new tag with notes drawn from the release's changes.

#### Step 5.1
- **Setup**: a release cut where the user declines or is never asked about GitHub publishing
- **Do**: the operation completes (Run: `gh release`)
- **Observe**: no `gh` release command is executed
- [x] Pass

#### Step 5.2
- **Setup**: the user explicitly opts in to a GitHub release
- **Do**: the release cut completes
- **Observe**: a GitHub release exists for the new tag with notes reflecting the version's changes
- [ ] Pass

#### Step 5.3
- **Setup**: `gh` is unavailable or unauthenticated
- **Do**: the user opts in
- **Observe**: the local release (version bump, changelog, tag) still succeeds and the GitHub step fails with an actionable message
- [ ] Pass

### US-6: Cut releases through the skill layer as an AI orchestrator

*Independent test:* An AI orchestrator can complete a release cut end-to-end via the skill, and a direct CLI invocation of the release command from an unauthorized AI session is blocked by the guard hook.

#### Step 6.1
- **Setup**: an AI orchestrator session
- **Do**: the release skill is invoked
- **Observe**: the release flow runs with the correct authorization tier and completes without the orchestrator calling the CLI directly
- [ ] Pass

#### Step 6.2
- **Setup**: an AI session without the required authorization
- **Do**: it attempts the release CLI command via Bash
- **Observe**: the `metta-guard-bash` hook blocks the call
- [x] Pass

#### Step 6.3
- **Setup**: a human in a terminal
- **Do**: they run the release CLI command directly
- **Observe**: it works without the skill layer
- [ ] Pass

### US-7: See pre-existing manual releases rendered sanely

*Independent test:* On a repo with pre-existing manual release tags, the regenerated changelog renders those versions sanely (best-effort backfill or an explicit pre-existing-history section), and bump derivation treats the latest manual tag as the release boundary.

#### Step 7.1
- **Setup**: metta's repo with manual tags v0.2.0–v0.4.0
- **Do**: the changelog regenerates under the new format
- **Observe**: those versions appear sanely — via best-effort anchoring or an explicit prior-history section — and no existing entries are lost
- [ ] Pass

#### Step 7.2
- **Setup**: the last release was a manual tag
- **Do**: the first automated release cut runs
- **Observe**: bump derivation counts only changes shipped since that tag and the new version increments from it
- [x] Pass

## Additional scenarios

#### Step 8.1: Valid semver config accepted
- **Setup**: a release config specifying scheme `semver`, version file `package.json`, tag prefix `v`, and GitHub release opt-in `false`
- **Do**: the config is loaded
- **Observe**: Zod validation passes and the parsed config exposes all four keys with those values
- **Machine-verified** — summary.md references "Valid semver config accepted"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.2: Unsupported scheme rejected with key named
- **Setup**: a release config specifying scheme `calver`
- **Do**: the config is loaded
- **Observe**: Zod validation fails and the error message names the scheme key and states that only `semver` is supported
- **Machine-verified** — summary.md references "Unsupported scheme rejected with key named"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.3: Malformed version-file path rejected
- **Setup**: a release config whose version-file value is an empty string
- **Do**: the config is loaded
- **Observe**: Zod validation fails and the error message names the version-file key
- **Machine-verified** — summary.md references "Malformed version-file path rejected"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.4: Defaults applied for omitted optional keys
- **Setup**: a release config that specifies only scheme and version-file location
- **Do**: the config is loaded
- **Observe**: the tag prefix defaults to `v` and the GitHub-release opt-in defaults to disabled
- **Machine-verified** — summary.md references "Defaults applied for omitted optional keys"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.5: Current product version read from configured file
- **Setup**: a Node project whose `package.json` version field is `0.4.0` and release config pointing at `package.json`
- **Do**: the user asks metta for the current product version
- **Observe**: metta reports `0.4.0` sourced from `package.json`, not from `installed_version`
- **Machine-verified** — summary.md references "Current product version read from configured file"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.6: Version file missing yields distinguishing error
- **Setup**: release config pointing at a version file that does not exist
- **Do**: the product version is read
- **Observe**: the operation fails with an error that names the configured path and refers to the "product version", without mentioning or falling back to `installed_version`
- **Machine-verified** — summary.md references "Version file missing yields distinguishing error"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.7: Version drift stamp untouched by release operations
- **Setup**: a project with an `installed_version` stamp recorded by version drift
- **Do**: any release-versioning operation (version read, bump, release cut) completes
- **Observe**: the `installed_version` value is byte-identical to its value before the operation
- **Machine-verified** — summary.md references "Version drift stamp untouched by release operations"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.8: Existing lifecycle unchanged without release config
- **Setup**: a project with no release configuration
- **Do**: the user runs an existing lifecycle command (e.g. finalize or ship)
- **Observe**: the command behaves exactly as before this capability existed, with no release prompts, no version reads, and no new output
- **Machine-verified** — summary.md references "Existing lifecycle unchanged without release config"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.9: Release command without config fails actionably
- **Setup**: a project with no release configuration
- **Do**: the user invokes the release command
- **Observe**: the command exits with an error stating that release config is missing and naming the keys required to enable it, and no files are modified
- **Machine-verified** — summary.md references "Release command without config fails actionably"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.10: Only fixes recommend patch
- **Setup**: the set of shipped changes since the last release tag contains only `fix:`-prefixed changes
- **Do**: bump derivation runs over that set
- **Observe**: it returns `patch`
- **Machine-verified** — summary.md references "Only fixes recommend patch"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.11: Feature present recommends minor
- **Setup**: the shipped-change set contains at least one `feat:`-prefixed change and no breaking-change markers
- **Do**: bump derivation runs
- **Observe**: it returns `minor`
- **Machine-verified** — summary.md references "Feature present recommends minor"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.12: Breaking marker recommends major
- **Setup**: the shipped-change set contains a change carrying a breaking-change marker (e.g. `feat!:` or a `BREAKING CHANGE:` footer)
- **Do**: bump derivation runs (Run: `BREAKING CHANGE:`)
- **Observe**: it returns `major`
- **Machine-verified** — summary.md references "Breaking marker recommends major"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.13: Derivation is deterministic and pure
- **Setup**: a fixed in-memory input of shipped changes, last release tag, and metadata
- **Do**: the derivation function is invoked twice with that same input
- **Observe**: both invocations return the same bump level and no file, git state, or process environment is modified
- **Machine-verified** — summary.md references "Derivation is deterministic and pure"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.14: Override recommendation with explicit level
- **Setup**: bump derivation recommends `patch` for the pending release
- **Do**: the user explicitly selects `minor` and confirms the release
- **Observe**: the release proceeds computing the next version with a minor bump and records that the level was user-selected
- **Machine-verified** — summary.md references "Override recommendation with explicit level"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.15: Accepting the recommendation
- **Setup**: bump derivation recommends `minor`
- **Do**: the user confirms without overriding
- **Observe**: the release proceeds with a minor bump
- **Machine-verified** — summary.md references "Accepting the recommendation"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.16: One invocation produces consistent release artifacts
- **Setup**: a project at version `0.4.0` with shipped changes since the last release tag recommending a minor bump
- **Do**: the user invokes the release operation and confirms `0.5.0`
- **Observe**: the version file reads `0.5.0`, `docs/changelog.md` contains a `0.5.0` section listing those changes, a release commit containing both files exists, and an annotated tag `v0.5.0` points at that commit
- **Machine-verified** — summary.md references "One invocation produces consistent release artifacts"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.17: Tag annotation carries release identity
- **Setup**: a release cut for version `0.5.0` completes
- **Do**: the created tag is inspected
- **Observe**: it is an annotated (not lightweight) tag whose annotation message includes the version `0.5.0`
- **Machine-verified** — summary.md references "Tag annotation carries release identity"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.18: Nothing pushed without explicit confirmation
- **Setup**: a release cut completes locally
- **Do**: the user inspects the remote without having separately confirmed a push
- **Observe**: no branch and no tag from the release exists on the remote
- **Machine-verified** — summary.md references "Nothing pushed without explicit confirmation"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.19: Existing tag aborts without force
- **Setup**: a tag `v0.5.0` already exists locally
- **Do**: the release operation attempts to cut version `0.5.0`
- **Observe**: the operation aborts before creating the release commit or reports the tag step as failed, the error names the conflicting tag, and no `--force`, tag deletion, or history rewrite is attempted
- **Machine-verified** — summary.md references "Existing tag aborts without force"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.20: Mid-cut failure is reported with the failing step
- **Setup**: the changelog regeneration step fails during a release cut
- **Do**: the operation aborts
- **Observe**: the user is told that the changelog step failed and why, and no annotated tag for the target version has been created
- **Machine-verified** — summary.md references "Mid-cut failure is reported with the failing step"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.21: First release derives from all shipped changes
- **Setup**: a repository with no tags matching the configured tag prefix and a version file reading `0.1.0`
- **Do**: the user invokes the release operation
- **Observe**: bump derivation runs over all shipped changes, the recommendation is presented against base version `0.1.0`, and the cut proceeds normally on confirmation
- **Machine-verified** — summary.md references "First release derives from all shipped changes"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.22: Manual tag treated as release boundary
- **Setup**: the latest matching tag is a hand-created `v0.4.0` predating this capability
- **Do**: the first automated release cut runs
- **Observe**: bump derivation counts only changes shipped after `v0.4.0` and the new version increments from `0.4.0`
- **Machine-verified** — summary.md references "Manual tag treated as release boundary"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.23: Changes split across release boundary
- **Setup**: archived changes A and B shipped before tag `v0.5.0` and change C shipped after it
- **Do**: the changelog regenerates
- **Observe**: A and B appear under the `0.5.0` heading, C appears under the unreleased heading, and none of them appears twice
- **Machine-verified** — summary.md references "Changes split across release boundary"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.24: Multiple versions render in release order
- **Setup**: releases `0.4.0` and `0.5.0` exist with changes attributed to each
- **Do**: the changelog regenerates
- **Observe**: the `0.5.0` section appears before the `0.4.0` section and each change is listed under exactly one version
- **Machine-verified** — summary.md references "Multiple versions render in release order"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.25: Versioned shape survives finalize regeneration
- **Setup**: a project that has adopted release-versioning and has a versioned changelog
- **Do**: docs regeneration runs during finalize for a subsequent change
- **Observe**: the regenerated `docs/changelog.md` retains version-anchored sections (with the new change under unreleased) and does not revert to the flat date/changeName list
- **Machine-verified** — summary.md references "Versioned shape survives finalize regeneration"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.26: Manual tags render without losing entries
- **Setup**: metta's repository with manual tags `v0.2.0`–`v0.4.0` and archived change entries predating the capability
- **Do**: the changelog regenerates under the versioned format
- **Observe**: the changelog contains headings or an explicit prior-history section covering `0.2.0`–`0.4.0`, and every entry present in the previous flat changelog is still present somewhere in the output
- **Machine-verified** — summary.md references "Manual tags render without losing entries"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.27: No confirmation means no gh invocation
- **Setup**: a release cut where the user declines GitHub publication or the opt-in flag is disabled so no prompt occurs
- **Do**: the operation completes
- **Observe**: no `gh` command was executed
- **Machine-verified** — summary.md references "No confirmation means no gh invocation"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.28: Confirmed opt-in publishes release notes
- **Setup**: the opt-in flag is enabled, `gh` is installed and authenticated, and the user explicitly confirms GitHub publication
- **Do**: the release cut completes
- **Observe**: a GitHub release exists for the new tag whose notes reflect the changes in that version's changelog section
- **Machine-verified** — summary.md references "Confirmed opt-in publishes release notes"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.29: Missing gh binary degrades gracefully
- **Setup**: `gh` is not installed and the user opts into GitHub publication
- **Do**: the release cut runs
- **Observe**: the version file, changelog, release commit, and annotated tag are all produced, and the GitHub step reports that `gh` was not found with guidance to install it and publish the tag manually
- **Machine-verified** — summary.md references "Missing gh binary degrades gracefully"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.30: Unauthenticated gh degrades gracefully
- **Setup**: `gh` is installed but not authenticated
- **Do**: the user opts into GitHub publication during a release cut
- **Observe**: the local release succeeds and the GitHub step fails with a message identifying the authentication problem and how to authenticate and retry
- **Machine-verified** — summary.md references "Unauthenticated gh degrades gracefully"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.31: Human runs release CLI directly
- **Setup**: a human in a terminal (no AI orchestrator session) on a configured project
- **Do**: they run the release CLI command
- **Observe**: the release flow runs without requiring any skill invocation or guard credential
- **Machine-verified** — summary.md references "Human runs release CLI directly"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.32: Version status command reports version and recommendation
- **Setup**: a configured project at version `0.4.0` with `feat:` changes shipped since the last tag
- **Do**: the user runs the version status command
- **Observe**: output includes current version `0.4.0` and a recommended `minor` bump, and no files are modified
- **Machine-verified** — summary.md references "Version status command reports version and recommendation"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.33: Skill-mediated release is authorized
- **Setup**: an AI orchestrator session invoking the release skill
- **Do**: the skill drives the release flow and its authorized context issues the release CLI call
- **Observe**: the guard hook permits the call and the release completes end-to-end without the orchestrator calling the CLI directly
- **Machine-verified** — summary.md references "Skill-mediated release is authorized"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.34: Unauthorized AI invocation is blocked
- **Setup**: an AI session that has not invoked the release skill and holds no valid authorization for the release command's tier
- **Do**: it attempts the release CLI command via Bash
- **Observe**: the `metta-guard-bash` hook blocks the call before execution
- **Machine-verified** — summary.md references "Unauthorized AI invocation is blocked"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

#### Step 8.35: Skill delivered as template file
- **Setup**: the project is built with `tsc` and the template copy step
- **Do**: the build completes
- **Observe**: the release skill exists in `dist/` as a copied template file and its content appears in no TypeScript string literal
- **Machine-verified** — summary.md references "Skill delivered as template file"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [x] Pass

## UAT run — 2026-08-11

- **Runner**: inline (session subagent cap 200/200 reached; orchestrator executed the runner contract directly, noted per fallback directive)
- **Method**: live fixture project (scratchpad) driven via the built CLI (`node dist/cli/index.js`) for fixture-only operations; guard-block check exercised via the real `metta` binary; machine-verified steps accepted on their annotations plus finalize/CI gate evidence (2085/2085 tests)
- **Results**: 52 pass / 0 fail / 6 skip
- **Passed (manual, directly observed)**: 1.1-1.4, 2.1-2.5, 3.1-3.3, 4.1, 4.2, 5.1, 6.2, 7.2 — fixture cuts produced 0.4.0→0.5.0→0.5.1→0.5.2 with consistent version file/changelog/annotated tags, override recorded, tag conflict refused without force, manual tag honored as boundary, guard blocked unauthorized `release cut`
- **Passed (machine-verified)**: 8.1-8.35
- **Skipped (needs manual acceptance)**:
  - 4.3 — finalize-time changelog regen not exercised in fixture (covered by 8.25)
  - 5.2 — real GitHub release requires a remote repo (covered mocked by 8.28)
  - 5.3 — gh-unavailable degradation not simulated live (covered by 8.29/8.30)
  - 6.1 — skill-mediated release: to be observed during the upcoming real v0.5.0 cut
  - 6.3 — requires a human terminal
  - 7.1 — metta repo has not yet adopted release config; to be observed at the real cut
- **Note**: bad-scheme config error (1.2/8.2) names the key and constraint correctly but renders as a raw Zod issue array — cosmetic, logged separately
