# Design: metta-docs-generate-auto-gener

## Overview

This design covers the `DocGenerator` class, four Handlebars-style doc templates, the `metta docs generate` CLI command, and the Finalizer integration. The approach is template-driven, fully deterministic, and free of any AI provider calls. All content is compiled by parsing existing Markdown files under `spec/`.

---

## ADR-1: Template engine — handlebars-style `.hbs` files over code-embedded strings

**Decision**: Store each doc template as a `.hbs` file in `src/templates/docs/`, copied to `dist/templates/docs/` at build time. The generator performs simple token substitution (`{{variable}}` and `{{#each}}...{{/each}}`) without pulling in the full Handlebars library.

**Rationale**: Keeping templates as first-class files lets operators inspect and override them without touching TypeScript source. The existing project already distributes built-in templates to `dist/` (gates, artifacts, workflows, skills) using the same copy-at-build pattern. Pulling in the `handlebars` npm package for simple block iteration would be needless vendor coupling — the substitution surface is small enough for a purpose-built 50-line renderer. If the surface grows, adopting handlebars is a single-line change.

**Risk flagged**: If a downstream operator overrides a template file and the `.hbs` format evolves, they will need to migrate their overrides. This is acceptable for v1 given the narrow template surface.

---

## ADR-2: Source parsing — regex-based Markdown extraction over a Markdown AST library

**Decision**: Extract headings and section content from spec files using regex patterns (`/^## Requirement:/m`, `/^### Scenario:/m`, `/^### ADR-/m`) rather than introducing a remark/unified AST pipeline.

**Rationale**: The spec files follow a strict, narrow formatting convention enforced by metta's own agents. The extraction requirements (headings, sections between headings) map cleanly to line-by-line or regex operations. Adding `remark` or `unified` introduces ~15 transitive dependencies and a significantly larger API surface for a one-time parsing task. Regression risk from regex is lower given the constrained input format.

**Risk**: If spec files deviate from the expected heading format (e.g., level-3 headings used for top-level requirements), extraction may silently miss content. The generator will emit a warning when a section parses as empty.

---

## ADR-3: Doc generation failure isolation — non-throwing try/catch wrapper in Finalizer

**Decision**: The `Finalizer` wraps the `DocGenerator.generate()` call in a `try/catch` and maps any thrown error to a warning log entry. It does not rethrow and does not fail the `FinalizeResult`.

**Rationale**: The spec requires that doc generation failure MUST NOT block finalize (spec § "Requirement: Auto-Trigger on Finalize"). The finalize step has already completed the archive write and spec merge — those are the durable side-effects. Doc output is a derived artifact that can be regenerated at any time via `metta docs generate`. The isolation boundary makes the dependency direction explicit: Finalizer owns the lifecycle, DocGenerator is a best-effort post-step.

---

## Component List

| Component | Path | Responsibility |
|-----------|------|----------------|
| `DocGenerator` | `src/docs/doc-generator.ts` | Core generation class. Reads spec sources, loads templates, writes output files. |
| Doc templates | `src/templates/docs/*.md.hbs` | One template per doc type. Defines section structure; tokens filled at generation time. |
| `DocsConfigSchema` | `src/schemas/project-config.ts` | Already present. Validates `output`, `generate_on`, `types`. |
| CLI command | `src/cli/commands/docs.ts` | Registers `metta docs generate [type] [--dry-run]` with Commander. |
| Finalizer integration | `src/finalize/finalizer.ts` | Replaces placeholder Step 4 with live `DocGenerator.generate()` call. |

---

## Data Models

### `DocType`

```typescript
export type DocType = 'architecture' | 'api' | 'changelog' | 'getting-started'
```

The four values exactly match the spec and the `DocsConfig.types` array elements.

### `DocGenerateResult`

```typescript
export interface DocGenerateResult {
  generated: string[]   // absolute paths written to disk
  skipped: string[]     // doc type names not generated (not in requested types)
  warnings: string[]    // non-fatal parse/IO messages
}
```

### `CapabilityEntry` (internal)

```typescript
interface CapabilityEntry {
  name: string          // directory name under spec/specs/
  label: string         // first ## heading from spec.md, or name if absent
  specPath: string      // absolute path to spec.md
  requirements: RequirementEntry[]
}

interface RequirementEntry {
  heading: string       // text after "## Requirement:"
  scenarios: string[]   // texts after "### Scenario:" under this requirement
}
```

### `ArchiveEntry` (internal)

```typescript
interface ArchiveEntry {
  dirName: string       // e.g. "2026-04-06-add-mfa"
  date: string          // extracted YYYY-MM-DD prefix
  changeName: string    // remainder after date prefix
  designPath: string    // absolute path (may not exist)
  summaryPath: string   // absolute path (may not exist)
  adrs: AdrEntry[]      // parsed from design.md
  summaryContent: string | null
}

interface AdrEntry {
  title: string
  content: string
}
```

---

## `DocGenerator` Class Design

**File**: `src/docs/doc-generator.ts`

```typescript
export class DocGenerator {
  constructor(
    private specDir: string,       // absolute path to spec/ directory
    private projectRoot: string,   // absolute project root
    private config: DocsConfig,    // validated DocsConfig
    private templateDir?: string,  // defaults to dist/templates/docs/
  ) {}

  async generate(types?: DocType[]): Promise<DocGenerateResult>

  private async generateArchitecture(sources: string[]): Promise<string>
  private async generateApi(sources: string[]): Promise<string>
  private async generateChangelog(sources: string[]): Promise<string>
  private async generateGettingStarted(sources: string[]): Promise<string>

  private async loadCapabilities(): Promise<CapabilityEntry[]>
  private async loadArchiveEntries(): Promise<ArchiveEntry[]>
  private async loadTemplate(type: DocType): Promise<string>
  private renderTemplate(template: string, vars: Record<string, unknown>): string
  private buildHeader(sourcePaths: string[]): string
  private relPaths(paths: string[]): string
}
```

**Template resolution**: `templateDir` defaults to the `dist/templates/docs/` path resolved relative to the compiled JS file via `new URL('../../templates/docs', import.meta.url).pathname`. This matches how the existing `finalize.ts` command resolves `../../templates/gates`.

**Output path**: Each doc is written to `path.join(projectRoot, config.output, '<type>.md')`. The output directory is created with `mkdir -p` semantics if absent.

**Header format**: Built by `buildHeader()`. Source paths are made relative to `projectRoot`. If the comma-separated list would exceed 120 characters, the list is truncated to the first N paths that fit with an `...and M more` suffix appended.

**Dry-run support**: The `generate()` method accepts a `dryRun: boolean` parameter (default `false`). In dry-run mode, file content is computed but `writeFile` is not called. `result.generated` still contains the paths that would have been written, matching the spec's dry-run contract (spec § "Requirement: CLI Command").

---

## CLI Command Design

**File**: `src/cli/commands/docs.ts`

The command uses Commander's subcommand model, matching the pattern of `metta specs list|show|diff`:

```
metta docs generate [type] [--dry-run]
```

`[type]` is validated against the four known `DocType` values. If an unrecognized value is passed, the command exits with code 4 and prints to stderr. This mirrors the exit-4 error convention used throughout the codebase (see `finalize.ts`, `specs.ts`).

The command reads `DocsConfig` via `ctx.configLoader.load()` and falls back to `DocsConfigSchema` defaults when the `docs` key is absent.

On success, paths are printed one per line to stdout. Warnings from `result.warnings` are printed to stderr with a `warn:` prefix.

---

## Finalizer Integration

Step 4 in `Finalizer.finalize()` currently holds a placeholder. The integration replaces it:

1. Load `DocsConfig` from the project config file using `ConfigLoader`. If the `docs` key is absent, apply `DocsConfigSchema` defaults.
2. If `config.docs.generate_on !== 'finalize'`, skip — set `docsGenerated = []` and continue.
3. Construct `DocGenerator(specDir, projectRoot, docsConfig)`.
4. Call `generator.generate()` inside a `try/catch`.
5. On success, set `docsGenerated = result.generated`.
6. On catch, log a warning line to stderr and set `docsGenerated = []`.

The `Finalizer` constructor already receives `specDir` and an optional `projectRoot`. The `ConfigLoader` instantiation mirrors the pattern in CLI commands — `new ConfigLoader(projectRoot)` — and its `load()` is called with `await`.

---

## Template File Structure

Each template lives at `src/templates/docs/<type>.md.hbs`. Token syntax:

- `{{title}}` — document title string
- `{{generatedHeader}}` — the three-line HTML comment block (injected before rendering, not inside the template body)
- `{{#each items}}...{{name}}...{{/each}}` — block iteration
- `{{content}}` — pre-formatted Markdown block passed as a string

Templates define the section skeleton. The generator populates the data, calls `renderTemplate()`, then prepends the header.

### Template files

| Template | Key sections defined |
|----------|---------------------|
| `architecture.md.hbs` | `# Architecture`, `## Components`, `## Architectural Decisions`, `## System Design` |
| `api.md.hbs` | `# API Reference`, one `## <CapabilityName>` per capability, requirements and scenario lists |
| `changelog.md.hbs` | `# Changelog`, `### YYYY-MM-DD — <change-name>` entries in reverse order |
| `getting-started.md.hbs` | `# Getting Started`, `## Project`, `## Stack`, `## Conventions`, `## Architectural Constraints`, `## Quick Start` |

---

## Source Parsing Logic

### Capabilities (`spec/specs/`)

1. `readdir(specDir/specs, { withFileTypes: true })` — collect directory entries.
2. For each directory, read `spec.md`. Extract the first `## ` heading as the label. If absent, use the directory name.
3. Extract `RequirementEntry` items: split the file on `^## Requirement:` lines; for each segment, collect `### Scenario:` headings within the segment.
4. Sort capabilities lexicographically by directory name for consistent API doc output.

### Archive entries (`spec/archive/`)

1. `readdir(specDir/archive, { withFileTypes: true })` — collect directory entries.
2. For each directory, parse the `YYYY-MM-DD` prefix from the name. Entries that do not match the prefix pattern are skipped with a warning.
3. Sort entries in reverse chronological order: first by date descending, then by full directory name descending for same-date ties.
4. For each entry, attempt to read `design.md` and `summary.md`. Failures produce a warning entry in `result.warnings` but do not abort iteration.
5. Parse ADRs from `design.md` by splitting on `^### ADR-` heading lines.

### `spec/project.md`

1. Read the entire file.
2. Extract section content by splitting on `^## ` heading lines.
3. Map heading text to the four expected sections. Missing sections produce a warning but do not abort generation.

---

## Dependencies

No new npm dependencies are introduced. The implementation uses only:

- `node:fs/promises` (`readFile`, `writeFile`, `mkdir`, `readdir`) — already used throughout the codebase
- `node:path` (`join`, `relative`) — already used
- `zod` — already present for schema validation
- `DocsConfig` / `DocsConfigSchema` — already defined in `src/schemas/project-config.ts`

The `templateDir` default is resolved via `import.meta.url`, matching the existing resolution pattern in `finalize.ts` for gates templates.

---

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Spec files deviate from heading convention | Low — metta agents enforce format | Emit warning on empty parse result |
| `dist/templates/docs/` missing at runtime (build not run) | Low | Throw `DocGeneratorError` with actionable message |
| Output `docs/` directory is under version control and large | Acceptable | Files are small, deterministic; operator owns `.gitignore` choices |
| Vendor lock-in via template engine | None | No third-party template library; built-in renderer only |
| Finalizer blocking on slow doc generation | Low | No network I/O; all operations are local file reads and writes |

---

## Out of Scope (references spec)

Per spec § "Out of Scope": AI provider calls, HTML/PDF output, watch mode, versioned snapshots, custom doc types, and doc generation during `metta ship` are all excluded from this design. The `metta refresh` integration mentioned in intent.md is deferred to a separate change.
