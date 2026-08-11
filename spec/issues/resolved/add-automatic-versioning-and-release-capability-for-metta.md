# Add automatic versioning and release capability for metta-consuming projects

**Captured**: 2026-08-08
**Status**: resolved
**Severity**: minor

## Symptom
Metta has no notion of the host project's version. Cutting a release — bumping `package.json` (or equivalent version file), writing a versioned changelog entry, creating a git tag, and optionally publishing a GitHub release — is a fully manual, out-of-band chore for every metta-consuming project. Metta itself demonstrates the gap: `v0.2.0` through `v0.4.0` were all hand-driven (tags exist, `package.json` says `0.4.0`), yet nothing in the ship/finalize lifecycle produced or even acknowledged them.

## Root Cause Analysis
The framework was designed around the change lifecycle (propose → plan → execute → verify → finalize → ship) and treats "ship" as terminal: `finalize` merges spec deltas, regenerates docs, and archives the change; `ship` merges the branch with safety snapshots. No stage models a *release* as an aggregation of shipped changes. The only version concept in the codebase is `installed_version` in the project state, which tracks the metta framework's own install stamp for drift detection — not the host project's product version. Similarly, the changelog generator flattens archived change summaries by date with no version anchoring, so there is nothing to attach a semver bump to. The raw signals a release capability needs already exist — per-change workflow tier (`trivial`/`quick`/`standard`/`full`) in `.metta.yaml`, conventional-commit prefixes enforced by convention, archived change summaries, and git tags — but no module consumes them to derive a bump level, mutate a version file, or create a tag. This is a capability gap, not a defect in existing code. Proposal direction: a version/release capability any metta-consuming project gets (must work for metta itself and consumers like zeus), configurable scheme (semver) and version-file location, bump derivation from shipped changes since the last tag (fix→patch, feat→minor, breaking→major), changelog regeneration from archived changes, tag creation, optional GitHub release via `gh` — all respecting the PR-based shipping rule and no-auto-push confirmation rules.

### Evidence
- `src/config/version-drift.ts:60` — `stampInstalledVersion` writes the only version field in the system (`installed_version`), which tracks metta's own install, confirming no host-project version model exists.
- `src/docs/doc-generator.ts:205` — `generateChangelog` renders archived change summaries as flat `date — changeName` sections with no version headings, so releases cannot be reflected in the changelog today.
- `src/ship/merge-safety.ts:158` — the only tags ship ever creates are `metta/pre-merge/*` safety snapshots; the repo's `v0.2.0`–`v0.4.0` tags were created manually outside metta.

## Candidate Solutions
1. **Standalone `metta version` / `metta release` CLI surface** — Add a release module with project-config keys (versioning scheme, version-file location) and commands that inspect shipped changes since the last release tag, derive the bump level from conventional-commit prefixes and/or change tiers, rewrite the version file, regenerate the changelog with version sections, commit, and tag — with `gh release create` as an opt-in step. A matching `metta-release` skill wraps it for AI orchestration, and confirmation gates honor the no-auto-push rule. Tradeoff: a new top-level lifecycle concept and CLI surface to spec, test, and guard-authorize, and releases can silently drift if users forget to run it.
2. **Finalize/ship integration (release-on-ship)** — Extend `finalize`/`ship` so each shipped change records its bump signal in archive metadata, and ship offers (or a config flag auto-triggers) a release cut when changes have accumulated, keeping versioning inside the existing lifecycle with no new entry point. Tradeoff: couples release cadence to individual change shipping — batching several changes into one release becomes awkward, and it complicates the already safety-critical ship path.
3. **Changelog-anchored minimal version tracking** — Skip tagging/releasing initially: add a `version` field to project config and teach `generateChangelog` to group archived changes under version headings, with a small `metta version bump` helper that updates the version file and changelog only, leaving tags and GitHub releases manual. Tradeoff: does not actually automate the release chore (tags and `gh` remain manual), so the original pain is only partially addressed and a second change is needed later.


## Resolution

**Resolved**: 2026-08-11 — shipped as PR #66 (change fix-automatic-versioning-release-capability-metta, archived 2026-08-11; release-versioning living spec, metta release CLI + skill). Issue file cleanup was missed at ship time because the original fix fork died at the spend limit.
