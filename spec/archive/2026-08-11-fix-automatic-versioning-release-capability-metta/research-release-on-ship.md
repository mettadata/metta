# Research: Candidate 2 — Finalize/Ship Integration (Release-on-Ship)

## Approach summary

Versioning lives inside the existing lifecycle: each change records its bump signal (conventional-commit type / workflow tier) in archive metadata at finalize time, and ship offers — or a config flag auto-triggers — a release cut once shipped changes have accumulated since the last release tag. No new top-level entry point beyond what the spec forces anyway.

Critical caveat found during investigation: the spec itself (`spec.md`, "Release CLI Command Surface" and "Release Skill And Guard Authorization" requirements) mandates a standalone Commander CLI surface and a matching skill regardless of candidate. So this candidate is not an alternative to a release command — it is **Candidate 1's full surface plus a ship-side trigger**. The evaluation below is really about whether that extra trigger earns its cost.

## Codebase findings (file:line evidence)

**1. There are two ship paths, and the primary one is not code.**
- `src/cli/commands/ship.ts:6-61` — `registerShipCommand` is a thin wrapper: load config, resolve `targetBranch` from `config.git?.pr_base ?? 'main'` (line 18), then `new MergeSafetyPipeline(ctx.projectRoot, ctx.gateRegistry).run(sourceBranch, targetBranch, options.dryRun)` (lines 38-39). A post-success release hook could attach after line 39 cleanly, gated on `result.status === 'success'`.
- **But** the AI-orchestrated ship flow is `src/templates/skills/metta-ship/SKILL.md`, and it never calls `metta ship`: its steps are `metta finalize --dry-run` → `metta finalize` → `git push -u origin metta/<change>` → `gh pr create` → `gh pr merge <n> --merge` → back on main `git pull --ff-only`. The skill explicitly forbids local merge: "Direct local merge of the change branch into main (`git merge`) is forbidden — every change ships through a pushed branch and a GitHub PR" (enforced by archived change `spec/archive/2026-08-08-enforce-pr-based-shipping-all-ship-paths-user-requires-every/`). **There is no single testable code hook for "ship succeeded" on the primary path** — a release trigger there lives in skill markdown, or nowhere.

**2. Merge-safety is self-contained and safety-critical.**
- `src/ship/merge-safety.ts:22-244` — `MergeSafetyPipeline.run` is a 9-step pipeline with multiple abort/rollback paths (`restore()` at 82-89, `reset --hard ${snapshotTag}` at 173, 188, 199, 234). The only tag it creates is the rollback snapshot `metta/pre-merge/${sourceBranch}` via `git tag -f` at lines 156-158 — namespaced, forced, lightweight, and unrelated to release tags. The merge commit message is hardcoded `chore: merge ${sourceBranch}` (line 169), so it carries no bump information.
- Covered by `tests/merge-safety.test.ts` (10 tests). Any release logic inserted *inside* the pipeline multiplies rollback interactions (what happens to a release commit/tag when post-merge gates fail and the pipeline `reset --hard`s? — lines 227-243). The intent already constrains this: merge-safety "is not modified beyond, at most, additive metadata" (intent.md, Impact).

**3. Finalize is the natural place to record a bump signal — good precedent exists.**
- `src/finalize/finalizer.ts:52-294` — steps: completeness gate (80-96), dry-run spec merge (100-115), gates (119-142), real merge (160), UAT/TOKENS generation (177-233), **archive at step 6** (236: `artifactStore.archive(changeName)`), then **step 6b writes `gates.yaml` into the archive dir** (241-254) — a direct precedent for enriching the archive with post-hoc metadata. Docs regenerate at step 7 (256-276) when `docs.generate_on === 'finalize'`.
- `src/artifacts/artifact-store.ts:315-326` — `archive()` moves the entire change dir (including `.metta.yaml`) to `spec/archive/${date}-${name}`. So a bump-signal field written into change metadata before archiving persists automatically.
- `src/schemas/change-metadata.ts:91-115` — `ChangeMetadataSchema` is `.strict()`, so a new optional field (e.g. `bump_signal: z.enum(['patch','minor','major']).optional()` or a `commit_type` string) is a required schema edit; there is ample precedent for optional additive fields (`escalation`, `model_escalations`, `token_usage`).

**4. The raw bump signal is weaker than the intent implies — explicit recording is the valuable part.**
- Change names are slugified free-text descriptions (`ctx.artifactStore.deriveChangeName(description)`, `src/cli/commands/propose.ts:59`); real archive entries like `2026-08-08-set-git-init-defaultbranch-main-ci-gates-job` and `2026-08-08-token-usage-tracking-finalize-report-...` carry **no** reliable `fix:`/`feat:` prefix. The ship merge commit is `chore: merge ...` (merge-safety.ts:169) or a GitHub PR merge commit. So deriving bump levels purely from git archaeology at release time is lossy; capturing an explicit signal at finalize (from the branch's conventional commits, the workflow tier, or a one-line prompt) is the genuinely good idea inside this candidate — and it is equally usable by Candidate 1.

**5. Changelog generator has no version concept and no git access.**
- `src/docs/doc-generator.ts:205-235` — `generateChangelog` emits a flat `## ${date} — ${changeName}` list from `loadArchiveEntries()` (334-385), which parses `YYYY-MM-DD-name` dir names and reads `summary.md`. `DocGenerator` does zero git I/O today; version anchoring needs release boundaries supplied from outside (a `.metta/` releases state file written at cut time, or tag data gathered at the CLI edge) to keep the functional-core discipline. This work is identical across candidates.

**6. Config surface is additive either way.**
- `src/schemas/project-config.ts:103-125` — `ProjectConfigSchema` is `.strict()`; a `release` key (scheme, version_file, tag_prefix, github opt-in) slots in beside `git`/`docs`/`uat`. This candidate adds one more knob: `release.on_ship: 'off' | 'prompt' | 'auto'` (default `off` to satisfy the "Purely Additive When Unconfigured" requirement — finalize/ship behave byte-identically without config, per spec.md scenario "Existing lifecycle unchanged without release config").
- `src/config/version-drift.ts:42-52, 60-62` — `installed_version` is read raw from `.metta/config.yaml` and stamped via `setProjectField`; fully separate from any product-version file. No overlap risk as long as the release module never imports it — easy to keep, easy to test.

**7. Guard tiers.**
- `.claude/hooks/metta-guard-bash.mjs:42, 66, 76` — `ship` is Tier 1 (fork-tier, authorized by `agent_type` from the forked `metta-skill-host`); `finalize` is Tier 2 (session-tier credential). If release rides the ship skill, the skill's fork context authorizes it for free — but the spec-mandated standalone `metta release` CLI still needs its own entry in the blocked-subcommand lists (lines 42/66) plus a skill-name mapping (line 76 table), the same guard work Candidate 1 needs. Net saving: zero.

## Implementation sketch

Because the spec mandates the standalone surface anyway, this candidate = Candidate 1 + the following deltas:

1. `src/schemas/change-metadata.ts` — add optional `bump_signal` (enum patch/minor/major) or `commit_type` field.
2. `src/finalize/finalizer.ts` — before step 6 (`archive`), derive and write the bump signal into `.metta.yaml` (inputs gathered at the edge: branch commit subjects via `git log`, workflow tier from metadata; pure classification function in the release core module). Warn-and-continue on failure, mirroring the UAT/TOKENS degradation pattern (lines 198-204, 226-232).
3. `src/schemas/project-config.ts` — `ReleaseConfigSchema` (shared with Candidate 1) plus `on_ship` toggle.
4. `src/cli/commands/ship.ts` — after `pipeline.run` returns `success` and not `dryRun`, if release config present and `on_ship !== 'off'`: count archived changes since last `{tag_prefix}*` tag, print/prompt a release offer, delegate to the release module. Strictly outside `MergeSafetyPipeline`.
5. `src/templates/skills/metta-ship/SKILL.md` — new step after "Back on `main`: `git pull --ff-only`": if release configured, run the version-status command and offer the release cut via AskUserQuestion, invoking the release skill/CLI. This is instruction prose, not testable code.
6. Everything Candidate 1 needs regardless: release core module (pure bump derivation + semver increment + changelog grouping), version-file reader/writer, tag/commit/`gh` effects at the edge, `metta release`/`metta version` commands, release skill template, guard entries, `generateChangelog` version anchoring, ~8-10 new src files + matching tests.

Estimated extra surface over Candidate 1: 4 touched files (`ship.ts`, `finalizer.ts`, `change-metadata.ts`, `metta-ship/SKILL.md`), two of them lifecycle-critical, plus tests for the ship-hook gating and finalize signal recording.

## Edge cases

- **Batching multiple shipped changes into one release**: works structurally — "changes since last tag" is computed from archive entries + tags, so accumulation is free. But the *trigger* model fights it: under `prompt`, every ship interrupts with a release offer the user must decline N-1 times; under `auto`, every ship becomes a release (version churn, one change per version) unless a threshold knob is added — more config for behavior Candidate 1 gets by simply not running `metta release` yet.
- **Aborted ship**: `MergeSafetyPipeline.run` has 10+ early-return failure/conflict paths; the CLI hook must gate on `status === 'success' && !dryRun` (straightforward). On the skill path, step 6 allows leaving the PR open for review — the change is finalized/archived but *not* shipped, so "released changes" and "archived changes" diverge; a release cut at that moment would include an unmerged change in the changelog. Candidate 1 has the same theoretical window but doesn't actively prompt at exactly the wrong moment.
- **Squash-merge interaction**: `GitConfigSchema.merge_strategy` supports `'squash'` (project-config.ts:25). Any design that cuts the release on the feature branch pre-merge produces a tag pointing at a commit unreachable from main after squash. The cut must run on main post-merge — which only the skill markdown reaches on the primary path.
- **Parallel worktrees**: worktrees are enabled by default (`project-config.ts:29-32`) and the codebase has a whole `workflow-parallelism-discipline` capability. Auto-releasing on ship of change A rewrites the version file and `docs/changelog.md` on main while change B's branch is in flight — guaranteeing merge conflicts in B on exactly the files the release touched. Decoupled cadence (release when quiescent, user-chosen) sidesteps this; release-on-ship maximizes it.
- **No prior tag**: identical handling in all candidates (spec "First Release Without Prior Tag") — derive over all archive entries, base on current version-file value. Nothing ship-specific.
- **`git.enabled: false`** (`project-config.ts:21`): ship is meaningless without git, so the on-ship trigger is unreachable; the standalone command errors actionably. No special handling needed, but it underlines that the trigger only exists on one config path.

## Risks & tradeoffs

**Risks (specific to this candidate):**
1. **The primary ship path has no code hook.** The real ship flow is skill markdown + `gh pr merge`; a release trigger there is untestable prose, while a hook in `src/cli/commands/ship.ts` decorates a command the AI flow is forbidden from calling (guard Tier 1 + skill rules). The trigger either bifurcates (markdown + CLI, kept in sync by hand) or covers only the human path.
2. **Couples release cadence to per-change shipping**, directly contradicting the spec's framing of the cut as "a single user-invoked release operation" (spec.md, "Release Cut Operation") and inviting one-change-per-version churn or prompt fatigue.
3. **Touches the safety-critical ship/finalize paths** (`finalizer.ts` archive sequence, `ship.ts`) for marginal benefit; any regression there blocks all shipping, not just releases. The `merge-safety.ts` pipeline itself can stay untouched, but reviewers must verify that.
4. **Worktree conflict amplification** (see edge cases) — the auto mode is actively harmful in metta's own parallel-change workflow.
5. **Strictly more work than Candidate 1**: every Candidate 1 deliverable is still required by the spec; this adds 4 lifecycle-file touches, skill edits, and extra config on top.

**Genuine strengths worth salvaging:**
- **Bump-signal recording at finalize** (`change-metadata.ts` optional field + a warn-and-continue write in `finalizer.ts` step ~5d) captures release intent at the moment of maximum context, follows the existing `gates.yaml` precedent, and removes the git-archaeology weakness found in finding 4. It is additive, low-risk, and equally serves Candidate 1's `metta release` derivation.
- Discoverability: a ship-time hint ("2 changes shipped since v0.4.0 — run /metta-release when ready") gets most of the UX benefit with none of the coupling, as a one-line, non-blocking notice.

## Verdict

**Score: 3/10** as the primary architecture.

The spec independently mandates the standalone CLI + skill surface, so release-on-ship cannot replace Candidate 1 — it can only add a trigger on top of it, and the trigger's natural attachment point does not exist as testable code (the primary ship path is skill markdown driving `gh`, not `MergeSafetyPipeline`). It couples cadence to shipping against the spec's "single user-invoked operation" language, amplifies worktree merge conflicts under metta's own default parallel workflow, and adds touches to the two most safety-sensitive files in the lifecycle for benefits a passive hint delivers more cheaply.

**Recommendation if this research wins anyway / hybrid contribution:** do not adopt release-on-ship as the architecture. Salvage two pieces into Candidate 1: (a) the optional `bump_signal` field in `ChangeMetadataSchema` written by `Finalizer` before `archive()` (finding 3/4 — cheap, additive, high-value for derivation accuracy), and (b) a non-blocking "changes pending release" notice at the end of the ship skill and `metta ship` output. Keep the cut itself as the standalone, user-invoked `metta release` operation.
