# Research: Standalone `metta release` CLI surface (Candidate 1)

## Approach summary

Add a self-contained `src/release/` module plus a `release` command group registered like every other Commander command: a read-only status form (`metta release status`, plus the `ALLOWED_BARE` pattern for bare `metta release`) that reports current product version + recommended bump, and a mutating `metta release cut` that runs the full pipeline — preflight, last-tag discovery, commit collection, pure bump derivation, confirmation, version-file rewrite, versioned-changelog regeneration, conventional release commit, annotated tag, and strictly-confirmed optional `gh release create`. Config lands as a new optional `release:` block in `ProjectConfigSchema` (purely additive — `.optional()` means unconfigured projects validate identically). A `metta-release` skill template ships under `src/templates/skills/`, and the guard hook gains a Tier-2 scope for `release:cut` while allow-listing the read-only forms. Release cadence is fully decoupled from ship/finalize; the merge-safety path is untouched.

Naming note: the spec's "version status command" is better spelled `metta release status` than `metta version` — `metta version` visually collides with Commander's built-in `--version`/`-V` (registered at `src/cli/index.ts:58`) and would need a new single-word guard allowlist entry, whereas a `release` group reuses the existing two-word allow/block machinery cleanly (see guard findings below).

## Codebase findings

### CLI registration — drop-in slot exists

- `src/cli/index.ts:53-104` — flat `registerXCommand(program)` list; a `registerReleaseCommand` import + call is one line each. The `preAction` hook (`src/cli/index.ts:128-166`) already gives every non-exempt command a config-parse fail-fast and the drift check for free; `release` needs no exemption in either set.
- Command-file pattern: `src/cli/commands/docs.ts:8-65` (`registerDocsCommand`) is the closest template — subcommand group (`docs generate`), `createCliContext()` (`src/cli/helpers.ts:101`), `ctx.configLoader.load()`, `outputJson`/`handleError`, `--dry-run` flag. `release` mirrors this shape exactly.
- Interactive confirmation already exists: `askYesNo` at `src/cli/helpers.ts:372-406` — TTY-aware, falls back to `defaultYes` (default `false`) when non-TTY or `--json`. Fail-closed default suits "no gh without confirmation" and "confirm target version" out of the box. Non-interactive/skill path uses explicit flags (`--bump <level>`, `--yes`, `--github`).

### Config schema — additive Zod block

- `src/schemas/project-config.ts:103-125` — `ProjectConfigSchema` is `.strict()`; sub-configs like `GitConfigSchema` (`:20-33`) and `DocsConfigSchema` (`:37-41`) show the house style (`.strict()`, defaults inline). New block:
  - `ReleaseConfigSchema = z.object({ scheme: z.literal('semver'), version_file: z.string().min(1), tag_prefix: z.string().default('v'), github_release: z.boolean().default(false) }).strict()`, attached as `release: ReleaseConfigSchema.optional()`.
  - `z.literal('semver')` (or `z.enum(['semver'])` with a custom message) satisfies the "names the offending key, states only semver supported" scenario; Zod issues already carry `path`, and `ConfigLoader.load()` surfaces them (`src/config/config-loader.ts:143-164`).
- `.optional()` makes the "purely additive when unconfigured" requirement structural: existing configs parse byte-identically. `metta release ...` without the block errors actionably in the command layer.
- Config writes (if `metta release init`-style setup is wanted later) go through the comment-preserving `setProjectField` (`src/config/config-writer.ts:11-37`) — same path `stampInstalledVersion` uses.

### Product version vs installed_version — clean separation available

- `src/config/version-drift.ts` is fully self-contained: `readInstalledVersion` (`:42-52`) reads only `.metta/config.yaml` top-level `installed_version`; `stampInstalledVersion` (`:60-62`) writes only that key. A new `src/release/version-file.ts` that reads/writes the *configured* file (`package.json` etc.) shares zero code paths with it — the "byte-identical installed_version" scenario holds by construction. `getPackageVersion` (`src/cli/helpers.ts:472-477`) reads metta's *own* package.json (via `import.meta.url`), a third distinct concept; error wording in the new module should name all distinctions.

### Changelog generation — flat today, pure grouping slots in

- `src/docs/doc-generator.ts:205-235` (`generateChangelog`) — builds a flat list of `## {date} — {changeName}` sections from `loadArchiveEntries()` (`:334-385`), which parses `spec/archive/YYYY-MM-DD-name/` dirs and reads `summary.md`. Notably it does **not** use the `.hbs` template path (`loadTemplate`, `:387`) — output is assembled in code, so restructuring is low-friction.
- Grouping design: a pure function `groupEntriesByRelease(entries, boundaries)` in `src/release/changelog-grouping.ts`, where `boundaries: Array<{ version, tag }>` plus a per-entry attribution map are gathered at the edge. **Attribution mechanism:** date-prefix comparison against tag dates is ambiguous (day granularity); the precise, cheap alternative is tree containment — `git ls-tree -d <tag> spec/archive/<dirName>` non-empty ⇒ the change was archived at or before that tag. Archive dirs are committed during finalize and merged with the branch, so containment is reliable. 127 archive dirs (`ls spec/archive | wc -l`) × a handful of tags is trivial cost; the earliest containing tag is the change's release. Unattributable entries (dir present at no tag) fall into Unreleased; entries older than the oldest tag land under that tag or an explicit "Prior history" section — satisfying the v0.2.0–v0.4.0 backfill requirement without git archaeology.
- Call sites needing the boundary input: `src/cli/commands/docs.ts:41` and `src/finalize/finalizer.ts:269` (finalize regenerates docs — this is the "versioned shape survives finalize" scenario). `DocGenerator`'s constructor (`src/docs/doc-generator.ts:76-84`) gains an optional `releaseContext` param (boundaries + attribution map); both call sites gather it via one shared edge helper (`src/release/git-release-tags.ts`). When git/tags are unavailable, `releaseContext` is undefined and everything renders under a single Unreleased section — graceful degradation, no flat-format regression.

### Git plumbing — two reusable patterns, no shared helper yet

- `src/ship/merge-safety.ts:22-28` — `MergeSafetyPipeline` pattern: private `git(args)` via `execAsync`, a `steps: MergeSafetyStep[]` array of `{step, status: 'pass'|'fail'|'skip', detail}` records, early-return on failure. `ReleasePipeline` should copy this shape verbatim — it directly satisfies the "report which step failed" requirement, and the preflight clean-tree check (`:71-79`, `git status --porcelain --untracked-files=no`) is exactly the release preflight.
- The only existing `git tag` call is the snapshot `tag -f` at `src/ship/merge-safety.ts:156-158` — note it uses `-f`, which release tags must NOT (constitution + "existing tag aborts without force" scenario). Release uses `git tag -a {prefix}{version} -m "..."` after a `git rev-parse -q --verify refs/tags/...` preflight.
- Safer exec style precedent: `src/util/git-log-timings.ts:20-25` uses `execFile('git', [args])` (no shell interpolation) and never throws. Prefer `execFile`-style arg arrays in the release pipeline over merge-safety's string interpolation.
- Commit precedent: `src/cli/helpers.ts:160-216` (`autoCommit`-style helper) — `git add -- <paths>` then `git commit -m <msg>`, with a documented TODO (`:205`) that commit sites are not yet consolidated; the release commit adds one more site, same idiom, message `chore(release): {version}` (conventional, per `git.commit_convention` default at `src/schemas/project-config.ts:22`).
- Last-tag discovery: `git tag --list '{prefix}[0-9]*' --sort=-version:refname` (first line = latest) or `git describe --tags --match '{prefix}*' --abbrev=0`; empty output = no prior tag = first-release path. Commit collection: `git log {tag}..HEAD --format=%s%x1f%b%x1e` (full history, **not** `--first-parent` — ship lands work via PR merges whose merge-commit subject is `chore: merge metta/<name>` (`src/templates/skills/metta-ship/SKILL.md` step 6, `src/ship/merge-safety.ts:169`), so the `feat:`/`fix:` signal lives on the branch commits, which plain `git log` includes).

### Bump-signal sources in archive metadata — weak; git log is primary

- `spec/archive/*/.metta.yaml` (schema: `src/schemas/change-metadata.ts:91-115`) carries `workflow` tier, timings, tokens — but **no conventional-commit type field**. Archive dir names are truncated slugs (e.g. `2026-04-14-metta-backlog-done-subcommand`), not typed. Conclusion: conventional-commit prefixes from `git log` between tags are the primary derivation input; tier from `.metta.yaml` is at best a tie-break heuristic. The pure `deriveBump(commits: CommitMeta[]): BumpLevel` in `src/release/bump-derivation.ts` takes pre-gathered subjects+bodies; `!`-suffix and `BREAKING CHANGE:`/`BREAKING-CHANGE:` footers ⇒ major, else any `feat` ⇒ minor, else patch. (Optional additive follow-up: stamp a `commit_type` field into `.metta.yaml` at propose-time for future releases — not required for this change.)
- Semver arithmetic: no `semver` package in dependencies (`package.json` deps: commander, remark-parse, unified, yaml, zod, …). A strict `^(\d+)\.(\d+)\.(\d+)$`-validated `bumpVersion(current, level)` in `src/release/semver.ts` (~25 lines, pure) avoids a new dependency; prerelease/build-metadata inputs are rejected with a clear error (out of scope per intent).

### Guard hook + skill + mint — established extension points

- `.claude/hooks/metta-guard-bash.mjs` (mirrored at `src/templates/hooks/metta-guard-bash.mjs` — **both copies must change**): unknown subcommands fail closed (`classify` returns `'unknown'` → block, `:261-271`), so shipping the CLI without touching the hook would block even read-only `metta release status` from AI sessions. Required edits:
  - `ALLOWED_TWO_WORD` (`:29-38`): `['release', new Set(['status'])]`; optionally `ALLOWED_BARE` (`:60`) += `'release'` (roadmap precedent — bare form is a status view).
  - `BLOCKED_TWO_WORD` (`:50-54`): `['release', new Set(['cut'])]` — Tier-2, scope key `release:cut` per the keying logic at `:226-230`.
- `.claude/hooks/metta-session-mint.mjs:18-29` — `SKILL_SCOPES` map: add `'metta-release': ['release:cut']`. **Tier recommendation: Tier 2 (session-tier).** Rationale: the release flow is confirmation-heavy (bump override, target-version confirm, gh opt-in) and should run in the main session where the skill can use AskUserQuestion before issuing the CLI call with explicit flags — matching the `metta-plan`/`metta-verify`/`metta-backlog` pattern, not the forked Tier-1 ship pattern. Tier 1 would push the confirmation dialogue into a fork, where user interaction is unavailable.
- Skill template: `src/templates/skills/metta-release/SKILL.md`, modeled on `src/templates/skills/metta-ship/SKILL.md` (frontmatter + steps + rules) but **without** `context: fork`/`agent:` lines (main-session skill). The `copy-templates` script (`package.json`) already does `cp -r src/templates/skills` — zero build changes. `metta install` copies skills/hooks to `.claude/` (hooks are "metta-owned assets, same as skills/agents", `src/cli/commands/install.ts:35`), so consumers get both the skill and the updated guard on `metta install`.
- Guard integration test exists to extend: `tests/cli-metta-guard-bash-integration.test.ts`.

### git.enabled=false precedent

`src/util/git-worktree.ts:63,82` — `git.enabled === false` ⇒ mode `'skipped'`, no git action; `src/cli/commands/instructions.ts:200` gates auto-commit on `cfg.git?.enabled !== false`. A release is *inherently* a git operation (commit + tag), so unlike worktrees it cannot degrade: `metta release cut` with `git.enabled: false` must fail fast with an actionable error; `metta release status` can still report the version-file value and skip tag/bump portions with a warning.

## Implementation sketch

New files (src → matching tests in flat `tests/` dir, 1:1):

| File | Contents |
|---|---|
| `src/release/semver.ts` | pure `parseSemver`, `bumpVersion` |
| `src/release/bump-derivation.ts` | pure `parseConventionalSubject`, `deriveBump` |
| `src/release/version-file.ts` | read/write product version; JSON strategy for `*.json` (`version` field, indentation-preserving), trimmed-plain-text strategy otherwise; distinct-from-installed_version error wording |
| `src/release/changelog-grouping.ts` | pure `groupEntriesByRelease(entries, boundaries, attribution)` |
| `src/release/git-release-tags.ts` | edge: `listReleaseTags(root, prefix)`, `attributeArchiveEntries(root, tags, dirNames)` (ls-tree containment), `collectCommitsSince(root, tag)` — `execFile`, never-throw-tolerant like `git-log-timings.ts` |
| `src/release/release-pipeline.ts` | `ReleasePipeline` class, merge-safety-style step records; injected confirm callbacks keep it testable |
| `src/release/gh-release.ts` | edge: `gh --version` / `gh auth status` probe → typed `missing-binary` vs `unauthenticated` outcome; `gh release create <tag> --title --notes-file` |
| `src/cli/commands/release.ts` | `registerReleaseCommand` — `release status` (read-only), `release cut [--bump <level>] [--yes] [--github] [--dry-run]` |
| `src/templates/skills/metta-release/SKILL.md` | main-session skill: status → AskUserQuestion (bump/confirm/gh) → `metta release cut --bump X --yes [--github] --json` |
| tests | `tests/release-{semver,bump-derivation,version-file,changelog-grouping,pipeline}.test.ts`, `tests/cli-release.test.ts` (temp git repo fixtures, precedent: `tests/cli-finalize.test.ts`), `tests/doc-generator-versioned-changelog.test.ts` |

Modified files:

- `src/schemas/project-config.ts` — `ReleaseConfigSchema` + `release:` key (+ export in `src/schemas/index.ts` if barreled)
- `src/cli/index.ts` — import + `registerReleaseCommand(program)`
- `src/docs/doc-generator.ts` — `generateChangelog` restructured around the pure grouping fn; optional `releaseContext` constructor param
- `src/cli/commands/docs.ts:41` and `src/finalize/finalizer.ts:269` — gather + pass `releaseContext`
- `.claude/hooks/metta-guard-bash.mjs` + `src/templates/hooks/metta-guard-bash.mjs` — allow/block entries
- `.claude/hooks/metta-session-mint.mjs` + `src/templates/hooks/metta-session-mint.mjs` — `SKILL_SCOPES['metta-release']`
- `tests/cli-metta-guard-bash-integration.test.ts` — new cases

Pipeline step order (satisfies the safety-constraint scenarios): `config-check → git-check (enabled + repo + not-detached) → preflight-clean-tree → last-tag → collect-commits → derive-bump → [confirm] → target-tag-absent → write-version-file → regen-changelog → commit → annotated-tag → [gh, isolated]`. Tag-absence is checked *before* any write, so the "existing tag" case aborts with zero mutations; a changelog failure triggers a best-effort restore of the version file (re-write previous content — no `git checkout --` needed since nothing is staged yet) before reporting the failing step. No push anywhere; `gh` failure after a successful tag reports separately and does not roll back (graceful-degradation requirement).

## Edge cases

- **No prior tag** — empty tag list ⇒ `collectCommitsSince(root, undefined)` = full `git log HEAD`; base version from the configured file; not an error (explicit spec requirement).
- **Manual pre-existing tags (v0.2.0–v0.4.0)** — tag listing is prefix-pattern-based, so hand-cut tags are first-class boundaries; ls-tree attribution backfills archive entries best-effort; anything unattributable renders under Unreleased/prior-history, nothing dropped.
- **Dirty tree** — preflight fails (merge-safety `status --porcelain --untracked-files=no` pattern) before any mutation.
- **`git.enabled: false` / not a repo / detached HEAD / shallow clone** — `git-check` step fails actionably; `release status` degrades to version-file-only output. Shallow clones may truncate `git log {tag}..HEAD` — detect `git rev-parse --is-shallow-repository` and warn.
- **Tag already exists** — pre-write `rev-parse -q --verify` abort; never `-f`, never delete.
- **Version file variants** — `package.json` without a `version` field; non-JSON file with trailing newline (preserve); file missing entirely (error names the configured path + "product version", never mentions `installed_version`).
- **Commit-message parsing** — `!` before `:` (e.g. `feat(api)!:`), `BREAKING CHANGE:`/`BREAKING-CHANGE:` in body only, non-conventional subjects (count as patch-weight, don't error), NUL/unit-separator-safe log format for multi-line bodies.
- **Merge-commit noise** — `chore: merge metta/x` subjects parse as `chore` ⇒ patch-weight; real signal comes from included branch commits (full log, not first-parent).
- **Two releases same day / same-day archive entries** — handled by tree-containment attribution, not date comparison.
- **Non-TTY `release cut` without `--yes`** — `askYesNo` returns the fail-closed default ⇒ aborts cleanly; skill always passes explicit flags.
- **Worktree invocation** — tags/commits are repo-global; pipeline runs against `projectRoot` cwd like merge-safety; release should normally run on `main` post-ship — add a warning (not a hard block) when cutting from a `metta/*` branch.

## Risks & tradeoffs

- **Doc-generator ripple (main risk).** `generateChangelog`'s output shape changes and two call sites (docs command, finalizer) must both supply release context, or finalize would regenerate a changelog missing version anchors. Mitigated by making `releaseContext` gathering a single shared helper and covering the finalize-regeneration scenario in `tests/doc-generator-versioned-changelog.test.ts`; residual risk is low because absent context degrades to "everything Unreleased", never to data loss.
- **Guard/mint dual-copy drift.** Hook changes must land in both `.claude/hooks/` (live repo) and `src/templates/hooks/` (shipped to consumers). Byte-identity is testable (precedent: `tests/agents-byte-identity.test.ts` for agents) — add the same for hooks if not already covered.
- **Hand-rolled semver.** Strict `x.y.z`-only parsing is ~25 lines and dependency-free, but rejects prerelease tags; acceptable given intent's out-of-scope list, and swappable for the `semver` package later without API change. (Adding the dep now is a defensible alternative; recommendation: skip it, smallest surface.)
- **One more unconsolidated git-commit site** — acknowledged tech debt per the TODO at `src/cli/helpers.ts:205`; keep the release commit inside `ReleasePipeline` so the future consolidation refactor has one obvious seam.
- **Bump-signal fidelity.** Because archives don't record commit type, derivation depends on commit-message hygiene on branch commits. The user override requirement (explicit `--bump`) is the escape hatch; recommendation is advisory by design.
- **Scale of change** — ~9 new source files, ~8 modified, ~7 new test files: solidly a `standard`-tier change, larger than candidates 2/3 but with no coupling into the safety-critical ship path (merge-safety untouched), which candidate 2 cannot claim.
- **Consumer rollout** — consumers get the skill/hook only after `metta install` re-run; version-drift warning (`src/cli/index.ts:137-151`) already nudges this.

## Verdict

**Fit score: 9/10.**

Every seam this approach needs already exists and was found in-code: flat command registration (`src/cli/index.ts`), strict optional Zod sub-configs (`project-config.ts`), a step-recorded git pipeline to clone (`MergeSafetyPipeline`), a code-assembled changelog generator with exactly two call sites, comment-preserving config writes, an `askYesNo` confirmation helper, and a guard/mint/skill extension pattern with direct precedent (`roadmap` for bare-allowed + two-word-blocked, `metta-backlog` for Tier-2 scoping). The approach satisfies all 13 spec requirements without touching merge-safety semantics or `version-drift.ts`, keeps bump derivation and changelog grouping pure (functional core), and is purely additive for unconfigured projects by schema construction. The docked point reflects the doc-generator call-site ripple (the one place this change couples into finalize) and the dual-copy hook-drift hazard — both bounded and testable. This is the shape the intent already flagged as leading, and the codebase evidence confirms it: recommended.
