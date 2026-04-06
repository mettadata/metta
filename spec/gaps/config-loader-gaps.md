# ConfigLoader — Specification Gaps

**Date:** 2026-04-06  
**Severity:** P1 = blocks correctness, P2 = blocks safety, P3 = quality/clarity

---

## GAP-CL-01 — Malformed YAML in config files silently swallowed [P1]

**Location:** `src/config/config-loader.ts:loadYamlFile` (lines 31–38)

**Description:** `loadYamlFile` returns `null` on any error, including malformed YAML (`YAML.parse` throws on syntax errors). A project config file with a typo is silently ignored and falls back to `{}`, masking real configuration mistakes with no error or warning.

**Impact:** A developer who misspells a YAML key or causes a syntax error will see metta behave with defaults, with no indication that their config was not applied.

**Recommendation:** Distinguish between `ENOENT` (file absent — treat as `{}`) and other errors (syntax/permission — throw or emit a warning). Add tests for the malformed YAML case.

---

## GAP-CL-02 — Environment variable key mapping for multi-segment underscored keys is ambiguous [P1]

**Location:** `src/config/config-loader.ts:applyEnvOverrides` (lines 40–71)

**Description:** The env var key is split on all `_` characters after stripping the `METTA_` prefix. This means `METTA_API_KEY` would be interpreted as `config.api.key`, not `config.api_key`. If any top-level or nested config field contains an underscore in its name (e.g., `api_key_env` in `ProviderConfigSchema`), there is no way to target it unambiguously via an environment variable.

**Impact:** `METTA_PROVIDERS_ANTHROPIC_API_KEY_ENV` would resolve to `config.providers.anthropic.api.key.env`, not `config.providers.anthropic.api_key_env`. The env override for that field is broken by design.

**Recommendation:** Define an explicit mapping table for env vars, use `__` (double underscore) as segment separator, or document the limitation and note which fields cannot be set via env.

---

## GAP-CL-03 — No test for malformed YAML config file [P1]

**Location:** `tests/config-loader.test.ts`

**Description:** All test cases use syntactically valid YAML. The silent-fallback behavior described in GAP-CL-01 is not tested, so the current behavior (swallow all errors) is not the result of a conscious design choice documented by a test.

**Recommendation:** Add a test that writes a syntactically invalid YAML file and asserts either an error is thrown or a warning is emitted, once GAP-CL-01 is resolved.

---

## GAP-CL-04 — Cache is not invalidated on environment variable changes [P2]

**Location:** `src/config/config-loader.ts:load`

**Description:** Once `load()` caches the config, subsequent mutations to `process.env` (adding or removing `METTA_*` variables) have no effect until `clearCache()` is called. This is not documented.

**Impact:** In test environments where env vars are mutated between assertions (as seen in `tests/config-loader.test.ts:afterEach`), a cached loader instance from a previous test would return stale config if shared across tests. The test suite correctly creates a new `ConfigLoader` per test, but the spec does not warn callers of long-lived instances.

**Recommendation:** Document this limitation explicitly. Consider adding a note that `ConfigLoader` instances SHOULD be short-lived (per-command) rather than application singletons.

---

## GAP-CL-05 — `local.yaml` gitignore requirement is unenforced [P2]

**Location:** `src/config/config-loader.ts` (design level)

**Description:** The spec states that `local.yaml` SHOULD be gitignored (as it is intended for personal overrides, API keys, etc.). However, nothing in the implementation checks or enforces this. A developer who commits `local.yaml` to version control risks leaking credentials.

**Recommendation:** Add a startup check (e.g., during `metta` CLI init or `ConfigLoader` construction) that warns if `<projectRoot>/.metta/local.yaml` is tracked by git. Alternatively, `metta init` should write `.metta/local.yaml` to `.gitignore` automatically.

---

## GAP-CL-06 — No test for default `globalDir` resolution [P3]

**Location:** `tests/config-loader.test.ts`

**Description:** Every test constructs `ConfigLoader` with an explicit `globalDir`. The default `~/.metta` path (derived from `homedir()`) is never exercised in tests.

**Recommendation:** Add a test asserting that `loader.globalPath` equals `join(homedir(), '.metta')` when `globalDir` is omitted.

---

## GAP-CL-07 — `ProjectConfigSchema` uses `.strict()` but merged config may fail on unknown env-injected keys [P3]

**Location:** `src/config/config-loader.ts:applyEnvOverrides` + `src/schemas/project-config.ts`

**Description:** `applyEnvOverrides` can inject arbitrary keys into the merged object. If a `METTA_*` variable maps to a key path not present in `ProjectConfigSchema`, the final `ProjectConfigSchema.parse(merged)` will throw a Zod validation error because all sub-schemas use `.strict()`.

**Impact:** A typo in an env var name (e.g., `METTA_DFAULTS_WORKFLOW`) causes a hard validation failure with a Zod error, which may be confusing to diagnose.

**Recommendation:** Document this behavior. Consider using `ProjectConfigSchema.passthrough()` at the top level before discarding unknown keys, or provide clearer error messages for env-var-induced validation failures.
