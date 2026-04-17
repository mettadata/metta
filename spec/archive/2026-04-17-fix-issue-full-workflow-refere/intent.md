# fix-issue-full-workflow-refere

## Problem

The `full` workflow (`src/templates/workflows/full.yaml`) defines three artifact stages that reference template files absent from `src/templates/artifacts/`:

- `domain-research.md` — loaded at the first stage of the workflow, before intent
- `architecture.md` — loaded after the `design` stage
- `ux-spec.md` — loaded in parallel with `tasks`, after `design`

`TemplateEngine.load()` iterates its `searchPaths` array and throws `Error: Template '<name>.md' not found in: ...` on the first call that targets a missing file. Because the `full` workflow places `domain-research` as stage one, every `metta instructions domain-research` call issued after `metta propose --workflow full` crashes before producing any output. The `architecture` and `ux-spec` stages crash identically when reached later in the sequence. The `full` workflow has therefore never been usable end-to-end: the change is created successfully, but the workflow stalls at the first artifact generation step and cannot proceed without manual intervention or a code workaround.

Affected users: any developer who selects `--workflow full` expecting the higher-ceremony process for complex systems changes.

## Proposal

Create three markdown stub files under `src/templates/artifacts/`, each following the established pattern of the eight existing artifact templates: a heading using the `{change_name}` token, section headers appropriate to the artifact's purpose, and brief one-line `{placeholder}` prompts under each section.

Files to create:

**`src/templates/artifacts/domain-research.md`** — sections: Domain Overview, Competitive Landscape, Technology Landscape, Key Findings, Implications for Intent. Rendered before the intent artifact so the proposer agent has a structured research foundation.

**`src/templates/artifacts/architecture.md`** — sections: Architecture Overview, Component Breakdown, Interfaces, State & Data Flow, Deployment Topology, Risks. Rendered after `design.md` to capture the deeper structural decisions the architect makes once the design is accepted.

**`src/templates/artifacts/ux-spec.md`** — sections: User Goals, Key Flows, Screens & States, Components & Interactions, Accessibility, Visual Tone. Rendered in parallel with `tasks.md` (both require `design`) to give the architect a dedicated artifact for the UX contract.

No code changes are required. `TemplateEngine.load()` already resolves template names by joining `searchPath + templateName`; the `copy-templates` build step globs the entire `src/templates/artifacts/` directory into `dist/`, so the three new files are automatically included in every subsequent build and install. The fix is purely additive: three new files, zero modifications to existing files.

## Impact

- `metta instructions domain-research`, `metta instructions architecture`, and `metta instructions ux-spec` will resolve their templates without error for the first time.
- `metta propose --workflow full <description>` followed by the full artifact sequence becomes end-to-end executable.
- No existing templates, workflows, agents, schemas, or runtime code are modified; there is no regression surface.
- The issue logged at `spec/issues/full-workflow-references-missing-template-files-domain-resea.md` is resolved.
- Developers choosing the `full` workflow gain three new structured artifacts that guide domain research, architecture documentation, and UX specification.

## Out of Scope

- Changes to `src/templates/workflows/full.yaml` — the stage references (`template: domain-research.md`, `template: architecture.md`, `template: ux-spec.md`) are already correct; only the files are missing.
- Changes to agents or persona definitions — `researcher` and `architect` agents already exist and are already assigned in `full.yaml`.
- A full end-to-end dogfood run of the `full` workflow on a real change — that is a separate validation exercise deferred to a follow-on task.
- Documentation or tutorials explaining when to choose `full` over `standard`.
- Adding these artifact types to the `standard` or `quick` workflows.
