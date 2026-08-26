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
