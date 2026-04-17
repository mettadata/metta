# fix-issue-full-workflow-refere

## Requirement: full-workflow-artifact-templates

Three markdown template files MUST exist under `src/templates/artifacts/` so that `TemplateEngine.load()` can satisfy every stage referenced by `src/templates/workflows/full.yaml`.

### Scenario: domain-research template load succeeds
- GIVEN a project with this change merged
- WHEN `TemplateEngine.load('domain-research.md')` is called
- THEN it returns the file contents with no error

### Scenario: architecture template load succeeds
- GIVEN a project with this change merged
- WHEN `TemplateEngine.load('architecture.md')` is called
- THEN it returns the file contents with no error

### Scenario: ux-spec template load succeeds
- GIVEN a project with this change merged
- WHEN `TemplateEngine.load('ux-spec.md')` is called
- THEN it returns the file contents with no error

### Scenario: full workflow propose + instructions round-trip
- GIVEN a project with this change merged
- WHEN `metta propose "<description>" --workflow full` is invoked and then `metta instructions domain-research --json --change <slug>` is invoked
- THEN neither command exits non-zero and the instructions response includes the populated `template` field

### Scenario: build pipeline copies the new templates
- GIVEN `npm run build` has been executed after this change
- WHEN the contents of `dist/templates/artifacts/` are inspected
- THEN `domain-research.md`, `architecture.md`, and `ux-spec.md` are present alongside the existing templates
