# bump-vitest-transitive-dependency-overrides-clear-6-open

## Problem

Six open Dependabot security alerts exist against `package-lock.json`. They span one runtime-scoped package and four dev-scoped packages that arrive through the vitest → vite toolchain:

| # | Package | Severity | Vulnerable range | Fixed at | Scope | Transitive path |
|---|---------|----------|-----------------|----------|-------|-----------------|
| 1 | form-data | HIGH | >= 4.0.0, < 4.0.6 | 4.0.6 | runtime | root → @anthropic-ai/sdk@0.39.0 → @types/node-fetch@2.6.13 → form-data |
| 2 | vite | HIGH | >= 7.0.0, <= 7.3.4 | 7.3.5 | dev | root → vitest → vite |
| 3 | vite | MEDIUM | >= 7.0.0, <= 7.3.4 | 7.3.5 | dev | root → vitest → vite (separate advisory) |
| 4 | postcss | MEDIUM | < 8.5.10 | 8.5.10 | dev | root → vitest → vite → postcss |
| 5 | esbuild | LOW | >= 0.27.3, < 0.28.1 | 0.28.1 | dev | root → vitest → vite → esbuild |
| 6 | vitest | CRITICAL | < 3.2.6 | 3.2.6 | dev | direct devDependency |

Alert 6 (vitest CRITICAL) is the root cause of alerts 2–5: the `^3.1.3` range in `package.json` resolves to 3.2.4, which pulls vite <= 7.3.4 and its sub-dependencies at vulnerable versions. Alert 1 (form-data HIGH) is independent, originating from the Anthropic SDK HTTP layer.

None of the six affected packages can be resolved by normal semver resolution under the current `package.json` constraints: vitest is pinned to `^3.1.3`, which permits 3.2.4 but not 3.2.6 until the lower bound is raised; the others are purely transitive with no direct entry in `package.json`.

## Proposal

Make three targeted edits to `package.json` and regenerate the lock file:

1. **Raise the direct `vitest` devDependency** from `^3.1.3` to `^3.2.6`. This makes 3.2.6 the minimum resolved version and causes npm to pull the patched vite, postcss, and esbuild transitively where semver allows.

2. **Add an `overrides` block** to `package.json` that forces the following minimum versions for transitive packages that npm semver alone cannot guarantee:

   ```json
   "overrides": {
     "form-data": ">=4.0.6",
     "vite": ">=7.3.5",
     "postcss": ">=8.5.10",
     "esbuild": ">=0.28.1"
   }
   ```

   `form-data` MUST be listed here because it is three hops from the root through `@anthropic-ai/sdk` and has no direct dependency entry to bump. The vite-family overrides act as a hard floor in case the transitive resolution produces an older patch for any reason.

3. **Regenerate `package-lock.json`** by running `npm install`. The resulting lock file MUST resolve all six packages at or above their respective fixed versions. No other production or development dependencies SHOULD change beyond patch-level transitive re-pins caused by the overrides.

All changes are patch- or minor-level within each package's existing major version. No public API changes are expected in any of the six packages at these version jumps.

## Impact

- **Security posture:** All 6 open Dependabot alerts are closed. The CRITICAL vitest alert and the HIGH form-data alert are the most material risk reductions.
- **Test runner:** vitest bumps from 3.2.4 to >= 3.2.6 (patch). The full existing test suite MUST pass under the new version before this change is shipped.
- **Build toolchain:** vite (dev), postcss (dev), and esbuild (dev) receive patch bumps. These affect only local development and CI — no production bundle is emitted by metta.
- **Runtime HTTP layer:** form-data is forced from 4.0.5 to >= 4.0.6, a patch bump within major 4. The `@anthropic-ai/sdk` API surface does not change; only the underlying HTTP form encoding library is patched. No behavior change is expected.
- **Lock file churn:** `package-lock.json` will show version changes for the six packages and possibly minor re-pins of their own sub-dependencies. This is expected and intentional.
- **No other code changes:** Source files, configuration files, spec files, and skill templates are untouched.

## Out of Scope

- Bumping any dependency not in the list of six alerts above.
- Upgrading `@anthropic-ai/sdk` to a different major or minor version.
- Removing or replacing the Anthropic SDK or its transitive chain.
- Refactoring test files or changing test configuration.
- Addressing any Dependabot alerts that may arise after this change ships.
- Migrating from npm overrides to a different resolution strategy (e.g., `resolutions` for Yarn, `pnpm.overrides`).
- Evaluating or switching the test runner away from vitest.
- Changes to CI pipeline configuration beyond what is required for the lock file update to be recognized.
