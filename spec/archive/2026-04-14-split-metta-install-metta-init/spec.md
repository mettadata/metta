# split-metta-install-metta-init

## MODIFIED: Requirement: install-command-scaffolds-only

The `metta install` command MUST scaffold Metta files into the project and MUST NOT emit discovery instructions or brownfield/greenfield classification. It MUST create `.metta/`, `spec/specs/`, `spec/changes/`, `spec/archive/` directories; write default `.metta/config.yaml`, `spec/project.md`, and `.metta/.gitignore` if absent; install `.claude/` slash commands, skills, and agents; regenerate `CLAUDE.md` via the refresh pipeline; and commit the result as `chore: initialize metta` when there are staged changes. The `--json` output MUST NOT include a `discovery` field and MUST NOT include a `mode` field — project classification is the responsibility of `metta init`. The command MUST NOT perform brownfield detection.

### Scenario: fresh install in a git repo
- GIVEN a git-initialized project with no `.metta/` directory
- WHEN the user runs `metta install --json`
- THEN the command creates `.metta/config.yaml`, `spec/project.md`, `spec/specs/`, `spec/changes/`, `spec/archive/`, installs `.claude/` assets, regenerates `CLAUDE.md`, commits as `chore: initialize metta`, and emits JSON with `status: "initialized"` and no `discovery` or `mode` keys

### Scenario: install on a project that already has .metta
- GIVEN a project where `metta install` has been run previously
- WHEN the user runs `metta install --json` again
- THEN the command exits successfully without overwriting `.metta/config.yaml` or `spec/project.md`, does not produce a new commit when nothing changed, and reports `status: "initialized"` with `committed: false`

### Scenario: install without a git repository
- GIVEN a directory with no `.git/`
- WHEN the user runs `metta install --json` without `--git-init`
- THEN the command exits with code 3 and emits `status: "git_missing"` without scaffolding any files

### Scenario: human-readable install output points at init
- GIVEN a fresh project
- WHEN the user runs `metta install` without `--json`
- THEN the final line of stdout directs them to run `metta init` next

## ADDED: Requirement: init-command-drives-discovery

The `metta init` command MUST produce the discovery payload consumed by AI agents to run project discovery. It MUST detect brownfield versus greenfield mode by scanning for language/framework marker files and non-empty source directories. It MUST emit the `discovery` object (agent persona, mode, detected stack, questions, output paths, constitution and context templates) to stdout when `--json` is set. It MUST require a prior `metta install` and MUST NOT scaffold any files, install any commands, or create commits.

### Scenario: init after install in a brownfield project
- GIVEN a project where `metta install` has been run and `Cargo.toml` plus a non-empty `src/` exist
- WHEN the user runs `metta init --json`
- THEN the command emits JSON containing a `discovery` object with `mode: "brownfield"`, `detected.stack` including Rust, `detected.directories` including `src`, the brownfield question set, and absolute `output_paths` for constitution, context_file, and config

### Scenario: init on a greenfield project
- GIVEN a project where `metta install` has been run and no stack marker files or source directories are present
- WHEN the user runs `metta init --json`
- THEN the command emits `discovery.mode: "greenfield"` with the greenfield question set and empty `detected.stack` and `detected.directories`

### Scenario: init before install is blocked
- GIVEN a project with no `.metta/` directory
- WHEN the user runs `metta init --json`
- THEN the command exits with code 3, emits an error JSON whose message instructs the user to run `metta install` first, and writes nothing to the filesystem

### Scenario: init does not mutate the repository
- GIVEN an installed project with a clean working tree
- WHEN the user runs `metta init --json`
- THEN after the command the working tree remains clean, no new commits are created, `.metta/config.yaml` and `spec/project.md` are byte-identical to their pre-run state

## ADDED: Requirement: init-skill-invokes-init-command

The `/metta-init` Claude Code skill MUST invoke `metta init --json` (not `metta install --json`) as its first step, parse the `discovery` object from the response, and spawn a `metta-discovery` agent with the parsed fields. The skill template in `src/templates/skills/metta-init/SKILL.md` MUST match the skill installed into target projects under `.claude/skills/metta-init/SKILL.md` via the command installer.

### Scenario: skill template references init command
- GIVEN the skill template at `src/templates/skills/metta-init/SKILL.md`
- WHEN a reader inspects the bash command on the first numbered step
- THEN the command is `metta init --json`, not `metta install --json`

### Scenario: skill propagates to installed projects
- GIVEN a project where `metta install` has been run
- WHEN the installer copies `.claude/skills/metta-init/SKILL.md` from the template
- THEN the installed copy also invokes `metta init --json`
