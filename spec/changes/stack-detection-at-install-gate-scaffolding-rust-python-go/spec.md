# Spec: stack-detection-at-install-gate-scaffolding-rust-python-go

## ADDED: Requirement: config-stacks-array-field

**Fulfills:** US-5

`.metta/config.yaml` MUST support a `project.stacks: string[]` field listing the detected (or user-specified) stack names in priority order. Backward compatibility: when a legacy config has `project.stack: "rust"` (single string), the loader MUST auto-upgrade it to `project.stacks: ["rust"]` on read without mutating the file.

### Scenario: new config uses stacks array

- GIVEN a newly created `.metta/config.yaml`
- WHEN `metta install` writes the config
- THEN the file contains `project.stacks: ["rust"]` (or the detected list)

### Scenario: legacy string config is upgraded on load

- GIVEN a pre-existing config with `project.stack: "python"`
- WHEN the config is loaded
- THEN the in-memory value has `project.stacks: ["python"]` and the single `project.stack` string accessor remains available for callers expecting the old shape

---

## ADDED: Requirement: install-detects-stack-markers

**Fulfills:** US-1, US-2, US-3, US-4

`metta install` MUST scan the project root for stack-marker files and populate `project.stacks` based on the detections. Priority order (for multi-stack) is `rust > go > python > js`. Markers:

- `Cargo.toml` → `rust`
- `go.mod` → `go`
- `pyproject.toml` or `requirements.txt` → `python`
- `package.json` → `js`

### Scenario: Rust-only project detected

- GIVEN a project root with only `Cargo.toml`
- WHEN `metta install` runs
- THEN `.metta/config.yaml` has `project.stacks: ["rust"]`

### Scenario: Python-only via pyproject.toml

- GIVEN a project root with `pyproject.toml`
- WHEN `metta install` runs
- THEN `project.stacks: ["python"]`

### Scenario: Python-only via requirements.txt

- GIVEN a project root with `requirements.txt` but no `pyproject.toml`
- WHEN `metta install` runs
- THEN `project.stacks: ["python"]`

### Scenario: Multi-stack monorepo ordered by priority

- GIVEN a project root with `Cargo.toml` AND `pyproject.toml`
- WHEN `metta install` runs
- THEN `project.stacks: ["rust", "python"]`

### Scenario: No markers

- GIVEN a project root with no recognized marker
- WHEN `metta install` runs
- THEN `project.stacks: []` and stdout/stderr contains a hint referencing `.metta/gates/` for manual override

---

## ADDED: Requirement: install-scaffolds-gate-yamls

**Fulfills:** US-1, US-2, US-3, US-5

For each non-JS stack detected (as the primary, i.e. `stacks[0]`), `metta install` MUST scaffold four files in `.metta/gates/`: `tests.yaml`, `lint.yaml`, `typecheck.yaml`, `build.yaml` using the stack-specific commands from `src/templates/gate-scaffolds/<stack>/`. JS-only projects MUST NOT create `.metta/gates/`. When `stacks[0]` is the only non-JS stack detected, no additional commentary is added. When multiple stacks are detected, each scaffolded file MUST include a header comment listing the other stacks and suggesting `&&` chaining.

### Scenario: Rust primary → four rust gate files written

- GIVEN `stacks[0]` is `rust`
- WHEN install runs
- THEN `.metta/gates/tests.yaml` contains `command: cargo test`, `lint.yaml` contains `command: cargo clippy`, `typecheck.yaml` contains `command: cargo check`, `build.yaml` contains `command: cargo build`

### Scenario: Python primary → pass-through build

- GIVEN `stacks[0]` is `python`
- WHEN install runs
- THEN `build.yaml` contains `command: true` with a comment noting Python has no logical build step

### Scenario: Go primary → pass-through typecheck

- GIVEN `stacks[0]` is `go`
- WHEN install runs
- THEN `typecheck.yaml` contains `command: true` with a comment noting Go has no separate typecheck step

### Scenario: JS-only project creates no gate overrides

- GIVEN `stacks: ["js"]`
- WHEN install runs
- THEN `.metta/gates/` directory is not created (or remains empty)

### Scenario: Multi-stack adds comment block

- GIVEN `stacks: ["rust", "python"]`
- WHEN the scaffolded `tests.yaml` is read
- THEN it contains `command: cargo test` AND a header comment block mentioning `python` as the other detected stack

### Scenario: Scaffolding never overwrites

- GIVEN `.metta/gates/tests.yaml` already exists
- WHEN `metta install` is re-run
- THEN the existing file is preserved byte-for-byte

---

## ADDED: Requirement: install-stack-flag-override

**Fulfills:** US-6

`metta install` MUST accept a `--stack <spec>` flag. The spec MAY be a single stack name (`rust`), a comma-separated list (`rust,python`), or the literal `skip` (no scaffolding, no detection). When `--stack` is supplied, it overrides auto-detection and populates `project.stacks` from the flag value.

### Scenario: --stack forces rust

- GIVEN `metta install --stack rust` is run in an empty directory
- WHEN the command completes
- THEN `project.stacks: ["rust"]` and 4 rust gate YAMLs are scaffolded

### Scenario: --stack multi-value

- GIVEN `metta install --stack rust,python` is run
- WHEN the command completes
- THEN `project.stacks: ["rust", "python"]` and rust gates are scaffolded (as primary)

### Scenario: --stack skip suppresses scaffolding

- GIVEN `metta install --stack skip` is run in a dir with `Cargo.toml`
- WHEN the command completes
- THEN no `.metta/gates/` directory is created and detection is not recorded

### Scenario: Invalid --stack value exits with error

- GIVEN `metta install --stack ruby` (unsupported value)
- WHEN the command runs
- THEN the command exits non-zero with a message listing the supported values
