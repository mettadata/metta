# adaptive-workflow-tier-selection-emit-complexity-score-after

## Problem

Every `/metta-quick` invocation dispatches a fixed fan-out of 8 subagents — 1 proposer, 1 executor, 3 reviewers, and 3 verifiers — regardless of how narrow the change is. During a 40-feature Trello-clone driver session, this pattern fired for single-attribute tooltip tweaks: changes that touched one file, altered fewer than ten lines, and carried no API or spec-surface implications. Each trivial feature cost roughly 5 minutes of wall time and approximately 200 KB of tokens. At 40 features per session, the compounding overhead is substantial and the marginal safety benefit of three parallel reviewers on a tooltip label change is negligible.

The inverse problem also exists: users and orchestrators running `/metta-quick` on changes that span 4+ files and alter public API receive no planning artifacts, no spec update guidance, and no warning — the overshoot goes undetected until late in the lifecycle when implementation diverges from intent.

Both pain points share a common root cause: the framework has no mechanism to estimate a change's scope after intent is known and no surface to expose that estimate. There is nowhere in `metta status` or `metta instructions` output that shows a complexity estimate, so no informed routing decision is possible — by the human or by the orchestrator — at any point in the lifecycle.

Developers iterating on high-feature-count sessions bear the trivial-change waste most acutely. AI orchestrators running automated `propose`/`fix-issues` flows bear the overshooting risk most acutely, because they have no interactive recourse: a quick run that grows unexpectedly produces no warning until `metta complete` closes the change.

## Proposal

Introduce a lightweight complexity scoring step that fires once immediately after `intent.md` is authored and persists its result in change metadata. The score drives four behaviours in this change: an always-on advisory recommendation, an interactive auto-downscale prompt on propose/fix-issues runs, a warn-only auto-upscale check at implementation-complete time, and a fan-out reduction for trivial changes inside `/metta-quick`.

### Score computation trigger

The score is computed once, as the final step of intent authoring, immediately after `intent.md` is written. It is not computed at CLI invocation time and not recomputed when `intent.md` is later edited. One exception: the auto-upscale path (mode 3) recomputes the score once more after `metta complete implementation` writes `summary.md`, using the actual files touched rather than the intent estimate. That recomputed score is stored separately and never overwrites the original estimate.

### Signals v1

The sole input signal is the estimated file count, parsed from the prose in the `## Impact` section of `intent.md`. The scorer counts distinct file or module references in that section and maps the count to a tier using the following thresholds:

| Tier     | File count  |
|----------|-------------|
| trivial  | ≤ 1 file    |
| quick    | 2–3 files   |
| standard | 4–7 files   |
| full     | 8+ files    |

If `intent.md` has not been written, the scorer produces no output and `complexity_score` is absent from change metadata.

### Storage

The score is persisted as a new structured field in the change's `.metta.yaml` metadata block:

```yaml
complexity_score:
  score: 1                      # numeric tier index: 0=trivial 1=quick 2=standard 3=full
  signals:
    file_count: 3
  recommended_workflow: quick
```

After `metta complete implementation`, if the auto-upscale check fires, the recomputed score is written as a parallel field and never overwrites the original:

```yaml
actual_complexity_score:
  score: 2
  signals:
    file_count: 5
  recommended_workflow: standard
```

Both fields are optional in the Zod schema for `.metta.yaml` change metadata. All read and write paths in `ArtifactStore` must handle their presence and absence without error.

### Advisory surfaces (mode 1)

Advisory mode is always active when a score is present. It is print-only and does not alter behaviour.

**`metta status --change <name>`** surfaces the score in both human-readable and `--json` output. Human output includes a `Complexity:` line showing the tier label, file-count signal value, and recommended workflow. JSON output includes the full `complexity_score` object. When `complexity_score` is absent (intent not yet written), the field renders as `complexity: null` in both formats.

**`metta instructions`** renders a one-line advisory banner at the top of its output when `complexity_score` is present — for example: `Advisory: complexity scored as quick (3 files) — recommended workflow: quick`. The banner is suppressed entirely when `complexity_score` is absent. It is informational only; it does not block execution.

### Auto-downscale behaviour (mode 2)

After intent is authored during a `metta propose` or `metta fix-issues` run, if the scorer classifies the change as a lower tier than the chosen workflow, an interactive prompt is printed:

```
Scored as <tier> (N files) — collapse workflow to /metta-quick? [y/N]
```

The default answer is No. On Yes, the `.metta.yaml` `workflow` field is updated from its current value (e.g. `standard`) to `quick`, and planning artifacts (stories, spec, research, design, tasks) are removed from the change's artifact list. On No, the original workflow continues unchanged.

The prompt is suppressed entirely when the chosen workflow already matches the recommendation or is already a smaller tier than recommended. When the environment is non-TTY (CI runners, `--json` output mode), the prompt is skipped and No is assumed; the advisory banner still appears in output so the record exists.

### Auto-upscale behaviour (mode 3)

Auto-upscale is warn-only. There is no artifact replay and no retroactive planning.

After `metta complete implementation` writes `summary.md`, the scorer recomputes the file count from the `## Files` section of `summary.md` (actual files touched, not the intent estimate). If the recomputed tier is higher than the chosen workflow tier, a warning is printed at the top of the `metta complete implementation` output:

```
Warning: this change touched N files — <tier> workflow was recommended; finalize will proceed on <chosen-tier>
```

Finalize is not blocked. The recomputed score is written to `actual_complexity_score` in `.metta.yaml` for retrospection. If the recomputed tier is equal to or lower than the chosen workflow tier, no warning is printed and `actual_complexity_score` is still written (silently).

### Intra-quick downsize rule (Candidate Solution A)

When `recommended_workflow` is `trivial` and the user is running `/metta-quick`, the skill's existing trivial-detection gate is extended to also govern review and verify fan-out. A trivial-scored change runs with 1 quality reviewer and 1 tests/tsc verifier only — no correctness reviewer, no security reviewer, no dedicated goal-check verifier. Non-trivial `/metta-quick` runs keep the current 3-reviewer + 3-verifier fan-out. Tests and tsc run on every change regardless of tier; this is not negotiable.

### Override mechanism

The existing `--workflow <tier>` flag on `metta propose` remains the authoritative override. When the flag is present, auto-downscale does not prompt and advisory continues to print.

## Impact

The following modules and artifacts are directly affected by this change:

- **`ArtifactStore` / change-metadata Zod schema** — `complexity_score` and `actual_complexity_score` are new optional fields added to the `.metta.yaml` change-metadata schema. Read and write paths must handle their presence and absence without error.
- **`metta status` command renderer** — human and JSON output renderers gain a `complexity` display path. The JSON serializer must include `complexity_score` (or `null`) in the change object.
- **`metta instructions` command renderer** — the output generator gains a conditional banner insertion step that reads `complexity_score` from change metadata and prepends the advisory line when the field is present.
- **`metta complete` command** — the implementation-complete handler gains two responsibilities: (a) triggering the auto-downscale prompt after intent is written (propose/fix-issues flow) and (b) triggering the auto-upscale recompute after `summary.md` is written and emitting the warning when the tier jumps above the chosen workflow.
- **`/metta-quick` skill template** — the trivial-detection gate section is extended with logic that checks `recommended_workflow` and conditionally reduces the reviewer and verifier subagent lists to the trivial fan-out (1 quality reviewer + 1 tests/tsc verifier).
- **`spec/specs/` rubric document** — a new rubric document is added describing the scoring algorithm, tier thresholds, signal definitions, and extension points for future signals.
- **`CLAUDE.md` Active Specs table** — updated to include the new rubric capability entry.

## Out of Scope

The following are explicitly deferred and must not be implemented as part of this change:

- **Candidate Solution B** — the dedicated `metta fast` / `metta instructions trivial` subcommand or skill path with zero review subagents.
- **Spec-surface signal** — counting changes to public API or spec-surface area as a complexity input.
- **Capability-count signal** — counting the number of `spec/specs/` capability folders touched as a complexity input.
- **Line-delta signal** — using estimated or actual line counts as a scoring signal beyond file count.
- **Retroactive artifact replay on auto-upscale** — mode 3 is warn-only; replaying planning artifacts (stories, research, design, tasks) into an in-progress quick change is out of scope.
- **Configuration flags to toggle advisory on/off** — the advisory is always active when a score is present; no opt-in/opt-out flag is introduced.
- **Recomputation on intent edits** — the score is computed once at intent-authoring time and frozen; subsequent edits to `intent.md` do not trigger a rescore.
- **New skills beyond `/metta-quick` modification** — no `metta score`, `metta fast`, or other new skill or subcommand is introduced; the scorer is wired into existing flows only.
- **Auto-downscale on `/metta-quick` runs** — the downscale prompt applies only to `metta propose` and `metta fix-issues` runs; quick runs are already the smallest named workflow and are not prompted.
