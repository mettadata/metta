# release-versioning

## Requirement: Release Configuration Schema

The system MUST define version/release configuration keys validated with a Zod schema on every read and write, covering: versioning scheme (only `semver` accepted initially), version-file location (path to the file holding the host project's product version, e.g. `package.json`), tag prefix (defaulting to `v`), and a GitHub-release opt-in flag (defaulting to disabled). Validation failures MUST name the offending key in the error message. (Traces: US-1; intent proposal item 1.)

### Scenario: Valid semver config accepted
- GIVEN a release config specifying scheme `semver`, version file `package.json`, tag prefix `v`, and GitHub release opt-in `false`
- WHEN the config is loaded
- THEN Zod validation passes and the parsed config exposes all four keys with those values

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
- THEN the tag prefix defaults to `v` and the GitHub-release opt-in defaults to disabled


## Requirement: Product Version Distinct From Installed Version

The system MUST treat the host project's product version — read from the configured version file — as a concept distinct from metta's `installed_version` install stamp. The product-version reader MUST return the version from the configured file, MUST NOT read or modify `installed_version`, and error messages and generated docs referencing the product version MUST use wording that distinguishes it from `installed_version`. The semantics of `src/config/version-drift.ts` MUST NOT change. (Traces: US-1; intent problem statement on `installed_version`.)

### Scenario: Current product version read from configured file
- GIVEN a Node project whose `package.json` version field is `0.4.0` and release config pointing at `package.json`
- WHEN the user asks metta for the current product version
- THEN metta reports `0.4.0` sourced from `package.json`, not from `installed_version`

### Scenario: Version file missing yields distinguishing error
- GIVEN release config pointing at a version file that does not exist
- WHEN the product version is read
- THEN the operation fails with an error that names the configured path and refers to the "product version", without mentioning or falling back to `installed_version`

### Scenario: Version drift stamp untouched by release operations
- GIVEN a project with an `installed_version` stamp recorded by version drift
- WHEN any release-versioning operation (version read, bump, release cut) completes
- THEN the `installed_version` value is byte-identical to its value before the operation


## Requirement: Purely Additive When Unconfigured

Projects that never configure or invoke the release capability MUST see no behavior change in any existing lifecycle command, and release commands invoked without release config MUST fail with an actionable message explaining how to configure the capability. (Traces: US-1 acceptance criteria; intent impact on consumer projects.)

### Scenario: Existing lifecycle unchanged without release config
- GIVEN a project with no release configuration
- WHEN the user runs an existing lifecycle command (e.g. finalize or ship)
- THEN the command behaves exactly as before this capability existed, with no release prompts, no version reads, and no new output

### Scenario: Release command without config fails actionably
- GIVEN a project with no release configuration
- WHEN the user invokes the release command
- THEN the command exits with an error stating that release config is missing and naming the keys required to enable it, and no files are modified


## Requirement: Bump Derivation From Shipped Changes

The system MUST provide a pure function that derives the recommended semver bump level from the shipped changes since the last release tag, using conventional-commit prefixes and archived change metadata: any breaking-change marker MUST yield `major`; otherwise any `feat:` change MUST yield `minor`; otherwise `fix:` (and remaining) changes MUST yield `patch`. The function MUST be deterministic and side-effect free: identical inputs MUST produce identical output, and it MUST NOT perform git, filesystem, or network I/O — callers gather inputs at the edges. (Traces: US-2; intent proposal item 2.)

### Scenario: Only fixes recommend patch
- GIVEN the set of shipped changes since the last release tag contains only `fix:`-prefixed changes
- WHEN bump derivation runs over that set
- THEN it returns `patch`

### Scenario: Feature present recommends minor
- GIVEN the shipped-change set contains at least one `feat:`-prefixed change and no breaking-change markers
- WHEN bump derivation runs
- THEN it returns `minor`

### Scenario: Breaking marker recommends major
- GIVEN the shipped-change set contains a change carrying a breaking-change marker (e.g. `feat!:` or a `BREAKING CHANGE:` footer)
- WHEN bump derivation runs
- THEN it returns `major`

### Scenario: Derivation is deterministic and pure
- GIVEN a fixed in-memory input of shipped changes, last release tag, and metadata
- WHEN the derivation function is invoked twice with that same input
- THEN both invocations return the same bump level and no file, git state, or process environment is modified


## Requirement: User Override Of Recommended Bump

The release flow MUST present the derived bump level as a recommendation and MUST allow the user to explicitly select a different bump level (patch, minor, or major); the user's explicit choice MUST take precedence and the recommendation MUST NOT block the release. (Traces: US-2 acceptance criteria.)

### Scenario: Override recommendation with explicit level
- GIVEN bump derivation recommends `patch` for the pending release
- WHEN the user explicitly selects `minor` and confirms the release
- THEN the release proceeds computing the next version with a minor bump and records that the level was user-selected

### Scenario: Accepting the recommendation
- GIVEN bump derivation recommends `minor`
- WHEN the user confirms without overriding
- THEN the release proceeds with a minor bump


## Requirement: Release Cut Operation

The system MUST provide a single user-invoked release operation that, after the user confirms the target version, performs in order: (1) rewrite the configured version file with the new version, (2) regenerate `docs/changelog.md` with the new version's section containing the released changes, (3) create a release commit containing the version-file and changelog updates using a conventional commit message, and (4) create an annotated git tag named `{tag_prefix}{new_version}` pointing at the release commit. All outputs MUST be mutually consistent (same version string in file, changelog heading, and tag). (Traces: US-3; intent proposal item 3.)

### Scenario: One invocation produces consistent release artifacts
- GIVEN a project at version `0.4.0` with shipped changes since the last release tag recommending a minor bump
- WHEN the user invokes the release operation and confirms `0.5.0`
- THEN the version file reads `0.5.0`, `docs/changelog.md` contains a `0.5.0` section listing those changes, a release commit containing both files exists, and an annotated tag `v0.5.0` points at that commit

### Scenario: Tag annotation carries release identity
- GIVEN a release cut for version `0.5.0` completes
- WHEN the created tag is inspected
- THEN it is an annotated (not lightweight) tag whose annotation message includes the version `0.5.0`


## Requirement: Release Cut Safety Constraints

The release operation MUST NOT push any branch or tag to a remote as part of the cut; pushing MUST require a separate explicit user confirmation. The operation MUST NOT use `--force`, `--no-verify`, or any destructive git operation. If any step fails (e.g. the target tag already exists, or the version file cannot be written), the operation MUST abort, report which step failed and why, and MUST NOT attempt to overwrite or delete existing git objects. (Traces: US-3 acceptance criteria; constitution git constraints.)

### Scenario: Nothing pushed without explicit confirmation
- GIVEN a release cut completes locally
- WHEN the user inspects the remote without having separately confirmed a push
- THEN no branch and no tag from the release exists on the remote

### Scenario: Existing tag aborts without force
- GIVEN a tag `v0.5.0` already exists locally
- WHEN the release operation attempts to cut version `0.5.0`
- THEN the operation aborts before creating the release commit or reports the tag step as failed, the error names the conflicting tag, and no `--force`, tag deletion, or history rewrite is attempted

### Scenario: Mid-cut failure is reported with the failing step
- GIVEN the changelog regeneration step fails during a release cut
- WHEN the operation aborts
- THEN the user is told that the changelog step failed and why, and no annotated tag for the target version has been created


## Requirement: First Release Without Prior Tag

When no release tag matching the configured tag prefix exists in the repository, the system MUST treat all shipped changes as candidates for the first release, MUST derive the bump recommendation from that full set, and MUST base the new version on the current value in the configured version file. The absence of a prior tag MUST NOT be treated as an error. (Traces: US-2, US-3; intent requirement for release boundary handling.)

### Scenario: First release derives from all shipped changes
- GIVEN a repository with no tags matching the configured tag prefix and a version file reading `0.1.0`
- WHEN the user invokes the release operation
- THEN bump derivation runs over all shipped changes, the recommendation is presented against base version `0.1.0`, and the cut proceeds normally on confirmation

### Scenario: Manual tag treated as release boundary
- GIVEN the latest matching tag is a hand-created `v0.4.0` predating this capability
- WHEN the first automated release cut runs
- THEN bump derivation counts only changes shipped after `v0.4.0` and the new version increments from `0.4.0`


## Requirement: Version-Anchored Changelog Generation

Changelog generation (the `generateChangelog` path in `src/docs/doc-generator.ts`, covered by existing docs generation) MUST produce version-anchored output: each released version gets a heading containing its version string, changes are grouped under the version in which they were released, an unreleased/pending section groups changes shipped after the latest release tag, version sections appear in release order (newest first), and no change appears under more than one section. The grouping logic MUST be a pure function over changes and release boundaries. (Traces: US-4; intent proposal item 5 and impact on `doc-generator.ts`.)

### Scenario: Changes split across release boundary
- GIVEN archived changes A and B shipped before tag `v0.5.0` and change C shipped after it
- WHEN the changelog regenerates
- THEN A and B appear under the `0.5.0` heading, C appears under the unreleased heading, and none of them appears twice

### Scenario: Multiple versions render in release order
- GIVEN releases `0.4.0` and `0.5.0` exist with changes attributed to each
- WHEN the changelog regenerates
- THEN the `0.5.0` section appears before the `0.4.0` section and each change is listed under exactly one version

### Scenario: Versioned shape survives finalize regeneration
- GIVEN a project that has adopted release-versioning and has a versioned changelog
- WHEN docs regeneration runs during finalize for a subsequent change
- THEN the regenerated `docs/changelog.md` retains version-anchored sections (with the new change under unreleased) and does not revert to the flat date/changeName list


## Requirement: Pre-Existing Manual Release History Rendering

On a repository with release tags created before this capability was adopted, changelog regeneration MUST render those versions sanely without losing existing entries: changes MUST be anchored to manual tags on a best-effort basis, and any entries that cannot be attributed to a specific version MUST appear under an explicit prior-history (or unreleased) section rather than being dropped. Accurate per-version reconstruction of historical change lists is NOT required. (Traces: US-7; intent out-of-scope note on backfill.)

### Scenario: Manual tags render without losing entries
- GIVEN metta's repository with manual tags `v0.2.0`–`v0.4.0` and archived change entries predating the capability
- WHEN the changelog regenerates under the versioned format
- THEN the changelog contains headings or an explicit prior-history section covering `0.2.0`–`0.4.0`, and every entry present in the previous flat changelog is still present somewhere in the output


## Requirement: Opt-In GitHub Release Publication

Creation of a GitHub release via the `gh` CLI MUST be strictly opt-in: the release operation MUST NOT execute any `gh` command unless the user explicitly confirms GitHub publication for this cut (config opt-in enables the prompt; it does not bypass confirmation). On confirmation, the system MUST create a GitHub release for the new tag with notes drawn from the version's changes. (Traces: US-5; intent proposal item 3.)

### Scenario: No confirmation means no gh invocation
- GIVEN a release cut where the user declines GitHub publication or the opt-in flag is disabled so no prompt occurs
- WHEN the operation completes
- THEN no `gh` command was executed

### Scenario: Confirmed opt-in publishes release notes
- GIVEN the opt-in flag is enabled, `gh` is installed and authenticated, and the user explicitly confirms GitHub publication
- WHEN the release cut completes
- THEN a GitHub release exists for the new tag whose notes reflect the changes in that version's changelog section


## Requirement: Graceful Degradation When gh Unavailable

When the user opts into GitHub publication but `gh` is missing from PATH or unauthenticated, the local release (version file rewrite, changelog, release commit, annotated tag) MUST still succeed, and the GitHub step MUST fail separately with an actionable message naming the cause (missing binary vs. unauthenticated) and how to retry publication manually. The failed GitHub step MUST NOT roll back or invalidate the local release. (Traces: US-5 acceptance criteria.)

### Scenario: Missing gh binary degrades gracefully
- GIVEN `gh` is not installed and the user opts into GitHub publication
- WHEN the release cut runs
- THEN the version file, changelog, release commit, and annotated tag are all produced, and the GitHub step reports that `gh` was not found with guidance to install it and publish the tag manually

### Scenario: Unauthenticated gh degrades gracefully
- GIVEN `gh` is installed but not authenticated
- WHEN the user opts into GitHub publication during a release cut
- THEN the local release succeeds and the GitHub step fails with a message identifying the authentication problem and how to authenticate and retry


## Requirement: Release CLI Command Surface

The system MUST expose the release capability as a Commander.js CLI command surface: a command reporting the current product version and recommended bump, and a command performing the release cut. Both MUST work for a human running the CLI directly in a terminal without the skill layer. (Traces: US-1, US-6; intent proposal items 1 and 4.)

### Scenario: Human runs release CLI directly
- GIVEN a human in a terminal (no AI orchestrator session) on a configured project
- WHEN they run the release CLI command
- THEN the release flow runs without requiring any skill invocation or guard credential

### Scenario: Version status command reports version and recommendation
- GIVEN a configured project at version `0.4.0` with `feat:` changes shipped since the last tag
- WHEN the user runs the version status command
- THEN output includes current version `0.4.0` and a recommended `minor` bump, and no files are modified


## Requirement: Release Skill And Guard Authorization

The system MUST ship a matching metta release skill so AI orchestrators cut releases through the skill layer, and the `metta-guard-bash` hook MUST assign the release command(s) to a guard tier (the specific tier is a design decision) such that: an authorized skill-mediated invocation is permitted, and a direct release CLI invocation from an AI session lacking that tier's authorization is blocked. The skill MUST be a template file copied to `dist/` at build time, not an inline string. (Traces: US-6; intent proposal item 4 and orchestration-guard impact.)

### Scenario: Skill-mediated release is authorized
- GIVEN an AI orchestrator session invoking the release skill
- WHEN the skill drives the release flow and its authorized context issues the release CLI call
- THEN the guard hook permits the call and the release completes end-to-end without the orchestrator calling the CLI directly

### Scenario: Unauthorized AI invocation is blocked
- GIVEN an AI session that has not invoked the release skill and holds no valid authorization for the release command's tier
- WHEN it attempts the release CLI command via Bash
- THEN the `metta-guard-bash` hook blocks the call before execution

### Scenario: Skill delivered as template file
- GIVEN the project is built with `tsc` and the template copy step
- WHEN the build completes
- THEN the release skill exists in `dist/` as a copied template file and its content appears in no TypeScript string literal
