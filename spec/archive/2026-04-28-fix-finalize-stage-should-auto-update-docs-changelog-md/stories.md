# fix-finalize-stage-should-auto-update-docs-changelog-md — User Stories

## US-1: Changelog refreshes on finalize without explicit configuration

**As a** developer adopting metta on a freshly-initialized project
**I want to** have `docs/changelog.md` refreshed automatically when I run `metta finalize`
**So that** my project's changelog stays in sync with the contents of `spec/archive/` without me hand-editing config or doc files
**Priority:** P1
**Independent Test Criteria:** Running `metta finalize` against a project whose `.metta/config.yaml` contains no `docs:` block produces an updated `docs/changelog.md` whose top entry references the just-archived change.

**Acceptance Criteria:**
- **Given** a metta project whose `.metta/config.yaml` does not declare a `docs:` block, and an active change with all artifacts and gates green **When** I run `metta finalize` **Then** `docs/changelog.md` is rewritten so its first entry corresponds to the change just moved into `spec/archive/`.
- **Given** the same project state **When** finalize completes **Then** `docs/architecture.md`, `docs/api.md`, and `docs/getting-started.md` are also regenerated, because the schema-default `docs.types` enables all four.
- **Given** the same project state **When** I open `.metta/config.yaml` after finalize **Then** the file is unchanged — the schema default applies in-memory only.

---

## US-2: Explicit `generate_on: manual` opt-out is preserved

**As a** developer who has chosen to manage changelog updates manually
**I want to** keep `metta finalize` from rewriting my docs when I have explicitly opted out via `docs.generate_on: manual`
**So that** my deliberate configuration is honored and my hand-curated docs are not overwritten
**Priority:** P1
**Independent Test Criteria:** Running `metta finalize` against a project whose `.metta/config.yaml` sets `docs.generate_on: manual` leaves `docs/changelog.md` byte-identical to its pre-finalize state.

**Acceptance Criteria:**
- **Given** a project whose `.metta/config.yaml` declares `docs:\n  generate_on: manual` **When** I run `metta finalize` **Then** `docs/changelog.md` is not modified by the finalizer.
- **Given** the same project state **When** finalize completes **Then** none of `docs/architecture.md`, `docs/api.md`, or `docs/getting-started.md` are rewritten.
- **Given** the same project state **When** finalize is examined for side-effects **Then** the change is still archived to `spec/archive/`, summary merging still runs, and only the `DocGenerator.generate` invocation is bypassed.

---

## US-3: Explicit partial `docs:` block keeps explicit values

**As a** developer who customizes only the `docs.output` path
**I want to** declare `docs.output: ./website/changelog` and have my custom path used while still benefiting from the default `generate_on: finalize` behavior
**So that** I can override one field without restating every default
**Priority:** P2
**Independent Test Criteria:** Running `metta finalize` against a project whose `.metta/config.yaml` sets only `docs.output: ./website` writes the changelog to `./website/changelog.md` (not `./docs/changelog.md`).

**Acceptance Criteria:**
- **Given** a project whose `.metta/config.yaml` declares only `docs:\n  output: ./website` **When** I run `metta finalize` **Then** the changelog is written to `./website/changelog.md`.
- **Given** the same project state **When** the finalizer evaluates the docs guard **Then** `generate_on` resolves to its inner-schema default (`finalize`) and the guard passes.

---

## US-4: First finalize after upgrade does not surprise users

**As a** maintainer of an existing metta project that previously omitted the `docs:` block
**I want to** be informed that my next finalize will produce new doc files
**So that** I can review the new `docs/*.md` outputs as part of my normal change review rather than seeing an unexpected diff
**Priority:** P3
**Independent Test Criteria:** The change summary or release note for this fix mentions the behavior change so users can anticipate the first-finalize doc diff.

**Acceptance Criteria:**
- **Given** the change is shipped to main **When** a user reads the change summary in `spec/archive/` **Then** the summary explicitly states that projects without an explicit `docs:` block will start regenerating `docs/changelog.md` (and the other three doc types) on finalize.
- **Given** a user wants to suppress the new behavior **When** they consult the summary **Then** the summary tells them to set `docs.generate_on: manual` in `.metta/config.yaml`.
