# uat-document-generation-at-finalize-every-finalized-change — User Stories

## US-1: Accepting owner receives a followable UAT script at finalize

**As a** project owner accepting a finished feature
**I want to** receive a step-by-step UAT.md acceptance script automatically when a change finalizes
**So that** I can verify what was built by following observable steps instead of reverse-engineering acceptance from stories.md, spec.md, and summary prose
**Priority:** P1
**Independent Test Criteria:** Running `metta finalize` on a standard change with parsed stories succeeds and leaves a UAT.md in the change directory (swept to the archive) containing numbered steps with what-to-do text, what-you-should-observe text, and a checkbox per step.

**Acceptance Criteria:**
- **Given** a standard-tier change whose stories.md parses to kind 'stories' and whose gates pass **When** `metta finalize` runs to completion **Then** a UAT.md is generated deterministically (no AI call) from stories.md acceptance criteria and spec.md scenarios, rendered through the TemplateEngine from the external template `src/templates/artifacts/uat.md`
- **Given** a generated UAT.md **When** the owner reads any step **Then** the step states what to do (derived from Independent Test Criteria, including named CLI invocations where present), what to observe (derived from Then clauses), and provides a checkbox to record the result
- **Given** a generated UAT.md **When** the owner reads the header **Then** it records the change name, the generation date, and instructions to report failures by logging a metta issue
- **Given** a finalize run that fails before completion (gates fail or spec merge fails) **When** the run aborts **Then** no stray UAT.md is left in the change directory

---

## US-2: Fresh AI agent verifies a build via story-grouped steps with machine-verified annotations

**As an** AI agent in a fresh session asked to verify a completed build
**I want to** follow UAT steps grouped by user story, with annotations marking which scenarios were already machine-verified
**So that** I can focus manual verification effort on unverified behavior and trace every step back to the story it fulfills
**Priority:** P1
**Independent Test Criteria:** Opening the generated UAT.md for a finalized standard change shows steps grouped under US-N story headings, with a best-effort "machine-verified" annotation on steps whose scenarios are already covered per gates.yaml and summary.md.

**Acceptance Criteria:**
- **Given** a change with multiple user stories **When** UAT.md is generated **Then** steps are numbered and grouped by user story so each step is traceable to its originating US-N
- **Given** a scenario already covered by gate runs or verification evidence recorded in gates.yaml and summary.md **When** the assembler builds the corresponding step **Then** the step carries a machine-verified annotation
- **Given** a scenario with no machine verification coverage **When** the assembler builds the corresponding step **Then** the step carries no machine-verified annotation, signaling it needs manual confirmation

---

## US-3: Quick and trivial changes still get a reduced UAT script

**As a** project owner accepting a quick-mode or trivial fix
**I want to** receive a reduced UAT script even when the change has no user stories or only a sentinel stories.md
**So that** every finalized change hands me something followable — UAT generation is never silently skipped
**Priority:** P2
**Independent Test Criteria:** Running `metta finalize` on a quick-tier change with a sentinel stories.md produces a UAT.md built from spec.md scenarios, or — when no scenarios exist — from intent.md Proposal bullets plus summary.md highlights.

**Acceptance Criteria:**
- **Given** a quick/trivial change whose stories.md is absent or is a sentinel (does not parse to kind 'stories') and whose spec.md contains scenarios **When** finalize generates UAT.md **Then** the reduced script is assembled from the spec.md scenarios
- **Given** a quick/trivial change with no stories and no spec.md scenarios **When** finalize generates UAT.md **Then** the reduced script falls back to intent.md Proposal bullets and summary.md highlights
- **Given** any change of any tier with UAT generation enabled **When** finalize completes successfully **Then** a UAT.md exists — generation is never skipped entirely due to tier

---

## US-4: Maintainer can disable UAT generation via config

**As a** project maintainer configuring metta
**I want to** toggle UAT generation off with a `uat.enabled` setting in `.metta/config.yaml`, validated by a strict Zod schema
**So that** projects that do not want acceptance scripts can opt out cleanly without patching the finalize flow
**Priority:** P2
**Independent Test Criteria:** With `uat.enabled: false` set in `.metta/config.yaml`, `metta finalize` completes successfully without writing a UAT.md, while omitting the key entirely defaults generation to on.

**Acceptance Criteria:**
- **Given** `.metta/config.yaml` sets `uat.enabled: false` **When** finalize runs to completion **Then** no UAT.md is generated and finalize otherwise behaves normally
- **Given** `.metta/config.yaml` omits the `uat` section **When** finalize runs to completion **Then** UAT.md is generated, because the default is enabled
- **Given** a `uat` config block with an invalid value or unknown key **When** config is loaded **Then** the strict UatConfigSchema rejects it with a validation error rather than silently accepting it

---

## US-5: Finalize output surfaces the generated UAT path

**As a** project owner (or orchestrating agent) running finalize
**I want to** see the path of the generated UAT.md in the finalize success output, in both human-readable and `--json` forms
**So that** I can immediately locate and hand off the acceptance script without hunting through the archive
**Priority:** P2
**Independent Test Criteria:** A successful `metta finalize` prints a human-readable line containing the generated UAT.md path, and `metta finalize --json` includes a field carrying that same path.

**Acceptance Criteria:**
- **Given** a successful finalize with UAT generation enabled **When** output is rendered in human mode **Then** a line reports the path where UAT.md was written
- **Given** a successful finalize with UAT generation enabled **When** output is rendered with `--json` **Then** the JSON payload includes a field with the UAT.md path
- **Given** a successful finalize with `uat.enabled: false` **When** output is rendered **Then** no UAT path is reported (or the JSON field reflects that generation was skipped)

---

## US-6: Auditor finds the UAT script preserved in the archive

**As a** maintainer auditing an archived change later
**I want to** find the UAT.md swept into `spec/archive/<date>-<name>/` alongside the change's other artifacts
**So that** I can review or re-run the acceptance script months later without reconstructing it
**Priority:** P3
**Independent Test Criteria:** After a successful finalize, inspecting `spec/archive/<date>-<name>/` shows UAT.md present next to intent.md, stories.md, spec.md, and summary.md.

**Acceptance Criteria:**
- **Given** finalize writes UAT.md into `spec/changes/<name>/` after gates pass and after the real spec merge, immediately before archive **When** the archive move runs **Then** UAT.md lands in `spec/archive/<date>-<name>/` with the rest of the change artifacts
- **Given** an archived change with a UAT.md **When** an auditor opens it later **Then** the header still identifies the change name and generation date so the script is self-describing without the live change context
