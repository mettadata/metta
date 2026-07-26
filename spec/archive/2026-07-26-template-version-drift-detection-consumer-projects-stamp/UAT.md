# UAT: template-version-drift-detection-consumer-projects-stamp

- **Change**: template-version-drift-detection-consumer-projects-stamp
- **Generated**: 2026-07-26
- **Source**: user stories (stories.md)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

### US-1: Warn on version drift at every CLI invocation

*Independent test:* Running any metta command (other than install/init) in a project whose stamped `installed_version` differs from the running binary version prints exactly one stderr warning line and the command still completes normally.

#### Step 1.1
- **Setup**: a project with `installed_version: 0.1.0` in `.metta/config.yaml`
- **Do**: the developer runs any metta command with binary version 0.2.0 in human mode
- **Observe**: a one-line warning naming both versions is printed to stderr and the command proceeds without blocking
- [ ] Pass

#### Step 1.2
- **Setup**: a project stamped with `installed_version: 0.3.0`
- **Do**: the developer runs a command with an older binary version 0.2.0 (downgrade)
- **Observe**: the same mismatch warning is emitted, since comparison is exact string inequality
- [ ] Pass

#### Step 1.3
- **Setup**: a project whose stamped version exactly matches the running binary version
- **Do**: any command runs
- **Observe**: no drift warning is emitted
- [ ] Pass

#### Step 1.4
- **Setup**: a mismatched project
- **Do**: the developer runs `metta install` or `metta init` (Run: `metta install`, `metta init`)
- **Observe**: the drift check is skipped and no warning is printed
- [ ] Pass

### US-2: Legacy and broken configs stay quiet

*Independent test:* In a project with no `installed_version` field, and separately in a project with a missing or corrupt `.metta/config.yaml`, every metta command runs with no drift warning and no drift-related error.

#### Step 2.1
- **Setup**: a project whose `.metta/config.yaml` lacks the `installed_version` field
- **Do**: any command runs
- **Observe**: no warning is emitted and the command behaves as before
- [ ] Pass

#### Step 2.2
- **Setup**: a project with a missing or unparseable `.metta/config.yaml`
- **Do**: any command runs
- **Observe**: the drift check silently skips and does not add any error or warning of its own
- [ ] Pass

### US-3: Machine-readable mismatch signal in --json output

*Independent test:* A `--json` invocation in a drifted project includes `template_version_mismatch: { installed, running }` with the correct version strings, and the key is entirely absent when versions match.

#### Step 3.1
- **Setup**: a project stamped `0.1.0` and a running binary `0.2.0`
- **Do**: a command runs with `--json`
- **Observe**: the JSON output contains `template_version_mismatch` with `installed: "0.1.0"` and `running: "0.2.0"` merged into the normal payload
- [ ] Pass

#### Step 3.2
- **Setup**: a project whose stamp matches the running binary
- **Do**: a command runs with `--json`
- **Observe**: the `template_version_mismatch` key is absent from the output
- [ ] Pass

#### Step 3.3
- **Setup**: a drifted project
- **Do**: a command runs with `--json`
- **Observe**: the human-mode stderr warning does not corrupt the JSON payload on stdout
- [ ] Pass

### US-4: Re-stamping on install clears the warning

*Independent test:* After running `metta install` with a new binary in a previously drifted project, `.metta/config.yaml` contains the new version in `installed_version` and subsequent commands emit no drift warning.

#### Step 4.1
- **Setup**: a project stamped `0.1.0` and a running binary `0.2.0`
- **Do**: the developer runs `metta install` (Run: `metta install`)
- **Observe**: `installed_version` in `.metta/config.yaml` is overwritten with `0.2.0` via the validated config write path (`setProjectField`)
- [ ] Pass

#### Step 4.2
- **Setup**: a freshly re-stamped project
- **Do**: the developer runs any subsequent metta command
- **Observe**: no drift warning appears in human mode and no `template_version_mismatch` key appears in `--json` output
- [ ] Pass

#### Step 4.3
- **Setup**: a brand-new project with no metta config
- **Do**: the developer runs `metta init` (Run: `metta init`)
- **Observe**: the running binary version is stamped as `installed_version` and the resulting config passes strict ProjectConfigSchema validation
- [ ] Pass

### US-5: Doctor reports template freshness

*Independent test:* `metta doctor` shows a "Template freshness" check that passes when the stamp matches the running binary and warns when it mismatches or is missing.

#### Step 5.1
- **Setup**: a project whose `installed_version` matches the running binary version
- **Do**: the developer runs `metta doctor` (Run: `metta doctor`)
- **Observe**: the Template freshness check reports pass
- [ ] Pass

#### Step 5.2
- **Setup**: a project whose `installed_version` differs from the running binary version
- **Do**: the developer runs `metta doctor` (Run: `metta doctor`)
- **Observe**: the check reports warn and shows both the installed and running versions
- [ ] Pass

#### Step 5.3
- **Setup**: a legacy project with no `installed_version` stamp
- **Do**: the developer runs `metta doctor` (Run: `metta doctor`)
- **Observe**: the check reports warn indicating the stamp is missing, without failing the doctor run
- [ ] Pass

## Additional scenarios

#### Step 6.1: fresh install stamps the running version
- **Setup**: a git-initialized project with no `.metta/` directory and a running metta binary version "0.4.0"
- **Do**: the user runs `metta install` (Run: `metta install`)
- **Observe**: `.metta/config.yaml` contains top-level `installed_version: "0.4.0"` written via `setProjectField`, and the resulting config passes `ProjectConfigSchema` validation
- [ ] Pass

#### Step 6.2: re-running install overwrites a stale stamp
- **Setup**: a project whose `.metta/config.yaml` contains `installed_version: "0.3.0"` and a running binary version "0.4.0"
- **Do**: the user runs `metta install` (Run: `metta install`)
- **Observe**: `installed_version` in `.metta/config.yaml` is overwritten with "0.4.0", and subsequent commands emit no drift warning and no `template_version_mismatch` key in `--json` output
- [ ] Pass

#### Step 6.3: init stamps the running version
- **Setup**: a project where `metta install` has been run and the running binary version is "0.4.0"
- **Do**: the user runs `metta init` (Run: `metta install`, `metta init`)
- **Observe**: `.metta/config.yaml` contains `installed_version: "0.4.0"` and the config remains valid under the strict `ProjectConfigSchema`
- [ ] Pass

#### Step 6.4: init refreshes a stale stamp
- **Setup**: an installed project whose `.metta/config.yaml` contains `installed_version: "0.3.0"` and a running binary version "0.4.0"
- **Do**: the user runs `metta init` (Run: `metta init`)
- **Observe**: `installed_version` is overwritten with "0.4.0" and the next non-install/init command emits no drift warning
- [ ] Pass

#### Step 6.5: stamped config validates
- **Setup**: a `.metta/config.yaml` containing all existing required fields plus `installed_version: "0.4.0"`
- **Do**: the config is parsed with `ProjectConfigSchema`
- **Observe**: validation succeeds and the parsed object exposes `installed_version` as the string "0.4.0"
- [ ] Pass

#### Step 6.6: legacy config without the field remains valid
- **Setup**: a `.metta/config.yaml` written before version stamping existed, with no `installed_version` key
- **Do**: the config is parsed with `ProjectConfigSchema`
- **Observe**: validation succeeds unchanged and `installed_version` is absent from the parsed object
- [ ] Pass

#### Step 6.7: non-string stamp is rejected
- **Setup**: a `.metta/config.yaml` containing `installed_version: 4` (a number)
- **Do**: the config is parsed with `ProjectConfigSchema`
- **Observe**: validation fails with a type error on `installed_version`
- [ ] Pass

#### Step 6.8: upgrade drift warns once on stderr
- **Setup**: a project with `installed_version: "0.3.0"` in `.metta/config.yaml` and a running binary version "0.4.0"
- **Do**: the user runs `metta status` in human mode (Run: `metta status`)
- **Observe**: exactly one warning line naming "0.3.0" and "0.4.0" is printed to stderr, stdout is unaffected, and the command completes with its normal exit code
- [ ] Pass

#### Step 6.9: downgrade drift also warns
- **Setup**: a project with `installed_version: "0.4.0"` and a running binary version "0.3.0"
- **Do**: the user runs any command other than `install` or `init`
- **Observe**: the same one-line mismatch warning is emitted, because comparison is exact string inequality with no direction awareness
- [ ] Pass

#### Step 6.10: matching versions stay silent
- **Setup**: a project with `installed_version: "0.4.0"` and a running binary version "0.4.0"
- **Do**: the user runs any metta command
- **Observe**: no drift warning is emitted on stderr
- [ ] Pass

#### Step 6.11: install and init skip the check
- **Setup**: a project with `installed_version: "0.3.0"` and a running binary version "0.4.0"
- **Do**: the user runs `metta install` or `metta init` (Run: `metta install`, `metta init`)
- **Observe**: no drift warning is printed, and the command re-stamps `installed_version` to "0.4.0"
- [ ] Pass

#### Step 6.12: absent stamp stays silent
- **Setup**: a legacy project whose `.metta/config.yaml` parses successfully but has no `installed_version` field
- **Do**: the user runs any metta command
- **Observe**: no drift warning is emitted and the command behaves exactly as before stamping existed
- [ ] Pass

#### Step 6.13: missing or corrupt config skips silently
- **Setup**: a directory with no `.metta/config.yaml`, or one whose `.metta/config.yaml` contains unparseable YAML
- **Do**: the user runs any metta command
- **Observe**: the drift check silently skips, adds no warning or error of its own, and the command's normal behavior and exit code are unchanged
- [ ] Pass

#### Step 6.14: drift never changes exit codes
- **Setup**: a drifted project (`installed_version: "0.3.0"`, binary "0.4.0") and a command that would exit 0
- **Do**: the command runs
- **Observe**: the exit code is still 0; and for a command that would fail with exit code 3, the exit code is still 3 — the warning is purely advisory
- [ ] Pass

#### Step 6.15: mismatch appears in JSON payload
- **Setup**: a project with `installed_version: "0.3.0"` and a running binary version "0.4.0"
- **Do**: the user runs a metta command with `--json`
- **Observe**: the stdout JSON contains `template_version_mismatch: { "installed": "0.3.0", "running": "0.4.0" }` alongside the command's normal payload fields, and the payload parses as valid JSON
- [ ] Pass

#### Step 6.16: no mismatch means no key
- **Setup**: a project with `installed_version: "0.4.0"` and a running binary version "0.4.0"
- **Do**: the user runs a metta command with `--json`
- **Observe**: the `template_version_mismatch` key is absent from the JSON output
- [ ] Pass

#### Step 6.17: absent stamp means no key
- **Setup**: a legacy project with no `installed_version` field
- **Do**: the user runs a metta command with `--json`
- **Observe**: the `template_version_mismatch` key is absent from the JSON output
- [ ] Pass

#### Step 6.18: stderr warning does not corrupt stdout JSON
- **Setup**: a drifted project (`installed_version: "0.3.0"`, binary "0.4.0")
- **Do**: the user runs a metta command with `--json`
- **Observe**: any human-readable warning goes only to stderr and stdout contains a single well-formed JSON document
- [ ] Pass

#### Step 6.19: matching stamp passes
- **Setup**: a project with `installed_version: "0.4.0"` and a running binary version "0.4.0"
- **Do**: the user runs `metta doctor` (Run: `metta doctor`)
- **Observe**: the output includes a "Template freshness" check with status pass
- [ ] Pass

#### Step 6.20: mismatched stamp warns with both versions
- **Setup**: a project with `installed_version: "0.3.0"` and a running binary version "0.4.0"
- **Do**: the user runs `metta doctor` (Run: `metta doctor`)
- **Observe**: the "Template freshness" check reports warn and its message names both "0.3.0" (installed) and "0.4.0" (running)
- [ ] Pass

#### Step 6.21: missing stamp warns without failing doctor
- **Setup**: a legacy project whose `.metta/config.yaml` has no `installed_version` field
- **Do**: the user runs `metta doctor` (Run: `metta doctor`)
- **Observe**: the "Template freshness" check reports warn indicating the stamp is missing, and the doctor run completes normally with all other checks reported
- [ ] Pass
