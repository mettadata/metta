# consolidate-duplicated-cli-helpers-shared-geterrormessage

## Problem

The codebase has accumulated several low-level duplication and hygiene issues across CLI and infrastructure modules that compound review burden and carry latent risk:

**1. `getErrorMessage` expression copied 53 times across 35 files.**
The expression `err instanceof Error ? err.message : String(err)` is inlined wherever a catch block needs a string message. It appears in at least 35 files, with heavy concentrations in `src/cli/commands/install.ts` (7 sites), `src/execution/execution-engine.ts` (5 sites), and `src/cli/commands/config.ts`, `src/cli/commands/specs.ts`, and `src/cli/commands/tasks.ts` (3 sites each). There is no shared helper. Any future change to error serialization (e.g., adding cause chaining or AggregateError unwrapping) must touch every site manually — a fragile, error-prone process.

**2. `askYesNo` defined locally in `install.ts`, masking the canonical exported version.**
`src/cli/commands/install.ts:134` defines a local `function askYesNo(question: string): Promise<boolean>` that is used once at line 242. This local version is missing the TTY-detection guard, JSON-mode skip, and `[y/N]` prompt formatting present in the exported `askYesNo` at `src/cli/helpers.ts:272`. In non-interactive (non-TTY) contexts — CI pipelines, piped input, JSON-output mode — the local version can block waiting for input that never arrives, causing a hang. The exported version in helpers.ts handles these cases correctly.

**3. Nine swallowed `.catch(() => {})` sites carry no rationale.**
There are exactly 9 bare `.catch(() => {})` calls in production source (excluding `statusline.mjs`, which is a template and out of scope). These cover legitimate best-effort cleanup operations — aborting an in-progress rebase or merge, unlinking a lock file, resetting to a snapshot tag, writing a `.gitignore` with the `wx` exclusive flag. Each is defensible, but the absence of any comment forces every future reader to re-derive the rationale from context.

**4. Two helpers.ts symbols are exported unnecessarily.**
`phaseColor()` (line 199) and `agentColorMap` (line 209) are only referenced internally within `src/cli/helpers.ts` (phaseColor at line 204, agentColorMap at line 222). Exporting them widens the public API surface of the module without purpose, which complicates future internal refactors and creates misleading import paths.

**5. Repeated structural patterns lack shared utilities (conditional consolidation).**
Three patterns appear in multiple files with enough regularity to warrant a shared helper, but only where the sites are genuinely identical:
- `readFile -> YAML.parse -> schema.parse` appears in ~6 files: `workflow-engine.ts`, `config-writer.ts`, `gate-registry.ts`, `state-store.ts`, `config-loader.ts`, `repair-config.ts`.
- `readFile -> JSON.parse -> throw on invalid JSON` appears 3 times inside `install.ts` at lines ~18–31, ~59–72, and ~100–114, each guarding a VS Code `settings.json` load with the same error message ("exists but is not valid JSON — refusing to overwrite").
- `git commit` invocations appear at ~7 sites with varied error-handling strategies (`fix-gap.ts:57`, `backlog.ts:141`, `fix-issue.ts:50`, `install.ts:377`, `complete.ts:554`, `finalize.ts:166`) alongside `helpers.ts:129`, which already exposes a commit helper.

Forcing consolidation where error handling diverges would alter behavior; these sites require per-site judgment.

## Proposal

### 1. Add `getErrorMessage` to `src/cli/helpers.ts` and replace all 53 inline sites

Add the following export to `src/cli/helpers.ts`:

```typescript
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
```

Every occurrence of the inline expression across all 35 files MUST be replaced with a call to `getErrorMessage(err)` (or the appropriate catch-clause variable name). The replacement MUST be behavior-identical — the function body is the exact expression being replaced. Import paths MUST use the `.js` extension per project ESM convention.

### 2. Remove the local `askYesNo` in `install.ts` and import the helper

The local `askYesNo` at `src/cli/commands/install.ts:134` MUST be deleted. The call site at line 242 MUST be updated to use the exported `askYesNo` from `src/cli/helpers.ts`. The import MUST be added to the existing helpers import line in that file. This change alters non-interactive behavior: the helpers version will detect a missing TTY and skip the prompt rather than blocking, which is the correct behavior for CI and piped contexts.

### 3. Add inline comments to all 9 swallowed `.catch(() => {})` sites

Each of the following 9 sites MUST receive a one-line comment explaining why the error is safe to ignore. Behavior MUST NOT change — no error-handling logic is added or removed:

- `src/finalize/finalize-lock.ts:91` — lock file unlink on release; file may already be gone
- `src/execution/worktree-manager.ts:102` — `git rebase --abort`; best-effort cleanup after conflict
- `src/execution/worktree-manager.ts:124` — `git merge --abort`; best-effort cleanup after conflict
- `src/ship/merge-safety.ts:84` — checkout starting branch on cleanup; non-fatal if already detached
- `src/ship/merge-safety.ts:119` — `git merge --abort`; best-effort rollback, error already captured
- `src/ship/merge-safety.ts:122` — `git merge --abort` (second attempt); same rationale
- `src/ship/merge-safety.ts:179` — `git reset --hard` to snapshot tag; best-effort recovery
- `src/ship/merge-safety.ts:188` — `git reset --hard` to snapshot tag (second site); same rationale
- `src/cli/commands/install.ts:300` — `writeFile` with `wx` flag for `.metta/.gitignore`; file may already exist from a prior run

### 4. Remove `export` from `phaseColor` and `agentColorMap`

`phaseColor` at `src/cli/helpers.ts:199` and `agentColorMap` at `src/cli/helpers.ts:209` MUST have their `export` keyword removed. No other file imports either symbol; this is a pure visibility reduction with no call-site changes.

### 5. Extract shared utilities where sites are genuinely identical (conditional)

**`loadYamlFile<T>(path, schema)` — SHOULD consolidate if sites are identical.**
If the `readFile -> YAML.parse -> schema.parse` pattern at all 6 sites (`workflow-engine.ts`, `config-writer.ts`, `gate-registry.ts`, `state-store.ts`, `config-loader.ts`, `repair-config.ts`) uses identical error-handling and return shape, add a `loadYamlFile<T>(filePath: string, schema: ZodSchema<T>): Promise<T>` utility to `src/cli/helpers.ts` or a new `src/util/yaml.ts` module (kebab-case filename per convention) and replace all identical sites. Sites with divergent error handling MAY be deferred and MUST be documented with rationale.

**Settings JSON load pattern — SHOULD consolidate within `install.ts`.**
The three `readFile -> JSON.parse -> throw` blocks in `install.ts` at lines ~18–31, ~59–72, and ~100–114 are structurally identical. Extract a local or module-level helper (e.g., `loadSettingsJson(path: string)`) and replace all three sites. This extraction is contained within a single file and carries no cross-module risk.

**`gitCommit` helper — DEFER.**
The 7 `git commit` sites have varied error-handling strategies. Forcing a single helper signature would require silent behavioral changes or an overly complex options bag. These sites MUST NOT be consolidated in this change. The deferral MUST be noted in a `// TODO(consolidate-git-commit):` comment at `src/cli/helpers.ts:129` for future cleanup.

### Conventions

All new or modified TypeScript code MUST use strict ESM with `.js` import extensions. Filenames MUST follow kebab-case. Any new module MUST have a corresponding test file to maintain the near 1:1 test-to-source ratio. All changes MUST preserve existing observable behavior except the `askYesNo` non-interactive fix, which is an intentional improvement.

## Impact

| Area | Detail |
|------|--------|
| `getErrorMessage` rollout | Touches 35 files; every change is a mechanical, behavior-identical substitution. Grep-verifiable: zero occurrences of the inline expression should remain after the change. |
| `askYesNo` fix in `install.ts` | Changes observable behavior in non-TTY contexts: the local version blocked; the helpers version exits the prompt cleanly. This is an improvement and removes a documented hang risk in CI. Interactive (TTY) behavior is unchanged. |
| `.catch(() => {})` comments | Comment-only; no runtime behavior changes. |
| `phaseColor` / `agentColorMap` visibility | No call-site changes; the symbols remain accessible within `helpers.ts`. If any downstream file was incorrectly importing them, the TypeScript compiler will surface the error at build time. |
| `loadYamlFile` extraction | Consolidates ~6 files behind a single Zod-validated loader; failure surface narrows. Deferred sites are explicitly documented. |
| Settings JSON helper | Consolidates 3 identical blocks within `install.ts`; reduces local line count, no cross-module impact. |
| `gitCommit` deferral | No runtime change; adds one TODO comment in helpers.ts. |
| Test coverage | Any new utility function (`getErrorMessage`, `loadYamlFile`, settings JSON helper) MUST have a corresponding unit test file per the near 1:1 convention. Existing tests are expected to pass unchanged. |

## Out of Scope

- **Splitting oversized files.** `install.ts`, `helpers.ts`, and `execution-engine.ts` are large. File decomposition is a separate, higher-disruption change and is not addressed here.
- **Introducing a custom error hierarchy.** Adding typed error subclasses (e.g., `MettaConfigError extends Error`) is a design decision with cross-cutting impact. `getErrorMessage` is a serialization utility only — it does not define or replace error types.
- **Changing test-location convention.** Tests currently live in `__tests__/` subdirectories alongside source. Relocating or restructuring tests is not part of this change.
- **`statusline.mjs` swallowed catches.** This file is a template artifact (`dist/` output), not a source file. It is excluded from the 9-site count and is not touched here.
- **`gitCommit` consolidation.** Explicitly deferred due to divergent error handling across the 7 call sites. Forcing consolidation here would require behavioral decisions that belong in a dedicated refactor.
- **Any changes to public CLI API or command behavior** beyond the `askYesNo` non-interactive fix described above.
