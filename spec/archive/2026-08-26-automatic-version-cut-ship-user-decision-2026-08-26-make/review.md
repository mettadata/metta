# Review: automatic-version-cut-ship-user-decision-2026-08-26-make

Round 1 — three parallel reviewers, all PASS_WITH_WARNINGS, zero critical issues.

## Correctness

# Correctness Review: automatic-version-cut-ship-user-decision-2026-08-26-make

Verdict: PASS_WITH_WARNINGS

## Summary

The implementation matches the design closely and the focus areas are all sound: `ReleasePipeline.cut()` is purely local (notes computed after `annotated-tag`, dry-run omits notes and lists exactly six skipped mutation steps, restore/abort logic byte-untouched), the status echo fields are schema-resolved, the `--github` stub fires before any context/config/pipeline work, the install scaffold branches correctly on `package.json`, the canonical block is byte-identical across all 12 ship-skill copies and both hook trees, the mint delta is the single `metta-fix-gap` scope append, and the grep-assert suite asserts what it claims (frozen sentence, exactly-once, post-merge/post-pull ordering, propose opt-in anchoring, metta-release zero `--github` + confirm-before-create ordering). `tsc --noEmit` clean; all 14 change-relevant and adjacent test files pass (855 tests). Remaining findings are spec-wording contradictions and design/file drift, not behavior bugs.

## Critical issues

None.

## Warnings

1. **Off-mode spec scenario contradicts the delivered skill instructions (internal spec inconsistency).**
   `spec/changes/.../spec.md:132` ("Off mode ships without any release activity") requires "THEN no release status call, no bump derivation, and no cut runs" — but the canonical block (e.g. `src/templates/skills/metta-ship/SKILL.md:64`) must run `metta release status --json` first to resolve the effective `on_ship` mode (ADR-2 forbids skills parsing YAML), so exactly one read-only status call always happens in `off` mode. The same spec's "Post-Merge Release Flow" requirement (spec.md:47) mandates status as step (1) before the mode is knowable, so the spec contradicts itself. Behavior is harmless (read-only, allow-listed), but the scenario as written is unsatisfiable and will merge into the living spec. Fix: reword the scenario to "no release mutation — no derivation, no cut, no tag" or explicitly permit the single mode-resolving status probe.

2. **Canonical sentence and design cite a "dist rebuild" step that five of six ship skills do not contain.**
   The frozen sentence says the stage "runs only after the user-approved PR merge, git pull --ff-only, and dist rebuild" — but only `metta-ship` (step 9, `src/templates/skills/metta-ship/SKILL.md:59`) instructs a dist rebuild. `metta-quick`, `metta-auto`, `metta-fix-issues`, `metta-fix-gap`, and `metta-propose` contain no rebuild instruction at all (grep for `npm run build`/`rebuild` returns nothing in those five), and design.md §6's insertion table ("after steps 15/16 (pull + rebuild)" etc.) describes rebuild sub-steps that do not exist in those files — the block was correctly inserted after the pull instead. Spec.md:242 requires positioning "after the merge and the main fast-forward + rebuild"; for five skills the rebuild leg is vacuous. Not a behavior bug (a skill can't run a step it doesn't have), but the sentence asserts an ordering precondition those five files never establish. Consider either dropping "and dist rebuild" from a future revision of the canonical sentence or adding the rebuild step to the other ship paths (a known issue about stale main dist already exists).

3. **`metta-fix-issues`/`metta-fix-gap`: release stage ordered before issue/gap removal (step 11).**
   `src/templates/skills/metta-fix-issues/SKILL.md:124-136` and the fix-gap twin place the release cut + `git push --follow-tags origin main` *before* step 11 (`metta fix-issue --remove-issue` / `metta gaps remove`). The removal's spec mutations and any commit of them now land on main *after* the release push, so they are left unpushed at hand-back (pre-change ships also left them unpushed, so no regression) and will be attributed to the *next* release rather than the one just cut for the change that resolved them. Ordering removal before the stage would let the single authorized push carry it — worth a deliberate decision; as shipped it is consistent but slightly lossy.

4. **Ordering assertions use first-occurrence `indexOf`.**
   `tests/skill-release-ship-stage.test.ts:51,60` anchor on the first `gh pr merge <pr-number> --merge` / `git pull --ff-only` occurrence. Today each ship skill's first occurrence *is* the ship-path one, so the assertions are currently sound, but a future skill edit that mentions either string earlier (e.g. in a rules/notes section) would silently weaken the ordering check. Using `lastIndexOf` for the anchors (or asserting the stage precedes the final report step) would be more robust. Nice-to-have.

5. **`metta-release` step 1 still tells the skill to parse "target version" from `release status --json`** (`src/templates/skills/metta-release/SKILL.md`, step 1) — `ReleaseStatusResult` has no target-version field (only `version` + `recommendedBump`; the target is computed at cut time). Pre-existing wording retained by the rewrite; harmless but inaccurate.

6. **Spec scenario "Main-session ship path is authorized to cut" names `metta-ship` as the example** (spec.md:224-227), but `metta-ship` runs `context: fork` (Tier-1, `src/templates/skills/metta-ship/SKILL.md:5`); the actual main-session ship path is `metta-fix-gap`, which is what the mint-scope delta covers (`metta-session-mint.mjs:38`, verified against guard line 881 fork-tier authorization). The authorization matrix is correct end to end; only the scenario's parenthetical example is wrong.

## Verified in detail

- **Schema** (`src/schemas/project-config.ts:113-117`): enum + errorMap names `release.on_ship` and the three allowed values; `.default('auto')` / `.default(false)`; `.strict()` preserved; minimal `{scheme, version_file}` fixture regression-tested (no migration).
- **Pipeline** (`src/release/release-pipeline.ts`): `MUTATION_STEPS` is exactly the six local steps; gh step, `gh-release.ts`, its barrel export, and its test are all deleted with zero residual references (repo-wide grep clean); notes computed via the unchanged `extractChangelogSection` only after `annotated-tag` passes (line 521); dry-run returns at line 371 without notes; abort points, mutation-group `restoreFiles`, and commit-failure unstage logic are byte-untouched; `status()` echo fields come from the Zod-parsed config (lines 231-233) and `requireReleaseConfig()` still throws before any version read when config is absent.
- **CLI** (`src/cli/commands/release.ts:89-96`): `--github` stub throws `ReleaseError` before `createCliContext()`/config load — pre-mutation by construction; the old `github_release is disabled` fail-fast is gone; cut call drops `github`; hint and description updated; `--json` serializes `notes` and the echo fields automatically. Test asserts non-zero exit, message naming, and zero mutation (version file, releases.yaml, changelog, HEAD, tags, porcelain).
- **Install** (`src/cli/commands/install.ts:279-303`): complete valid release block (never a bare `on_ship`) only when `package.json` exists; both branches parse under `ProjectConfigSchema` in tests; `wx` flag untouched.
- **Skills**: canonical block byte-identical across all 12 files and both hook trees (direct `diff -q` clean); propose block sits inside the `--ship` opt-in section (after sub-step g, before step 9), PR-open path untouched; pre-1.0 guard bullet reads all three inputs from the status echo and downgrades major→minor with the prominent report; prompt mode fails closed; absent-config one-line notice keys off the exact `Release configuration is missing` message the error class produces.
- **Guard/mint**: single functional delta (`metta-fix-gap` scope append) plus the comment update; guard classification tables and `workflow-primer.ts` untouched; fork-tier Tier-2 authorization at guard line 881 confirmed for the five forked ship skills.
- **Tests**: `tsc --noEmit` clean; `schemas`, `release-pipeline`, `cli-release`, `cli-install`, `skill-release-ship-stage`, `template-deploy-sync`, `metta-session-mint`, `hooks-byte-identity`, `skill-uat-ship-gate`, `skill-propose-ship-gate`, `cli-skills`, `delivery`, `metta-guard-bash`, `metta-guard-mint-seam` all pass (855 passed, 2 pre-existing skips).

Verdict: PASS_WITH_WARNINGS

## Security

Verdict: PASS_WITH_WARNINGS

# Security Review: automatic-version-cut-ship-user-decision-2026-08-26-make

Scope reviewed: full `git diff main...HEAD` in this worktree — hooks (both trees), seven skill instruction files (both trees), release CLI/pipeline/schema, install scaffolding, deleted gh edge, tests.

## Authorization (mint-scope widening + guard tables)

- **SKILL_SCOPES widening is correctly scoped.** Only `metta-fix-gap` gained `release:cut` (`.claude/hooks/metta-session-mint.mjs:38`, mirrored at `src/templates/hooks/metta-session-mint.mjs:38`). No other skill's scope changed; `metta-release` keeps `['release:cut']` unchanged. Tokens are per-slug files and the slug is a static frontmatter argv (mint hook lines 98–100), so the scope cannot leak to another skill's credential.
- **Guard classification tables are byte-identical to main except a comment.** The `.claude/hooks/metta-guard-bash.mjs` diff touches only the comment at line 93; `BLOCKED_TWO_WORD`, `ALLOWED_TWO_WORD`, `ALLOWED_BARE`, `BLOCKED_SUBCOMMANDS`, and `SKILL_ENFORCED_SUBCOMMANDS` are unchanged. `release cut` remains Tier-2 blocked; `release status` remains read-only allowed.
- **Ship-path fork skills need no mint change** — the Tier-1 fork identity path (`metta-guard-bash.mjs:881–883`) already authorizes Tier-2 subcommands from a verified `agent_type`, which is why only the two main-session skills (metta-release, metta-fix-gap) appear in `SKILL_SCOPES`. Consistent, no widening beyond need.
- **Template parity verified**: all six ship-path SKILL.md files, metta-release SKILL.md, and both hooks are identical between `.claude/` and `src/templates/`.

## --github stub cannot reach the old publish path

- `src/cli/commands/release.ts:89–95`: `opts.github === true` throws `ReleaseError` before context load, config read, or `ReleasePipeline` construction — no mutation, no bypass.
- The pre-push publish code path no longer exists: `src/release/gh-release.ts` deleted, its export removed from `src/index.ts`, and `ReleasePipeline.cut()` no longer accepts a `github`/`ghExec` option (`src/release/release-pipeline.ts:79–96`). Nothing to bypass into.

## Push safety

- No `--force`, no `--no-verify`, no destructive git ops anywhere in the diff. The only push command instructed anywhere is `git push --follow-tags origin main`, and every skill file explicitly forbids `--force` and a second unconfirmed push.
- `metta-release` skill (step 4) gates its push on fresh per-run `AskUserQuestion` confirmation — good.
- The pipeline itself never pushes (`execFileAsync('git', args)` array-args only, `release-pipeline.ts:150`; tag creation at :505).

## Command injection surfaces

- CLI side is clean: all git invocations use `execFile` with argv arrays; no shell strings, no template-literal command construction.
- Skill side has two instruction-level surfaces, listed under Warnings below (heredoc terminator collision; unvalidated `tag_prefix` interpolated into shell commands).

## Secrets

- No secrets logged or committed. Session token values never appear in skill files; the mint hook writes tokens 0o600 under `.metta/scratch/`. `notes` in the cut JSON is changelog text only. `release status --json` echoes only config booleans/enums.

## Install scaffold

- `src/cli/commands/install.ts:303`: config written with `{ flag: 'wx' }` and errors swallowed — existing config is never overwritten. The new release block is static text (no interpolation), added only when `package.json` exists.

## Critical issues

(none)

## Warnings

- **Heredoc terminator collision in the instructed publish command** — `.claude/skills/metta-release/SKILL.md` step 5 and the `gh publish` bullet of the Post-merge release stage in all six ship-path SKILL.md files (plus `src/templates/` mirrors): notes are fed via `<<'NOTES'`. The quoted delimiter prevents expansion, but if the changelog-derived `notes` string contains a line that is exactly `NOTES`, the heredoc terminates early and the remaining note lines execute as shell commands in the orchestrator's Bash call. Changelog content derives from change names/summaries (semi-attacker-influenceable in a hostile-repo scenario). Recommend instructing skills to write `notes` to a file under `.metta/scratch/` and pass `--notes-file <path>`, or to choose a delimiter guaranteed absent from the notes.
- **`tag_prefix` is unvalidated and the tag is interpolated into shell commands by skills** — `src/schemas/project-config.ts:111` (`tag_prefix: z.string()`, pre-existing) places no character-set constraint; the skills interpolate `<tag>` (= `tag_prefix` + version) into `gh release view <tag>` and `gh release create <tag> --verify-tag --title <tag>`. A hostile `.metta/config.yaml` with metacharacters in `tag_prefix` becomes shell-injection text at publish time (the CLI side is immune via execFile argv). Threat model is limited — a repo writer could edit hooks directly — but a `regex` constraint on `tag_prefix` (e.g. `[A-Za-z0-9._-]*`) and a "quote the tag" instruction would close it cheaply.
- **`on_ship: auto` pushes to origin/main without a fresh per-push confirmation** — schema default (`src/schemas/project-config.ts:113`) and the scaffolded install default are both `auto`, so a merged ship auto-runs `git push --follow-tags origin main`. The skill text frames the user-approved PR merge as the authorizing decision and this is the change's recorded user decision, so it is accepted risk — noted here because the project convention says "No auto-push to remote without explicit user confirmation"; `prompt` mode remains available and fails closed when it cannot ask.
- **fix-gap credential window (informational)** — after `/metta-fix-gap` mints its token, the main session holds `release:cut` authorization for TTL+grace, usable outside the skill's post-merge stage. This is inherent to the Tier-2 model (identical exposure already exists for `finalize`/`complete`) and the widening is the minimum needed; no action required.

Verdict: PASS_WITH_WARNINGS

## Quality

Verdict: PASS_WITH_WARNINGS

# Quality Review: automatic-version-cut-ship-user-decision-2026-08-26-make

Reviewer focus: dead code, naming, duplication, test gaps, comment/doc accuracy.
Scope: `git diff main...HEAD` in the change worktree plus planning artifacts.

## Summary

The gh-release deletion is clean — no stray imports, types, helpers, fixtures, or
barrel entries survive. The six ship-skill release-stage blocks are byte-identical
(verified by hashing the block in all six deployed skills) and both skill trees are
byte-identical pair-wise (verified with `diff -q` across all seven touched skills).
Naming and filename conventions hold throughout. Targeted test runs pass
(`skill-release-ship-stage` 57/57, `schemas` 199/199, `metta-session-mint` 43/43).
One warning on grep-suite coverage of the mode/rail bullets; the rest are suggestions.

## Critical issues

None.

## Warnings

1. **Mode/rail bullets are byte-identical today but unpinned by any test** —
   `tests/skill-release-ship-stage.test.ts` (whole file). The suite freezes only the
   opening canonical sentence plus three command substrings (`--verify-tag`,
   `git push --follow-tags origin main`, `gh release view <tag>`). The six bullets
   that carry the behaviors this change's spec cares most about — the absent-config
   notice line (`notice: release config absent — skipping the post-merge release cut ...`),
   the prompt-mode fail-closed wording, and the pre-1.0 downgrade wording
   (`"pre-1.0: derived major downgraded to minor; set release.allow_major_pre_1: true to allow"`)
   — are deterministic strings and therefore grep-coverable, but no assertion pins
   them. `tests/template-deploy-sync.test.ts` only pins the template↔deployed axis,
   not cross-skill bullet identity, so a bullet can drift or be dropped in one of the
   six skills without any test failing. Design §9 scoped the test this way
   intentionally, and no test *pretends* to cover the bullets (test names are honest),
   so this is a should-fix, not a blocker: freeze the three behavior-bearing strings
   as constants and assert once-per-file, mirroring the existing sentence assert.

## Suggestions

1. **Inline YAML template grows in TypeScript** — `src/cli/commands/install.ts:40-49`
   (`releaseBlock`) extends the pre-existing inline `configContent` YAML literal. The
   project convention says template content lives in template files, not TS string
   literals. The pre-existing pattern makes this consistent rather than novel, but the
   scaffold is now large enough that moving `config.yaml` scaffolding to
   `src/templates/` would align it with how skills/hooks are handled.

2. **Removed-flag tombstone appears in `--help`** — `src/cli/commands/release.ts:81`.
   `--github` stays registered so it errors helpfully instead of hitting commander's
   unknown-option message (good), but the "(removed) ... see error for the sequence"
   description renders in help output. Commander's `new Option(...).hideHelp()` would
   keep the helpful error while hiding the dead flag from `--help`.

3. **Weakened exit-code assertion** — `tests/cli-release.test.ts` (`--github` test):
   the old test asserted `code === 4`; the rewrite asserts `code !== 0`. The mutation
   guards below it are thorough (version file, changelog, record, log, tags, porcelain
   all checked), so this is minor, but pinning the exact `ReleaseError` exit code would
   preserve the previous contract strength.

4. **Human-readable `release status` prints `onShip` but not the other two echoes** —
   `src/cli/commands/release.ts:66`. `allowMajorPre1` and `githubRelease` are
   JSON-only. Skills consume `--json`, so nothing is broken; printing all three would
   keep the human and JSON surfaces symmetric.

## Checks performed (clean)

- **Dead code from gh-release deletion**: `grep -rn "gh-release|GhOutcome|GhExec|createGithubRelease|ghExec"`
  over `src/` and `tests/` returns zero hits. `src/index.ts:45` barrel entry removed.
  `ReleaseCutOptions.github`/`ghExec` fields, the `'gh'` entry in `MUTATION_STEPS`
  (`src/release/release-pipeline.ts:105-111`), and the CLI's `gh` warn-rendering are
  all gone. Remaining mentions live only in `docs/changelog.md` (historical release
  record — correct to leave untouched).
- **1:1 test-to-source ratio**: `tests/release-gh-release.test.ts` deleted alongside
  `src/release/gh-release.ts`; new prose behavior gets a new dedicated test file
  (`tests/skill-release-ship-stage.test.ts`, kebab-case, modeled on
  `skill-uat-ship-gate.test.ts` as the design prescribes).
- **Naming/conventions**: `onShip`/`allowMajorPre1`/`githubRelease` camelCase in the
  JSON echo; `on_ship`/`allow_major_pre_1` snake_case matching sibling YAML keys in
  `ReleaseConfigSchema` (`src/schemas/project-config.ts:113-117`, `.strict()` kept);
  `.js` import extensions present in all touched imports; no skill/agent markdown
  inlined into TypeScript — the canonical block lives only in the twelve SKILL.md files.
- **Byte-identity**: the `### Post-merge release stage` block hashes identically
  (md5 `2f4412cb…`) across all six deployed ship skills; `diff -q` between
  `.claude/skills/*/SKILL.md` and `src/templates/skills/*/SKILL.md` is clean for all
  seven touched skills; same for both hook files.
- **Skill-wording consistency**: the canonical block's manual-remedy command
  (`gh release create <tag> --verify-tag`), the metta-release skill's step-5 fallback,
  and the CLI cut success hint (`src/cli/commands/release.ts:26-29`) all agree; the
  `--github` error text (`release.ts:90-95`) names the same cut → push → publish
  sequence the skills implement; no contradictory instructions found. The
  metta-release skill contains zero `--github` occurrences (test-enforced), and its
  rules section phrasing ("Never pass a GitHub flag") deliberately avoids the literal.
- **Comment/doc accuracy**: the guard comment
  (`.claude/hooks/metta-guard-bash.mjs:93` and template twin) now correctly names both
  minting skills, matching `SKILL_SCOPES` in `metta-session-mint.mjs:38`; the
  `notes` doc comment ("present on non-dry-run success",
  `src/release/release-pipeline.ts:99`) matches the dry-run early-return and is
  test-asserted; the install.ts scaffold comment accurately explains the
  package.json gate for the release block.
- **Test honesty**: the dry-run test's "exactly six skipped mutation steps" count
  matches the trimmed `MUTATION_STEPS`; the notes-equality assertion in
  `release-pipeline.test.ts` recomputes the expected section from the real changelog
  rather than hardcoding; install tests validate the scaffold against
  `ProjectConfigSchema` (guards against a bare `on_ship` without `scheme`/`version_file`).

Verdict: PASS_WITH_WARNINGS

## Disposition

- Warning fixes applied in-change: spec.md off-mode wording (unsatisfiable 'no release status call' -> 'no release mutation'); metta-release step-1 'target version' phantom JSON field wording (both trees).
- Remaining warnings accepted and recorded: heredoc terminator collision (notes-to-scratch-file suggested), unconstrained tag_prefix, on_ship auto-push posture (recorded user decision), frozen-sentence 'dist rebuild' prose in skills lacking a rebuild step, fix-issues/fix-gap release-before-removal ordering, indexOf ordering-anchor robustness, --github tombstone in --help.
