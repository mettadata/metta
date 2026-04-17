# Design: fix-issue-full-workflow-refere

## Approach

Add three stub markdown files under `src/templates/artifacts/`, matching the existing 8-template corpus style. No code changes. Build pipeline's `copy-templates` script already recursively copies the directory to `dist/`.

## Components

| File | Role | Agent (per full.yaml) |
|------|------|----------------------|
| `src/templates/artifacts/domain-research.md` | Pre-intent market/tech-landscape research (new file, ~15-20 lines) | `researcher` |
| `src/templates/artifacts/architecture.md` | Post-design detailed architecture (new file, ~15-20 lines) | `architect` |
| `src/templates/artifacts/ux-spec.md` | Post-design UX contract parallel to tasks (new file, ~15-20 lines) | `architect` |

## Template structure (each file)

Every file follows the exact shape of existing templates like `design.md`:

```
# <Capitalized Artifact Name>: {change_name}

## <Section 1>
{placeholder_for_section_1_prose}

## <Section 2>
{placeholder_for_section_2_prose}

...
```

Specific section headers per template (drawn from intent.md):

- **domain-research.md**: Domain Overview, Competitive Landscape, Technology Landscape, Key Findings, Implications for Intent
- **architecture.md**: Architecture Overview, Component Breakdown, Interfaces, State & Data Flow, Deployment Topology, Risks
- **ux-spec.md**: User Goals, Key Flows, Screens & States, Components & Interactions, Accessibility, Visual Tone

## Data Model

No persisted state; files are static template sources.

## Dependencies

- `TemplateEngine.load()` — existing loader; no change
- `copy-templates` in `package.json` — already globs `src/templates/artifacts/` into `dist/`

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Stub section headers miss what a real `full` workflow run needs | Acceptable for v1 — the agent persona (not the template) drives the substance. Users can edit their instance post-scaffold. Tracked: first real `full`-workflow dogfood may surface template refinements as follow-up issues. |
| Placeholder syntax diverges from existing templates | Use `{snake_case_name}` throughout, matching `{change_name}`, `{high_level_approach}`, etc. |
| `.claude/skills/` install captures templates that get stale | Same concern as every other artifact template; handled by the existing `metta install` / build refresh cycle. |
