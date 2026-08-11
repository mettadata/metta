# install-init

## Requirement: init-command-drives-discovery

The  command MUST produce the discovery payload consumed by AI agents to run project discovery. It MUST detect brownfield versus greenfield mode by scanning for language/framework marker files and non-empty source directories. It MUST emit the  object (agent persona, mode, detected stack, questions, output paths, constitution and context templates) to stdout when  is set. It MUST require a prior  and MUST NOT scaffold any files, install any commands, or create commits.

### Scenario: init after install in a brownfield project
- GIVEN a project where  has been run and  plus a non-empty  exist
- WHEN the user runs
- THEN the command emits JSON containing a  object with ,  including Rust,  including , the brownfield question set, and absolute  for constitution, context_file, and config

### Scenario: init on a greenfield project
- GIVEN a project where  has been run and no stack marker files or source directories are present
- WHEN the user runs
- THEN the command emits  with the greenfield question set and empty  and

### Scenario: init before install is blocked
- GIVEN a project with no  directory
- WHEN the user runs
- THEN the command exits with code 3, emits an error JSON whose message instructs the user to run  first, and writes nothing to the filesystem

### Scenario: init does not mutate the repository
- GIVEN an installed project with a clean working tree
- WHEN the user runs
- THEN after the command the working tree remains clean, no new commits are created,  and  are byte-identical to their pre-run state


## Requirement: init-skill-invokes-init-command

The  Claude Code skill MUST invoke  (not ) as its first step, parse the  object from the response, and spawn a  agent with the parsed fields. The skill template in  MUST match the skill installed into target projects under  via the command installer.

### Scenario: skill template references init command
- GIVEN the skill template at
- WHEN a reader inspects the bash command on the first numbered step
- THEN the command is , not

### Scenario: skill propagates to installed projects
- GIVEN a project where  has been run
- WHEN the installer copies  from the template
- THEN the installed copy also invokes


## Requirement: install-command-scaffolds-only

The  command MUST scaffold Metta files into the project and MUST NOT emit discovery instructions or brownfield/greenfield classification. It MUST create , , ,  directories; write default , , and  if absent; install  slash commands, skills, and agents; regenerate  via the refresh pipeline; and commit the result as  when there are staged changes. The  output MUST NOT include a  field and MUST NOT include a  field — project classification is the responsibility of . The command MUST NOT perform brownfield detection.

### Scenario: fresh install in a git repo
- GIVEN a git-initialized project with no  directory
- WHEN the user runs
- THEN the command creates , , , , , installs  assets, regenerates , commits as , and emits JSON with  and no  or  keys

### Scenario: install on a project that already has .metta
- GIVEN a project where  has been run previously
- WHEN the user runs  again
- THEN the command exits successfully without overwriting  or , does not produce a new commit when nothing changed, and reports  with

### Scenario: install without a git repository
- GIVEN a directory with no
- WHEN the user runs  without
- THEN the command exits with code 3 and emits  without scaffolding any files

### Scenario: human-readable install output points at init
- GIVEN a fresh project
- WHEN the user runs  without
- THEN the final line of stdout directs them to run  next


## Requirement: install-stamps-installed-version

The `metta install` command MUST write the running package version (as reported by `getPackageVersion`) to the top-level `installed_version` field in `.metta/config.yaml` using the validated `setProjectField` write path in `src/config/config-writer.ts`. The write MUST occur on every run of `metta install`, overwriting any existing `installed_version` value, so that re-running install after a binary upgrade or downgrade always refreshes the stamp. The stamped value MUST be the exact version string of the binary that performed the install.
Traces to: US-4 (Re-stamping on install clears the warning); intent problem statement — installed assets are frozen at the writing binary's version but nothing records which version that was.

### Scenario: fresh install stamps the running version
- GIVEN a git-initialized project with no `.metta/` directory and a running metta binary version "0.4.0"
- WHEN the user runs `metta install`
- THEN `.metta/config.yaml` contains top-level `installed_version: "0.4.0"` written via `setProjectField`, and the resulting config passes `ProjectConfigSchema` validation

### Scenario: re-running install overwrites a stale stamp
- GIVEN a project whose `.metta/config.yaml` contains `installed_version: "0.3.0"` and a running binary version "0.4.0"
- WHEN the user runs `metta install`
- THEN `installed_version` in `.metta/config.yaml` is overwritten with "0.4.0", and subsequent commands emit no drift warning and no `template_version_mismatch` key in `--json` output


## Requirement: init-stamps-installed-version

The `metta init` command MUST stamp the running package version into the top-level `installed_version` field of `.metta/config.yaml` via `setProjectField`, using the same write path and overwrite semantics as `metta install`. The stamp MUST be re-written on every run of `metta init`, so a drifted project is refreshed by either command.
Traces to: US-4 (Re-stamping on install clears the warning), acceptance criterion covering `metta init`.

### Scenario: init stamps the running version
- GIVEN a project where `metta install` has been run and the running binary version is "0.4.0"
- WHEN the user runs `metta init`
- THEN `.metta/config.yaml` contains `installed_version: "0.4.0"` and the config remains valid under the strict `ProjectConfigSchema`

### Scenario: init refreshes a stale stamp
- GIVEN an installed project whose `.metta/config.yaml` contains `installed_version: "0.3.0"` and a running binary version "0.4.0"
- WHEN the user runs `metta init`
- THEN `installed_version` is overwritten with "0.4.0" and the next non-install/init command emits no drift warning


## Requirement: project-config-schema-accepts-installed-version

`ProjectConfigSchema` in `src/schemas/project-config.ts` MUST accept an optional top-level `installed_version` field of type string. Configs that omit the field MUST remain valid (legacy installs are unaffected), and configs that include a string value MUST validate under the strict schema. A non-string `installed_version` value MUST fail validation.
Traces to: intent impact statement — the schema is strict, so stamping without the schema addition would reject stamped configs; schema and stamping ship together. Supports US-2 (legacy configs stay valid) and US-4.

### Scenario: stamped config validates
- GIVEN a `.metta/config.yaml` containing all existing required fields plus `installed_version: "0.4.0"`
- WHEN the config is parsed with `ProjectConfigSchema`
- THEN validation succeeds and the parsed object exposes `installed_version` as the string "0.4.0"

### Scenario: legacy config without the field remains valid
- GIVEN a `.metta/config.yaml` written before version stamping existed, with no `installed_version` key
- WHEN the config is parsed with `ProjectConfigSchema`
- THEN validation succeeds unchanged and `installed_version` is absent from the parsed object

### Scenario: non-string stamp is rejected
- GIVEN a `.metta/config.yaml` containing `installed_version: 4` (a number)
- WHEN the config is parsed with `ProjectConfigSchema`
- THEN validation fails with a type error on `installed_version`


## Requirement: invocation-time-drift-check

On every CLI invocation except the `install` and `init` commands, the global `preAction` hook in `src/cli/index.ts` MUST compare the `installed_version` stamped in `.metta/config.yaml` against the running binary version using exact string inequality — no semver ranges or "compatible minor" logic. When the two strings differ (in either direction, including a downgrade where the binary is older than the stamp), the CLI MUST emit exactly one warning line to stderr in human mode naming both versions. The check MUST NOT block execution, MUST NOT alter the command's exit code, and MUST NOT write to stdout. The check MUST emit nothing when the `installed_version` field is absent, and MUST silently skip when `.metta/config.yaml` is missing, corrupt, or unreadable — a drift-check failure MUST never break a CLI invocation.
Traces to: US-1 (Warn on version drift at every CLI invocation), US-2 (Legacy and broken configs stay quiet); intent problem statement — drift accumulates invisibly with no warning or diagnostic.

### Scenario: upgrade drift warns once on stderr
- GIVEN a project with `installed_version: "0.3.0"` in `.metta/config.yaml` and a running binary version "0.4.0"
- WHEN the user runs `metta status` in human mode
- THEN exactly one warning line naming "0.3.0" and "0.4.0" is printed to stderr, stdout is unaffected, and the command completes with its normal exit code

### Scenario: downgrade drift also warns
- GIVEN a project with `installed_version: "0.4.0"` and a running binary version "0.3.0"
- WHEN the user runs any command other than `install` or `init`
- THEN the same one-line mismatch warning is emitted, because comparison is exact string inequality with no direction awareness

### Scenario: matching versions stay silent
- GIVEN a project with `installed_version: "0.4.0"` and a running binary version "0.4.0"
- WHEN the user runs any metta command
- THEN no drift warning is emitted on stderr

### Scenario: install and init skip the check
- GIVEN a project with `installed_version: "0.3.0"` and a running binary version "0.4.0"
- WHEN the user runs `metta install` or `metta init`
- THEN no drift warning is printed, and the command re-stamps `installed_version` to "0.4.0"

### Scenario: absent stamp stays silent
- GIVEN a legacy project whose `.metta/config.yaml` parses successfully but has no `installed_version` field
- WHEN the user runs any metta command
- THEN no drift warning is emitted and the command behaves exactly as before stamping existed

### Scenario: missing or corrupt config skips silently
- GIVEN a directory with no `.metta/config.yaml`, or one whose `.metta/config.yaml` contains unparseable YAML
- WHEN the user runs any metta command
- THEN the drift check silently skips, adds no warning or error of its own, and the command's normal behavior and exit code are unchanged

### Scenario: drift never changes exit codes
- GIVEN a drifted project (`installed_version: "0.3.0"`, binary "0.4.0") and a command that would exit 0
- WHEN the command runs
- THEN the exit code is still 0; and for a command that would fail with exit code 3, the exit code is still 3 — the warning is purely advisory


## Requirement: json-output-carries-template-version-mismatch

When a version mismatch was detected during the invocation and the command runs with `--json`, the `outputJson` payload (`src/cli/helpers.ts`) MUST include a top-level `template_version_mismatch` object with exactly two string fields: `installed` (the stamped version) and `running` (the binary version). When no mismatch was detected — versions match, the stamp is absent, or the config was unreadable — the `template_version_mismatch` key MUST be entirely absent from the JSON output. The field MUST be merged into the command's normal payload without displacing existing fields, and the stderr warning MUST NOT corrupt the JSON document on stdout.
Traces to: US-3 (Machine-readable mismatch signal in --json output).

### Scenario: mismatch appears in JSON payload
- GIVEN a project with `installed_version: "0.3.0"` and a running binary version "0.4.0"
- WHEN the user runs a metta command with `--json`
- THEN the stdout JSON contains `template_version_mismatch: { "installed": "0.3.0", "running": "0.4.0" }` alongside the command's normal payload fields, and the payload parses as valid JSON

### Scenario: no mismatch means no key
- GIVEN a project with `installed_version: "0.4.0"` and a running binary version "0.4.0"
- WHEN the user runs a metta command with `--json`
- THEN the `template_version_mismatch` key is absent from the JSON output

### Scenario: absent stamp means no key
- GIVEN a legacy project with no `installed_version` field
- WHEN the user runs a metta command with `--json`
- THEN the `template_version_mismatch` key is absent from the JSON output

### Scenario: stderr warning does not corrupt stdout JSON
- GIVEN a drifted project (`installed_version: "0.3.0"`, binary "0.4.0")
- WHEN the user runs a metta command with `--json`
- THEN any human-readable warning goes only to stderr and stdout contains a single well-formed JSON document


## Requirement: doctor-template-freshness-check

The `metta doctor` command MUST include a check named "Template freshness" that compares the stamped `installed_version` in `.metta/config.yaml` against the running binary version. The check MUST report pass when the two version strings are exactly equal, MUST report warn (not fail) when they differ — showing both the installed and running versions — and MUST report warn when the `installed_version` stamp is missing, indicating the stamp is absent. The check MUST NOT cause the doctor run itself to error.
Traces to: US-5 (Doctor reports template freshness).

### Scenario: matching stamp passes
- GIVEN a project with `installed_version: "0.4.0"` and a running binary version "0.4.0"
- WHEN the user runs `metta doctor`
- THEN the output includes a "Template freshness" check with status pass

### Scenario: mismatched stamp warns with both versions
- GIVEN a project with `installed_version: "0.3.0"` and a running binary version "0.4.0"
- WHEN the user runs `metta doctor`
- THEN the "Template freshness" check reports warn and its message names both "0.3.0" (installed) and "0.4.0" (running)

### Scenario: missing stamp warns without failing doctor
- GIVEN a legacy project whose `.metta/config.yaml` has no `installed_version` field
- WHEN the user runs `metta doctor`
- THEN the "Template freshness" check reports warn indicating the stamp is missing, and the doctor run completes normally with all other checks reported
