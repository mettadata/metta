# finalize-ship

## ADDED: Requirement: UAT Script Generation At Finalize

`Finalizer.finalize` MUST generate a `UAT.md` acceptance script for the change being finalized, positioned in the finalize order after the gate-execution step has passed and after the real (non-dry-run) spec merge has been written, and immediately before the archive step moves the change directory. The file MUST be written to `spec/changes/<name>/UAT.md` so that the existing archive move sweeps it into `spec/archive/<date>-<name>/` alongside `intent.md`, `stories.md`, `spec.md`, `summary.md`, and `gates.yaml`. Generation MUST be deterministic assembly from the change's on-disk artifacts: the generator MUST NOT invoke any AI provider, and two runs over identical artifact inputs (holding the generation date fixed) MUST produce byte-identical output. The `FinalizeResult` returned by `Finalizer.finalize` MUST gain a field reporting the path where `UAT.md` was written.
Fulfills: US-1, US-6

### Scenario: Successful finalize writes UAT.md into the change directory before archive
- GIVEN a standard-tier change with all required artifacts complete, a clean delta, and passing gates
- WHEN `metta finalize` runs to completion
- THEN a `UAT.md` is written into `spec/changes/<name>/` after the spec merge and before `artifactStore.archive` runs
- AND the returned `FinalizeResult` carries the generated UAT path

### Scenario: Archive sweep carries UAT.md into the archive directory
- GIVEN a finalize run that generated `UAT.md` in `spec/changes/<name>/`
- WHEN the archive step moves the change directory
- THEN `spec/archive/<date>-<name>/UAT.md` exists next to `intent.md`, `stories.md`, `spec.md`, and `summary.md`

### Scenario: Generation is deterministic with no AI call
- GIVEN a fixed set of change artifacts and a fixed generation date
- WHEN the UAT generator is invoked twice over the same inputs
- THEN both runs produce byte-identical `UAT.md` content
- AND no AI provider client is constructed or called during generation

## ADDED: Requirement: No Stray UAT On Failed Finalize Paths

A finalize run that exits on any failure or non-writing path — incomplete artifacts, spec-merge conflict, gate failure, or dry-run mode — MUST NOT create a `UAT.md` in the change directory. UAT generation MUST be unreachable before the artifact-completeness check, conflict detection, and gate execution have all passed, and MUST be skipped entirely in dry-run mode, so no failed or simulated finalize ever leaves a stray acceptance script behind.
Fulfills: US-1

### Scenario: Incomplete artifacts abort before UAT generation
- GIVEN an active change with a workflow-required artifact not marked `complete`
- WHEN `metta finalize` runs and fails the artifact-completeness check
- THEN no `UAT.md` exists in `spec/changes/<name>/` after the run

### Scenario: Merge conflict aborts before UAT generation
- GIVEN a change whose delta conflicts with the current capability spec lock
- WHEN `metta finalize` runs and returns a conflict result
- THEN no `UAT.md` exists in `spec/changes/<name>/` after the run

### Scenario: Gate failure aborts before UAT generation
- GIVEN a change with a configured gate that will fail
- WHEN `metta finalize` runs and reports the gate failure
- THEN no `UAT.md` exists in `spec/changes/<name>/` after the run

### Scenario: Dry-run finalize writes no UAT.md
- GIVEN a fully complete change that would finalize cleanly
- WHEN `metta finalize` runs in dry-run mode
- THEN no `UAT.md` is written to `spec/changes/<name>/`
- AND the change remains in the active changes list unchanged

## ADDED: Requirement: UAT Source Material Assembly

The UAT generator MUST assemble step content from the change's structured artifacts using the existing parsers, consumed read-only: user-story acceptance criteria (Given/When/Then) and Independent Test Criteria MUST be read from `stories.md` via the existing stories parser (`parseStories`), and additional scenario coverage MUST be read from `spec.md` via the existing spec parser (`parseSpec` / `parseDeltaSpec`). The generator MUST consult `summary.md` and `gates.yaml` as the record of machine verification in order to annotate steps whose scenarios are already machine-covered; this cross-referencing is best-effort — when an annotation is not derivable from those sources for a given step, the annotation MUST simply be absent, and its absence MUST NOT fail or degrade generation. The generator MUST NOT modify the behavior of `parseStories`, `parseSpec`, `parseDeltaSpec`, or any source artifact.
Fulfills: US-1, US-2

### Scenario: Stories and spec scenarios feed the generated steps
- GIVEN a change whose `stories.md` parses to kind `stories` with acceptance criteria and Independent Test Criteria, and whose `spec.md` contains scenarios
- WHEN `UAT.md` is generated
- THEN each generated step's what-to-do text derives from Independent Test Criteria (including named CLI invocations where present) and its what-to-observe text derives from the THEN clauses of the corresponding acceptance criteria or spec scenarios

### Scenario: Machine-verified annotation applied when derivable
- GIVEN a step whose scenario is covered by evidence recorded in `gates.yaml` or `summary.md`, cross-referenced by requirement or story id
- WHEN the assembler builds that step
- THEN the step carries a machine-verified annotation referencing the covering evidence

### Scenario: Annotation absent when not derivable, without error
- GIVEN a step whose scenario has no matching coverage derivable from `gates.yaml` or `summary.md` (including when either file is missing)
- WHEN the assembler builds that step
- THEN the step carries no machine-verified annotation
- AND generation completes without error

## ADDED: Requirement: UAT Document Format

The generated `UAT.md` MUST open with a header recording the change name, the generation date, and failure-reporting instructions directing the reader to log a metta issue for any failed step. The body MUST consist of numbered steps grouped under headings for the user stories they derive from (identified by story id, e.g. `US-1`), so every step is traceable to its originating story. Each step MUST contain: what to do, what the reader should observe (derived from THEN clauses), and a markdown checkbox (`- [ ]`) for recording the result. Steps whose scenarios are machine-verified per the UAT Source Material Assembly requirement MUST additionally carry the machine-verified annotation.
Fulfills: US-1, US-2, US-6

### Scenario: Header is self-describing for later audit
- GIVEN a generated `UAT.md`, read either from the live change directory or months later from `spec/archive/<date>-<name>/`
- WHEN the reader opens the header
- THEN it states the change name, the generation date, and instructions to report failures by logging a metta issue, with no dependency on live change context

### Scenario: Steps are numbered, story-grouped, and checkable
- GIVEN a change with multiple user stories
- WHEN `UAT.md` is generated
- THEN steps appear numbered under per-story group headings identified by US-N
- AND every step contains what-to-do text, what-to-observe text, and a markdown checkbox `- [ ]`

## ADDED: Requirement: UAT Tier Fallback Chain

When UAT generation is enabled, the generator MUST select its source tier by this fallback chain and MUST NOT skip generation entirely for any tier: (1) when `stories.md` exists and parses to kind `stories`, the full story-grouped script MUST be produced; (2) when `stories.md` is absent or is a sentinel document (does not parse to kind `stories`) and `spec.md` contains scenarios, a reduced script MUST be assembled from the `spec.md` scenarios; (3) when neither parsed stories nor spec scenarios are available, a reduced script MUST be assembled from the `intent.md` Proposal bullets plus `summary.md` highlights. In every enabled case a `UAT.md` MUST exist after a successful finalize.
Fulfills: US-3

### Scenario: Parsed stories produce the full story-grouped script
- GIVEN a change whose `stories.md` parses to kind `stories`
- WHEN finalize generates `UAT.md`
- THEN the full script is produced with steps grouped by user story

### Scenario: Sentinel stories fall back to spec scenarios
- GIVEN a quick-tier change whose `stories.md` is a sentinel document that does not parse to kind `stories`, and whose `spec.md` contains scenarios
- WHEN finalize generates `UAT.md`
- THEN the reduced script is assembled from the `spec.md` scenarios

### Scenario: No stories and no spec scenarios fall back to intent plus summary
- GIVEN a trivial change with no parseable stories and no `spec.md` scenarios
- WHEN finalize generates `UAT.md`
- THEN the reduced script is assembled from the `intent.md` Proposal bullets and `summary.md` highlights

### Scenario: Generation is never skipped by tier when enabled
- GIVEN any change of any tier with UAT generation enabled
- WHEN `metta finalize` completes successfully
- THEN a `UAT.md` exists in the archived change directory

## ADDED: Requirement: UAT Configuration Toggle

The project config MUST gain a `uat` section validated by a strict Zod `UatConfigSchema` (mirroring `DocsConfigSchema`) registered on the strict `ProjectConfigSchema` in `src/schemas/project-config.ts`, with a single field `enabled` of type boolean defaulting to `true`. `ConfigLoader` MUST supply the parsed `uat` config to the finalizer the same way `config.docs` is read today. When `uat.enabled` is `false`, finalize MUST skip UAT generation entirely — no `UAT.md` is written and no UAT path is reported — while all other finalize behavior proceeds unchanged. Existing `.metta/config.yaml` files that omit the `uat` key MUST remain valid, with generation defaulting to enabled. The schema MUST reject unknown keys within the `uat` block and non-boolean `enabled` values with a validation error rather than silently accepting them.
Fulfills: US-4

### Scenario: Disabled toggle skips generation cleanly
- GIVEN `.metta/config.yaml` sets `uat.enabled: false`
- WHEN `metta finalize` runs to completion on a complete change
- THEN finalize succeeds, no `UAT.md` is written to the change directory or archive, and all other finalize behavior is unchanged

### Scenario: Omitted uat key defaults to enabled
- GIVEN `.metta/config.yaml` with no `uat` section
- WHEN config is loaded and `metta finalize` runs to completion
- THEN config validation passes and a `UAT.md` is generated

### Scenario: Invalid uat config is rejected strictly
- GIVEN a `uat` config block containing an unknown key or a non-boolean `enabled` value
- WHEN config is loaded
- THEN `UatConfigSchema` rejects it with a Zod validation error
- AND the invalid value is not silently coerced or ignored

## ADDED: Requirement: UAT Path In Finalize Output

The finalize success output in `src/cli/commands/finalize.ts` MUST surface the generated UAT path in both output modes. In `--json` mode the success payload MUST gain an additive `uatPath` field: a string containing the generated `UAT.md` path when generation succeeded, and `null` when generation was disabled via `uat.enabled: false` or degraded per the UAT Generation Failure Degradation requirement. All pre-existing success-payload fields MUST be unchanged, and the error JSON shapes (`incomplete_artifacts`, `conflict`, `gates_failed`, `finalize_locked`, `finalize_error`) MUST NOT be modified. In human-readable mode, a successful finalize with generation enabled MUST print a line reporting the path where `UAT.md` was written; when generation is disabled no UAT line is printed.
Fulfills: US-5

### Scenario: JSON success payload carries the UAT path
- GIVEN a successful finalize with UAT generation enabled
- WHEN `metta finalize --json` output is rendered
- THEN the success JSON includes `uatPath` set to the generated `UAT.md` path
- AND all previously existing success fields are present and unchanged

### Scenario: Human output reports the UAT path
- GIVEN a successful finalize with UAT generation enabled
- WHEN output is rendered in human-readable mode
- THEN a line reports the path where `UAT.md` was written

### Scenario: Disabled generation yields null path and no human line
- GIVEN a successful finalize with `uat.enabled: false`
- WHEN output is rendered in `--json` mode and in human mode
- THEN the JSON `uatPath` field is `null` and the human output contains no UAT path line

### Scenario: Error JSON shapes are unchanged
- GIVEN finalize runs that fail with incomplete artifacts, a merge conflict, failed gates, a held lock, or a finalize error
- WHEN `--json` output is rendered for each failure
- THEN each error payload matches its pre-existing shape with no `uatPath` field added

## ADDED: Requirement: UAT Template Externality

The `UAT.md` document MUST be rendered through the existing `TemplateEngine` (`src/templates/template-engine.ts`, single-brace `{key}` substitution) from a new external template file at `src/templates/artifacts/uat.md`, modeled on the existing `verify.md` artifact template. The template content MUST NOT appear as a string literal in TypeScript source. The template MUST be delivered to `dist/templates/artifacts/uat.md` by the existing `copy-templates` build step with no build-script changes, so the generator loads it from the same resolved templates directory as the other artifact templates at runtime.
Fulfills: US-1

### Scenario: Rendering goes through the external template
- GIVEN the UAT generator assembling a document
- WHEN rendering occurs
- THEN the content is produced by `TemplateEngine` substitution over `src/templates/artifacts/uat.md`
- AND no TypeScript source file contains the template body as a string literal

### Scenario: Template ships to dist via the existing copy step
- GIVEN a build of the project
- WHEN the existing `copy-templates` script runs unmodified
- THEN `dist/templates/artifacts/uat.md` exists and matches the source template

## ADDED: Requirement: UAT Generation Failure Degradation

A failure inside UAT assembly or rendering (for example an unreadable source artifact, a parser error, or a missing template file) MUST NOT abort an otherwise-successful finalize: the spec merge, gate results, and archive MUST complete exactly as they would have without the failure. On such a failure the finalizer MUST degrade by continuing without a `UAT.md`, MUST record the failure in the finalize output — a warning line in human-readable mode and, in `--json` mode, `uatPath: null` accompanied by a warning field or message describing the UAT generation failure — and MUST NOT convert the run's exit status to failure. The UAT generation error MUST NOT surface as any of the existing error JSON shapes.
Fulfills: US-1, US-5

### Scenario: Assembly error degrades to a warning, finalize still succeeds
- GIVEN a change that finalizes cleanly except that UAT assembly throws (for example the template file is missing from the resolved templates directory)
- WHEN `metta finalize` runs
- THEN the spec merge is written, gates results are recorded, the change is archived, and the command exits zero
- AND no `UAT.md` is present in the archive

### Scenario: Degraded run reports the failure in output
- GIVEN a finalize run whose UAT generation failed and degraded
- WHEN output is rendered
- THEN human mode prints a warning that UAT generation failed with the reason
- AND `--json` mode reports `uatPath: null` alongside a warning describing the UAT generation failure, while the payload remains the success shape rather than any error shape
