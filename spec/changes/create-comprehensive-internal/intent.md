# create-comprehensive-internal

## Problem

A developer working on metta itself has no single landing page that explains how the framework's moving parts compose. The existing docs (`docs/architecture.md`, `docs/api.md`, `docs/getting-started.md`) are generated from specs and describe what metta does for users of the tool; none of them explain the internal machinery a contributor needs to navigate: how a `/metta-propose` invocation becomes a YAML workflow stage, which subagent persona authors which artifact, what gates fire between stages and what each one checks, or how on-disk state is laid out across `.metta/` and `spec/`.

The gap means a new contributor must grep through 18 SKILL.md files, 10 agent definitions, 3 workflow YAMLs, 11 artifact templates, and 5 gate YAMLs independently just to answer basic orientation questions like "which skill should I use for this task?" or "what does the metta-verifier agent actually do?". There is no decision tree, no cross-system walkthrough, and no map connecting the concepts.

## Proposal

Create a `docs/workflows/` subdirectory containing 8 new reference files that together form a comprehensive internal guide. No existing files are rewritten; two existing files receive a one-line pointer to the new guide.

1. **`docs/workflows/README.md`** — Index and orientation hub. Lists all 7 sibling files with one-line descriptions, explains when to read each, and provides a decision tree ("which skill should I use?") covering the lifecycle, status, organization, spec-management, and setup skill groups.

2. **`docs/workflows/workflows.md`** — Reference for the three YAML workflow definitions (`quick`, `standard`, `full`). Documents each workflow's stage sequence, the artifact produced per stage, `requires` dependencies, gate checks, and the agent binding for each stage. Explains the criteria for choosing among the three (scope, ceremony level, risk).

3. **`docs/workflows/skills.md`** — Reference for all 18 installed `/metta-*` skills. For each skill: its slash-command name, one-sentence purpose, the CLI command(s) it wraps, the subagents it spawns, and guidance on when to prefer it over alternatives. Grouped by the five categories from `CLAUDE.md`: lifecycle, status, organization, spec-management, setup.

4. **`docs/workflows/agents.md`** — Reference for all 10 `metta-*` subagent personas. For each agent: its role in the lifecycle, the tools it is permitted to use, the artifact(s) it authors, the typical prompt shape it receives, and the workflow stages it participates in.

5. **`docs/workflows/artifacts.md`** — Reference for all 11 artifact types defined under `src/templates/artifacts/`. For each artifact: its purpose in the change lifecycle, the required sections in its template, the agent responsible for authoring it, and which workflow(s) include it.

6. **`docs/workflows/gates.md`** — Reference for all gates that can fire during a workflow. Covers the 5 YAML-defined gates (`build`, `lint`, `typecheck`, `tests`, `stories-valid`) plus the non-YAML gates enforced by agents or the CLI (`spec-quality`, `design-review`, `task-quality`, `uat`). For each gate: what it checks, the command or logic it runs, the `on_failure` policy, and which workflow stages trigger it.

7. **`docs/workflows/state.md`** — Reference for the on-disk state model. Documents the layout and ownership of `.metta/` (active change state, YAML files validated by Zod schemas), `spec/changes/` (per-change artifact directories), `spec/specs/` (living capability specs), `spec/archive/` (completed changes), `spec/issues/` (logged issues), `spec/backlog/` (prioritized items), and `spec/gaps/` (reconciliation gaps). States which agent or CLI command writes each location and under what lifecycle event.

8. **`docs/workflows/walkthroughs.md`** — Four end-to-end narrative walkthroughs showing how the concepts above compose in practice: (a) a one-line typo fix via `/metta-quick`, (b) a medium feature via `/metta-propose` using the standard workflow, (c) a logged bug resolved via `/metta-fix-issues`, and (d) a complex system redesign via `/metta-propose --workflow full`. Each walkthrough traces skill invocation → workflow stage execution → artifact authoring → gate firing → state transitions → final commit.

Additionally, a one-line pointer to `docs/workflows/README.md` is added to `docs/architecture.md` and `docs/getting-started.md` (below the generated-header note, as a human-maintained addendum section, so it survives `metta docs generate` reruns without conflicting with the generated body).

## Impact

- 8 new files created under `docs/workflows/` — purely additive, no existing files deleted or restructured.
- `docs/architecture.md` receives one new human-maintained section ("Workflow Guide") with a single cross-link; the generated body is unchanged.
- `docs/getting-started.md` receives one new human-maintained section ("Learn the Internals") with a single cross-link; the generated body is unchanged.
- No source code changes. No new tooling or build steps. No changes to `.metta/` state, YAML templates, skills, agents, or specs.
- All existing cross-references in `docs/api.md` and other existing docs remain intact.

## Out of Scope

- Any modifications to `docs/api.md` beyond what already exists.
- Any rewrites or restructuring of `docs/architecture.md` or `docs/getting-started.md` beyond the single pointer addendum described above.
- Files under `docs/proposed/` or `docs/research/`.
- New tooling for automated doc generation or doc validation.
- Revisions to the CLAUDE.md workflow section (addressed in the prior change `claude-md-workflow-section-ref`).
- Changes to any skill SKILL.md, agent definition, workflow YAML, artifact template, or gate YAML — those are source-of-truth files that `docs/workflows/` documents, not modifies.
- Versioning or changelog entries for the new docs beyond the commit itself.
