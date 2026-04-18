# stack-detection-at-install-gate-scaffolding-rust-python-go — User Stories

## US-1: Rust project auto-scaffolds gates at install

**As a** Rust developer running `metta install` for the first time
**I want to** have `.metta/gates/*.yaml` scaffolded with cargo commands automatically
**So that** `metta finalize` works without me needing to know the override mechanism
**Priority:** P1
**Independent Test Criteria:** Running `metta install` in a directory containing `Cargo.toml` creates `.metta/gates/tests.yaml` with `command: cargo test`.

**Acceptance Criteria:**
- **Given** a directory with only `Cargo.toml` **When** `metta install` is run **Then** `.metta/gates/{tests,lint,typecheck,build}.yaml` are created with cargo commands
- **Given** `.metta/gates/tests.yaml` already exists **When** `metta install` is re-run **Then** the existing file is NOT overwritten

---

## US-2: Python project auto-scaffolds gates at install

**As a** Python developer running `metta install`
**I want to** `.metta/gates/*.yaml` scaffolded with pytest/ruff/mypy
**So that** I don't see npm-test failures on my first finalize
**Priority:** P1
**Independent Test Criteria:** Running `metta install` in a directory with `pyproject.toml` creates `.metta/gates/tests.yaml` with `command: pytest`, and `build.yaml` with `command: true` (pass-through).

**Acceptance Criteria:**
- **Given** a directory with `pyproject.toml` **When** `metta install` is run **Then** 4 gate YAMLs are created with Python commands
- **Given** `requirements.txt` is present instead of `pyproject.toml` **Then** Python is still detected
- **Given** the project has no logical build step **Then** `build.yaml` contains `command: true` with an explanatory comment

---

## US-3: Go project auto-scaffolds gates at install

**As a** Go developer running `metta install`
**I want to** `.metta/gates/*.yaml` scaffolded with go commands
**So that** finalize runs against my toolchain out of the box
**Priority:** P1
**Independent Test Criteria:** Running `metta install` in a directory with `go.mod` creates `.metta/gates/tests.yaml` with `command: go test ./...`.

**Acceptance Criteria:**
- **Given** a directory with `go.mod` **When** `metta install` is run **Then** 4 gate YAMLs are created with go commands

---

## US-4: JS project uses built-ins (no scaffold)

**As a** JavaScript/TypeScript developer running `metta install`
**I want to** no `.metta/gates/` files created
**So that** existing projects continue to use built-in npm commands without clutter
**Priority:** P2
**Independent Test Criteria:** Running `metta install` in a directory with `package.json` does not create `.metta/gates/`.

**Acceptance Criteria:**
- **Given** a directory with only `package.json` **When** `metta install` is run **Then** `.metta/gates/` directory does not exist or is empty

---

## US-5: Multi-stack monorepo populates config.stacks

**As a** developer on a monorepo with `Cargo.toml` AND `pyproject.toml`
**I want to** `.metta/config.yaml`'s `project.stacks` field populated with both detected stacks
**So that** I can see what was detected and manually combine commands if needed
**Priority:** P2
**Independent Test Criteria:** Install in a dir with both `Cargo.toml` and `pyproject.toml` writes `stacks: [rust, python]` to config and scaffolds rust gate commands (first-stack primary).

**Acceptance Criteria:**
- **Given** both `Cargo.toml` and `pyproject.toml` in the project root **When** `metta install` is run **Then** `.metta/config.yaml`'s `project.stacks` is `[rust, python]` and the scaffolded `tests.yaml` uses `cargo test` with a comment noting Python was also detected

---

## US-6: --stack override bypasses detection

**As a** user with an unusual setup
**I want to** force `metta install --stack rust` to scaffold rust gates regardless of markers
**So that** I can onboard projects that don't fit the auto-detection
**Priority:** P2
**Independent Test Criteria:** `metta install --stack rust` in an empty directory scaffolds rust gates.

**Acceptance Criteria:**
- **Given** `--stack rust` flag **When** install runs in an empty dir **Then** `.metta/gates/*.yaml` get cargo commands
- **Given** `--stack skip` flag **Then** no gates are scaffolded

---

## US-7: No markers → clear hint

**As a** developer with a niche stack
**I want to** see a message pointing at the override mechanism when no markers match
**So that** I know how to create `.metta/gates/` manually
**Priority:** P3
**Independent Test Criteria:** Install in an empty dir with no markers prints a line referencing `.metta/gates/` and the docs.

**Acceptance Criteria:**
- **Given** no stack markers present **When** `metta install` runs **Then** stdout/stderr contains a reference to `.metta/gates/` as the manual-override path
