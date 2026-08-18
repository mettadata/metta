# Implementation Summary: fix-guard-edit-worktree-write-friction-caused-cross-repo

Three-layer defense-in-depth against cross-repo contamination from worktree-hosted
executor writes (zeus incident, 2026-08-18). All 8 tasks across 3 batches complete;
full gate suite green.

## Layer 1 — Template/skill shell-write path discipline (commit ce46aed9d)

- `src/templates/agents/metta-executor.md` (+ `.claude/` twin): new Deviation Rule 6
  (silent-write anomaly -> STOP-and-report, never a bash rewrite) and a
  `## Shell-Write Path Discipline` section — prompt-provided `change_root` is
  authoritative; all bash-mediated writes (`>`, `>>`, heredoc, `tee`, `cp`, `mv`,
  scripts) must target absolute paths under it; no `change_root` -> no bash writes;
  the per-task `git -C` status/commit step doubles as write verification.
- `src/templates/agents/metta-verifier.md` (+ twin): same discipline adapted; the
  sanctioned heredoc fallback is scoped to explicit refusals (`tool_use_error`) only,
  never silent success. Strings pinned by `agents-byte-identity` preserved.
- `metta-execute/SKILL.md` (+ twin): spawn-contract binding + silent-write STOP
  escalation paragraph. Six sibling skills (quick, auto, fix-issues, fix-gap, propose,
  verify + twins): byte-identical escalation sentence.
- New `tests/shell-write-path-discipline.test.ts` (25 tests) pins all markers in both
  trees.

## Layer 2 — Guard-bash write-target blocking (commit b69ef82f3)

- `.claude/hooks/metta-guard-bash.mjs` + `src/templates/hooks/` mirror (byte-identical):
  `extractWriteTargets` (confident plain absolute targets from `>`/`>>`, `tee`,
  `cp`/`mv` incl. `-t` forms; fail-open on `$`/backtick/glob/relative/unterminated),
  topology ported from guard-edit (`toPhysicalPath`/`resolveTargetRoot`/
  `deriveProbeRoot`) with a per-event-cached `metta status --json` probe. Blocks
  (exit 2, audit reason `worktree-write-target`) iff the target resolves inside the
  hosting checkout, outside the worktree, outside `<H>/.metta/`, while the change is
  worktree-hosted. Placed before the offender scan so blocked writes never re-prime
  Tier-2 credentials. Whole check try/catch fail-open.
- `tests/metta-guard-bash.test.ts` extended: blocked/allowed matrices + token-untouched
  invariant; 267/267 pass with zero pre-existing test modifications.

## Layer 3 — Main-checkout tree-clean verification (commits 5b49e5e10, 4ee5058c9, f70cc0f40, 7bb71daac, 1143f31b1)

- New `src/schemas/tree-baseline.ts` (strict `TreeEntrySchema`/`MainTreeBaselineSchema`)
  and `src/util/git-tree-baseline.ts` (pure `parsePorcelain` v1 `-z -uno` +
  `diffTreeState`; shell capture/compare/delete via `StateStore(<mainRoot>/.metta)` at
  `scratch/tree-baselines/<change>.yaml`; `MainTreeContaminationError`), barrel-exported.
- `resolveMainCheckoutRoot` in `src/cli/helpers.ts`: metadata-injected worktree =>
  projectRoot; in-worktree => path-math with `git rev-parse --git-common-dir`
  cross-check; else null (disengaged — covers `git.enabled: false`).
- Capture: write-once inside `instructions.ts`'s best-effort started-stamp block for
  worktree-hosted `implementation`; warns on pre-existing dirt; never blocks.
- Gate: `complete.ts` pre-`markArtifact` — new dirt fails with exit 4 and JSON
  `type: 'main_tree_contamination'` listing only newly-dirty paths; no-baseline and
  pre-existing-only warn and pass; non-worktree unchanged (proven pre-change-failing test).
- Ship: `MergeSafetyPipeline` gains an additive `mainCheckout` constructor option and a
  `main-checkout-clean` step (after `finalize-check`, before `preflight`) emitted only
  for worktree-hosted ships — fail on new dirt, pass+warn on pre-existing, skip without
  baseline; `ship.ts` feeds it and deletes the baseline best-effort on success.
  Non-worktree step list byte-identical.

## Bonus fix (Deviation Rule 1, commits 285c262e3, b82e77a10)

The install template's `.metta/.gitignore` entries were anchored wrong
(`.metta/state.yaml` inside `.metta/` matched nothing — verified via
`git check-ignore`) and lacked `scratch/`. Rewrote entries directory-relative and added
`scratch/` plus an effectiveness test. Existing consumer installs keep their old file
(`wx` write flag) — fresh installs get the corrected one.

## Gates

- Tests: 132 files, 2663 passed / 2 skipped / 0 failed
- Typecheck (`tsc --noEmit`): clean; Lint: pass; Build (incl. `copy-templates`): pass —
  `dist/` and `.claude/` mirrors byte-identical to `src/templates/`.

## Accepted residuals (documented in research/design)

- Shell wrappers/interpreters (`bash -c`, `python -c`, `rsync`, `git -C ... apply`)
  invisible to layer-2 extraction — compensated by layers 1 and 3.
- `--untracked-files=no` baseline misses new-file creation in main — compensated by
  layer 2.
- Instructions (layer 1) are soft enforcement — layers 2-3 are the hard backstops.
- Follow-up issue candidate: reviewer/specifier/uat-runner path-anchoring parity
  (`metta-reviewer.md` writes a relative `review.md` path).

## Verification (post-review rounds 1-3)

- **Tests**: full suite 133 files, 2697 passed / 2 skipped / 0 failed — two consecutive runs. Both runs exited 1 solely due to the pre-existing vitest-internal `[vitest-worker]: Timeout calling "onTaskUpdate"` RPC flake (stack entirely in node_modules/vitest; predates this change — see main commits fc30d871a, c7e5e75c1); zero failing tests either run. A third run during review exited 0.
- **Typecheck / lint / build**: `tsc --noEmit` clean, lint clean, build clean; `dist/templates/hooks/metta-guard-bash.mjs` byte-identical to `src/templates/hooks/`.
- **Spec coverage**: 13/13 ADDED requirements, 28/28 scenarios verified with cited test evidence (tests/shell-write-path-discipline, metta-guard-bash, git-tree-baseline, cli-helpers, instructions-stamps-timings, cli-complete, merge-safety, cli-ship-worktree, agents-byte-identity, template-deploy-sync — 519/519 targeted).
- **Review**: 3 rounds; round 3 verdicts PASS / PASS / PASS. Round-1 critical (ship wiring unreachable post-finalize) and major (guard-bash timeout DoS) fixed and re-verified end-to-end.

### Review-fix commits
- ad8e9c813 ship durable-evidence wiring + assertSafeSlug + readBaselineEntries
- aaee4ace4 guard-bash dedupe/cap/budget + stripHeredocBodies + /dev/ short-circuit
- eac6c0950 complete gate fail-open wrap + control-char stripping
- 5564054da describe timeout + merge-safety stripControlChars + ship polish + C1 range
- 8ce031a0b numeric-terminator refusal + cap/budget audit entries
