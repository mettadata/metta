# Research: fix-issue-full-workflow-refere

## Decision: Add three minimal stub templates, matching existing style

### Approaches Considered

1. **Minimal stub markdown with `{placeholder}` tokens** (selected) — mirrors the existing 8 templates in `src/templates/artifacts/` (average ~15 lines each). No new tooling, no new schema, picks up automatically via `copy-templates`'s existing `cp -r src/templates/artifacts dist/templates/artifacts` rule. The runtime `TemplateEngine.load(name)` resolves `src/templates/artifacts/<name>` in dev or `dist/templates/artifacts/<name>` at package time.
2. **Richer prompts with per-section guidance** — longer templates with embedded instructions for the researcher / architect persona. Rejected: inconsistent with the rest of the template corpus, and the persona guidance already lives in the agent definition (`metta instructions <artifact>` attaches the persona out-of-band).
3. **Remove the three stages from `full.yaml`** — would satisfy the issue's "or" clause. Rejected: amputates intended capability; the `full` workflow is explicitly designed around these stages (domain research upstream of intent, architecture + ux-spec downstream of design). Creating the templates is the higher-value fix.

### Rationale

The issue tracks a **missing-file** problem, not a design problem. The existing template corpus shows the pattern:

- 10–25 lines of markdown
- H1 with `{change_name}` placeholder
- Two to six H2 sections with `{placeholder}` tokens

We match that pattern exactly. No need for web research — this is established local convention.

Section headers per template come straight from intent.md:
- `domain-research.md` → Domain Overview, Competitive Landscape, Technology Landscape, Key Findings, Implications for Intent
- `architecture.md` → Architecture Overview, Component Breakdown, Interfaces, State & Data Flow, Deployment Topology, Risks
- `ux-spec.md` → User Goals, Key Flows, Screens & States, Components & Interactions, Accessibility, Visual Tone

### Artifacts Produced

None beyond this note — the findings feed directly into `design.md` and `tasks.md`.

### Sources

- `src/templates/artifacts/*.md` — existing template corpus (style reference)
- `src/templates/workflows/full.yaml` — stage declarations naming the three missing templates
- `spec/issues/full-workflow-references-missing-template-files-domain-resea.md` — the logged issue
