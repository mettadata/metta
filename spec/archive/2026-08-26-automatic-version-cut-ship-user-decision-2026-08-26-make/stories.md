<!--
User stories for this change.

Format: one `## US-N:` block per story with six bold-label fields
(**As a**, **I want to**, **So that**, **Priority:**, **Independent Test Criteria:**,
**Acceptance Criteria:**) followed by one or more Given/When/Then bullets.
Story IDs MUST be monotonic starting at US-1.
-->

# automatic-version-cut-ship-user-decision-2026-08-26-make — User Stories

## US-1: Automatic version cut when a change ships

**As a** internal developer shipping a change through any ship-path skill
**I want to** have a release cut automatically after the PR merge and main fast-forward, without running /metta-release myself
**So that** every shipped change is immediately reflected in a tag and version, and the release history never lags behind what actually landed on main

**Priority:** P1
**Independent Test Criteria:** Running a ship-path skill to completion with `release.on_ship: auto` (or unset, since auto is the default) produces a new version tag on main derived from the unreleased changes, with no manual release invocation.

**Acceptance Criteria:**
- **Given** a project with release config present and `release.on_ship` set to `auto` (or absent, defaulting to `auto`) **When** any ship-path skill (metta-ship, metta-propose ship opt-in, metta-quick, metta-auto, metta-fix-issues, metta-fix-gap) completes the PR merge and main fast-forward + rebuild **Then** the skill runs release status, derives the bump, and cuts the release via the existing ReleasePipeline with `--yes`, and the new tag rides the already-authorized main push via `--follow-tags`
- **Given** the cut succeeds **When** the ship step reports completion **Then** the output includes the new version number so the developer knows exactly what was released
- **Given** the automatic cut runs **When** it derives the bump **Then** it reuses the existing ReleasePipeline and bump-derivation rules end to end, with no second cut implementation

---

## US-2: Prompt mode asks before cutting

**As a** internal developer who wants a human decision on each release
**I want to** set `release.on_ship: prompt` so the ship step reports the unreleased count and recommended bump and asks me before cutting
**So that** I keep automatic coordination of the release step while retaining final say over when a version is cut

**Priority:** P2
**Independent Test Criteria:** With `release.on_ship: prompt`, an interactive ship presents the unreleased count and recommended bump and only cuts on confirmation, while a non-interactive ship skips the cut with a loud notice.

**Acceptance Criteria:**
- **Given** `release.on_ship: prompt` in an interactive session **When** a ship-path skill reaches the post-merge release step **Then** it reports the number of unreleased changes and the recommended bump and asks the developer whether to cut
- **Given** the developer confirms **When** the cut proceeds **Then** it follows the same pipeline and tag-push behavior as auto mode
- **Given** the developer declines **When** the ship completes **Then** no cut occurs and the shipped change remains in the unreleased backlog for a later on-demand release
- **Given** `release.on_ship: prompt` in a non-interactive context **When** the ship reaches the release step **Then** it fails closed by skipping the cut and emits a loud notice that the release was skipped and why

---

## US-3: Off mode and absent config preserve on-demand releasing

**As a** internal developer on a project that releases on its own cadence or has not configured releasing
**I want to** opt out via `release.on_ship: off`, and have projects with no release config skipped automatically
**So that** ship behavior stays exactly as it is today for teams that do not want automatic cuts, with no new mandatory configuration

**Priority:** P2
**Independent Test Criteria:** With `release.on_ship: off` or with release config entirely absent, a completed ship produces no tag and no cut, emitting only a one-line skip notice in the absent-config case.

**Acceptance Criteria:**
- **Given** `release.on_ship: off` **When** a ship-path skill completes the merge and main push **Then** no release step runs and releasing remains fully on-demand via /metta-release
- **Given** a project with no release config at all **When** a ship completes **Then** the release step is skipped with a one-line notice and the ship succeeds normally
- **Given** either skip path **When** the ship completes **Then** tokens, UAT enforcement, and gates behave exactly as before — the release step touches none of them

---

## US-4: Reliable GitHub release sequencing

**As a** internal developer (and anyone relying on GitHub releases as the record of what shipped)
**I want to** have the GitHub release created only after the tag has been pushed to the remote
**So that** the repeatable `--github` failure that broke both v0.5.0 and v0.6.0 cannot recur and no release requires manual repair

**Priority:** P1
**Independent Test Criteria:** A ship-triggered cut executes strictly in the order merge → pull → local cut (no `--github`) → push main with `--follow-tags` → `gh release create` against the pushed tag, and the GitHub release step never runs before the tag exists on the remote.

**Acceptance Criteria:**
- **Given** an automatic cut on ship **When** the release step executes **Then** the local cut runs without `--github`, the tag is pushed via `--follow-tags` on the authorized main push, and only then is the GitHub release created against the already-pushed tag
- **Given** the `gh` CLI is absent or unauthenticated **When** the GitHub-release step is reached **Then** the step degrades gracefully — the tag and version cut still land, and the skill reports that the GitHub release was skipped
- **Given** the fixed sequencing **When** compared against the v0.5.0/v0.6.0 failure mode **Then** the tag-not-on-remote race is structurally impossible because the GitHub release is created after the push, not during the cut

---

## US-5: Pre-1.0 major bump guard

**As a** internal developer shipping breaking changes on a pre-1.0 project
**I want to** have an automatically derived MAJOR bump downgraded to MINOR with a prominent report, unless I explicitly allow majors
**So that** an automatic cut never accidentally promotes the project to 1.0.0, which is an intentional milestone decision, not a side effect of shipping

**Priority:** P1
**Independent Test Criteria:** On a pre-1.0 version, an automatic cut whose derived bump is major produces a minor version instead and prominently reports the downgrade, while setting `release.allow_major_pre_1` restores the major bump.

**Acceptance Criteria:**
- **Given** the current version is below 1.0.0 and `release.allow_major_pre_1` is not set **When** the automatic cut derives a major bump **Then** the bump is downgraded to minor and the ship output prominently reports both the original derivation and the downgrade
- **Given** `release.allow_major_pre_1` is enabled **When** the automatic cut derives a major bump on a pre-1.0 version **Then** the major bump is applied as derived
- **Given** the current version is 1.0.0 or above **When** a major bump is derived **Then** the guard does not apply and the bump proceeds unchanged

---

## US-6: Ship never blocked by a failed cut

**As a** internal developer whose primary goal is landing the change
**I want to** have any failure in the automatic release step warn and continue rather than block or unwind the ship
**So that** a release hiccup (network, gh outage, pipeline error) can never hold my merged work hostage or corrupt the ship outcome

**Priority:** P1
**Independent Test Criteria:** When the post-merge cut fails for any reason, the ship still completes successfully with the merge and main push intact, and the failure is surfaced as a warning telling the developer how to cut on demand.

**Acceptance Criteria:**
- **Given** the PR is merged and main is fast-forwarded **When** the automatic cut fails at any point **Then** the ship completes with a clear warning, the merge is never reverted, and main is left in its pushed state
- **Given** a cut failure warning **When** the developer reads the ship output **Then** it identifies what failed and states that /metta-release can be run on demand to cut the release manually
- **Given** the release step runs in a fork or main-session skill context **When** it invokes release status and release cut **Then** the guard/mint scoping authorizes those calls, so the failure posture is only exercised for genuine cut errors rather than authorization gaps
