# adaptive-workflow-tier-selection-emit-complexity-score-after

## Problem

Every `/metta-quick` invocation dispatches a fixed fan-out of 8 subagents -- 1 proposer, 1 executor, 3 reviewers, and 3 verifiers -- regardless of how narrow the change is. During a 40-feature Trello-clone driver session, this pattern fired for single-attribute tooltip tweaks: changes that touched one file, altered fewer than ten lines, and carried no API or spec-surface implications. Each trivial feature cost roughly 5 minutes of wall time and approximately 200 KB of tokens. At 40 features per session, the compounding overhead is substantial and the marginal safety benefit of three parallel reviewers on a tooltip label change is negligible.

The inverse problem is equally costly: users and orchestrators running `/metta-quick` on changes that span 4+ files and alter public API receive no planning artifacts, no spec update guidance, and no warning. The overshoot goes undetected until late in the lifecycle, and the closed change lands in `spec/archive/` missing stories, a spec entry, and design rationale -- producing a permanent record of an under-specified change that future engineers cannot reason from.

Both pain points share a common root cause: the framework has no mechanism to estimate a change's scope after intent is known and no surface to expose that estimate. There is nowhere in `metta status` or `metta instructions` output that shows a complexity estimate, so no informed routing decision is possible -- by the human or by the orchestrator -- at any point in the lifecycle.

Developers iterating on high-feature-count sessions bear the trivial-change waste most acutely. AI orchestrators running automated `propose`/`fix-issues` flows bear both failure modes: a standard run that could have been quick wastes tokens per feature, and a quick run that outgrows the workflow ships without the planning artifacts that the spec store depends on.

## Proposal

Introduce a lightweight complexity scoring step that fires once immediately after `intent.md` is authored and persists its result in change metadata. The score drives five behaviours: an always-on advisory recommendation, an interactive auto-downscale prompt at intent time, an interactive auto-upscale prompt at intent time, an interactive auto-upscale prompt with retroactive artifact authoring at implementation-complete time, and a fan-out reduction for trivial changes inside `/metta-quick`. A `--auto` / `--accept-recommended` flag on the propose, quick, and fix-issues commands short-circuits all interactive prompts to Yes.

### Score computation trigger

The score is computed once, as the final step of intent authoring, immediately after `intent.md` is written. It is not computed at CLI invocation time and not recomputed when `intent.md` is later edited. One exception: the post-implementation upscale path recomputes the score once more after `metta complete implementation` writes `summary.md`, using the actual files touched rather than the intent estimate. That recomputed score is stored separately and never overwrites the original estimate.

### Signals v1

The sole input signal is the estimated file count, parsed from the prose in the `## Impact` section of `intent.md`. The scorer counts distinct file or module references in that section and maps the count to a tier using the following thresholds:

| Tier     | File count  |
|----------|-------------|
| trivial  | <= 1 file   |
| quick    | 2-3 files   |
| standard | 4-7 files   |
| full     | 8+ files    |

For the post-implementation recompute, the scorer reads the `## Files` section of `summary.md` and applies the same thresholds to actual file count.

If `intent.md` has not been written, the scorer produces no output and `complexity_score` is absent from change metadata.

### Storage

The score is persisted as new structured fields in the change's `.metta.yaml` metadata block:

```yaml
complexity_score:
  score: 1                      # numeric tier index: 0=trivial 1=quick 2=standard 3=full
  signals:
    file_count: 3
  recommended_workflow: quick
auto_accept_recommendation: true  # present only when --auto flag was passed
```

After `metta complete implementation`, the recomputed score is written as a parallel field and never overwrites the original:

```yaml
actual_complexity_score:
  score: 2
  signals:
    file_count: 5
  recommended_workflow: standard
```

All three fields (`complexity_score`, `actual_complexity_score`, `auto_accept_recommendation`) are optional in the Zod schema for `.metta.yaml` change metadata. All read and write paths in `ArtifactStore` must handle their presence and absence without error.

### Advisory surfaces (mode 1)

Advisory mode is always active when a score is present. It is print-only and does not alter behaviour.

**`metta status --change <name>`** surfaces the score in both human-readable and `--json` output. Human output includes a `Complexity:` line showing the tier label, file-count signal value, and recommended workflow. JSON output includes the full `complexity_score` object. When `complexity_score` is absent (intent not yet written), the field renders as `complexity: null` in both formats.

**`metta instructions`** renders a one-line advisory banner at the top of its output when `complexity_score` is present. The banner reflects the relationship between the current workflow and the recommendation:

- Agreement: `Advisory: current workflow quick matches recommendation quick`
- Downscale recommended: `Advisory: current standard, scored trivial -- downscale recommended`
- Upscale recommended: `Advisory: current quick, scored standard -- upscale recommended`

The banner is suppressed entirely when `complexity_score` is absent. It does not block execution.

### Auto-downscale at intent time (mode 2)

After intent is authored during a `metta propose` or `metta fix-issues` run, if the scorer classifies the change as a lower tier than the chosen workflow, an interactive prompt is printed:

```
Scored as <tier> (N files) -- collapse workflow to /metta-<tier>? [y/N]
```

The default answer is No. On Yes: the `.metta.yaml` `workflow` field is updated to the recommended tier, and planning artifacts that have not yet been authored (stories, spec, research, design, tasks) are removed from the change's artifact list. On No, the original workflow continues unchanged.

The prompt is suppressed when the chosen workflow already matches the recommendation or is already a smaller tier than recommended. When the environment is non-TTY (CI runners, `--json` output mode), the prompt is skipped and No is assumed; the advisory banner still appears in output so the record exists.

When `auto_accept_recommendation: true` is set, the prompt is skipped and Yes is auto-selected.

### Auto-upscale at intent time (mode 3)

After intent is authored, if the scorer classifies the change as a higher tier than the chosen workflow, an interactive prompt is printed:

```
Scored as <tier> (N files) -- promote workflow to /metta-<tier>? [y/N]
```

The default answer is No. On Yes: the `.metta.yaml` `workflow` field is updated to the recommended tier, and missing planning artifacts are inserted into the change's artifact list before implementation runs. The scorer computes the artifact diff by loading both the current workflow YAML definition and the target workflow YAML definition, then inserting any stages present in the target but not yet in the artifact list. For example, promoting from quick to standard inserts stories, spec, research, design, and tasks as pending artifacts. On No, the original workflow continues unchanged.

The prompt is suppressed when the chosen workflow already matches or exceeds the recommendation. When the environment is non-TTY, the prompt is skipped and No is assumed; the advisory banner still appears.

When `auto_accept_recommendation: true` is set, the prompt is skipped and Yes is auto-selected.

### Post-implementation auto-upscale (mode 4)

After `metta complete implementation` writes `summary.md`, the scorer recomputes the file count from the `## Files` section of `summary.md` (ground truth: actual files touched, not the intent estimate). If the recomputed tier exceeds the chosen workflow tier, an interactive prompt is printed:

```
Implementation touched N files -- promote to /metta-<tier> and retroactively author stories + spec? [y/N]
```

The default answer is No. When the environment is non-TTY, the prompt is skipped and No is assumed.

When `auto_accept_recommendation: true` is set, the prompt is skipped and Yes is auto-selected.

**On Yes:**

1. The `.metta.yaml` `workflow` field is updated to the recomputed tier.
2. A metta-product agent is spawned to author `stories.md` retroactively, using `intent.md`, `summary.md`, and the actual code as input.
3. A metta-specifier agent (metta-proposer subagent type) is spawned to author `spec.md` retroactively, using `intent.md`, `summary.md`, and the actual code as input.
4. Both `stories` and `spec` are inserted into the artifacts list and marked `complete`.
5. The skill orchestrator's subsequent review and verify spawns respect the new tier -- for example, a change promoted from trivial to standard runs 3 reviewers and 3 verifiers instead of 1+1.

Research, design, and tasks artifacts are not retroactively authored. Only stories and spec are produced by the retroactive path.

**On No:** the original warning line is printed ("Warning: this change touched N files -- <tier> workflow was recommended; finalize will proceed on <chosen-tier>"), `actual_complexity_score` is persisted in `.metta.yaml`, and verification proceeds unchanged on the original workflow.

The recomputed score is written to `actual_complexity_score` in both the Yes and No paths. If the recomputed tier is equal to or lower than the chosen workflow tier, no prompt is printed and `actual_complexity_score` is still written silently.

### Intra-quick downsize rule (Candidate Solution A)

When `recommended_workflow` is `trivial` and the user is running `/metta-quick`, the skill's existing trivial-detection gate is extended to also govern review and verify fan-out. A trivial-scored change runs with 1 quality reviewer and 1 tests/tsc verifier only -- no correctness reviewer, no security reviewer, no dedicated goal-check verifier. Non-trivial `/metta-quick` runs keep the current 3-reviewer + 3-verifier fan-out. Tests and tsc run on every change regardless of tier; this is not negotiable.

This rule applies even when the user declines the auto-downscale prompt. The user may choose to remain on the quick workflow while still benefiting from the reduced fan-out for a trivial-scored change.

### Override mechanism and `--auto` flag

The existing `--workflow <tier>` flag on `metta propose`, `metta quick`, and `metta fix-issues` remains the authoritative override for the initial workflow choice. When `--workflow` is present, auto-downscale and auto-upscale at intent time still prompt normally unless `--auto` is also set.

The `--auto` / `--accept-recommended` flag is added to `metta propose`, `metta quick`, and `metta fix-issues`. When passed, it is persisted as `auto_accept_recommendation: true` in `.metta.yaml`. At any adaptive-routing prompt (intent-time downscale, intent-time upscale, post-implementation upscale), if `auto_accept_recommendation` is true, the prompt is skipped and Yes is auto-selected.

`--auto` and `--workflow` can be combined: `--workflow` sets the initial choice and `--auto` auto-accepts any subsequent recommendation shift away from that choice.

The `/metta-quick` and `/metta-propose` skill templates already accept `--auto` to short-circuit the discovery loop. This change extends the meaning of that flag to also cover adaptive-routing prompts -- no new template machinery is required, but the skill template documentation is updated to describe the expanded scope.

## Impact

The following modules and artifacts are directly affected by this change:

- **`ArtifactStore` / change-metadata Zod schema** -- `complexity_score`, `actual_complexity_score`, and `auto_accept_recommendation` are new optional fields added to the `.metta.yaml` change-metadata schema. Read and write paths must handle their presence and absence without error.
- **`metta propose` CLI command parser** -- gains `--auto` / `--accept-recommended` option; persists `auto_accept_recommendation: true` in `.metta.yaml` when set.
- **`metta quick` CLI command parser** -- gains `--auto` / `--accept-recommended` option with the same persistence behaviour.
- **`metta fix-issues` CLI command parser** -- gains `--auto` / `--accept-recommended` option with the same persistence behaviour.
- **`metta complete` command** -- the implementation-complete handler gains three new responsibilities: (a) triggering the intent-time auto-downscale prompt after intent is authored, (b) triggering the intent-time auto-upscale prompt after intent is authored, and (c) triggering the post-implementation auto-upscale prompt after `summary.md` is written, including the retroactive artifact spawn logic for the Yes path.
- **`metta status` command renderer** -- human and JSON output renderers gain a `complexity` display path. The JSON serializer includes `complexity_score` (or `null`) in the change object.
- **`metta instructions` command renderer** -- the output generator gains a conditional banner insertion step that reads `complexity_score` and `workflow` from change metadata, computes the relationship between them, and prepends the appropriate advisory line when the field is present.
- **`/metta-quick` skill template** -- the trivial-detection gate section is extended with logic that checks `recommended_workflow` and conditionally reduces the reviewer and verifier subagent lists to the trivial fan-out (1 quality reviewer + 1 tests/tsc verifier). Documentation is updated to note that `--auto` now also auto-accepts routing recommendations.
- **`/metta-propose` skill template** -- documentation is updated to note that `--auto` now also auto-accepts routing recommendations. No template logic changes are required.
- **`spec/specs/` rubric document** -- a new rubric document is added describing the scoring algorithm, tier thresholds, signal definitions, prompt behaviour, retroactive authoring logic, and extension points for future signals.
- **`CLAUDE.md` Active Specs table** -- updated to include the new rubric capability entry.

## Out of Scope

The following are explicitly deferred and must not be implemented as part of this change:

- **Candidate Solution B** -- the dedicated `metta fast` / `metta instructions trivial` subcommand or skill path with zero review subagents.
- **Spec-surface signal** -- counting changes to public API or spec-surface area as a complexity input.
- **Capability-count signal** -- counting the number of `spec/specs/` capability folders touched as a complexity input.
- **Line-delta signal** -- using estimated or actual line counts as a scoring signal beyond file count.
- **Retroactive authoring of research, design, and tasks on post-implementation upscale** -- only stories and spec are retroactively authored; research, design, and tasks artifacts are not produced by the retroactive path.
- **Configuration flags to toggle advisory on/off** -- the advisory is always active when a score is present; no opt-in/opt-out flag is introduced.
- **Recomputation on intent edits** -- the score is computed once at intent-authoring time and frozen; subsequent edits to `intent.md` do not trigger a rescore.
- **Recomputation at any lifecycle point other than implementation complete** -- the only permitted recompute point is after `metta complete implementation` writes `summary.md`.
- **New skills beyond `/metta-quick` and `/metta-propose` modifications** -- no `metta score`, `metta fast`, or other new skill or subcommand is introduced; the scorer is wired into existing flows only.
- **Auto-downscale on `/metta-quick` runs** -- the downscale prompt applies only to `metta propose` and `metta fix-issues` runs; quick runs are already the smallest named interactive workflow and are not prompted for downscale.
