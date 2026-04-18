# project-local-gate-overrides-metta-gates-language-agnostic — User Stories

## US-1: Rust / Python / Go project can finalize

**As a** metta user on a non-JavaScript project
**I want to** override the built-in gate commands with my project's test/build/lint toolchain
**So that** `metta finalize` runs the right commands and my changes can land
**Priority:** P1
**Independent Test Criteria:** Dropping `.metta/gates/tests.yaml` with `command: cargo test` in a Rust project overrides the built-in `npm test` gate — `GateRegistry.get('tests').command === 'cargo test'`.

**Acceptance Criteria:**
- **Given** a project with `.metta/gates/tests.yaml` containing `command: cargo test` **When** the gate registry loads all gates **Then** the `tests` gate's command is `cargo test`, not the built-in `npm test`
- **Given** no `.metta/gates/` directory exists **When** the gate registry loads **Then** the built-in npm-based gates are used (backward compatible)

---

## US-2: Only named overrides take effect

**As a** metta user overriding only one gate
**I want to** place `.metta/gates/tests.yaml` alone without replacing lint/typecheck/build
**So that** the other built-in gates keep working unchanged
**Priority:** P2
**Independent Test Criteria:** A project with only `.metta/gates/tests.yaml` shows `tests` overridden and `lint`, `typecheck`, `build` still at built-in values.

**Acceptance Criteria:**
- **Given** `.metta/gates/` contains only `tests.yaml` **When** the registry loads **Then** the `tests` gate is overridden but other gates match the built-in defaults

---

## US-3: Docs point users at the override path

**As a** new metta user on a non-JS project
**I want to** the getting-started docs to mention `.metta/gates/*.yaml` as the override path
**So that** I discover the mechanism without needing to read source
**Priority:** P3
**Independent Test Criteria:** `docs/getting-started.md` or equivalent contains a paragraph referencing `.metta/gates/` override.

**Acceptance Criteria:**
- **Given** the getting-started documentation **When** grepped for `.metta/gates` **Then** at least one reference to the override path is present
