# adaptive-workflow-tier-selection-emit-complexity-score-after

## Problem

Every `/metta-quick` invocation dispatches a fixed fan-out of 8 subagents — 1 proposer, 1 executor, 3 reviewers, and 3 verifiers — regardless of how narrow the change is. During a 40-feature Trello-clone driver session, this pattern fired for single-attribute tooltip tweaks: changes that touched one file, altered fewer than ten lines, and carried no API or spec-surface implications. Each trivial feature cost roughly 5 minutes of wall time and approximately 200 KB of tokens. At 40 features in a session, the compounding waste is substantial and the marginal safety benefit of three parallel reviewers on a tooltip label change is negligible.

The root cause is that `/metta-quick` has no mechanism to introspect a change's scope after intent is known and adjust subagent fan-out accordingly. The user and the orchestrator both lack a visibility signal — there is nowhere in `metta status` or `metta instructions` output that surfaces a complexity estimate, so no informed routing decision is possible at any point in the lifecycle.

Developers and AI orchestrators running iterative, high-feature-count sessions bear the cost most acutely: they pay the full orchestration overhead on every change without recourse short of not using review subagents at all.

## Proposal

Introduce a lightweight complexity scoring step that fires once, immediately after `intent.md` is authored, and persists its result in change metadata. The score drives two things in this change: an advisory recommendation visible to the user and a fan-out reduction for changes the scorer classifies as trivial inside `/metta-quick`.

**Score computation trigger.** The score is computed once, after the intent artifact is fully written, as the final step of the propose/quick intent-authoring phase. It is not computed at CLI invocation time, not recomputed continuously, and not recomputed if intent is later edited.

**Signal for v1.** The sole input signal is the estimated file count, parsed from the prose in the `## Impact` section of `intent.md`. The scorer counts distinct file or module references in that section and maps the count to a tier using the following thresholds:

| Tier | File count |
|------|------------|
| trivial | 1 or fewer files |
| quick | 2–3 files |
| standard | 4–7 files |
| full | 8 or more files |

If `intent.md` has not been written yet the scorer produces no output; `complexity_score` is absent from metadata.

**Storage.** The score is persisted as a new structured field in the change's `.metta.yaml` metadata block:

```yaml
complexity_score:
  score: 1          # numeric tier (0=trivial, 1=quick, 2=standard, 3=full)
  signals:
    file_count: 1
  recommended_workflow: trivial
```

This field is added to the `ArtifactStore` change-metadata schema and validated by the existing Zod schema for `.metta.yaml`.

**Advisory surface — `metta status`.** The `metta status --change <name>` command surfaces the score in both human-readable and JSON output. Human output includes a `Complexity:` line showing the tier label, file-count signal value, and recommended workflow. JSON output includes the full `complexity_score` object. When `complexity_score` is absent, the field renders as `complexity: null` in both formats.

**Advisory surface — `metta instructions`.** The `metta instructions` command renders a one-line advisory banner at the top of its output when `complexity_score` is present, for example: `Advisory: complexity scored as trivial (1 file) — recommended workflow: quick`. The banner is suppressed entirely when `complexity_score` is absent. The banner is informational only; it does not block execution or alter behavior.

**Override.** The existing `--workflow <tier>` flag on `metta propose` remains the authoritative override. The advisory is print-only; no auto-routing occurs.

**Intra-quick downsizing (Candidate Solution A from backlog).** When the `recommended_workflow` is `trivial` and the user is running `/metta-quick`, the skill's existing trivial-detection gate is extended to also govern review and verify fan-out. A trivial-scored change runs with 1 quality reviewer and 1 tests/tsc verifier only — no correctness reviewer, no security reviewer, no dedicated goal-check verifier. Non-trivial quick runs keep the current 3+3 fan-out. Tests and tsc run on every change regardless of tier; this is not negotiable.

## Impact

The following modules and artifacts are directly affected by this change:

- **`ArtifactStore` / change-metadata schema** — the `complexity_score` field is a new optional key added to the Zod schema for `.metta.yaml` change metadata. Read and write paths in `ArtifactStore` must handle its presence and absence without error.
- **`metta status` command** — human and JSON output renderers gain a `complexity` display path. The JSON serializer must include `complexity_score` (or `null`) in the change object.
- **`metta instructions` command** — the output generator gains a conditional banner insertion step that reads `complexity_score` from change metadata and prepends the advisory line when the field is present.
- **`/metta-quick` skill template** — the trivial-detection gate section is extended with logic that checks `recommended_workflow` and conditionally reduces the reviewer and verifier subagent lists to the trivial fan-out.
- **Spec documentation** — `spec/specs/` gains a rubric document describing the scoring algorithm, tier thresholds, signal definitions, and extension points for future signals. The `CLAUDE.md` Active Specs table is updated accordingly.

No changes to `metta propose`, `metta fix-issues`, `metta auto`, or any other skill template are required. The scorer runs as a step injected after intent authoring, not as a separate command.

## Out of Scope

The following are explicitly deferred to follow-up changes and must not be implemented here:

- **Auto-downscale routing** — automatically collapsing `propose` or `fix-issues` to `quick` when the complexity score falls below a threshold. This change is advisory only.
- **Auto-upscale routing** — detecting mid-`quick` that a change has grown and automatically promoting it to `standard`. This change does not recompute the score after initial computation.
- **Spec-surface signal** — counting changes to public API or spec surface area as a complexity input. Deferred pending a reliable detection strategy.
- **Capability-count signal** — counting the number of `spec/specs/` capability folders touched as a complexity input.
- **Line-delta signal** — using estimated or actual line counts as a scoring signal beyond file count.
- **Any new CLI subcommand or skill** — no `metta score`, `metta fast`, or `metta instructions trivial` subcommand or skill is introduced. The scorer is wired into existing flows only.
- **Configuration flags for advisory mode** — the advisory is always on when a score is present; there is no opt-in/opt-out flag in this change.
- **Candidate Solution B** — the dedicated `metta fast` / `metta instructions trivial` path with zero review subagents is not implemented here.
- **Recomputation on intent edits** — the score is computed once and frozen; subsequent edits to `intent.md` do not trigger a rescore.
