# Design: automatic-version-cut-ship-user-decision-2026-08-26-make

## Approach

Adopt the research decision **"Local-only cut + skill-side verified GitHub publish"** exactly as recorded, honoring all six binding riders. The shape:

1. **`ReleasePipeline.cut()` becomes purely local.** The in-cut `'gh'` step is deleted (a code *removal*, not a reorder), so the tag-not-on-remote race is impossible by construction. `cut()` ends at the annotated tag and additionally emits the extracted changelog section as a `notes` string (rider 3) so no consumer ever re-parses `docs/changelog.md`.
2. **The publish step moves to the post-push actor — the skills.** The constitution forbids the CLI from pushing, and the push is already skill-side in every ship path; `gh release create` becomes the eighth skill-side remote operation in the established pattern (`git push`, `gh pr create/checks/merge/comment`). The gh block runs only after `git push --follow-tags origin main` lands the tag, probes `gh release view <tag>` first (rider 6, idempotent re-run), and always passes `--verify-tag` (rider 2) so gh aborts instead of silently creating a wrong tag from default-branch HEAD (the actual v0.5.0/v0.6.0 corruption mode; gh manual, https://cli.github.com/manual/gh_release_create).
3. **A canonical, byte-identical release-stage block** is inserted into all six ship-path skills (both trees), positioned after merge → `git pull --ff-only` → dist rebuild and before final hand-back. It handles `release.on_ship` mode (`auto`/`prompt`/`off`), absent release config, the pre-1.0 major guard, and warn-and-continue failure posture. Drift is pinned by a new grep-assert test (template: `tests/skill-uat-ship-gate.test.ts`) plus the existing auto-discovering `tests/template-deploy-sync.test.ts` byte-identity suite.
4. **Config knob** `release.on_ship: auto | prompt | off` (default `auto`, three-legged pattern mirroring `uat.enforce_on_ship`) and escape hatch `release.allow_major_pre_1: boolean` (default `false`).
5. **`--github` is removed from `metta release cut`** with an erroring stub (rider 1) — the broken ordering is unreachable without notice. `/metta-release` gets the same fixed sequence with an explicit per-run push confirmation (rider 4).

ADR-style decisions (composition over inheritance throughout — no new classes, no pipeline subclassing):

- **ADR-1 — Skill-side publish over pipeline phase split.** Per `research.md`: the CLI cannot follow the push in one invocation (it may not push), so a `release publish-github` subcommand would still be skill-invoked at the same point, adding ~60 lines of CLI, a new guard word, a new mint scope, and primer/seam sync for no structural gain. `--verify-tag` + the `gh release view` probe match the split's typed-degradation and retryability benefits. (Traces: research rationale; spec "Single Cut Path Through ReleasePipeline", "Opt-In GitHub Release Publication".)
- **ADR-2 — Echo release knobs through `release status --json` rather than having skills parse YAML.** The skills must branch on `on_ship`, `allow_major_pre_1`, and `github_release`, including the *omitted-key-means-default* leg. Re-implementing Zod default resolution in skill prose would break the three-legged pattern; the established precedent is config echoed through CLI JSON (`uatEnforceOnShip` in `metta finalize --json`). `ReleaseStatusResult` gains three additive, schema-resolved echo fields (see API Design). Read-only, allow-listed, no guard delta.
- **ADR-3 — Absent-config detection via the existing `release status` failure.** `ReleaseConfigMissingError` already fires before any read/write; the skill treats a status failure whose message contains `Release configuration is missing` as the documented skip signal (one-line loud notice, ship continues). No new CLI surface. (Traces: spec "Purely Additive When Unconfigured".)
- **ADR-4 — Delete `src/release/gh-release.ts` outright.** After the `'gh'` step removal it has zero importers; publication is raw `gh` commands in skill prose. Keeping a dead typed edge would be a second publish path in waiting — contrary to the subtractive posture and the single-cut-path requirement.
- **ADR-5 — Vendor lock-in flag.** The publish leg (`gh release view/create`) is GitHub-specific. This is *pre-existing, opt-in* lock-in behind `release.github_release: false`-by-default; this change narrows it (gh is no longer reachable from the CLI at all) rather than widening it. The cut, tag, and push legs are pure git.

## Components

File-by-file. "Both trees" = `src/templates/...` source of truth **and** the committed `.claude/...` deployed copy; `tests/template-deploy-sync.test.ts` auto-discovers every file in the `skills` and `hooks` families and fails on any byte difference, so each edit is made identically in both places.

### 1. `src/schemas/project-config.ts` — config schema

`ReleaseConfigSchema` (currently lines 104–113) gains two keys, following the existing `scheme` errorMap pattern so validation failures name the offending key:

```ts
on_ship: z.enum(['auto', 'prompt', 'off'], {
  errorMap: () => ({ message: "release.on_ship: must be one of 'auto', 'prompt', 'off'" }),
}).default('auto'),
allow_major_pre_1: z.boolean().default(false),
```

`export type ReleaseConfig = z.infer<typeof ReleaseConfigSchema>` picks both up automatically; no new type exports needed beyond the inferred widening. Existing configs without either key parse to the defaults (legs 1 and 2 of the three-legged pattern) — no migration.

### 2. `src/cli/commands/install.ts` — scaffolding (leg 3)

The scaffolded config is the `configContent` template string at lines 279–290 (pre-existing string-literal scaffold; this change follows that established pattern rather than introducing a template file for a 6-line YAML block — flagged as a known convention tension already present in the file). Mirror the `uat.enforce_on_ship` comment-plus-explicit-key style. Because `ReleaseConfigSchema` is `.strict()` and requires `scheme` + `version_file`, a bare `release.on_ship` key would make the scaffolded config *invalid* — so the release block is scaffolded **only when a version file is detectable**: when `existsSync(join(root, 'package.json'))`, append:

```yaml
release:
  scheme: semver
  version_file: package.json
  github_release: false
  # Ship-path skills cut a release automatically after each merged ship;
  # set prompt to be asked each time, or off for on-demand /metta-release only.
  on_ship: auto
```

Projects without `package.json` get no `release` block and keep the absent-config skip behavior (spec: "Making release config mandatory" is out of scope). The `wx` write flag already protects existing configs.

### 3. `src/release/release-pipeline.ts` — local-only cut

- **`MUTATION_STEPS`** (lines 106–114): remove `'gh'`. Dry-run now emits six skipped mutation steps.
- **Delete the gh step** (lines 509–528) and the `gh` local plus `import { createGithubRelease, type GhExec, type GhOutcome } from './gh-release.js'` (line 17).
- **`ReleaseCutOptions`**: remove `github: boolean` and `ghExec?: GhExec`.
- **`ReleaseCutResult`**: remove `gh?: GhOutcome`; add `notes?: string` — "extracted changelog section for the cut version; present on non-dry-run success". After the `annotated-tag` step passes, compute `const notes = await this.extractChangelogSection(changelogPath, target)` (the existing private helper, lines 540–552, reused unchanged — rider 3, ~3 lines) and return `{ status: 'success', steps, version: target, tag, notes }`. Dry-run success omits `notes` (the changelog was not regenerated).
- **`ReleaseStatusResult`** (ADR-2): add `onShip: 'auto' | 'prompt' | 'off'`, `allowMajorPre1: boolean`, `githubRelease: boolean`, populated in `status()` from the Zod-parsed `release` config (`release.on_ship`, `release.allow_major_pre_1`, `release.github_release`). Additive — no existing field changes.
- `cut()`'s abort-point ordering, mutation-group restore logic, and bump derivation are untouched (spec: derivation rules unchanged; single cut path preserved).

### 4. `src/release/gh-release.ts` — deleted (ADR-4)

Remove the file and any barrel re-exports of `GhOutcome`/`GhExec`/`createGithubRelease` from `src/index.ts` (verify with a repo-wide import grep at execute time). `tests/release-gh-release.test.ts` is deleted with it (1:1 test-to-source ratio maintained by removal on both sides).

### 5. `src/cli/commands/release.ts` — CLI surface

- **`--github` erroring stub (rider 1).** Keep the option registered so Commander does not emit a generic `unknown option` — replace the current declaration (line 81) with `.option('--github', '(removed) GitHub publication now happens after the tag push — see error for the sequence')`. In the action, *before* `createCliContext()` / config load / any pipeline construction, when `opts.github === true`:

  ```
  throw new ReleaseError(
    "--github has been removed from 'release cut': the cut is local-only. " +
    'Publish after the tag is on the remote: (1) metta release cut --bump <level> --yes, ' +
    '(2) git push --follow-tags origin main, ' +
    '(3) gh release create <tag> --verify-tag --notes-file - (requires release.github_release: true).'
  )
  ```

  This performs no release mutation and replaces the old `release.github_release is disabled` fail-fast (lines 107–111), which is deleted.
- **`pipeline.cut()` call** (lines 123–128): drop the `github` field.
- **`renderCutResult`** (lines 18–40): delete the `result.gh` warn block (lines 26–29); update the hint (line 30) to:
  `'The tag was NOT pushed. Push it with: git push --follow-tags origin main — then publish the GitHub release (if configured) with: gh release create <tag> --verify-tag'`.
- **Command description** (line 78): `'Cut a release locally: bump version, update record and changelog, commit, and tag (never pushes; GitHub publication happens after the tag push)'`.
- `--json` output needs no bespoke handling — `outputJson(result)` serializes the new `notes` field and the new status echo fields automatically.

### 6. Ship-path skills — canonical release-stage block (6 skills × 2 trees = 12 files)

Files: `{src/templates/skills,.claude/skills}/{metta-ship,metta-propose,metta-quick,metta-auto,metta-fix-issues,metta-fix-gap}/SKILL.md`. One shared markdown block, inserted **verbatim and byte-identically** in all twelve, headed `### Post-merge release stage`. Insertion points (after pull --ff-only + dist rebuild, before the final report/hand-back step):

| Skill | Position |
|---|---|
| `metta-ship` | new step 10, after step 9 (dist rebuild); report becomes step 11 |
| `metta-propose` (ship opt-in only) | after the `--ship` sub-steps `g` (pull/cleanup) and its rebuild sub-step, before the report sub-step; the PR-open hand-back path is untouched — no release wording on it |
| `metta-quick` | after steps 15/16 (pull + rebuild) |
| `metta-auto` | after steps 14/15 (pull + rebuild) |
| `metta-fix-issues` | after sub-steps `e`/`f` (pull + rebuild) |
| `metta-fix-gap` | after sub-steps `e`/`f` (pull + rebuild) |

The block opens with the **canonical grep-asserted sentence** (frozen byte-exact in the new test; authored once in `metta-ship` and copied, never retyped):

> Post-merge release stage (runs only after the user-approved PR merge, git pull --ff-only, and dist rebuild — never at a PR-open hand-back): resolve the effective release.on_ship mode via metta release status --json, and on auto (or a confirmed prompt) derive the bump, run metta release cut --bump <level> --yes --json, push the release commit and tag with git push --follow-tags origin main, then — only when githubRelease is true — probe gh release view <tag> and publish with gh release create <tag> --verify-tag --notes-file -, treating every failure in this stage as warn-and-continue: report what failed, state that /metta-release cuts it on demand, and never unwind or block the completed ship.

Followed by the mode/rail bullets (also part of the byte-identical block):

- **Absent config:** if `metta release status --json` fails with `Release configuration is missing`, emit exactly one loud line — `notice: release config absent — skipping the post-merge release cut (configure release: in .metta/config.yaml to enable)` — and continue to hand-back. Not an error, never a ship blocker. Any *other* status failure is warn-and-continue.
- **`off`:** stop the stage immediately; no derivation, no cut, no gh — behavior identical to pre-change ships.
- **`prompt`:** report `<unreleasedChanges> unreleased change(s), recommended bump: <recommendedBump>` and ask via AskUserQuestion **when the context can ask**; in any context that cannot collect an answer (forked skill execution, non-interactive run), fail closed — skip the cut and emit a loud notice that prompt mode could not ask. Decline = no cut, backlog stays for `/metta-release`. Confirm = proceed identically to `auto`.
- **Pre-1.0 major guard:** when `version` < 1.0.0, `recommendedBump` is `major`, and `allowMajorPre1` is `false` → cut `minor` instead and prominently report both the original major derivation and the downgrade ("pre-1.0: derived major downgraded to minor; set release.allow_major_pre_1: true to allow"). `allowMajorPre1: true` or version ≥ 1.0.0 → apply as derived. All three inputs come from the status `--json` echo (ADR-2).
- **Cut:** `metta release cut --bump <level> --yes --json`; on success parse `version`, `tag`, `notes`; the ship report MUST state the released version.
- **Push:** `git push --follow-tags origin main` — the single authorized main push carrying the release commit and tag; never `--force`, never a second unconfirmed push.
- **gh publish (only when `githubRelease` is true):** probe `gh release view <tag>`; if it exists, skip creation (idempotent). Otherwise `gh release create <tag> --verify-tag --title <tag> --notes-file -` with the `notes` string from cut `--json` fed on stdin via a quoted heredoc. Any gh failure (missing binary, unauthenticated, create error): warn naming the cause and the exact manual command `gh release create <tag> --verify-tag`, then continue. `githubRelease: false` → no `gh release` command at all.

No frontmatter changes are needed: all six already carry `Bash`; the gh/git commands are unguarded; prompt-capable contexts already resolve AskUserQuestion availability at runtime.

### 7. `{src/templates/skills,.claude/skills}/metta-release/SKILL.md` — on-demand skill (rider 4)

- Step 3: `metta release cut --bump <level> --yes --json` — the `--github` clause is dropped entirely.
- Step 2's GitHub question moves *after* the cut: when `github_release: true` (now read from the status `--json` echo), ask whether to publish.
- New step 4: ask **explicit per-run confirmation** to push; on yes run `git push --follow-tags origin main`; on no, report the manual command and stop (local release intact).
- New step 5 (only after a confirmed, successful push, and only when the user opted in): the same gh block — probe `gh release view <tag>`, then `gh release create <tag> --verify-tag --title <tag> --notes-file -` with `notes` from cut `--json`; warn-and-continue on failure with the manual command.
- Rules updated: "Never run `git push` from this skill" → "Push only with explicit per-run user confirmation, only `git push --follow-tags origin main`, never `--force`"; "omit `--github`" rule replaced by "never pass `--github` — the flag is removed and errors".

### 8. Guard/mint hooks — `{.claude/hooks,src/templates/hooks}/{metta-guard-bash.mjs,metta-session-mint.mjs}`

**Single delta:** in `metta-session-mint.mjs`, `SKILL_SCOPES['metta-fix-gap']` (line 38) becomes `['fix-gap', 'complete', 'finalize', 'release:cut']` — in both trees. Rationale, confirmed against the guard source:

- `metta-ship`, `metta-propose`, `metta-quick`, `metta-auto`, `metta-fix-issues` execute as forked `metta-skill-host` subagents; `metta-guard-bash.mjs` line 881 authorizes **any** Tier-2 subcommand for a trusted fork caller (`isTrustedSkillCaller`), so `release cut` from those five is already permitted with zero changes.
- `metta-fix-gap` is Tier-2 (session-credential) — hence the mint-scope append.
- **No new guard words:** `release status` is already on `ALLOWED_TWO_WORD` (guard line 67), `release cut` already in `BLOCKED_TWO_WORD` with scope key `release:cut` (line 94), bare `release` already in `ALLOWED_BARE` (line 107). A direct orchestrator `release cut` with no credential remains blocked exactly as today. The guard-side comment at lines 92–94 ("minted only by the metta-release skill") is updated to name both minting skills.
- **`src/delivery/workflow-primer.ts`:** no change — its SYNC'd lists (lines 35–36, 91) mirror the guard allow/block lists, which are untouched; the `tests/delivery.test.ts` seam test stays green by construction.

### 9. Tests

- **New: `tests/skill-release-ship-stage.test.ts`** — modeled directly on `tests/skill-uat-ship-gate.test.ts` (same `SKILL_TREES` × `SHIP_SKILLS` 12-case matrix, same frozen-constant discipline):
  - canonical release sentence appears **exactly once** per file (`split(...).length - 1 === 1`);
  - ordering: sentence index > `indexOf('gh pr merge <pr-number> --merge')` and > `indexOf('git pull --ff-only')` (post-merge, post-pull positioning; fails when the stage is removed, naming the offending file);
  - block content: each file contains `--verify-tag`, `git push --follow-tags origin main`, and `gh release view <tag>`;
  - `metta-propose` only: the canonical sentence sits inside the `--ship` opt-in section (index > the ship-opt-in heading anchor), guarding the no-release-at-PR-open rule;
  - `metta-release` (both trees): contains `--verify-tag` and `git push --follow-tags origin main`, contains **no** `--github` occurrence, and the push-confirmation wording precedes `gh release create`;
  - aggregate all-files check mirroring the UAT test's final describe.
  - Template↔deployed **byte-identity needs no new assertions**: `tests/template-deploy-sync.test.ts` auto-discovers every file in the `skills` and `hooks` families (including the mint-hook scope edit) and fails on any drift or orphan.
- **`tests/schemas.test.ts`** (`ReleaseConfigSchema` describe, ~line 1253): omitted `on_ship` → `'auto'`; each of `auto|prompt|off` accepted; `on_ship: 'always'` rejected with a message naming `release.on_ship` and the allowed values; omitted `allow_major_pre_1` → `false`; explicit `true` accepted; existing minimal `{scheme, version_file}` fixtures still parse (regression on the no-migration guarantee).
- **`tests/release-pipeline.test.ts`:** remove the entire `cut — gh isolation` describe (~lines 420–485) and the `github`/`ghExec` fields from the `cutOptions` helper (line 66) and `GhExec` import (line 15); drop `'gh'` from the step-order assertion (line 338) and the `result.gh` assertions (lines 119, 124); **add**: successful cut result carries `notes` equal to the extracted `## <version> — <date>` changelog section; dry-run result carries no `notes`; `status()` echoes `onShip`/`allowMajorPre1`/`githubRelease` for explicit, omitted-key, and default-config fixtures.
- **`tests/release-gh-release.test.ts`:** deleted with its source (ADR-4).
- **`tests/cli-release.test.ts`:** replace the `--github fails fast` test (~line 196) with: `release cut --github` exits non-zero, stderr names the removed `--github` flag and contains `git push --follow-tags origin main` and `--verify-tag`, and no version file/changelog/commit/tag mutation occurred; update the success-path hint assertion to the new "tag NOT pushed" wording; assert cut `--json` output includes the `notes` string (the "cut --json supplies the notes body" scenario).
- **`tests/cli-install.test.ts`:** with a `package.json` present, scaffolded `.metta/config.yaml` contains explicit `release.on_ship: auto` (and `scheme`/`version_file`) and parses under `ProjectConfigSchema`; without `package.json`, no `release` key is written.
- **Hook seam tests** (`tests/hooks-byte-identity.test.ts` + guard/mint unit tests): existing suites cover the mint-scope change via byte-identity; add one mint-hook assertion that `SKILL_SCOPES['metta-fix-gap']` includes `'release:cut'` if the existing scope-table test enumerates scopes.

## Data Model

**No persisted-state schema changes beyond the config schema.** Explicitly:

- **No `releases-record` schema change.** `src/schemas/releases-record.ts` (`ReleaseEntry`, `ReleasesRecord`, `BumpLevelEnum`) is untouched; `spec/releases.yaml` entries keep the exact shape written today. One recorded behavioral note: because the canonical block always passes `--bump <level>`, ship-triggered entries record `bump_source: 'override'` even when the level equals the derivation — accepted, since the skill's derivation input *is* the pipeline's own `recommendedBump` echoed through status.
- **`ReleaseConfigSchema`** gains `on_ship` (enum, `.default('auto')`) and `allow_major_pre_1` (boolean, `.default(false)`), both validated on every read/write via the existing `ProjectConfigSchema` path in the config loader. `.strict()` is preserved.
- **In-memory API types only** (not persisted): `ReleaseCutResult` −`gh` +`notes?: string`; `ReleaseCutOptions` −`github` −`ghExec`; `ReleaseStatusResult` +`onShip` +`allowMajorPre1` +`githubRelease`.
- No new state files, no `.metta/` additions, no token/UAT/gate state touched.

## API Design

**CLI surface (`metta release`):**

| Command | Change |
|---|---|
| `metta release status [--json]` | Additive: JSON gains `onShip`, `allowMajorPre1`, `githubRelease` (schema-resolved echo). Human output unchanged (optionally one `On-ship mode:` line). Read-only, guard-allow-listed — unchanged classification. |
| `metta release cut --bump <level> --yes [--dry-run] [--json]` | `--github` removed; passing it errors (no mutation) naming the flag and the cut → push → publish sequence. Success JSON gains `notes` (extracted changelog section). `gh` result field and `gh` step disappear from output; dry-run lists six skipped mutation steps. Description/hints updated to the fixed sequence. |

**TypeScript contracts:** `ReleasePipeline.cut(opts: ReleaseCutOptions): Promise<ReleaseCutResult>` with the option/result deltas above; `createGithubRelease`, `GhExec`, `GhOutcome` are removed from the public surface. `ReleaseConfig` widens with the two new keys.

**Skill instruction contract (the real API of this change):** the canonical release-stage block in Components §6 — fixed sequence `status --json` → mode gate → bump derivation + pre-1.0 guard → `cut --bump <level> --yes --json` → `git push --follow-tags origin main` → (opt-in) `gh release view <tag>` probe → `gh release create <tag> --verify-tag --title <tag> --notes-file -` — byte-identical across the six ship-path skills and mirrored (with per-run push confirmation) in `metta-release`. Failure posture at every step: warn-and-continue, naming `/metta-release` as the on-demand remedy; the ship outcome is never blocked or unwound.

**Guard/mint contract:** unchanged classification tables; one widened mint scope (`metta-fix-gap` += `release:cut`). Fork-tier authorization for the other five ship paths is existing behavior, not new surface.

## Dependencies

**External (runtime, unchanged set):**
- `git` — cut commit/tag (existing), plus the skill-side `git push --follow-tags origin main` (rides the established skill-side push pattern).
- `gh` CLI — *optional*, skill-side only, gated on `release.github_release: true`; graceful degradation (warn + manual command) when missing/unauthenticated/failing. After this change the TypeScript codebase has **zero** gh invocations.
- No new npm dependencies; `zod`, `commander`, `vitest`, `yaml` usage is all within existing patterns.

**Internal:**
- `src/release/release-pipeline.ts` depends (unchanged) on `semver.ts`, `bump-derivation.ts`, `version-file.ts`, `releases-record-store.ts`, `git-release-tags.ts`, `DocGenerator`; the `gh-release.js` import is removed.
- `src/cli/commands/release.ts` → pipeline types (updated).
- Skill blocks depend on the `release status --json` / `release cut --json` field contracts (ADR-2 / rider 3) — the only cross-boundary coupling this change adds, pinned by `tests/cli-release.test.ts` JSON assertions.
- Hook templates ↔ deployed copies via `tests/template-deploy-sync.test.ts`; guard ↔ primer lists via the `tests/delivery.test.ts` seam (no delta).
- Spec deltas already recorded in this change's `spec.md` (release-versioning MODIFIED/ADDED requirements; finalize-ship ship-step wording rides the skill edits).

## Risks & Mitigations

1. **Instruction drift across 12+ skill files** (the sequence silently diverges or gets dropped in one copy). *Mitigation:* one canonical byte-identical block; frozen-constant grep-asserts with per-file ordering checks in `tests/skill-release-ship-stage.test.ts` (fails naming the offender); auto-discovering byte-identity in `tests/template-deploy-sync.test.ts` covers the template↔deployed axis for skills *and* hooks with no hand-maintained file list.
2. **gh silently creating a wrong tag from default-branch HEAD** when the tag is not on the remote (the v0.5.0/v0.6.0 corruption mode — `gh release create` does not fail on a missing tag). *Mitigation:* structurally closed — the in-cut gh step no longer exists; `--verify-tag` is part of the frozen canonical sentence and grep-asserted in all files, so gh aborts on any residual mis-ordering; the `gh release view` probe makes re-runs idempotent.
3. **Prompt mode in a non-interactive/forked context** cutting without an answer. *Mitigation:* fail-closed by instruction — no answer means no cut, loud notice, ship completes; spec scenario "Non-interactive context fails closed" plus the US-2 acceptance criterion pin the behavior.
4. **A failing cut blocking or unwinding a completed ship.** *Mitigation:* warn-and-continue is written into the canonical sentence itself (grep-asserted); the cut runs strictly after merge/pull/rebuild so there is nothing for it to unwind; guard authorization is widened *up front* (fork-tier already valid; `metta-fix-gap` mint scope appended) so the failure posture is exercised only for genuine cut errors, never authorization gaps.
5. **`--github` removal breaking muscle memory / older instructions.** *Mitigation:* erroring stub keeps the flag *parsed* but never *acted on* — the error names the removed flag and prints the exact three-step fixed sequence before any config load or mutation; `tests/cli-release.test.ts` asserts zero mutation on that path.
6. **Install scaffolding writing an invalid config** (`.strict()` release block missing `scheme`/`version_file`). *Mitigation:* the release block is scaffolded only when `package.json` exists, always as a complete valid block; `tests/cli-install.test.ts` parses the scaffolded config through `ProjectConfigSchema` in both branches.
7. **Status/cut JSON contract drift between CLI and skill prose.** *Mitigation:* additive-only JSON changes; field names asserted in `tests/cli-release.test.ts`; the notes string is produced by the same `extractChangelogSection` the old gh step used, so notes content semantics are unchanged.
8. **Pre-1.0 guard mis-evaluation in skill prose** (wrong default when keys are omitted). *Mitigation:* ADR-2 — the skill never parses YAML; it reads Zod-resolved `onShip`/`allowMajorPre1` from status `--json`, keeping default resolution in exactly one place; derivation rules themselves are untouched (out of scope by intent).
9. **GitHub vendor lock-in** (ADR-5). *Mitigation:* confined to the opt-in publish leg behind `github_release: false`-by-default; local cut/tag/push are provider-neutral git; no gh code remains in TypeScript, so a future non-GitHub publish leg is a skill-block edit, not a pipeline change.
