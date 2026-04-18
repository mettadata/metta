# Spec: project-local-gate-overrides-metta-gates-language-agnostic

## ADDED: Requirement: finalize-loads-project-local-gate-overrides

**Fulfills:** US-1, US-2

`metta finalize` MUST load gates in two passes: first from `src/templates/gates/` (built-ins), then from `<projectRoot>/.metta/gates/`. Gates registered in the second pass MUST replace any earlier gate of the same name. When `<projectRoot>/.metta/gates/` does not exist, the command MUST NOT error — the existing behavior preserves.

### Scenario: project override replaces built-in

- GIVEN `<projectRoot>/.metta/gates/tests.yaml` exists with `command: cargo test`
- WHEN `metta finalize` loads the gate registry
- THEN `GateRegistry.get('tests').command === 'cargo test'` (the built-in `npm test` is overridden)

### Scenario: missing override dir is silent pass-through

- GIVEN `<projectRoot>/.metta/gates/` does not exist
- WHEN `metta finalize` loads the gate registry
- THEN all gates take their built-in values and no error is raised

### Scenario: partial override leaves other gates intact

- GIVEN `<projectRoot>/.metta/gates/` contains only `tests.yaml` (no other YAML files)
- WHEN the gate registry loads
- THEN the `tests` gate is overridden and `lint`, `typecheck`, `build`, `stories-valid` keep their built-in definitions

---

## ADDED: Requirement: gate-registry-load-order-is-deterministic

**Fulfills:** US-1

`GateRegistry.loadFromDirectory` MUST read directory entries in lexical order so repeated loads produce the same final registry state. (Already the case today via `readdir` + sort; this requirement pins the behavior.)

### Scenario: identical state across repeated loads

- GIVEN a fixed set of built-in and project-local gate YAMLs
- WHEN `loadFromDirectory` is called twice with the same directory
- THEN both calls produce the same registered gates

---

## ADDED: Requirement: docs-mention-override-path

**Fulfills:** US-3

The getting-started documentation (or an equivalent user-facing doc) MUST reference `.metta/gates/*.yaml` as the path for project-local gate overrides.

### Scenario: docs grep hit

- GIVEN `docs/getting-started.md` (or the nearest user-facing getting-started equivalent)
- WHEN the file is grep'd for `.metta/gates`
- THEN at least one reference exists
