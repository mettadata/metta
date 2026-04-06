# ConfigLoader — Specification

**Status:** Imported  
**Source:** `src/config/config-loader.ts`, `tests/config-loader.test.ts`, `src/schemas/project-config.ts`  
**Date:** 2026-04-06

---

## 1. Overview

`ConfigLoader` resolves and merges metta project configuration from four ordered layers: global user config, project-level config, a local (gitignored) override, and environment variables. The result is validated against `ProjectConfigSchema` and cached in memory for the lifetime of the instance.

---

## 2. Configuration Layers

Layers are applied in ascending priority order. Higher-priority layers win on conflict.

| Priority | Layer | File Path |
|---|---|---|
| 1 (lowest) | Global | `~/.metta/config.yaml` |
| 2 | Project | `<projectRoot>/.metta/config.yaml` |
| 3 | Local | `<projectRoot>/.metta/local.yaml` |
| 4 (highest) | Environment | `METTA_*` environment variables |

---

## 3. Constructor

```
new ConfigLoader(projectRoot: string, globalDir?: string)
```

- `projectRoot` MUST be the absolute path to the project directory.
- `globalDir` SHOULD default to `~/.metta` (resolved via `homedir()`) when not provided.
- The constructor MUST NOT perform any I/O or load any config at construction time.

---

## 4. Methods

### 4.1 `load()`

- MUST return a `Promise<ProjectConfig>`.
- MUST apply the four-layer merge in priority order (global → project → local → env).
- MUST use deep-merge semantics: nested objects are merged recursively; arrays and scalar values from the higher-priority layer replace those from lower layers.
- MUST NOT throw when a config file is absent; missing files MUST be silently treated as empty objects (`{}`).
- MUST apply environment variable overrides after all file-based layers.
- MUST validate the fully merged configuration against `ProjectConfigSchema` using `schema.parse` (throwing on invalid file-based config).
- MUST cache the resulting `ProjectConfig` after the first successful load.
- On subsequent calls, MUST return the same object reference (identity equality) without re-reading any files.

**Important:** The cached config is NOT auto-invalidated when environment variables change. Once `load()` has been called, mutations to `process.env` (adding or removing `METTA_*` variables) will not take effect until `clearCache()` is called. `ConfigLoader` instances SHOULD be short-lived (per-command) rather than used as long-lived singletons.

### 4.2 `clearCache()`

- MUST discard the cached config object.
- A subsequent call to `load()` MUST re-read and re-merge all layers.

### 4.3 Path Accessors (read-only getters)

| Getter | Returns |
|---|---|
| `projectPath` | The `projectRoot` supplied to the constructor |
| `globalPath` | The resolved `globalDir` |
| `mettaDir` | `<projectRoot>/.metta` |
| `specDir` | `<projectRoot>/spec` |

All accessors MUST be synchronous and MUST NOT perform I/O.

---

## 5. Environment Variable Mapping

- MUST scan all `process.env` entries whose keys begin with `METTA_`.
- MUST strip the `METTA_` prefix, convert the remainder to lowercase, and split on `__` (double underscore) to derive a nested key path. Single underscores within a segment are preserved, allowing targeting of config keys that contain underscores (e.g., `api_key_env`).
  - Example: `METTA_DEFAULTS__WORKFLOW=full` sets `config.defaults.workflow = "full"`.
  - Example: `METTA_PROVIDERS__ANTHROPIC__API_KEY_ENV=KEY` sets `config.providers.anthropic.api_key_env = "KEY"`.
- MUST coerce values:
  - `"true"` → boolean `true`
  - `"false"` → boolean `false`
  - A string matching `/^\d+$/` → integer (base 10)
  - All other values → string (unchanged)
- MUST create intermediate objects as needed when the key path implies nesting into a key that does not yet exist.

---

## 6. Deep Merge Semantics

- MUST merge plain objects recursively.
- MUST NOT merge arrays; a higher-priority array MUST replace the lower-priority array entirely.
- `null` values MUST be treated as scalars (not merged into as objects).
- The merge MUST be non-destructive: the source objects MUST NOT be mutated.

---

## 7. Malformed YAML Handling

When a config file exists but cannot be parsed as valid YAML:

- MUST write a warning to `process.stderr` in the format: `Warning: failed to parse YAML config at <filePath>: <error message>`.
- MUST treat the malformed file as an empty object (`{}`) and continue loading.
- MUST NOT throw an exception for a YAML parse failure in any config file.
- The remaining layers (including other files and environment variables) MUST still be applied normally.

This allows a broken `local.yaml` to degrade gracefully while still applying the valid `project.yaml` and global config.

---

## 8. Environment Variable Validation Error Handling

When environment variable overrides cause `ProjectConfigSchema` validation to fail but the file-only configuration is valid:

- MUST write a warning to `process.stderr` in the format: `Warning: METTA_* environment variable(s) caused config validation errors (ignored):\n<issues>`.
- MUST fall back to the file-only merged configuration (without the env overrides).
- MUST NOT throw in this case.

When the file-only configuration is itself invalid (i.e., the Zod error is not caused solely by env vars), the original `ZodError` MUST be re-thrown.

---

## 9. ProjectConfigSchema (Summary)

The validated output type `ProjectConfig` contains the following optional top-level sections. All are optional at the config file level; unset fields receive Zod defaults where declared.

| Section | Type | Notable Fields |
|---|---|---|
| `project` | `ProjectInfoSchema` | `name` (required), `description`, `stack`, `conventions` |
| `defaults` | inline object | `workflow` (string, default `"standard"`), `mode` (enum: `interactive` / `autonomous` / `supervised`, default `"supervised"`) |
| `providers` | `Record<string, ProviderConfigSchema>` | `provider`, `model`, `api_key_env` |
| `tools` | `string[]` | — |
| `gates` | `Record<string, GateConfigSchema>` | `command`, `timeout`, `required`, `on_failure` |
| `git` | `GitConfigSchema` | `enabled`, `commit_convention`, `protected_branches`, `merge_strategy`, etc. |
| `docs` | `DocsConfigSchema` | `output`, `generate_on`, `types` |
| `auto` | `AutoConfigSchema` | `max_cycles`, `ship_on_success` |
| `context_sections` | `string[]` | — |
| `adapters` | `string[]` | — |
| `cleanup` | inline object | `log_retention_days` (int, default `30`) |

All schemas use Zod `.strict()`, so extra fields MUST cause a validation failure.

---

## 10. Behavioral Scenarios

### 10.1 No Config Files Present

**Given** no global config, no project config, and no local config files exist  
**And** no `METTA_*` environment variables are set  
**When** `load()` is called  
**Then** it MUST return a valid `ProjectConfig` (with all fields optional and defaults applied)  
**And** MUST NOT throw.

---

### 10.2 Global Config Loaded

**Given** a global config at `<globalDir>/config.yaml` containing `project.name: "Global App"`  
**When** `load()` is called  
**Then** the returned config MUST include `project.name === "Global App"`.

---

### 10.3 Project Config Overrides Global

**Given** a global config sets `project.name: "Global App"`  
**And** a project config sets `project.name: "Project App"`  
**When** `load()` is called  
**Then** the returned config MUST have `project.name === "Project App"`.

---

### 10.4 Local Config Overrides Project Config

**Given** a project config sets `defaults.mode: "supervised"`  
**And** a local config sets `defaults.mode: "autonomous"`  
**When** `load()` is called  
**Then** the returned config MUST have `defaults.mode === "autonomous"`.

---

### 10.5 Environment Variables Override All Files

**Given** a project config sets `project.name: "Project App"`  
**And** `METTA_DEFAULTS__WORKFLOW` is set to `"full"` in the environment  
**When** `load()` is called  
**Then** the returned config MUST have `defaults.workflow === "full"`.

---

### 10.6 Double Underscore Separator Preserves Single Underscores in Key Names

**Given** a project config with `providers.anthropic.provider: "anthropic"`  
**And** `METTA_PROVIDERS__ANTHROPIC__API_KEY_ENV` is set to `"MY_SECRET_KEY"`  
**When** `load()` is called  
**Then** the returned config MUST have `providers.anthropic.api_key_env === "MY_SECRET_KEY"`  
**And** the single underscore in `api_key_env` MUST be preserved as part of the key name, not treated as a path separator.

---

### 10.7 Caching

**Given** `load()` has been called once successfully  
**When** `load()` is called again  
**Then** it MUST return the identical object reference (same reference, no re-read).

---

### 10.8 Cache Invalidation

**Given** `load()` has been called and the config file is subsequently modified on disk  
**When** `clearCache()` is called followed by `load()`  
**Then** the new call MUST re-read all files and reflect the updated values.

---

### 10.9 Malformed YAML Logged and Skipped

**Given** `<projectRoot>/.metta/local.yaml` contains invalid YAML  
**And** `<projectRoot>/.metta/config.yaml` is valid  
**When** `load()` is called  
**Then** a warning MUST be written to `process.stderr` containing `"Warning: failed to parse YAML config"`  
**And** the returned config MUST reflect the valid project config (the malformed file is skipped)  
**And** MUST NOT throw.

---

### 10.10 Invalid Env Vars Warned and Ignored

**Given** a valid project config  
**And** a `METTA_*` environment variable that introduces a key causing Zod validation failure  
**When** `load()` is called  
**Then** a warning MUST be written to `process.stderr` containing `"Warning: METTA_* environment variable(s) caused config validation errors"`  
**And** the returned config MUST reflect the file-only configuration  
**And** MUST NOT throw.

---

### 10.11 Path Accessors

**Given** a `ConfigLoader` constructed with `projectRoot = "/path/to/project"` and `globalDir = "/path/to/global"`  
**Then**:

- `loader.projectPath` MUST equal `"/path/to/project"`
- `loader.globalPath` MUST equal `"/path/to/global"`
- `loader.mettaDir` MUST equal `"/path/to/project/.metta"`
- `loader.specDir` MUST equal `"/path/to/project/spec"`

---

### 10.12 Default Global Dir

**Given** a `ConfigLoader` constructed with only `projectRoot` (no `globalDir` argument)  
**Then** `loader.globalPath` MUST equal `<homedir>/.metta`.

---

## 11. Implementation Constraints

- `local.yaml` MUST be listed in `.gitignore` because it is intended for developer-local overrides such as API keys or personal workflow preferences. `metta init` SHOULD ensure `.metta/local.yaml` is added to the project `.gitignore` file. Committing `local.yaml` to version control risks leaking credentials.
- Environment variable coercion occurs last and MUST NOT be cached separately; re-reading env occurs on each `load()` call following a `clearCache()`.
- The loader MUST NOT merge or expose any config source other than the four defined layers.
- Malformed YAML files MUST be silently skipped (with a stderr warning); only absent files are truly silent.

---

## 12. Dependencies

| Dependency | Version Constraint | Purpose |
|---|---|---|
| `zod` | workspace | Schema validation via `ProjectConfigSchema` |
| `yaml` | workspace | YAML file parsing |
| `node:fs/promises` | Node.js >= 22 | File reading |
| `node:path` | Node.js built-in | Path joining |
| `node:os` | Node.js built-in | `homedir()` for default global path |
