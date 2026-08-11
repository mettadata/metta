# Research: Changelog-anchored minimal version tracking (Candidate 3)

Approach under evaluation: skip tagging and GitHub releases initially. Add a `version` field to project config, teach `generateChangelog` to group archived changes under version headings, and provide a small `metta version bump` helper that updates the version file and changelog only. Tags and GitHub releases stay manual; a later change could add full release automation on top.

## Approach summary

Three deliverables, all additive:

1. **Config**: a `release:` block in `ProjectConfigSchema` (scheme, version-file path, tag prefix, gh opt-in flag reserved-but-unused) — optional, so unconfigured projects are untouched.
2. **Changelog versioning**: `generateChangelog` in `src/docs/doc-generator.ts` gains a pure grouping step that buckets archive entries under version headings plus an Unreleased section, driven by a small Zod-validated releases record (written at bump time) rather than by git tags.
3. **CLI helper**: `metta version` (status, read-only) and `metta version bump <level>` (rewrites the configured version file, appends a release record, regenerates the changelog). No git commit, no tag, no `gh`, no push.

Deliberately deferred: bump *derivation* could be included cheaply (it is a pure function), but release commit, annotated tag, GitHub release, and the release skill flow around them are all out of this approach's scope. The intent document itself flags this candidate as under-delivering (intent.md line 35).

## Codebase findings (file:line evidence)

All paths relative to the change root `/home/utx0/Code/metta/.metta/worktrees/fix-automatic-versioning-release-capability-metta`.

### Current changelog rendering — `src/docs/doc-generator.ts`

- `generateChangelog` (`doc-generator.ts:205-235`) is ~30 lines: it calls `loadArchiveEntries()`, skips entries missing `summary.md` with a warning (211), then renders a flat list — one `## ${date} — ${changeName}` heading per entry (225) followed by raw `summaryContent`. Empty archive renders `No archived changes with summaries found.` (231).
- `ArchiveEntry` (`doc-generator.ts:45-53`) carries `dirName`, `date`, `changeName`, `summaryContent`. `loadArchiveEntries` (`334-385`) parses archive dir names against `/^(\d{4}-\d{2}-\d{2})-(.+)$/` (344) and sorts reverse-chronologically by date, then dirName desc for ties (377-382). **Date granularity is day-only** — this matters for attributing changes to a release cut on the same day.
- `loadTemplate` (`doc-generator.ts:387-397`) and `src/templates/docs/changelog.md.hbs` exist, but `generateChangelog` does **not** use the template — all four generators build markdown with inline `lines.push(...)`. Existing precedent: the minimal diff extends the inline builder rather than migrating to the .hbs template.
- Regeneration path: `Finalizer` (`src/finalize/finalizer.ts:256-269`) constructs `DocGenerator` and regenerates when `docs.generate_on === 'finalize'` (268). Whatever grouping logic is added must live *inside* `generateChangelog` (fed from persisted state), or the finalize regeneration would revert to the flat shape — this is exactly the spec scenario at spec.md:161-164.
- **Test gap**: there is no `doc-generator.test.ts` anywhere (`tests/` has 99 files, none covering `DocGenerator`; only `tests/finalizer.test.ts` touches it indirectly). This change would create the first direct test for the changelog path — slightly more test surface than "minimal" suggests, but it also repays an existing 1:1-ratio debt.

### Config schema — `src/schemas/project-config.ts`

- `ProjectConfigSchema` (`project-config.ts:103-125`) is a `.strict()` object of optional/defaulted sub-schemas (`GitConfigSchema` 20-33, `DocsConfigSchema` 37-41 are the closest patterns). `installed_version` is a top-level optional string (124).
- A `ReleaseConfigSchema` slots in identically: `z.object({ scheme: z.literal('semver'), version_file: z.string().min(1), tag_prefix: z.string().default('v'), github_release: z.boolean().default(false) }).strict()`, wired as `release: ReleaseConfigSchema.optional()`. Optionality gives the "purely additive when unconfigured" requirement for free.
- Key-naming in errors: `ConfigLoader.load` already formats Zod issues as `path.join('.')`-prefixed messages (`src/config/config-loader.ts:154-155`), so "error names the offending key" comes from Zod + a `z.literal('semver', { message: ... })` custom message.
- Writes: `setProjectField` (`src/config/config-writer.ts:11-36`) is the comment-preserving YAML write path if `metta config set release.version_file ...` or an init helper needs to write the block.

### `installed_version` separation — `src/config/version-drift.ts`

- `readInstalledVersion` (`version-drift.ts:42-52`) reads only `.metta/config.yaml` top-level `installed_version`; `stampInstalledVersion` (60-62) writes it via `setProjectField`. The new product-version reader reads the *configured* version file (e.g. host `package.json`) and never touches this module — separation is structural, not just naming. `getPackageVersion` (`src/cli/helpers.ts:472-477`) shows the existing pattern for reading a `package.json` `version` field (metta's own, via `import.meta.url`); the host-project reader is the same shape rooted at `projectRoot`.

### CLI registration — `src/cli/index.ts` and `src/cli/commands/`

- Registration is uniform: one `registerXCommand(program)` export per file in `src/cli/commands/` (44 existing files), imported and called in `src/cli/index.ts:11-51` / `64-97`. `registerDocsCommand` (`src/cli/commands/docs.ts:8-43`) is the closest template: builds a command group, loads config via `createCliContext().configLoader.load()`, parses the sub-config with its schema, drives `DocGenerator`, honors `--json` and `--dry-run`. A new `src/cli/commands/version.ts` with `version` (status) and `version bump <level>` subcommands is a mechanical addition.

### Guard hook tiering — `.claude/hooks/metta-guard-bash.mjs` and `metta-session-mint.mjs`

- The guard is fail-closed for unknown subcommands (comment at `metta-guard-bash.mjs:59`), so `metta version` would be **blocked for AI sessions by default** until explicitly classified. Required entries:
  - `version` bare/status → `ALLOWED_BARE` (line 60, currently only `roadmap`) or `ALLOWED_SUBCOMMANDS` (19-26) — it is read-only.
  - `version bump` → `BLOCKED_TWO_WORD` (50-54, pattern: `['backlog', new Set(['add','done','promote'])]`) as Tier 2 session-tier.
  - A matching `'metta-version': ['version:bump']` scope in `SKILL_SCOPES` (`metta-session-mint.mjs:18-29`, two-word forms keyed `"<sub>:<third>"`), plus a skill under `src/templates/skills/` (copied to `dist/templates/skills` by the `copy-templates` script, `package.json:18`) and deployed to `.claude/skills/`.
- Tier 2 fits: `version bump` mutates a config-adjacent file and docs but is not a fork-tier lifecycle entry point. Guard/mint tests exist (`tests/metta-guard-bash.test.ts`, `tests/metta-session-mint.test.ts`) and would need the new entries covered.

### Attributing archived changes to versions (the grouping input)

Archive dirs carry only a `YYYY-MM-DD` date prefix (`doc-generator.ts:344`); there is no per-entry `.metta.yaml` in the archive (spot-checked `spec/archive/2026-04-06-build-metta-refresh-cli-slash/` — artifacts only). Since this approach creates no tags, the cleanest boundary record is a **releases state file** (e.g. `.metta/releases.yaml` or `spec/releases.yaml`, Zod-validated like all state): at `version bump` time, snapshot the set of not-yet-attributed archive `dirName`s under the new version. Grouping then becomes an exact, pure function `groupByRelease(entries, releases)` — no date-tie ambiguity, and finalize regeneration preserves shape because the record persists. Manual tags v0.2.0-v0.4.0 get a one-time backfill entry (best-effort by date, or an explicit "Prior releases" section), satisfying the US-7 rendering requirement without git archaeology.

The alternative — deriving boundaries from `git tag` dates at generation time — would pull git I/O into `DocGenerator` (currently pure fs, constructor at `doc-generator.ts:76-84`) and still can't beat day-granularity ties. The existing tag surface is only the `metta/pre-merge/*` snapshot tags in `src/ship/merge-safety.ts:156-159` (`git tag -f`, explicitly a rollback mechanism, and its `-f` usage is scoped to metta-namespaced snapshot refs — not a pattern to reuse for release tags).

## Implementation sketch

Estimated surface (new + modified):

| File | Change |
|---|---|
| `src/schemas/project-config.ts` | `ReleaseConfigSchema` + `release` key (~15 lines) |
| `src/schemas/releases.ts` (new) | Zod schema for the releases record: `[{ version, date, changes: string[] }]` (~20 lines) |
| `src/release/product-version.ts` (new) | Pure semver increment + edge readers/writers for the configured version file (JSON `package.json` indent-preserving rewrite; plain-text fallback for other files) (~80 lines) |
| `src/release/group-by-release.ts` (new, or inside doc-generator) | Pure grouping function (~40 lines) |
| `src/docs/doc-generator.ts` | `generateChangelog` reads releases record, renders `## {version} — {date}` sections + `## Unreleased` + prior-history fallback (~50-line diff) |
| `src/cli/commands/version.ts` (new) | `version` status + `version bump <patch|minor|major>` (~120 lines) |
| `src/cli/index.ts` | register (+2 lines) |
| `.claude/hooks/metta-guard-bash.mjs` + `metta-session-mint.mjs` | tier entries (~6 lines) |
| `src/templates/skills/metta-version/` + `.claude/skills/metta-version/` | new skill template (build copy step already handles the dir) |
| Tests | `tests/product-version.test.ts`, `tests/group-by-release.test.ts`, first `tests/doc-generator.test.ts` (changelog path), schema cases in `tests/schemas.test.ts`, guard/mint entries in existing hook tests (~5 files) |

Roughly 350-450 LOC plus tests. No changes to finalize/ship, merge-safety, or state-store. Optionally, the pure bump-derivation function (`deriveBump(changes) → level`) can be included at ~30 lines with git-log gathering at the CLI edge — recommended even in this approach, since it is the cheapest requirement in the spec and its absence fails two more requirements (see below).

Edge cases found:

- **Same-day archive after bump**: solved by snapshot attribution in the releases record, not by date comparison.
- **Missing `summary.md`** entries are skipped from the changelog today (`doc-generator.ts:210-213`); grouped rendering must keep the same warning behavior so no entries silently vanish (US-7 "no entries lost").
- **`package.json` rewrite fidelity**: naive `JSON.stringify` can reorder nothing but can change indentation/trailing newline; detect indent from the raw text (2-space in this repo) and preserve the trailing newline.
- **Version-file/record divergence**: user hand-edits `package.json` after a bump — `metta version` status should surface the mismatch rather than error.

## Unmet spec requirements

Measured against this change's own `spec.md` (the delta spec `metta verify` will check against). This approach **fails or only partially satisfies 7 of the 14 requirements**:

1. **Release Cut Operation (spec.md:100-112) — FAIL.** No release commit (step 3) and no annotated tag (step 4). Both scenarios fail: no `v0.5.0` tag exists and the "annotation carries release identity" scenario (109-112) has no subject at all.
2. **Release Cut Safety Constraints (spec.md:114-131) — VACUOUS/FAIL.** The constraints are trivially "met" only because the operations they constrain don't exist; the "existing tag aborts" scenario (123-126) cannot pass because there is no tag step to abort.
3. **Bump Derivation From Shipped Changes (spec.md:62-84) — FAIL as scoped** (user picks the level manually). Recoverable: including the pure `deriveBump` function upgrades this to PASS at low cost.
4. **User Override Of Recommended Bump (spec.md:86-98) — FAIL as scoped.** There is no recommendation to override. Also recoverable via the same derivation function.
5. **Release CLI Command Surface (spec.md:203-215) — PARTIAL.** The version-status scenario (212-215) requires the status command to print a *recommended bump*; without derivation it fails. The "release cut command" half maps only to `version bump`, which does less than the spec's release cut.
6. **Opt-In GitHub Release Publication (spec.md:175-187) — FAIL.** The "no confirmation → no gh" scenario passes vacuously, but the confirmed-publication scenario (184-187) is unimplementable without the tag it publishes against.
7. **Graceful Degradation When gh Unavailable (spec.md:189-201) — FAIL.** No gh step exists to degrade.

Satisfied: Release Configuration Schema (5-27), Product Version Distinct From Installed Version (29-46), Purely Additive When Unconfigured (48-60), Version-Anchored Changelog Generation (147-164), Pre-Existing Manual Release History Rendering (166-173), Release Skill And Guard Authorization (217-234, scoped to `version bump`), and First Release Without Prior Tag (133-145) only in its "absence of a tag is not an error" half — the "manual tag treated as release boundary" scenario (142-145) is met by backfill record rather than tag reading, which is defensible but weaker than written.

Bottom line: even with derivation added back, requirements 1, 2, 6, 7 remain unmet. Shipping this approach honestly requires rewriting `spec.md` to remove or defer four requirements — and intent.md explicitly lists tag creation and opt-in GitHub release as "must deliver" (proposal item 3, intent.md:27) while pre-labeling this candidate as under-delivering (intent.md:35).

## Risks & tradeoffs

**For:**

- Smallest genuinely useful diff: touches no safety-critical path (ship/merge-safety untouched), no `gh` dependency, no git write operations at all — the entire constitutional git-safety burden (no force, no auto-push, abort semantics) evaporates because nothing mutates git.
- The two pieces it does build (config schema, version-anchored changelog with a releases record) are exactly the pieces every fuller candidate also needs, and the releases-record design survives intact under a later Candidate-1 build-out (the tag step just starts writing the same record).
- Codebase fit is excellent: every piece has a direct existing pattern (`DocsConfigSchema`, `registerDocsCommand`, `setProjectField`, guard two-word tiering).

**Against:**

- **It does not fix the logged issue.** The chore being automated is version-file edit + changelog + tag + optional GH release; this automates the first two and leaves the user hand-running `git tag -a` and `gh release create` — the most error-prone steps (tag/file/changelog consistency) remain manual, and nothing enforces that the manual tag matches the bumped version. The framework would *record* releases it did not actually cut.
- **Spec renegotiation cost**: for a fix-issue change, the verify gate runs against `spec.md` as written; 4-7 requirement failures means either a large descoping edit to an already-authored spec (with stories US-3, US-5 gutted) or a failed verification. That renegotiation is itself workflow overhead that erodes the "smallest diff" argument.
- **Two-change total cost is higher**: the follow-up change re-opens the same files (`version.ts` command, skill, guard entries, spec) and must migrate `version bump` semantics into a `release` operation, likely with a rename/deprecation. One coherent Candidate-1 change avoids that churn.
- **Half-built config**: `tag_prefix` and `github_release` keys ship as validated-but-dead config, which conflicts with the project's tendency to spec-check everything that exists.
- "Defer risk" is weak here because the risky-looking part (git tagging) is actually small: an annotated `git tag` + existence pre-check is ~15 lines at the imperative edge, far less than the changelog work this approach already commits to.

## Verdict

**Score: 3/10** against this change's spec and intent. (Codebase-fit alone would be 8/10 — every needed pattern exists and the diff is clean — but the approach structurally fails the authored spec: 4 requirements are unimplementable without tags/gh, 3 more need the derivation add-back, and the intent names tag creation and opt-in GitHub release as required outcomes while pre-labeling this candidate as under-delivery.)

"Smallest diff now, second change later" is defensible only if the user explicitly re-scopes the issue to "versioned changelog first" — a product decision, not a technical one. On the technical merits, the marginal cost of the deferred pieces (annotated tag ~15 lines, gh opt-in ~40 lines, both behind existing confirmation patterns) is small relative to the cost of renegotiating the spec and re-opening every touched file in a follow-up change. Recommendation from this track: **do not select Candidate 3 as the change's approach**; instead, carry its two durable components — the `ReleaseConfigSchema` shape and the releases-record + pure `groupByRelease` changelog design (which cleanly solves the finalize-regeneration and same-day-attribution edge cases) — into the Candidate 1 design.
