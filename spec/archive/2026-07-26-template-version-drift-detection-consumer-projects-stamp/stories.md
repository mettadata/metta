# template-version-drift-detection-consumer-projects-stamp — User Stories

## US-1: Warn on version drift at every CLI invocation

**As a** developer using metta in a consumer project
**I want to** see a one-line warning whenever the metta binary version differs from the version stamped at install time
**So that** I discover template/asset drift immediately after an upgrade or downgrade instead of debugging subtle misbehavior later

**Priority:** P1
**Independent Test Criteria:** Running any metta command (other than install/init) in a project whose stamped `installed_version` differs from the running binary version prints exactly one stderr warning line and the command still completes normally.

**Acceptance Criteria:**
- **Given** a project with `installed_version: 0.1.0` in `.metta/config.yaml` **When** the developer runs any metta command with binary version 0.2.0 in human mode **Then** a one-line warning naming both versions is printed to stderr and the command proceeds without blocking
- **Given** a project stamped with `installed_version: 0.3.0` **When** the developer runs a command with an older binary version 0.2.0 (downgrade) **Then** the same mismatch warning is emitted, since comparison is exact string inequality
- **Given** a project whose stamped version exactly matches the running binary version **When** any command runs **Then** no drift warning is emitted
- **Given** a mismatched project **When** the developer runs `metta install` or `metta init` **Then** the drift check is skipped and no warning is printed

---

## US-2: Legacy and broken configs stay quiet

**As a** developer using metta in a legacy consumer project installed before version stamping existed
**I want to** run metta commands without drift warnings or errors when the stamp is absent or the config is unreadable
**So that** older projects keep working unchanged and a corrupt config never turns the advisory check into a new failure mode

**Priority:** P2
**Independent Test Criteria:** In a project with no `installed_version` field, and separately in a project with a missing or corrupt `.metta/config.yaml`, every metta command runs with no drift warning and no drift-related error.

**Acceptance Criteria:**
- **Given** a project whose `.metta/config.yaml` lacks the `installed_version` field **When** any command runs **Then** no warning is emitted and the command behaves as before
- **Given** a project with a missing or unparseable `.metta/config.yaml` **When** any command runs **Then** the drift check silently skips and does not add any error or warning of its own

---

## US-3: Machine-readable mismatch signal in --json output

**As an** automation script or CI pipeline consuming metta's `--json` output
**I want to** receive a `template_version_mismatch` object with the installed and running versions when drift exists
**So that** pipelines can detect stale project assets programmatically and fail, alert, or trigger a re-install without scraping stderr text

**Priority:** P2
**Independent Test Criteria:** A `--json` invocation in a drifted project includes `template_version_mismatch: { installed, running }` with the correct version strings, and the key is entirely absent when versions match.

**Acceptance Criteria:**
- **Given** a project stamped `0.1.0` and a running binary `0.2.0` **When** a command runs with `--json` **Then** the JSON output contains `template_version_mismatch` with `installed: "0.1.0"` and `running: "0.2.0"` merged into the normal payload
- **Given** a project whose stamp matches the running binary **When** a command runs with `--json` **Then** the `template_version_mismatch` key is absent from the output
- **Given** a drifted project **When** a command runs with `--json` **Then** the human-mode stderr warning does not corrupt the JSON payload on stdout

---

## US-4: Re-stamping on install clears the warning

**As a** developer using metta in a consumer project
**I want to** have `metta install` (and `metta init`) write the running binary's version into `installed_version` every time they run
**So that** refreshing the project's assets also refreshes the stamp, making the drift warning disappear once assets are actually up to date

**Priority:** P1
**Independent Test Criteria:** After running `metta install` with a new binary in a previously drifted project, `.metta/config.yaml` contains the new version in `installed_version` and subsequent commands emit no drift warning.

**Acceptance Criteria:**
- **Given** a project stamped `0.1.0` and a running binary `0.2.0` **When** the developer runs `metta install` **Then** `installed_version` in `.metta/config.yaml` is overwritten with `0.2.0` via the validated config write path (`setProjectField`)
- **Given** a freshly re-stamped project **When** the developer runs any subsequent metta command **Then** no drift warning appears in human mode and no `template_version_mismatch` key appears in `--json` output
- **Given** a brand-new project with no metta config **When** the developer runs `metta init` **Then** the running binary version is stamped as `installed_version` and the resulting config passes strict ProjectConfigSchema validation

---

## US-5: Doctor reports template freshness

**As a** developer diagnosing a misbehaving consumer project
**I want to** see a "Template freshness" check in `metta doctor` output
**So that** version drift shows up as an explicit, named diagnostic during health checks rather than something I have to infer from behavior

**Priority:** P2
**Independent Test Criteria:** `metta doctor` shows a "Template freshness" check that passes when the stamp matches the running binary and warns when it mismatches or is missing.

**Acceptance Criteria:**
- **Given** a project whose `installed_version` matches the running binary version **When** the developer runs `metta doctor` **Then** the Template freshness check reports pass
- **Given** a project whose `installed_version` differs from the running binary version **When** the developer runs `metta doctor` **Then** the check reports warn and shows both the installed and running versions
- **Given** a legacy project with no `installed_version` stamp **When** the developer runs `metta doctor` **Then** the check reports warn indicating the stamp is missing, without failing the doctor run
