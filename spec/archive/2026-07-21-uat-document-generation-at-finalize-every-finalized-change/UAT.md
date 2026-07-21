# UAT: uat-document-generation-at-finalize-every-finalized-change

- **Change**: uat-document-generation-at-finalize-every-finalized-change
- **Generated**: 2026-07-21
- **Source**: user stories (stories.md)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
Do not edit this document to make a step pass.

## Acceptance steps

### US-1: Accepting owner receives a followable UAT script at finalize

*Independent test:* Running `metta finalize` on a standard change with parsed stories succeeds and leaves a UAT.md in the change directory (swept to the archive) containing numbered steps with what-to-do text, what-you-should-observe text, and a checkbox per step.

#### Step 1.1
- **Setup**: a standard-tier change whose stories.md parses to kind 'stories' and whose gates pass
- **Do**: `metta finalize` runs to completion (Run: `metta finalize`)
- **Observe**: a UAT.md is generated deterministically (no AI call) from stories.md acceptance criteria and spec.md scenarios, rendered through the TemplateEngine from the external template `src/templates/artifacts/uat.md`
- [ ] Pass

#### Step 1.2
- **Setup**: a generated UAT.md
- **Do**: the owner reads any step
- **Observe**: the step states what to do (derived from Independent Test Criteria, including named CLI invocations where present), what to observe (derived from Then clauses), and provides a checkbox to record the result
- [ ] Pass

#### Step 1.3
- **Setup**: a generated UAT.md
- **Do**: the owner reads the header
- **Observe**: it records the change name, the generation date, and instructions to report failures by logging a metta issue
- [ ] Pass

#### Step 1.4
- **Setup**: a finalize run that fails before completion (gates fail or spec merge fails)
- **Do**: the run aborts
- **Observe**: no stray UAT.md is left in the change directory
- [ ] Pass

### US-2: Fresh AI agent verifies a build via story-grouped steps with machine-verified annotations

*Independent test:* Opening the generated UAT.md for a finalized standard change shows steps grouped under US-N story headings, with a best-effort "machine-verified" annotation on steps whose scenarios are already covered per gates.yaml and summary.md.

#### Step 2.1
- **Setup**: a change with multiple user stories
- **Do**: UAT.md is generated
- **Observe**: steps are numbered and grouped by user story so each step is traceable to its originating US-N
- [ ] Pass

#### Step 2.2
- **Setup**: a scenario already covered by gate runs or verification evidence recorded in gates.yaml and summary.md
- **Do**: the assembler builds the corresponding step
- **Observe**: the step carries a machine-verified annotation
- [ ] Pass

#### Step 2.3
- **Setup**: a scenario with no machine verification coverage
- **Do**: the assembler builds the corresponding step
- **Observe**: the step carries no machine-verified annotation, signaling it needs manual confirmation
- [ ] Pass

### US-3: Quick and trivial changes still get a reduced UAT script

*Independent test:* Running `metta finalize` on a quick-tier change with a sentinel stories.md produces a UAT.md built from spec.md scenarios, or — when no scenarios exist — from intent.md Proposal bullets plus summary.md highlights.

#### Step 3.1
- **Setup**: a quick/trivial change whose stories.md is absent or is a sentinel (does not parse to kind 'stories') and whose spec.md contains scenarios
- **Do**: finalize generates UAT.md (Run: `metta finalize`)
- **Observe**: the reduced script is assembled from the spec.md scenarios
- [ ] Pass

#### Step 3.2
- **Setup**: a quick/trivial change with no stories and no spec.md scenarios
- **Do**: finalize generates UAT.md
- **Observe**: the reduced script falls back to intent.md Proposal bullets and summary.md highlights
- [ ] Pass

#### Step 3.3
- **Setup**: any change of any tier with UAT generation enabled
- **Do**: finalize completes successfully
- **Observe**: a UAT.md exists — generation is never skipped entirely due to tier
- [ ] Pass

### US-4: Maintainer can disable UAT generation via config

*Independent test:* With `uat.enabled: false` set in `.metta/config.yaml`, `metta finalize` completes successfully without writing a UAT.md, while omitting the key entirely defaults generation to on.

#### Step 4.1
- **Setup**: `.metta/config.yaml` sets `uat.enabled: false`
- **Do**: finalize runs to completion (Run: `metta finalize`)
- **Observe**: no UAT.md is generated and finalize otherwise behaves normally
- [ ] Pass

#### Step 4.2
- **Setup**: `.metta/config.yaml` omits the `uat` section
- **Do**: finalize runs to completion
- **Observe**: UAT.md is generated, because the default is enabled
- [ ] Pass

#### Step 4.3
- **Setup**: a `uat` config block with an invalid value or unknown key
- **Do**: config is loaded
- **Observe**: the strict UatConfigSchema rejects it with a validation error rather than silently accepting it
- [ ] Pass

### US-5: Finalize output surfaces the generated UAT path

*Independent test:* A successful `metta finalize` prints a human-readable line containing the generated UAT.md path, and `metta finalize --json` includes a field carrying that same path.

#### Step 5.1
- **Setup**: a successful finalize with UAT generation enabled
- **Do**: output is rendered in human mode (Run: `metta finalize`, `metta finalize --json`)
- **Observe**: a line reports the path where UAT.md was written
- [ ] Pass

#### Step 5.2
- **Setup**: a successful finalize with UAT generation enabled
- **Do**: output is rendered with `--json`
- **Observe**: the JSON payload includes a field with the UAT.md path
- [ ] Pass

#### Step 5.3
- **Setup**: a successful finalize with `uat.enabled: false`
- **Do**: output is rendered
- **Observe**: no UAT path is reported (or the JSON field reflects that generation was skipped)
- [ ] Pass

### US-6: Auditor finds the UAT script preserved in the archive

*Independent test:* After a successful finalize, inspecting `spec/archive/<date>-<name>/` shows UAT.md present next to intent.md, stories.md, spec.md, and summary.md.

#### Step 6.1
- **Setup**: finalize writes UAT.md into `spec/changes/<name>/` after gates pass and after the real spec merge, immediately before archive
- **Do**: the archive move runs
- **Observe**: UAT.md lands in `spec/archive/<date>-<name>/` with the rest of the change artifacts
- [ ] Pass

#### Step 6.2
- **Setup**: an archived change with a UAT.md
- **Do**: an auditor opens it later
- **Observe**: the header still identifies the change name and generation date so the script is self-describing without the live change context
- [ ] Pass

## Additional scenarios

#### Step 7.1: Successful finalize writes UAT.md into the change directory before archive
- **Setup**: a standard-tier change with all required artifacts complete, a clean delta, and passing gates
- **Do**: `metta finalize` runs to completion (Run: `metta finalize`)
- **Observe**: a `UAT.md` is written into `spec/changes/<name>/` after the spec merge and before `artifactStore.archive` runs; the returned `FinalizeResult` carries the generated UAT path
- [ ] Pass

#### Step 7.2: Archive sweep carries UAT.md into the archive directory
- **Setup**: a finalize run that generated `UAT.md` in `spec/changes/<name>/`
- **Do**: the archive step moves the change directory
- **Observe**: `spec/archive/<date>-<name>/UAT.md` exists next to `intent.md`, `stories.md`, `spec.md`, and `summary.md`
- [ ] Pass

#### Step 7.3: Generation is deterministic with no AI call
- **Setup**: a fixed set of change artifacts and a fixed generation date
- **Do**: the UAT generator is invoked twice over the same inputs
- **Observe**: both runs produce byte-identical `UAT.md` content; no AI provider client is constructed or called during generation
- [ ] Pass

#### Step 7.4: Incomplete artifacts abort before UAT generation
- **Setup**: an active change with a workflow-required artifact not marked `complete`
- **Do**: `metta finalize` runs and fails the artifact-completeness check (Run: `metta finalize`)
- **Observe**: no `UAT.md` exists in `spec/changes/<name>/` after the run
- [ ] Pass

#### Step 7.5: Merge conflict aborts before UAT generation
- **Setup**: a change whose delta conflicts with the current capability spec lock
- **Do**: `metta finalize` runs and returns a conflict result (Run: `metta finalize`)
- **Observe**: no `UAT.md` exists in `spec/changes/<name>/` after the run
- [ ] Pass

#### Step 7.6: Gate failure aborts before UAT generation
- **Setup**: a change with a configured gate that will fail
- **Do**: `metta finalize` runs and reports the gate failure (Run: `metta finalize`)
- **Observe**: no `UAT.md` exists in `spec/changes/<name>/` after the run
- [ ] Pass

#### Step 7.7: Dry-run finalize writes no UAT.md
- **Setup**: a fully complete change that would finalize cleanly
- **Do**: `metta finalize` runs in dry-run mode (Run: `metta finalize`)
- **Observe**: no `UAT.md` is written to `spec/changes/<name>/`; the change remains in the active changes list unchanged
- [ ] Pass

#### Step 7.8: Stories and spec scenarios feed the generated steps
- **Setup**: a change whose `stories.md` parses to kind `stories` with acceptance criteria and Independent Test Criteria, and whose `spec.md` contains scenarios
- **Do**: `UAT.md` is generated
- **Observe**: each generated step's what-to-do text derives from Independent Test Criteria (including named CLI invocations where present) and its what-to-observe text derives from the THEN clauses of the corresponding acceptance criteria or spec scenarios
- [ ] Pass

#### Step 7.9: Machine-verified annotation applied when derivable
- **Setup**: a step whose scenario is covered by evidence recorded in `gates.yaml` or `summary.md`, cross-referenced by requirement or story id
- **Do**: the assembler builds that step
- **Observe**: the step carries a machine-verified annotation referencing the covering evidence
- [ ] Pass

#### Step 7.10: Annotation absent when not derivable, without error
- **Setup**: a step whose scenario has no matching coverage derivable from `gates.yaml` or `summary.md` (including when either file is missing)
- **Do**: the assembler builds that step
- **Observe**: the step carries no machine-verified annotation; generation completes without error
- [ ] Pass

#### Step 7.11: Header is self-describing for later audit
- **Setup**: a generated `UAT.md`, read either from the live change directory or months later from `spec/archive/<date>-<name>/`
- **Do**: the reader opens the header
- **Observe**: it states the change name, the generation date, and instructions to report failures by logging a metta issue, with no dependency on live change context
- [ ] Pass

#### Step 7.12: Steps are numbered, story-grouped, and checkable
- **Setup**: a change with multiple user stories
- **Do**: `UAT.md` is generated
- **Observe**: steps appear numbered under per-story group headings identified by US-N; every step contains what-to-do text, what-to-observe text, and a markdown checkbox `- [ ]`
- [ ] Pass

#### Step 7.13: Parsed stories produce the full story-grouped script
- **Setup**: a change whose `stories.md` parses to kind `stories`
- **Do**: finalize generates `UAT.md`
- **Observe**: the full script is produced with steps grouped by user story
- [ ] Pass

#### Step 7.14: Sentinel stories fall back to spec scenarios
- **Setup**: a quick-tier change whose `stories.md` is a sentinel document that does not parse to kind `stories`, and whose `spec.md` contains scenarios
- **Do**: finalize generates `UAT.md`
- **Observe**: the reduced script is assembled from the `spec.md` scenarios
- [ ] Pass

#### Step 7.15: No stories and no spec scenarios fall back to intent plus summary
- **Setup**: a trivial change with no parseable stories and no `spec.md` scenarios
- **Do**: finalize generates `UAT.md`
- **Observe**: the reduced script is assembled from the `intent.md` Proposal bullets and `summary.md` highlights
- [ ] Pass

#### Step 7.16: Generation is never skipped by tier when enabled
- **Setup**: any change of any tier with UAT generation enabled
- **Do**: `metta finalize` completes successfully (Run: `metta finalize`)
- **Observe**: a `UAT.md` exists in the archived change directory
- [ ] Pass

#### Step 7.17: Disabled toggle skips generation cleanly
- **Setup**: `.metta/config.yaml` sets `uat.enabled: false`
- **Do**: `metta finalize` runs to completion on a complete change (Run: `metta finalize`)
- **Observe**: finalize succeeds, no `UAT.md` is written to the change directory or archive, and all other finalize behavior is unchanged
- [ ] Pass

#### Step 7.18: Omitted uat key defaults to enabled
- **Setup**: `.metta/config.yaml` with no `uat` section
- **Do**: config is loaded and `metta finalize` runs to completion (Run: `metta finalize`)
- **Observe**: config validation passes and a `UAT.md` is generated
- [ ] Pass

#### Step 7.19: Invalid uat config is rejected strictly
- **Setup**: a `uat` config block containing an unknown key or a non-boolean `enabled` value
- **Do**: config is loaded
- **Observe**: `UatConfigSchema` rejects it with a Zod validation error; the invalid value is not silently coerced or ignored
- [ ] Pass

#### Step 7.20: JSON success payload carries the UAT path
- **Setup**: a successful finalize with UAT generation enabled
- **Do**: `metta finalize --json` output is rendered (Run: `metta finalize --json`)
- **Observe**: the success JSON includes `uatPath` set to the generated `UAT.md` path; all previously existing success fields are present and unchanged
- [ ] Pass

#### Step 7.21: Human output reports the UAT path
- **Setup**: a successful finalize with UAT generation enabled
- **Do**: output is rendered in human-readable mode
- **Observe**: a line reports the path where `UAT.md` was written
- [ ] Pass

#### Step 7.22: Disabled generation yields null path and no human line
- **Setup**: a successful finalize with `uat.enabled: false`
- **Do**: output is rendered in `--json` mode and in human mode
- **Observe**: the JSON `uatPath` field is `null` and the human output contains no UAT path line
- [ ] Pass

#### Step 7.23: Error JSON shapes are unchanged
- **Setup**: finalize runs that fail with incomplete artifacts, a merge conflict, failed gates, a held lock, or a finalize error
- **Do**: `--json` output is rendered for each failure
- **Observe**: each error payload matches its pre-existing shape with no `uatPath` field added
- [ ] Pass

#### Step 7.24: Rendering goes through the external template
- **Setup**: the UAT generator assembling a document
- **Do**: rendering occurs
- **Observe**: the content is produced by `TemplateEngine` substitution over `src/templates/artifacts/uat.md`; no TypeScript source file contains the template body as a string literal
- [ ] Pass

#### Step 7.25: Template ships to dist via the existing copy step
- **Setup**: a build of the project
- **Do**: the existing `copy-templates` script runs unmodified
- **Observe**: `dist/templates/artifacts/uat.md` exists and matches the source template
- [ ] Pass

#### Step 7.26: Assembly error degrades to a warning, finalize still succeeds
- **Setup**: a change that finalizes cleanly except that UAT assembly throws (for example the template file is missing from the resolved templates directory)
- **Do**: `metta finalize` runs (Run: `metta finalize`)
- **Observe**: the spec merge is written, gates results are recorded, the change is archived, and the command exits zero; no `UAT.md` is present in the archive
- [ ] Pass

#### Step 7.27: Degraded run reports the failure in output
- **Setup**: a finalize run whose UAT generation failed and degraded
- **Do**: output is rendered
- **Observe**: human mode prints a warning that UAT generation failed with the reason; `--json` mode reports `uatPath: null` alongside a warning describing the UAT generation failure, while the payload remains the success shape rather than any error shape
- [ ] Pass
