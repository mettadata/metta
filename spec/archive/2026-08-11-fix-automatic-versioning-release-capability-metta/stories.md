# fix-automatic-versioning-release-capability-metta — User Stories

## US-1: Configure the host project's product version

**As a** developer of a metta-consuming project
**I want to** tell metta what versioning scheme my project uses and where its version lives (e.g. `package.json`)
**So that** the framework knows my product's current version as a first-class concept, distinct from metta's own `installed_version` install stamp
**Priority:** P1
**Independent Test Criteria:** With version config set, metta reports the host project's current product version read from the configured version file, and invalid config is rejected by Zod validation with a clear error.

**Acceptance Criteria:**
- **Given** a Node project with `package.json` version `0.4.0` and version config pointing at it **When** the user asks metta for the current product version **Then** metta reports `0.4.0` from the configured file, not `installed_version`
- **Given** a config specifying an unsupported scheme or a malformed version-file path **When** the config is loaded **Then** Zod validation fails with an error message that clearly names the offending key
- **Given** a project that has never configured the release capability **When** the user runs any existing lifecycle command **Then** behavior is unchanged (purely additive capability)
- **Given** version config exists **When** any error or doc mentions the product version **Then** wording distinguishes it from `installed_version` so the two cannot be confused

## US-2: Get a recommended bump level derived from shipped work

**As a** developer cutting a release
**I want to** have metta derive the recommended semver bump (patch/minor/major) from the changes shipped since the last release tag
**So that** I don't have to manually audit commit history to decide what the next version number should be
**Priority:** P1
**Independent Test Criteria:** Given a set of shipped changes since the last release tag with known conventional-commit prefixes, the derivation function returns the correct bump level deterministically, and the user can override it.

**Acceptance Criteria:**
- **Given** only `fix:`-prefixed shipped changes since the last release tag **When** bump derivation runs **Then** it recommends a patch bump
- **Given** at least one `feat:`-prefixed shipped change and no breaking markers **When** bump derivation runs **Then** it recommends a minor bump
- **Given** any shipped change carrying a breaking-change marker **When** bump derivation runs **Then** it recommends a major bump
- **Given** a recommended bump level **When** the user explicitly chooses a different level **Then** the release proceeds with the user's choice and the recommendation does not block it
- **Given** the same inputs (changes, tags, metadata) **When** derivation runs twice **Then** the result is identical (pure function, no side effects)

## US-3: Cut a release with one operation

**As a** developer of a metta-consuming project
**I want to** run a single release operation that bumps the version file, regenerates the version-anchored changelog, and creates an annotated release tag
**So that** cutting a release stops being a manual, error-prone multi-step chore outside the framework
**Priority:** P1
**Independent Test Criteria:** One invocation of the release operation produces a bumped version file, a regenerated changelog with the new version heading, and an annotated git tag — all consistent with each other — with no push to remote.

**Acceptance Criteria:**
- **Given** a project at version `0.4.0` with shipped changes recommending a minor bump **When** the user invokes the release operation and confirms **Then** the version file reads `0.5.0`, `docs/changelog.md` has a `0.5.0` section containing those changes, and an annotated tag for `0.5.0` exists locally
- **Given** the release operation completes **When** the user inspects the remote **Then** nothing was pushed — no branch, no tag — without a separate explicit confirmation
- **Given** any step of the release cut fails (e.g. tag already exists) **When** the operation aborts **Then** the user is told what failed and no `--force` or destructive git operation is attempted

## US-4: Read a changelog organized by released version

**As a** reader of a metta-consuming project's changelog (developer, consumer, or maintainer)
**I want to** see changes grouped under the version they shipped in, with unreleased changes grouped separately
**So that** I can answer "what shipped in version X?" and "what's pending for the next release?" at a glance
**Priority:** P1
**Independent Test Criteria:** After a release cut, the regenerated `docs/changelog.md` shows version-anchored sections where each archived change appears under exactly one version (or the unreleased section), replacing the flat date/changeName list.

**Acceptance Criteria:**
- **Given** archived changes shipped before and after the last release tag **When** the changelog regenerates **Then** pre-tag changes appear under that version's heading and post-tag changes appear under an unreleased/pending heading
- **Given** multiple releases exist **When** the changelog regenerates **Then** version sections appear in release order and no change is listed under more than one version
- **Given** a project that has adopted the capability **When** docs regeneration runs during finalize **Then** the versioned changelog shape is preserved rather than reverting to the flat list

## US-5: Publish an opt-in GitHub release

**As a** maintainer of a project hosted on GitHub
**I want to** optionally publish a GitHub release via `gh` as part of the release cut, only after explicit confirmation
**So that** consumers see release notes on GitHub without me hand-assembling them, while nothing is published unless I say so
**Priority:** P2
**Independent Test Criteria:** A release cut without confirmation never invokes `gh release`; with explicit opt-in confirmation, a GitHub release is created for the new tag with notes drawn from the release's changes.

**Acceptance Criteria:**
- **Given** a release cut where the user declines or is never asked about GitHub publishing **When** the operation completes **Then** no `gh` release command is executed
- **Given** the user explicitly opts in to a GitHub release **When** the release cut completes **Then** a GitHub release exists for the new tag with notes reflecting the version's changes
- **Given** `gh` is unavailable or unauthenticated **When** the user opts in **Then** the local release (version bump, changelog, tag) still succeeds and the GitHub step fails with an actionable message

## US-6: Cut releases through the skill layer as an AI orchestrator

**As a** developer working through an AI orchestrator (Claude Code session)
**I want to** invoke the release capability via a matching metta skill, with guard-hook authorization enforced
**So that** AI-driven release cuts follow the same skill-first guarantees as the rest of the lifecycle, while I can still run the CLI directly from a terminal
**Priority:** P2
**Independent Test Criteria:** An AI orchestrator can complete a release cut end-to-end via the skill, and a direct CLI invocation of the release command from an unauthorized AI session is blocked by the guard hook.

**Acceptance Criteria:**
- **Given** an AI orchestrator session **When** the release skill is invoked **Then** the release flow runs with the correct authorization tier and completes without the orchestrator calling the CLI directly
- **Given** an AI session without the required authorization **When** it attempts the release CLI command via Bash **Then** the `metta-guard-bash` hook blocks the call
- **Given** a human in a terminal **When** they run the release CLI command directly **Then** it works without the skill layer

## US-7: See pre-existing manual releases rendered sanely

**As a** metta maintainer whose project already has hand-cut releases (v0.2.0–v0.4.0)
**I want to** adopt the release capability without my existing tags breaking or vanishing from the changelog
**So that** metta's own release history stays coherent and the next automated release continues from the last manual tag
**Priority:** P3
**Independent Test Criteria:** On a repo with pre-existing manual release tags, the regenerated changelog renders those versions sanely (best-effort backfill or an explicit pre-existing-history section), and bump derivation treats the latest manual tag as the release boundary.

**Acceptance Criteria:**
- **Given** metta's repo with manual tags v0.2.0–v0.4.0 **When** the changelog regenerates under the new format **Then** those versions appear sanely — via best-effort anchoring or an explicit prior-history section — and no existing entries are lost
- **Given** the last release was a manual tag **When** the first automated release cut runs **Then** bump derivation counts only changes shipped since that tag and the new version increments from it
