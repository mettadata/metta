# Tasks: metta-docs-generate-auto-gener

## Batch 1 — Independent (no inter-task dependencies, run in parallel)

- [ ] **Task 1.1 — Create `src/docs/doc-generator.ts`**
  - Define `DocType` union type (`'architecture' | 'api' | 'changelog' | 'getting-started'`)
  - Define `DocGenerateResult` interface (`generated`, `skipped`, `warnings` string arrays)
  - Define internal interfaces `CapabilityEntry`, `RequirementEntry`, `ArchiveEntry`, `AdrEntry`
  - Implement `DocGenerator` class with constructor `(specDir: string, projectRoot: string, config: DocsConfig, templateDir?: string)`
  - Implement public `generate(types?: DocType[], dryRun?: boolean): Promise<DocGenerateResult>`
    - Default `types` to `config.types` cast to `DocType[]` when argument is omitted
    - Populate `skipped` with any of the four known types not in the requested set
    - Create output directory with `mkdir -p` semantics before writing
    - Write managed header block (`buildHeader()`) prepended to each output file
  - Implement private `generateArchitecture(sources: string[]): Promise<string>`
    - Read `spec/specs/` directories via `loadCapabilities()`, produce component list
    - Read `spec/archive/*/design.md` files via `loadArchiveEntries()`, extract ADRs in reverse-chrono order
    - Load and render `architecture.md.hbs` template
  - Implement private `generateApi(sources: string[]): Promise<string>`
    - Read `spec/specs/` via `loadCapabilities()`, lexicographically sorted
    - For each capability, list requirements and nested scenarios
    - Load and render `api.md.hbs` template
  - Implement private `generateChangelog(sources: string[]): Promise<string>`
    - Read `spec/archive/*/summary.md` via `loadArchiveEntries()`, reverse-chrono order
    - Emit warning and skip entries missing `summary.md`
    - Load and render `changelog.md.hbs` template
  - Implement private `generateGettingStarted(sources: string[]): Promise<string>`
    - Read `spec/project.md`; extract sections under `## Project`, `## Stack`, `## Conventions`, `## Architectural Constraints`
    - Emit warning (not error) for any missing section; omit that section from output
    - Quick-start commands block sourced from template, not from `spec/project.md`
    - Load and render `getting-started.md.hbs` template
  - Implement private helpers:
    - `loadCapabilities(): Promise<CapabilityEntry[]>` — reads all `spec/specs/<cap>/spec.md` files; logs warning on unreadable file
    - `loadArchiveEntries(): Promise<ArchiveEntry[]>` — reads all `spec/archive/*/` dirs; skips dirs without `YYYY-MM-DD` prefix with warning
    - `loadTemplate(type: DocType): Promise<string>` — reads from `templateDir`; throws `DocGeneratorError` if file missing
    - `renderTemplate(template: string, vars: Record<string, unknown>): string` — built-in token substitution, no third-party library
    - `buildHeader(sourcePaths: string[]): string` — three-line HTML comment block; truncates source list beyond 120 chars
    - `relPaths(paths: string[]): string` — converts absolute paths to paths relative to `projectRoot`
  - Export `DocGenerator`, `DocGenerateResult`, `DocType` from this file
  - Resolve default `templateDir` via `new URL('../../templates/docs', import.meta.url).pathname`

- [ ] **Task 1.2 — Create doc templates in `src/templates/docs/`**
  - Create directory `src/templates/docs/`
  - Create `architecture.md.hbs`:
    - `# Architecture` title section
    - `## Components` section with `{{#each capabilities}}` block listing name and label
    - `## Architectural Decisions` section with `{{#each adrs}}` block; when empty, include note "No ADRs recorded yet"
    - `## System Design` section placeholder for diagram content extracted from design files
  - Create `api.md.hbs`:
    - `# API Reference` title section
    - `{{#each capabilities}}` block: `## <name>` heading, then `### Requirements` list with nested scenario bullets
    - Handle zero-scenario requirements gracefully (no sub-list rendered)
  - Create `changelog.md.hbs`:
    - `# Changelog` title section
    - `{{#each entries}}` block: `### YYYY-MM-DD — <change-name>` heading, then summary content verbatim
  - Create `getting-started.md.hbs`:
    - `# Getting Started` title section
    - Conditional blocks for `## Project`, `## Stack`, `## Conventions`, `## Architectural Constraints`
    - `## Quick Start` section with fixed code block listing `metta propose`, `metta execute`, `metta finalize`, `metta ship` with one-line descriptions
  - Confirm all four templates are included in the `tsconfig.json` / `package.json` build copy step so they land in `dist/templates/docs/`

- [ ] **Task 1.3 — Create `src/cli/commands/docs.ts`**
  - Export `registerDocsCommand(program: Command): void`
  - Create `docs` parent command with `.description('Generate and manage documentation')`
  - Create `docs generate` subcommand:
    - `[type]` positional argument — optional
    - `--dry-run` flag
  - Validate `[type]` against the four known `DocType` values; if invalid, print to stderr and exit code 4
  - Load `DocsConfig` via `ctx.configLoader.load()` — apply `DocsConfigSchema` defaults when `docs` key is absent: `output: './docs'`, `generate_on: 'finalize'`, `types: ['architecture', 'api', 'changelog', 'getting-started']`
  - Resolve `specDir` as `path.join(ctx.projectRoot, 'spec')`
  - Resolve `templateDir` via `new URL('../../templates/docs', import.meta.url).pathname`
  - Instantiate `DocGenerator(specDir, ctx.projectRoot, docsConfig, templateDir)`
  - Call `generator.generate(types, dryRun)` where `types` is `[type]` if provided, else undefined
  - On success:
    - Print each path in `result.generated` to stdout, one per line
    - Print each entry in `result.warnings` to stderr prefixed with `warn:`
    - Exit 0
  - On failure: print human-readable error to stderr, exit code 4
  - Dry-run mode: print paths that would be written; do not write files; exit 0

---

## Batch 2 — Depends on Task 1.1 and Task 1.3

- [ ] **Task 2.1 — Register docs command in `src/cli/index.ts`**
  - Add import: `import { registerDocsCommand } from './commands/docs.js'`
  - Add call: `registerDocsCommand(program)` after `registerFinalizeCommand(program)`
  - Verify `metta docs --help` prints the generate subcommand

- [ ] **Task 2.2 — Wire `DocGenerator` into `Finalizer` (`src/finalize/finalizer.ts`)**
  - Import `DocGenerator` and `DocType` from `../../docs/doc-generator.js`
  - Import `ConfigLoader` from `../../config/config-loader.js`
  - Import `DocsConfigSchema` from `../../schemas/project-config.js`
  - Replace Step 4 placeholder comment with live implementation:
    1. Instantiate `ConfigLoader(projectRoot)` and `await configLoader.load()`
    2. Extract `docsConfig` from result; fall back to `DocsConfigSchema.parse({})` if `config.docs` is absent
    3. If `docsConfig.generate_on !== 'finalize'`, skip — `docsGenerated = []`
    4. Else: `const templateDir = new URL('../../templates/docs', import.meta.url).pathname`
    5. Construct `DocGenerator(specDir, projectRoot!, docsConfig, templateDir)`
    6. Wrap `generator.generate()` in `try/catch`; on catch, write warning to `process.stderr` and set `docsGenerated = []`
    7. On success, set `docsGenerated = result.generated`
  - Confirm `FinalizeResult.docsGenerated` is populated correctly in all three `generate_on` modes
  - Confirm finalize still returns `gatesPassed: true` and valid `archiveName` when doc generation throws

---

## Batch 3 — Depends on all prior tasks

- [ ] **Task 3.1 — Add tests for `DocGenerator` (`src/docs/doc-generator.test.ts`)**
  - Use Vitest with temp directory isolation (create temp dir per test, clean up in `afterEach`)
  - Seed helper: `seedSpecTree(tmpDir, capabilities, archiveEntries)` — writes minimal `spec/specs/<cap>/spec.md` and `spec/archive/<entry>/` files
  - Test: full generation from clean spec tree
    - Seed three capabilities, two archive entries each with `design.md` and `summary.md`, `spec/project.md` with all four sections
    - Call `generator.generate()` with no args
    - Assert `result.generated` has length 4
    - Assert all four output files exist and are non-empty
    - Assert `result.warnings` is empty
  - Test: missing `design.md` in one archive entry
    - Seed one archive entry without `design.md`
    - Call `generator.generate(['architecture'])`
    - Assert `result.generated` includes architecture path
    - Assert `result.warnings` references the missing file
    - Assert no throw
  - Test: subset generation
    - Call `generator.generate(['changelog'])`
    - Assert `result.generated` has length 1
    - Assert only `changelog.md` written; other three files absent
  - Test: architecture ADR ordering
    - Seed two archive entries: `2026-04-06-fix-gap/design.md` with "ADR-1: Skill-orchestrated pipeline" and `2026-04-05-add-auth/design.md` with "ADR-1: JWT-based tokens"
    - Assert `architecture.md` contains `fix-gap` ADR text before `add-auth` ADR text
  - Test: API doc capability ordering
    - Seed capabilities `workflow-engine` and `artifact-store`
    - Assert `artifact-store` section appears before `workflow-engine` in `api.md`
  - Test: changelog ordering with same-date entries
    - Seed entries `2026-04-06-fix-gap`, `2026-04-06-add-auth`, `2026-04-05-bootstrap`
    - Assert `fix-gap` appears before `add-auth` in `changelog.md` (reverse lex within same date)
    - Assert `2026-04-05-bootstrap` entry appears last
  - Test: getting-started with missing `## Architectural Constraints`
    - Seed `spec/project.md` with `## Project`, `## Stack`, `## Conventions` but no `## Architectural Constraints`
    - Assert `getting-started.md` is written
    - Assert `result.warnings` has one entry noting the absent heading
  - Test: managed header written correctly
    - Assert first line of any generated file is exactly `<!-- Generated by Metta — do not edit directly -->`
    - Assert third line is exactly `<!-- Run \`metta docs generate\` to regenerate -->`
  - Test: dry-run does not write files
    - Call `generator.generate(undefined, true)`
    - Assert `result.generated` is non-empty (paths that would be written)
    - Assert no files exist on disk at those paths
  - Test: empty archive does not fail architecture generation
    - Seed two capabilities, zero archive entries
    - Assert `architecture.md` is written with component list
    - Assert ADR section present with "no ADRs" note
    - Assert no throw
