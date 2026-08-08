# fix-automatic-versioning-release-capability-metta

## Problem

Metta has no concept of the host project's product version, so cutting a release is a fully manual, out-of-band chore for every metta-consuming project. A release today means hand-editing `package.json` (or the project's equivalent version file), hand-writing a versioned changelog entry, hand-creating a git tag, and optionally hand-publishing a GitHub release — none of which the ship/finalize lifecycle produces, records, or even acknowledges.

Metta itself demonstrates the gap: v0.2.0 through v0.4.0 were all cut by hand. The tags exist and `package.json` says `0.4.0`, yet nothing in metta's own lifecycle knows those releases happened.

The root cause is that the framework treats "ship" as terminal. Finalize merges spec deltas, regenerates docs, and archives the change; ship merges the branch under safety snapshots. No stage models a *release* — an aggregation of shipped changes cut at a version boundary. Concretely:

- The only version field anywhere in the system is `installed_version` (`src/config/version-drift.ts:60`, `stampInstalledVersion`) — metta's own install stamp for template-drift detection, not the host project's product version.
- The changelog generator (`src/docs/doc-generator.ts:205`, `generateChangelog`) renders archived change summaries as a flat list of `date — changeName` sections with no version anchoring, so the changelog cannot answer "what shipped in 0.4.0?"
- The only tags ship creates are `metta/pre-merge/*` rollback snapshots (`src/ship/merge-safety.ts:158`); release tags are invisible to the framework.

The raw signals a release capability needs already exist — per-change workflow tier in `.metta.yaml`, conventional-commit prefixes, archived change summaries, existing git tags — but no module consumes them to derive a bump level, mutate a version file, create a tag, or publish a release. This is a capability gap, not a defect.

**Who is affected:** every developer on a metta-consuming project (including metta itself and downstream consumers such as zeus) who ships changes through the lifecycle and then must step outside the framework to version and release them. Secondary impact: anyone reading `docs/changelog.md`, which currently cannot map changes to released versions.

## Proposal

Add a first-class versioning and release capability to metta, usable both by metta itself and by any consuming project. The change proceeds through a research phase that evaluates candidate approaches before locking design; this intent frames the required outcomes, not the mechanism.

The shipped capability must deliver:

1. **A host-project version concept.** Metta knows the host project's current product version — distinct from `installed_version` — including where it lives (e.g. `package.json` for Node projects, a configurable version-file location for others) and what scheme it follows (semver initially). Configuration is validated with Zod like all other config.
2. **Bump derivation from shipped work.** A pure function derives the recommended bump level (patch/minor/major) from the shipped changes since the last release boundary, using existing signals: conventional-commit prefixes (`fix:` → patch, `feat:` → minor, breaking markers → major), archived change metadata, and the last release tag. The recommendation is overridable by the user.
3. **Release cut mechanics.** A single user-invoked operation that: bumps the version file, regenerates the changelog with version-anchored sections (changes grouped under the version they shipped in, unreleased changes grouped separately), creates an annotated release tag, and — strictly opt-in, behind explicit confirmation — creates a GitHub release via `gh`. Every step honors the constitution: no auto-push without explicit user confirmation, no `--force`, no destructive git operations.
4. **Skill-first surface.** A matching `metta-release` (naming TBD in design) skill so AI orchestrators go through the skill layer per the workflow rules, with the CLI command remaining available to humans in a terminal. Guard-hook tier assignment is decided in design.
5. **Changelog versioning.** `generateChangelog` gains version headings so `docs/changelog.md` reflects release history, with a defined story for pre-existing manual releases (metta's own v0.2.0–v0.4.0 tags must render sanely, even if only as best-effort backfill or an explicit "pre-metta-release history" section).

The research phase evaluates and records a decision among the three candidate shapes from the issue:

- **Candidate 1 (leading):** standalone `metta version` / `metta release` CLI surface + config keys + matching skill; release cadence decoupled from shipping.
- **Candidate 2:** release-on-ship integration, where ship offers/auto-triggers a release cut. Tradeoff: couples release cadence to shipping and complicates the safety-critical ship path.
- **Candidate 3:** changelog-anchored minimal tracking (version field + version headings + `metta version bump` helper; tags and GitHub releases stay manual). Tradeoff: does not automate the actual chore, so it under-delivers on the logged issue.

Implementation follows all constitutional constraints: TypeScript strict ESM (Node >= 22), Commander.js for any CLI surface, Zod validation on every state/config read-write, templates as external files copied to `dist/`, functional core / imperative shell (bump derivation and changelog grouping are pure; git/filesystem/`gh` effects live at the edges), and near 1:1 test-to-source ratio.

## Impact

- **`src/docs/doc-generator.ts` (`generateChangelog`)** — output format changes from flat date/changeName sections to version-anchored sections. `docs/changelog.md` is regenerated in the new shape; anything parsing the current flat format would need updating (no known in-repo consumers beyond human readers).
- **Config surface (`config-loader` / `config-writer` / `schemas` capabilities)** — new validated config keys for version scheme and version-file location. `installed_version` semantics are untouched; the new product-version concept must be clearly distinguished from it in schema, docs, and error messages to avoid confusion with `version-drift.ts`.
- **Ship/finalize lifecycle (`finalize-ship` capability)** — depending on the chosen candidate, ship may gain an optional release prompt or archive metadata may gain a bump-signal field. The merge-safety path itself (`src/ship/merge-safety.ts`) is not modified beyond, at most, additive metadata; its snapshot/rollback behavior is preserved.
- **Skill and guard surface (`orchestration-guard`)** — a new skill entry and a guard-tier assignment for the new command(s).
- **Docs regeneration** — `docs/changelog.md` and potentially `docs/api.md` / CLAUDE.md spec tables regenerate to reflect the new capability spec.
- **Consumer projects** — purely additive: projects that never invoke the release capability see no behavior change. Projects adopting it get versioned changelogs and tag automation.

## Out of Scope

- **Publishing to package registries** (npm publish, crates.io, PyPI, etc.). Release here means version bump + changelog + tag + optional GitHub release — not artifact distribution.
- **CI/CD pipeline integration** — no GitHub Actions workflows, release automation on merge, or hosted-runner concerns. Releases are cut interactively by a user (human or AI-orchestrated with confirmation).
- **Non-semver versioning schemes** (CalVer, build numbers, epoch schemes). The config leaves room for future schemes, but only semver is implemented.
- **Monorepo / multi-package versioning** — one version per host project. Independent per-package versions and changelog scoping are a future capability.
- **Rewriting historical changelog entries for metta's manual releases** beyond a best-effort anchoring/backfill story; reconstructing accurate per-version change lists for v0.2.0–v0.4.0 from git archaeology is not required.
- **Changing `installed_version` / version-drift behavior** — the install-stamp mechanism in `src/config/version-drift.ts` keeps its exact semantics.
- **Automatic pushing of release tags or branches** — pushing to remote always requires explicit user confirmation, per constitution; no default-on push behavior of any kind.
- **Release branches, hotfix backports, or maintenance-line support** — single-line release history off the main branch only.
