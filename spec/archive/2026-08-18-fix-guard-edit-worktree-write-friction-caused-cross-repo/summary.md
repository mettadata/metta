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

## Spec Scenarios

Checklist: each ADDED requirement from `spec.md` (orchestration-guard delta) mapped to
its test evidence. All scenarios PASS.

- [x] **Req 1 — Executor Shell Writes Are Anchored Under change_root** — PASS
  - Scenario: Executor template forbids bash writes outside change_root — `tests/shell-write-path-discipline.test.ts` pins the `## Shell-Write Path Discipline` section and change_root-anchoring rule in both `src/templates/agents/metta-executor.md` and the `.claude/agents/` twin.
  - Scenario: Existing executor rules are preserved — same test file asserts the executor template change is additive (pre-existing deviation rules and completion contract intact); `tests/agents-byte-identity.test.ts` pinned strings preserved.
- [x] **Req 2 — Silent-Write Anomaly Triggers STOP-and-Report, Never a Bash Fallback** — PASS
  - Scenario: Non-landing Edit result leads to STOP, not bash fallback — `tests/shell-write-path-discipline.test.ts` pins Deviation Rule 6 (silent-write anomaly -> STOP-and-report) in both template trees.
  - Scenario: Template inspection finds no sanctioned bash-fallback path — same test file asserts no bash-rewrite recovery path exists in the executor template.
- [x] **Req 3 — Verifier Carries the Same Shell-Write Path Discipline** — PASS
  - Scenario: Verifier template contains the path-discipline rule — `tests/shell-write-path-discipline.test.ts` pins the same discipline in `metta-verifier.md` (both trees), with the sanctioned heredoc fallback scoped to explicit `tool_use_error` refusals only, never silent success.
- [x] **Req 4 — Execute Skill Contract Binds Executors to Path Discipline and Escalates STOP-Reports** — PASS
  - Scenario: Skill contract escalates a silent-write STOP-report — `tests/shell-write-path-discipline.test.ts` pins the escalation paragraph in `metta-execute/SKILL.md` (both trees) with no workaround path.
  - Scenario: Spawn contract names the path-discipline binding — same test file pins the spawn-contract binding, and asserts the byte-identical escalation sentence across the 6 sibling skills (quick, auto, fix-issues, fix-gap, propose, verify).
- [x] **Req 5 — Guard-Bash Blocks Bash Write Targets That Resolve Into the Main Checkout** — PASS
  - Scenario: Redirection into the main checkout is blocked with a diagnostic — `tests/metta-guard-bash.test.ts` blocked matrix: `>`/`>>` into main checkout exits 2, stderr names offending path + expected change_root prefix, audit reason `worktree-write-target`.
  - Scenario: Heredoc, tee, cp, and mv targets are covered — same blocked matrix covers heredoc-on-cmdline, `tee`, `cp`, `mv`, and `cp -t` destination forms; verified in both hook copies (`.claude/hooks/` and `src/templates/hooks/`).
  - Scenario: Writes inside the change's own worktree pass — allowed matrix: worktree-internal and `<main>/.metta/` targets pass.
  - Scenario: No worktree-hosted active change means no write-target check — allowed matrix: no-context / non-worktree-hosted cases are inert.
- [x] **Req 6 — Write-Target Heuristic Fails Open on Unparseable Commands and Ignores Non-Write Commands** — PASS
  - Scenario: Unresolvable write targets fail open — `tests/metta-guard-bash.test.ts` fail-open cases: `$VAR` targets, relative paths, `/tmp` paths, `2>&1` fd-duplication; extraction cap fail-open audited.
  - Scenario: Non-write commands are untouched — same file asserts non-write commands see no new rejection path.
- [x] **Req 7 — Write-Target Check Leaves Existing Guard-Bash Behavior Unchanged** — PASS
  - Scenario: Pre-existing guard-bash test suite passes unmodified — `tests/metta-guard-bash.test.ts` change was 507 insertions / 0 deletions; full pre-existing suite green with zero modified expectations.
  - Scenario: metta CLI invocations are classified exactly as before — Tier-1/Tier-2 classification untouched; token-untouched invariant pinned (blocked writes never re-prime Tier-2 credentials).
- [x] **Req 8 — Write-Target Check Ships in the Hook Template** — PASS
  - Scenario: Consumer install receives the write-target check — byte-identity assertions in `tests/metta-guard-bash.test.ts` and `tests/template-deploy-sync.test.ts` (repo-local hook == shipped template == dist copy); install registration test covers hook placement.
- [x] **Req 9 — Main-Checkout Cleanliness Baseline Is Recorded Before Worktree Execution** — PASS
  - Scenario: Baseline is recorded as validated state at execution start — `tests/instructions-stamps-timings.test.ts` (capture inside the started-stamp block for worktree-hosted `implementation`) + `tests/git-tree-baseline.test.ts` (Zod-validated `MainTreeBaselineSchema`, write-once semantics, `scratch/tree-baselines/<change>.yaml`).
  - Scenario: Non-worktree changes skip the baseline — `tests/instructions-stamps-timings.test.ts` asserts non-worktree changes record nothing and behave identically.
- [x] **Req 10 — Implementation Completion Fails on New Main-Checkout Dirt** — PASS
  - Scenario: New main-checkout dirt fails completion with the offending paths — `tests/cli-complete.test.ts`: exit 4, JSON `type: 'main_tree_contamination'`, newly-dirty paths listed.
  - Scenario: Clean run completes unchanged — same file: clean-comparison and no-baseline cases pass through unchanged.
  - Scenario: Detection never mutates the main checkout — same file asserts the failure path is report-only, no git mutation of the main tree.
- [x] **Req 11 — Ship Preflight Verifies Main-Checkout Cleanliness for Worktree-Hosted Changes** — PASS
  - Scenario: Ship preflight catches main-checkout contamination — `tests/merge-safety.test.ts`: `main-checkout-clean` step (after `finalize-check`, before `preflight`) fails on new dirt with path-naming detail in the `MergeSafetyStep` result shape; `tests/cli-ship-worktree.test.ts` covers end-to-end ship wiring.
  - Scenario: Non-worktree ships are unchanged — `tests/merge-safety.test.ts` asserts the non-worktree step list is byte-identical to pre-change.
- [x] **Req 12 — Pre-Existing Main-Checkout Dirt Warns but Never Hard-Blocks** — PASS
  - Scenario: Pre-existing dirt produces a warning at execution start — `tests/instructions-stamps-timings.test.ts` (warn-not-block at capture).
  - Scenario: Completion passes with pre-existing dirt and no new dirt — `tests/cli-complete.test.ts` pre-existing-only pass case.
  - Scenario: Only new paths appear in the failure diagnostic — `tests/git-tree-baseline.test.ts` attribution tests + `tests/cli-complete.test.ts` and `tests/merge-safety.test.ts` diagnostics list only newly-dirty paths.
- [x] **Req 13 — Tests Cover Write-Target Classification and Tree-Clean Detection** — PASS
  - Scenario: Write-target matrix distinguishes blocked from allowed — blocked/allowed matrices in `tests/metta-guard-bash.test.ts` (see Reqs 5-6).
  - Scenario: Baseline/compare module tests cover dirt attribution — `tests/git-tree-baseline.test.ts` clean / pre-dirtied / newly-dirtied cases.
  - Scenario: New blocking tests fail against pre-change behavior — completion gate proven via pre-change-failing test; 519/519 targeted tests pass across the 10 relevant files (shell-write-path-discipline, metta-guard-bash, git-tree-baseline, cli-helpers, instructions-stamps-timings, cli-complete, merge-safety, cli-ship-worktree, agents-byte-identity, template-deploy-sync).

## Gate Results

| Gate | Result |
|------|--------|
| Tests (full suite) | PASS — 133 files, 2697 passed / 2 skipped / 0 failed, two consecutive runs. Both exited 1 solely from the pre-existing vitest-internal "[vitest-worker] Timeout calling onTaskUpdate" flake (zero failing tests either run); a third run during review exited 0. |
| Typecheck (`tsc --noEmit`) | PASS — clean |
| Lint | PASS — clean |
| Build (incl. `copy-templates`) | PASS — clean; `dist/` and `.claude/` hook mirrors byte-identical to `src/templates/` |
| Review | PASS — 3 rounds; final verdicts PASS / PASS / PASS (correctness, security, quality reviewers) |

## Summary

Three-layer defense-in-depth against cross-repo worktree contamination is implemented
and verified against all 13 ADDED spec requirements (28/28 scenarios) with cited test
evidence, three passing review rounds, and all gates green. No spec gaps found.

> Note: the harness refused the verifier's Write tool call for this artifact
> ("Subagents should return findings as text, not write report files"); per the
> verifier contract it was written via the sanctioned heredoc fallback to the
> mandated path.
