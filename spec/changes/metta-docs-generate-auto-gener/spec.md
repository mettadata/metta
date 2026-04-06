# Spec: metta-docs-generate-auto-gener

## Overview

This spec describes the `DocGenerator` class and the `metta docs generate` CLI command. The feature reads from `spec/specs/`, `spec/archive/`, and `spec/project.md` and writes four Markdown documents to the configured output directory. Generation is template-driven, deterministic, and requires no AI provider calls.

---

## Requirement: Doc Generator

The `DocGenerator` class MUST accept a `specDir` path (absolute), a `projectRoot` path (absolute), and a `DocsConfig` object at construction time.

`DocGenerator` MUST expose a `generate(types?: DocType[])` method that, when called without arguments, generates all four doc types listed in `DocsConfig.types`. When called with a `types` argument, it MUST generate only the specified subset.

`DocGenerator` MUST read the following source locations:
- `spec/specs/<capability>/spec.md` — one file per capability directory — for architecture and API docs
- `spec/archive/*/design.md` — one file per archive entry — for architecture docs
- `spec/archive/*/summary.md` — one file per archive entry — for changelog docs
- `spec/project.md` — the project constitution — for the getting-started doc

`DocGenerator` MUST NOT call any AI provider, make any network request, or read any file outside `spec/` and `dist/templates/docs/`.

`DocGenerator` MUST load one Handlebars-style template file per doc type from `dist/templates/docs/<type>.md.hbs`. Each template defines the section structure; the generator fills in the content from parsed spec data.

When a source file is missing or unreadable, the generator MUST log a warning and continue generating the remaining content for that doc type. It MUST NOT throw or abort generation for a single missing file.

`generate()` MUST return a `DocGenerateResult` object containing:
- `generated`: string array of output file paths that were written
- `skipped`: string array of doc types skipped due to configuration
- `warnings`: string array of non-fatal parse or I/O warnings encountered

### Scenario: Full generation from clean spec tree

- GIVEN `spec/specs/` contains directories `artifact-store`, `workflow-engine`, and `schemas`
- AND `spec/archive/` contains two entries each with `design.md`, `summary.md`, and `spec.md`
- AND `spec/project.md` exists with stack and conventions sections
- AND `DocsConfig.types` is `['architecture', 'api', 'changelog', 'getting-started']`
- WHEN `generator.generate()` is called
- THEN `result.generated` contains four absolute file paths under `DocsConfig.output`
- AND each file exists on disk and is non-empty
- AND `result.warnings` is empty

### Scenario: Missing design.md in one archive entry

- GIVEN `spec/archive/2026-04-06-some-change/` exists but contains no `design.md`
- AND all other sources are present
- WHEN `generator.generate(['architecture'])` is called
- THEN `result.generated` includes the architecture doc path
- AND `result.warnings` contains an entry referencing the missing `design.md`
- AND generation does not throw

### Scenario: Subset generation via types argument

- GIVEN all source files are present
- WHEN `generator.generate(['changelog'])` is called
- THEN only `changelog.md` is written to the output directory
- AND `result.generated` has length 1
- AND `architecture.md`, `api.md`, and `getting-started.md` are not written

---

## Requirement: Architecture Doc

The architecture doc MUST be generated from two sources: `spec/specs/<capability>/spec.md` files (for the component list) and `spec/archive/*/design.md` files (for ADRs and system design sections).

The generated `architecture.md` MUST include the following sections in order:
1. A component list derived from all capability directories found under `spec/specs/`
2. Architectural Decision Records, one sub-section per ADR found in any `design.md` under `spec/archive/`
3. A system design section containing component diagram blocks extracted from `design.md` files

Each ADR entry MUST include: the ADR title, the decision, and the rationale as found in the source file.

Each component entry MUST include the capability name (directory name under `spec/specs/`) and the first `##` heading found in that capability's `spec.md` as a human-readable label.

Archive `design.md` files MUST be processed in reverse chronological order based on the archive directory name prefix (`YYYY-MM-DD`).

### Scenario: Architecture doc with two archive entries

- GIVEN `spec/archive/2026-04-06-fix-gap/design.md` contains `### ADR-1: Skill-orchestrated pipeline`
- AND `spec/archive/2026-04-05-add-auth/design.md` contains `### ADR-1: JWT-based tokens`
- AND `spec/specs/` contains directories `artifact-store` and `workflow-engine`
- WHEN `generator.generate(['architecture'])` is called
- THEN `architecture.md` lists `artifact-store` and `workflow-engine` as components
- AND the ADR from `2026-04-06-fix-gap` appears before the ADR from `2026-04-05-add-auth`

### Scenario: Architecture doc with no archive entries

- GIVEN `spec/archive/` is empty
- AND `spec/specs/` contains two capability directories
- WHEN `generator.generate(['architecture'])` is called
- THEN `architecture.md` is written with the component list section populated
- AND the ADR section is present with a note indicating no ADRs are recorded yet
- AND generation does not fail

---

## Requirement: API Doc

The API doc MUST be generated exclusively from `spec/specs/<capability>/spec.md` files.

The generated `api.md` MUST include one section per capability directory found under `spec/specs/`. Each capability section MUST list:
- All `## Requirement:` headings found in the spec file as named requirements
- All `### Scenario:` headings found in the spec file as named scenarios associated with their parent requirement

Requirements MUST appear in the order they appear within the source spec file. Capabilities MUST be listed in lexicographic order by directory name.

The API doc MUST NOT include design decisions, task lists, or archive data.

### Scenario: API doc for two capabilities

- GIVEN `spec/specs/artifact-store/spec.md` contains two `## Requirement:` headings and three `### Scenario:` headings total
- AND `spec/specs/workflow-engine/spec.md` contains one `## Requirement:` heading and two `### Scenario:` headings
- WHEN `generator.generate(['api'])` is called
- THEN `api.md` contains a section for `artifact-store` appearing before `workflow-engine`
- AND the artifact-store section lists two requirements
- AND each requirement lists its associated scenarios

### Scenario: API doc capability with no scenarios

- GIVEN `spec/specs/schemas/spec.md` contains one `## Requirement:` heading and no `### Scenario:` headings
- WHEN `generator.generate(['api'])` is called
- THEN the schemas section in `api.md` lists the requirement
- AND no scenario sub-items appear for that requirement
- AND no error or warning is emitted

---

## Requirement: Changelog Doc

The changelog doc MUST be generated from `summary.md` files found under `spec/archive/*/`.

Archive entries MUST be processed in reverse chronological order based on the `YYYY-MM-DD` prefix of the archive directory name. Entries with the same date prefix MUST be listed in reverse lexicographic order by full directory name.

Each changelog entry MUST include:
- The date extracted from the directory name prefix
- The change name (the remainder of the directory name after the date prefix and first hyphen)
- The full content of the `summary.md` file, rendered as-is under a `###` heading

The changelog doc MUST NOT include design rationale, ADRs, or spec requirement text.

### Scenario: Changelog with three archive entries across two dates

- GIVEN archive entries: `2026-04-06-fix-gap`, `2026-04-06-add-auth`, `2026-04-05-bootstrap`
- AND each entry contains a non-empty `summary.md`
- WHEN `generator.generate(['changelog'])` is called
- THEN the two `2026-04-06` entries appear before the `2026-04-05` entry
- AND within `2026-04-06`, `fix-gap` appears after `add-auth` (reverse lex: `fix-gap` > `add-auth`)
- AND each entry shows the correct date and change name

### Scenario: Archive entry with missing summary.md

- GIVEN `spec/archive/2026-04-06-orphan-change/` exists but contains no `summary.md`
- AND two other archive entries have valid `summary.md` files
- WHEN `generator.generate(['changelog'])` is called
- THEN `changelog.md` is written with the two valid entries
- AND `result.warnings` contains an entry referencing the missing `summary.md`
- AND the orphan entry is omitted from the output

---

## Requirement: Getting-Started Doc

The getting-started doc MUST be generated exclusively from `spec/project.md`.

The generated `getting-started.md` MUST include the following sections extracted from `spec/project.md`:
- Project description (content under the first `## Project` heading)
- Stack (content under the `## Stack` heading)
- Conventions (content under the `## Conventions` heading)
- Architectural constraints (content under the `## Architectural Constraints` heading, if present)
- Quick-start commands: a fixed code block listing `metta propose`, `metta execute`, `metta finalize`, and `metta ship` with one-line descriptions for each

The quick-start commands block MUST be sourced from the template file (`dist/templates/docs/getting-started.md.hbs`), not from `spec/project.md`, since `spec/project.md` does not contain CLI invocation examples.

If a section heading is absent from `spec/project.md`, the corresponding section MUST be omitted from the output without emitting an error. A warning MUST be recorded in `result.warnings`.

### Scenario: Full project.md with all sections present

- GIVEN `spec/project.md` contains `## Project`, `## Stack`, `## Conventions`, and `## Architectural Constraints` headings
- WHEN `generator.generate(['getting-started'])` is called
- THEN `getting-started.md` contains all four extracted sections plus the quick-start commands block
- AND `result.warnings` is empty

### Scenario: project.md missing Architectural Constraints section

- GIVEN `spec/project.md` contains `## Project`, `## Stack`, and `## Conventions` but no `## Architectural Constraints`
- WHEN `generator.generate(['getting-started'])` is called
- THEN `getting-started.md` is written without an architectural constraints section
- AND `result.warnings` contains one entry noting the absent heading
- AND the remaining sections are present and correct

---

## Requirement: CLI Command

The command `metta docs generate [type] [--dry-run]` MUST be registered in `src/cli/index.ts` alongside the other registered commands.

The `[type]` positional argument MUST accept one of `architecture`, `api`, `changelog`, or `getting-started`. When omitted, all types enabled in `DocsConfig.types` MUST be generated.

The `--dry-run` flag MUST cause the generator to compute what would be written and print a diff-style summary to stdout without writing any files to disk. In dry-run mode, `result.generated` MUST contain the paths that would have been written, and no files MUST be created or modified.

The command MUST read `DocsConfig` from the project config file (`.metta/config.yaml` under the `docs` key) using the existing `ConfigLoader`. When no `docs` key is present, defaults from `DocsConfigSchema` MUST apply: `output: './docs'`, `generate_on: 'finalize'`, `types: ['architecture', 'api', 'changelog', 'getting-started']`.

On success, the command MUST print the list of files written (or that would be written, in dry-run mode) to stdout, one path per line. On failure, it MUST print a human-readable error to stderr and exit with code 4.

### Scenario: Successful full generation via CLI

- GIVEN the project has valid `spec/specs/` and `spec/archive/` trees
- AND no `docs` key is present in `.metta/config.yaml`
- WHEN `metta docs generate` is executed
- THEN the command exits with code 0
- AND stdout lists four file paths: `./docs/architecture.md`, `./docs/api.md`, `./docs/changelog.md`, `./docs/getting-started.md`
- AND all four files exist on disk after the command completes

### Scenario: Dry-run prints diff without writing files

- GIVEN `./docs/api.md` does not exist on disk
- WHEN `metta docs generate api --dry-run` is executed
- THEN the command exits with code 0
- AND stdout shows what would be written to `./docs/api.md`
- AND `./docs/api.md` does not exist on disk after the command completes

### Scenario: Unknown type argument rejected

- GIVEN the user runs `metta docs generate foobar`
- WHEN the command is executed
- THEN the command exits with a non-zero code
- AND stderr contains a message indicating that `foobar` is not a valid doc type

---

## Requirement: Auto-Trigger on Finalize

When `DocsConfig.generate_on` equals `'finalize'`, the `Finalizer` class MUST invoke `DocGenerator.generate()` after the archive step (step 3 in `Finalizer.finalize()`) and before returning the `FinalizeResult`.

The `Finalizer` MUST populate `FinalizeResult.docsGenerated` with the list of file paths written by the generator.

If doc generation throws or returns warnings, the `Finalizer` MUST NOT fail the finalize operation. It MUST log a warning and set `docsGenerated` to the partial or empty list returned. The finalize MUST complete and return with `gatesPassed: true` and a valid `archiveName` regardless of doc generation errors.

When `DocsConfig.generate_on` is `'verify'` or `'manual'`, the `Finalizer` MUST skip doc generation entirely and leave `docsGenerated` as an empty array.

When `DocsConfig` is absent from the project config, the `Finalizer` MUST apply the default `generate_on: 'finalize'` and generate docs.

### Scenario: Docs generated automatically on finalize

- GIVEN `DocsConfig.generate_on` is `'finalize'`
- AND all source spec files are present and valid
- WHEN `finalizer.finalize(changeName)` is called and completes successfully
- THEN `result.docsGenerated` is a non-empty array containing the paths of the generated files
- AND the generated files exist on disk under `DocsConfig.output`

### Scenario: Doc generation failure does not block finalize

- GIVEN `DocsConfig.generate_on` is `'finalize'`
- AND `spec/project.md` is corrupted and unreadable
- WHEN `finalizer.finalize(changeName)` is called
- THEN `result.archiveName` is non-empty (archive completed)
- AND `result.gatesPassed` is `true`
- AND `result.docsGenerated` is empty or a partial list
- AND the finalizer does not throw

### Scenario: generate_on manual skips doc generation during finalize

- GIVEN `DocsConfig.generate_on` is `'manual'`
- WHEN `finalizer.finalize(changeName)` is called
- THEN `result.docsGenerated` is an empty array
- AND no files are written to `DocsConfig.output` by the finalizer

---

## Requirement: Doc Headers

Every file written by `DocGenerator` MUST begin with a metta-managed HTML comment header block as the first content of the file, before any Markdown headings or body text.

The header MUST contain exactly three comment lines:
1. `<!-- Generated by Metta — do not edit directly -->`
2. `<!-- Source: <comma-separated list of source paths relative to project root> -->`
3. `<!-- Run \`metta docs generate\` to regenerate -->`

The source paths listed on line 2 MUST reflect the actual files read to produce that specific doc type. For the architecture doc, this MUST include all `spec/specs/<capability>/spec.md` and `spec/archive/*/design.md` paths that were successfully read. For the changelog doc, this MUST include all `spec/archive/*/summary.md` paths read.

If source path lists exceed a reasonable line length (more than 120 characters), paths MAY be truncated with a `...and N more` suffix rather than wrapping onto multiple lines.

The header MUST be reproduced verbatim on every regeneration. Existing header content from a prior run MUST be replaced, not appended.

### Scenario: Header written on first generation

- GIVEN `./docs/api.md` does not exist
- WHEN `generator.generate(['api'])` is called
- THEN the first three lines of `./docs/api.md` are the three-line HTML comment block
- AND line 1 is exactly `<!-- Generated by Metta — do not edit directly -->`
- AND line 3 is exactly `<!-- Run \`metta docs generate\` to regenerate -->`

### Scenario: Header overwrites manually edited header on regeneration

- GIVEN `./docs/changelog.md` exists and its first line has been manually changed to `<!-- custom note -->`
- WHEN `generator.generate(['changelog'])` is called
- THEN the file is overwritten
- AND the first line is `<!-- Generated by Metta — do not edit directly -->`
- AND the manually added note is no longer present

### Scenario: Source paths reflect actual files read

- GIVEN generation reads `spec/specs/artifact-store/spec.md` and `spec/specs/workflow-engine/spec.md`
- WHEN `generator.generate(['api'])` is called
- THEN line 2 of `api.md` contains `spec/specs/artifact-store/spec.md` and `spec/specs/workflow-engine/spec.md`

---

## Out of Scope

- AI provider calls during generation. All content is derived from parsing existing Markdown files. No summarization, elaboration, or inference via LLM.
- HTML, PDF, or OpenAPI output formats. Only `.md` files are produced.
- Watch mode or file-system event triggers. Generation fires only on explicit CLI invocation or on the finalize lifecycle event.
- Versioned doc snapshots per release or git tag.
- Plugin-defined or custom doc types beyond the four defined (`architecture`, `api`, `changelog`, `getting-started`).
- Preservation of manual edits to generated files. Files carrying the metta-managed header will be overwritten on the next `generate` call.
- Doc generation during `metta ship`. Generation fires at finalize only.
- Interactive review or approval gates for generated docs.
- Modification of files in `docs/` that do not match one of the four managed file names. Unmanaged files in the output directory are left untouched.
