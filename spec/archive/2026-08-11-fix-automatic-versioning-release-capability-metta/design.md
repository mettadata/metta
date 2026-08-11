# Design: fix-automatic-versioning-release-capability-metta

## Approach

Implement research Candidate 1 exactly as decided: a self-contained `src/release/` module exposed as a `metta release` Commander command group (`status` read-only, `cut` mutating), an optional `release:` block on `ProjectConfigSchema`, a Tier-2 `metta-release` skill, and guard/mint entries for scope `release:cut`. Release cadence is fully decoupled from ship/finalize; `src/ship/merge-safety.ts` and `src/config/version-drift.ts` are not modified.

Functional core, imperative shell: semver arithmetic, bump derivation, and changelog grouping are pure functions with 1:1 tests; git, filesystem, and `gh` effects live in thin edge modules driven by a `ReleasePipeline` that records step results in the `MergeSafetyPipeline` style (`{step, status, detail}` records, early return on failure) so "which step failed and why" is structural (spec: Release Cut Safety Constraints).

**Open question resolved — changelog attribution uses a releases record**, per the research lean, with one simplification the record's location makes possible: the record lives **inside the spec store at `spec/releases.yaml`**, which `DocGenerator` already owns as its input directory. `DocGenerator` loads and Zod-validates the record itself (exactly like `loadArchiveEntries()` loads `spec/archive/`), so **neither call site — `src/cli/commands/docs.ts:41` nor `src/finalize/finalizer.ts:269` — changes at all**, and no `releaseContext` constructor parameter is needed. Git `ls-tree` containment is used exactly once per historical tag, at first-cut time, to backfill manual tags (v0.2.0–v0.4.0) into the record; thereafter the record is the single, exact, pure source of truth. See ADR-1.

Format switching is record-presence-driven: no `spec/releases.yaml` → `generateChangelog` emits today's flat format byte-identically (purely-additive requirement holds structurally); record present → version-anchored format. Because the record is committed in the release commit and read from `specDir` on every generation, finalize's regeneration keeps the versioned shape with zero coordination (spec scenario: "Versioned shape survives finalize regeneration").

### ADR-1: Releases record in the spec store, not git-derived attribution

**Decision:** Changelog version attribution is read from a Zod-validated `spec/releases.yaml` snapshotting attributed archive dirNames at cut time. `git ls-tree` containment is used only once, during the first cut, to backfill pre-existing manual tags.
**Rationale:** The record is exact (no same-day-tie ambiguity), keeps `DocGenerator` free of git I/O (it stays a pure spec-store reader — no vendor/tool coupling), survives finalize regeneration because it travels with the spec store, and — by living under `specDir` — eliminates the doc-generator call-site ripple that research flagged as the main risk. Continuous `ls-tree` attribution would put git subprocess calls inside every docs generation, including finalize's failure-tolerant path.
**Consequence:** `spec/releases.yaml` is a new committed state file; the release commit must include it (it does — it is written in the same pipeline step group as the changelog). Repos that delete it degrade to the flat changelog, never to data loss.

### ADR-2: Tier-2 guard scope for `release cut`

**Decision:** `release cut` is session-tier (Tier 2), scope key `release:cut`; `release status` (and bare `metta release`) is allow-listed read-only.
**Rationale:** The flow is confirmation-heavy (bump override, target-version confirm, gh opt-in) and must run in the main session where `AskUserQuestion` works — matching the `metta-backlog`/`metta-roadmap` precedent, not the forked Tier-1 ship pattern. Fork-tier would strand the confirmation dialogue where user interaction is unavailable.

### ADR-3: Hand-rolled strict semver, no new dependency

**Decision:** A ~25-line pure `parseSemver`/`bumpVersion` accepting only `x.y.z`; prerelease/build-metadata inputs rejected with a clear error.
**Rationale:** No `semver` package exists in the dependency tree today; intent scopes out non-semver and prerelease schemes. Swappable later behind the same two-function API without churn. Smallest surface wins.

## Components

All new source files get a matching test file in flat `tests/` (1:1 convention).

| Component | Path | Responsibility |
|---|---|---|
| Semver core (pure) | `src/release/semver.ts` | `parseSemver`, `bumpVersion`; `SemverParseError` |
| Bump derivation (pure) | `src/release/bump-derivation.ts` | `parseConventionalCommit`, `deriveBump` over pre-gathered commit subjects/bodies |
| Changelog grouping (pure) | `src/release/changelog-grouping.ts` | `groupEntriesByRelease(entries, record)` — each archive entry lands in exactly one version group or Unreleased |
| Version file I/O (edge) | `src/release/version-file.ts` | Read/write product version in the configured file; JSON strategy (`version` field, indentation- and trailing-newline-preserving) for `*.json`, trimmed plain text otherwise; `ProductVersionError` wording that names the configured path and "product version" and never mentions `installed_version` |
| Releases record store (edge) | `src/release/releases-record-store.ts` | Load/save `spec/releases.yaml` through `ReleasesRecordSchema` (no unvalidated writes); returns `null` when absent |
| Git edge | `src/release/git-release-tags.ts` | `execFile('git', [...])`-style (no shell interpolation, per `git-log-timings.ts` precedent): tag listing, tag existence, commit collection, one-shot `ls-tree` backfill attribution |
| gh edge | `src/release/gh-release.ts` | Probe (`missing-binary` vs `unauthenticated` vs `ok`) and `gh release create` with notes from the version's changelog section; never throws into the pipeline — returns a typed outcome |
| Pipeline (imperative shell) | `src/release/release-pipeline.ts` | `ReleasePipeline` class: `status()` and `cut()` with ordered step records; composes all modules above; `ReleaseError` hierarchy root |
| CLI command | `src/cli/commands/release.ts` | `registerReleaseCommand(program)`: `release status` (default subcommand → bare `metta release` = status), `release cut [--bump <level>] [--yes] [--github] [--dry-run]`; `createCliContext`/`outputJson`/`handleError`/`askYesNo` per `docs.ts` shape |
| Config schema | `src/schemas/project-config.ts` (modified) | `ReleaseConfigSchema` + `release:` key |
| Releases record schema | `src/schemas/releases-record.ts` (new) | `ReleasesRecordSchema` (+ barrel export in `src/schemas/index.ts`) |
| Doc generator | `src/docs/doc-generator.ts` (modified) | `generateChangelog` loads the releases record and delegates grouping to the pure function; flat format preserved when record absent |
| Skill template | `src/templates/skills/metta-release/SKILL.md` (new) | Main-session skill (no `context: fork`), mint-hook frontmatter, AskUserQuestion-driven flow ending in explicit flags |
| Guard hook | `.claude/hooks/metta-guard-bash.mjs` + `src/templates/hooks/metta-guard-bash.mjs` (modified, byte-identical) | Allow `release status`/bare `release`; block `release cut` as Tier-2 scope `release:cut` |
| Mint hook | `.claude/hooks/metta-session-mint.mjs` + `src/templates/hooks/metta-session-mint.mjs` (modified, byte-identical) | `SKILL_SCOPES['metta-release'] = ['release:cut']` |
| CLI registration | `src/cli/index.ts` (modified) | Import + `registerReleaseCommand(program)`; no preAction exemption needed |

Tests: `tests/release-semver.test.ts`, `tests/release-bump-derivation.test.ts`, `tests/release-changelog-grouping.test.ts`, `tests/release-version-file.test.ts`, `tests/release-releases-record-store.test.ts`, `tests/release-git-release-tags.test.ts`, `tests/release-pipeline.test.ts`, `tests/cli-release.test.ts` (temp git repo fixtures, precedent `tests/cli-finalize.test.ts`), `tests/doc-generator-versioned-changelog.test.ts` (includes the finalize-regeneration scenario), new cases in `tests/metta-guard-bash.test.ts` / `tests/cli-metta-guard-bash-integration.test.ts`, and `tests/hooks-byte-identity.test.ts` asserting `.claude/hooks/*.mjs` ≡ `src/templates/hooks/*.mjs` (agents precedent: `tests/agents-byte-identity.test.ts`).

## Data Model

### Release config (`.metta/config.yaml`, `src/schemas/project-config.ts`)

```ts
export const ReleaseConfigSchema = z.object({
  scheme: z.literal('semver', {
    message: "release.scheme: only 'semver' is supported",
  }),
  version_file: z.string().min(1, {
    message: 'release.version_file: must be a non-empty path to the file holding the product version',
  }),
  tag_prefix: z.string().default('v'),
  github_release: z.boolean().default(false),
}).strict()

export type ReleaseConfig = z.infer<typeof ReleaseConfigSchema>

// In ProjectConfigSchema (.strict() parent, unchanged otherwise):
//   release: ReleaseConfigSchema.optional(),
```

`.optional()` on a `.strict()` parent makes "purely additive when unconfigured" structural: existing configs parse byte-identically. Zod issue paths name the offending key (spec: Release Configuration Schema); `ConfigLoader.load()` surfaces them unchanged. Requirement traceability: the four keys map 1:1 to the Release Configuration Schema requirement; `github_release: false` default satisfies the opt-in default.

### Releases record (`spec/releases.yaml`, `src/schemas/releases-record.ts`)

```ts
export const BumpLevelEnum = z.enum(['major', 'minor', 'patch'])
export type BumpLevel = z.infer<typeof BumpLevelEnum>

export const ReleaseEntrySchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  tag: z.string().min(1),                      // e.g. 'v0.5.0' (tag_prefix + version)
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bump: BumpLevelEnum.optional(),              // absent on backfilled entries
  bump_source: z.enum(['derived', 'override']).optional(), // records user-selected level (US-2)
  backfilled: z.boolean().default(false),      // true for pre-capability manual tags
  changes: z.array(z.string()),                // archive dirNames snapshotted at cut time
}).strict()

export const ReleasesRecordSchema = z.object({
  releases: z.array(ReleaseEntrySchema),       // newest first
}).strict()

export type ReleasesRecord = z.infer<typeof ReleasesRecordSchema>
```

Semantics:
- **Attribution:** an archive entry belongs to the release whose `changes` array lists its dirName; entries listed nowhere are **Unreleased**. Snapshot at cut time = (all `spec/archive/` dirNames) minus (union of all recorded `changes`). Exact, pure, no git I/O, immune to same-day ties.
- **Backfill (first cut only):** if no record exists and tags matching `{tag_prefix}x.y.z` exist, the pipeline attributes each archive dirName to the earliest tag whose tree contains `spec/archive/<dirName>` (`git ls-tree -d <tag> -- spec/archive/<dirName>`), writing one `backfilled: true` entry per historical tag. Dirs contained in no tag stay unattributed (→ Unreleased). Nothing is dropped (spec: Pre-Existing Manual Release History Rendering).
- **Written only** through `releases-record-store.ts` with `ReleasesRecordSchema.parse` on both read and write (no unvalidated state writes).

### Changelog output shape (record present)

```
# Changelog

## Unreleased            ← omitted when empty
### {date} — {changeName}
{summaryContent}

## {version} — {date}    ← newest first, record order
### {date} — {changeName}
{summaryContent}
```

Record absent → current flat `## {date} — {changeName}` format, byte-identical.

### Not modified

`installed_version` (`src/config/version-drift.ts`) and `ChangeMetadataSchema` are untouched. The research-salvaged optional `bump_signal` field and ship-time "pending release" hint are explicitly **not** built (nice-to-haves; no speculative extensibility).

## API Design

### CLI surface (`src/cli/commands/release.ts`)

```
metta release [status] [--json]        # status is the default subcommand; read-only
metta release cut [--bump <patch|minor|major>] [--yes] [--github] [--dry-run] [--json]
```

- `status`: prints current product version (from `release.version_file`), last release tag (or "none"), commit count since, recommended bump, and unreleased archive-entry count. Modifies nothing. With `git.enabled: false` / not a repo: prints version-file value only, with a warning that tag/bump portions are unavailable (degradation decided in research).
- `cut`: runs the pipeline below. `--bump` overrides the recommendation (`bump_source: 'override'`); `--yes` skips the interactive target-version confirmation; `--github` is the explicit per-cut confirmation for GitHub publication (valid only when `github_release: true` in config — if config is `false`, `--github` fails fast before any mutation with "release.github_release is disabled in config"). Interactive path uses `askYesNo` (`src/cli/helpers.ts`), whose fail-closed non-TTY default means a non-interactive `cut` without `--yes` aborts cleanly. Missing `release:` config → exit with an actionable error naming the required keys (`release.scheme`, `release.version_file`) before touching anything.

Registration: one import + `registerReleaseCommand(program)` in `src/cli/index.ts` (after `registerDocsCommand`); no entry in `CONFIG_PARSE_EXEMPT_COMMANDS` or `DRIFT_CHECK_EXEMPT_COMMANDS`.

### Module signatures

```ts
// src/release/semver.ts (pure)
export class SemverParseError extends Error {}
export function parseSemver(v: string): { major: number; minor: number; patch: number } // throws SemverParseError on anything but strict x.y.z
export function bumpVersion(current: string, level: BumpLevel): string

// src/release/bump-derivation.ts (pure)
export interface CommitInput { subject: string; body: string }
export interface ParsedCommit { type: string | null; breaking: boolean }
export function parseConventionalCommit(commit: CommitInput): ParsedCommit
  // breaking: '!' before ':' in subject (e.g. feat(api)!:) OR 'BREAKING CHANGE:'/'BREAKING-CHANGE:' in body
export function deriveBump(commits: CommitInput[]): BumpLevel
  // any breaking → 'major'; else any type 'feat' → 'minor'; else 'patch' (non-conventional subjects count as patch-weight, never error)

// src/release/changelog-grouping.ts (pure)
export interface ChangelogEntryInput { dirName: string; date: string; changeName: string; summaryContent: string }
export interface ReleaseGroup { version: string | null; date: string | null; entries: ChangelogEntryInput[] } // version null = Unreleased
export function groupEntriesByRelease(entries: ChangelogEntryInput[], record: ReleasesRecord): ReleaseGroup[]
  // returns [Unreleased?, ...record.releases order]; every entry appears exactly once

// src/release/version-file.ts (edge)
export class ProductVersionError extends Error {}
export function readProductVersion(projectRoot: string, config: ReleaseConfig): Promise<string>
export function writeProductVersion(projectRoot: string, config: ReleaseConfig, next: string): Promise<void>

// src/release/releases-record-store.ts (edge)
export function loadReleasesRecord(specDir: string): Promise<ReleasesRecord | null> // null when file absent
export function saveReleasesRecord(specDir: string, record: ReleasesRecord): Promise<void>

// src/release/git-release-tags.ts (edge; execFile arg arrays, no shell interpolation)
export function listReleaseTags(cwd: string, tagPrefix: string): Promise<string[]> // `git tag --list '{prefix}[0-9]*' --sort=-version:refname`, newest first
export function tagExists(cwd: string, tag: string): Promise<boolean>              // `git rev-parse -q --verify refs/tags/<tag>`
export function collectCommitsSince(cwd: string, tag: string | undefined): Promise<CommitInput[]>
  // `git log [<tag>..]HEAD --format=%s%x1f%b%x1e` — full log, NOT --first-parent (signal lives on branch commits under `chore: merge metta/x` merges)
export function attributeArchiveDirsToTags(cwd: string, tagsOldestFirst: string[], dirNames: string[]): Promise<Map<string, string[]>>
  // backfill only: dirName → earliest containing tag via `git ls-tree -d <tag> -- spec/archive/<dir>`

// src/release/gh-release.ts (edge; returns outcomes, never throws)
export type GhOutcome =
  | { status: 'created'; tag: string }
  | { status: 'missing-binary'; remedy: string }
  | { status: 'unauthenticated'; remedy: string }
  | { status: 'failed'; detail: string }
export function createGithubRelease(cwd: string, tag: string, title: string, notes: string): Promise<GhOutcome>
  // probes binary + `gh auth status` first; remedy strings include manual retry command (`gh release create <tag> ...`)

// src/release/release-pipeline.ts (imperative shell)
export class ReleaseError extends Error {}
export class ReleaseConfigMissingError extends ReleaseError {} // names required keys in message
export interface ReleaseStep { step: string; status: 'pass' | 'fail' | 'skip'; detail?: string }
export interface ReleaseStatusResult {
  version: string; lastTag: string | null; commitCount: number | null
  recommendedBump: BumpLevel | null; unreleasedChanges: number; warnings: string[]
}
export interface ReleaseCutOptions {
  bumpOverride?: BumpLevel
  confirmVersion: (target: string, recommended: BumpLevel, source: 'derived' | 'override') => Promise<boolean> // CLI wires askYesNo or --yes; tests inject
  github: boolean   // explicit per-cut confirmation (flag or interactive yes)
  dryRun: boolean
}
export interface ReleaseCutResult {
  status: 'success' | 'failure' | 'aborted'
  steps: ReleaseStep[]
  version?: string; tag?: string
  gh?: GhOutcome    // present only when github publication was attempted
}
export class ReleasePipeline {
  constructor(private projectRoot: string, private config: ProjectConfig) {}
  status(): Promise<ReleaseStatusResult>
  cut(opts: ReleaseCutOptions): Promise<ReleaseCutResult>
}
```

### Pipeline step order (`cut`) — zero mutations before all abort points

`config-check → git-check → clean-tree → last-tag → collect-commits → derive-bump → confirm → target-tag-absent → backfill-record (first cut with pre-existing tags only, in memory) → write-version-file → write-releases-record → regen-changelog → commit → annotated-tag → gh (optional, isolated)`

- `git-check`: `git.enabled !== false`, inside a repo, not detached; warns (does not block) on a `metta/*` branch and on shallow clones (`rev-parse --is-shallow-repository`).
- `clean-tree`: `git status --porcelain --untracked-files=no` (merge-safety pattern).
- `confirm`: presents `{current} → {target}` with recommendation and source; decline → `status: 'aborted'`, nothing written.
- `target-tag-absent`: `tagExists` check **before any write**; existing tag → fail naming the tag; never `-f`, never delete (contrast: merge-safety's snapshot `tag -f` is not reused here).
- Mutation group: version file, `spec/releases.yaml` (new entry prepended, `bump_source` recorded), changelog via `DocGenerator.generate(['changelog'])`. On failure inside this group, best-effort restore of previously-read file contents (nothing is staged yet), then report the failing step.
- `commit`: `git add -- <version_file> spec/releases.yaml docs/changelog.md` then `git commit -m "chore(release): {version}"` (one more unconsolidated commit site, kept inside the pipeline as the future refactor seam per `src/cli/helpers.ts` TODO).
- `annotated-tag`: `git tag -a {tag_prefix}{version} -m "Release {version}"`.
- `gh`: runs only when `config.release.github_release === true` AND `opts.github === true`; any non-`created` outcome is reported in `result.gh` and **never** rolls back or fails the local release (`status` stays `'success'`).
- **No push anywhere.** Pushing is out of scope for the pipeline entirely; the CLI prints the exact `git push --follow-tags` command for the user to run manually.
- `--dry-run`: stops after `target-tag-absent`, reporting derived bump/target version with all mutation steps `skip`.

### `generateChangelog` modification (`src/docs/doc-generator.ts:205-235`)

```ts
private async generateChangelog(sources: string[]): Promise<string> {
  const archiveEntries = await this.loadArchiveEntries()        // unchanged
  const record = await this.loadReleasesRecord()                // NEW: reads {specDir}/releases.yaml, Zod-validated; null when absent/invalid (invalid → warn + null, degradation not failure)
  // ...existing summary-missing warn/skip loop unchanged...
  if (record === null) { /* existing flat rendering, byte-identical */ }
  const groups = groupEntriesByRelease(entries, record)         // pure fn from src/release/changelog-grouping.ts
  // render: '## Unreleased' (when non-empty), then '## {version} — {date}' per record order,
  // each containing the existing '### {date} — {changeName}\n{summaryContent}' blocks
}
```

**Call sites `src/cli/commands/docs.ts:41` and `src/finalize/finalizer.ts:269`: no modification.** Both already construct `DocGenerator(specDir, projectRoot, docsConfig, ...)`; the record lives under `specDir`, so both sites pick up versioned rendering automatically. `tests/doc-generator-versioned-changelog.test.ts` pins the finalize-regeneration scenario (record present + newly archived change → new change under Unreleased, version sections intact) and the record-absent flat-format byte-identity.

### Guard, mint, and skill

`.claude/hooks/metta-guard-bash.mjs` **and** `src/templates/hooks/metta-guard-bash.mjs` (byte-identical):

```js
ALLOWED_TWO_WORD:  ['release', new Set(['status'])]
ALLOWED_BARE:      add 'release'          // bare form = status view (roadmap precedent)
BLOCKED_TWO_WORD:  ['release', new Set(['cut'])]   // Tier-2 scope key 'release:cut' via existing keying at classify()/offender logic
```

`.claude/hooks/metta-session-mint.mjs` **and** `src/templates/hooks/metta-session-mint.mjs`:

```js
SKILL_SCOPES['metta-release'] = ['release:cut']
```

`src/templates/skills/metta-release/SKILL.md` — main-session skill (no `context: fork`), `metta-backlog` frontmatter pattern:

```yaml
---
name: metta:release
description: Cut a versioned release (bump, changelog, tag, optional GitHub release)
allowed-tools: [Bash, AskUserQuestion]
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: .claude/hooks/metta-session-mint.mjs metta-release
---
```

Skill body: (1) run `metta release status --json` first — allow-listed, reports state AND completes a Bash cycle so the mint hook's credential is in place (backlog precedent); (2) `AskUserQuestion` — accept/override bump, confirm target version, gh opt-in (only offered when config enables it); (3) run `metta release cut --bump <level> --yes [--github] --json`; (4) echo results and the manual `git push --follow-tags origin main` suggestion — the skill never pushes. The `copy-templates` build step already copies `src/templates/skills` recursively; zero build changes.

## Dependencies

**External:** none added. `npm ls` gains nothing: semver is hand-rolled (ADR-3); git and `gh` are invoked as subprocesses via `node:child_process` `execFile`; `gh` is optional at runtime with typed degradation. No vendor lock-in beyond the existing, isolated `gh` opt-in step (GitHub-specific by nature; confined to `gh-release.ts`, off by default — flagged per lock-in policy).

**Internal (existing modules consumed, unmodified unless listed):**
- `ConfigLoader` (`src/config/config-loader.ts`) — config load + Zod error surfacing
- `DocGenerator` (`src/docs/doc-generator.ts`) — modified as specified; sole changelog owner
- `createCliContext`, `askYesNo`, `outputJson`, `handleError` (`src/cli/helpers.ts`)
- `MergeSafetyPipeline` — pattern precedent only (step records); no code shared, no modification
- Guard/mint hooks and skill template pipeline (`copy-templates`, `metta install` asset copying)

**Build/rollout:** consumers receive the skill and updated hooks on their next `metta install`; the existing version-drift warning already nudges that.

## Risks & Mitigations

- **Changelog shape regression during finalize** (research's top risk, now smaller): with the record in `specDir`, there are no call-site edits to forget; residual risk is `loadReleasesRecord` mishandling an invalid record inside finalize's swallow-all catch. Mitigation: invalid record → warn + flat fallback (never throw), pinned by `tests/doc-generator-versioned-changelog.test.ts` including a corrupt-record case.
- **Dual-copy hook drift** (`.claude/hooks/` vs `src/templates/hooks/`): mitigated by new `tests/hooks-byte-identity.test.ts` (agents-byte-identity precedent) so any future edit to one copy fails CI.
- **Bump-signal fidelity depends on commit hygiene**: derivation is advisory by design; `--bump` override (recorded as `bump_source: 'override'`) is the escape hatch; non-conventional subjects degrade to patch-weight, never error.
- **Backfill inaccuracy for v0.2.0–v0.4.0**: `ls-tree` containment is best-effort by spec; entries contained in no tag render under Unreleased rather than being dropped; `backfilled: true` marks these entries so nobody mistakes them for exact attribution. Out-of-scope git archaeology is not attempted.
- **Partial-failure mid-mutation-group**: tag-absence and clean-tree checks precede all writes; within the write group nothing is staged until `commit`, so best-effort in-memory restore of prior file contents suffices; the failing step is named in `steps`. A failure after `commit` but before `annotated-tag` leaves a valid release commit without a tag — the error message says exactly that and gives the single `git tag -a` command to complete manually (no automatic rollback: no destructive git ops by constitution).
- **`spec/releases.yaml` merge conflicts** across parallel worktrees: low likelihood — the file is written only by `release cut`, which warns when run off `main`/on a `metta/*` branch; releases are cut post-ship on the mainline by design.
- **Hand-rolled semver rejects prerelease versions** in the version file: fails fast with `SemverParseError` naming the file and the accepted `x.y.z` form; acceptable per intent's out-of-scope list and swappable later behind the same API.
- **Non-TTY/skill misuse of `cut`**: `askYesNo` fail-closed default means no `--yes` → clean abort; guard blocks unauthorized AI invocation (`release:cut` Tier-2), and `release status` stays available for read-only inspection.
