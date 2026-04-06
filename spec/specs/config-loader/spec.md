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
- MUST validate the fully merged configuration against `ProjectConfigSchema` using `schema.parse` (throwing on invalid config).
- MUST cache the resulting `ProjectConfig` after the first successful load.
- On subsequent calls, MUST return the same object reference (identity equality) without re-reading any files.

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

## 7. ProjectConfigSchema (Summary)

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

## 8. Behavioral Scenarios

### 8.1 No Config Files Present

**Given** no global config, no project config, and no local config files exist  
**And** no `METTA_*` environment variables are set  
**When** `load()` is called  
**Then** it MUST return a valid `ProjectConfig` (with all fields optional and defaults applied)  
**And** MUST NOT throw.

---

### 8.2 Global Config Loaded

**Given** a global config at `<globalDir>/config.yaml` containing `project.name: "Global App"`  
**When** `load()` is called  
**Then** the returned config MUST include `project.name === "Global App"`.

---

### 8.3 Project Config Overrides Global

**Given** a global config sets `project.name: "Global App"`  
**And** a project config sets `project.name: "Project App"`  
**When** `load()` is called  
**Then** the returned config MUST have `project.name === "Project App"`.

---

### 8.4 Local Config Overrides Project Config

**Given** a project config sets `defaults.mode: "supervised"`  
**And** a local config sets `defaults.mode: "autonomous"`  
**When** `load()` is called  
**Then** the returned config MUST have `defaults.mode === "autonomous"`.

---

### 8.5 Environment Variables Override All Files

**Given** a project config sets `project.name: "Project App"`  
**And** `METTA_DEFAULTS_WORKFLOW` is set to `"full"` in the environment  
**When** `load()` is called  
**Then** the returned config MUST have `defaults.workflow === "full"`.

---

### 8.6 Caching

**Given** `load()` has been called once successfully  
**When** `load()` is called again  
**Then** it MUST return the identical object reference (same reference, no re-read).

---

### 8.7 Cache Invalidation

**Given** `load()` has been called and the config file is subsequently modified on disk  
**When** `clearCache()` is called followed by `load()`  
**Then** the new call MUST re-read all files and reflect the updated values.

---

### 8.8 Path Accessors

**Given** a `ConfigLoader` constructed with `projectRoot = "/path/to/project"` and `globalDir = "/path/to/global"`  
**Then**:

- `loader.projectPath` MUST equal `"/path/to/project"`
- `loader.globalPath` MUST equal `"/path/to/global"`
- `loader.mettaDir` MUST equal `"/path/to/project/.metta"`
- `loader.specDir` MUST equal `"/path/to/project/spec"`

---

## 9. Implementation Constraints

- `local.yaml` MUST be listed in `.gitignore` because it is intended for developer-local overrides such as API keys or personal workflow preferences. `metta init` SHOULD ensure `.metta/local.yaml` is added to the project `.gitignore` file. Committing `local.yaml` to version control risks leaking credentials.
- Environment variable coercion occurs last and MUST NOT be cached separately; re-reading env occurs on each `load()` call following a `clearCache()`.
- The loader MUST NOT merge or expose any config source other than the four defined layers.
- Config file parse errors (malformed YAML) MUST propagate to the caller; only absent files are silently ignored.

---

## 10. Dependencies

| Dependency | Version Constraint | Purpose |
|---|---|---|
| `zod` | workspace | Schema validation via `ProjectConfigSchema` |
| `yaml` | workspace | YAML file parsing |
| `node:fs/promises` | Node.js >= 22 | File reading |
| `node:path` | Node.js built-in | Path joining |
| `node:os` | Node.js built-in | `homedir()` for default global path |
