# Research: Declare tsx as a devDependency

Approach evaluated for change `fix-ci-test-flakiness-undeclared-tsx-dependency`.

## Approach

Add `tsx` to `devDependencies` in `package.json` (with the corresponding `package-lock.json` entry) so `npm ci` installs it into `node_modules` and every `npx tsx …` call in the test suite resolves the locally installed binary instead of fetching tsx from the npm registry on cold CI runners.

## How it works

`npx` resolves package names against the local project first: "Package names provided without a specifier will be matched with whatever version exists in the local project." Only "if any requested packages are not present in the local project dependencies" does npx install them into the npm cache from the registry.[^1]

Today tsx is **not** in the local project — the lockfile has no `node_modules/tsx` entry (the only `tsx` string in `package-lock.json` is vite's *optional peer dependency* declaration, which installs nothing). So on a cold CI runner (`npm ci` → `npm test`, per `.github/workflows/ci.yml` — tests run before `npm run build`), the first `npx tsx` in each fresh npx-cache state performs a registry fetch of tsx + esbuild inside the test's `execFile` call, which has a hard `timeout: 10000` in `tests/helpers/cli.ts` (`runCli`). A slow fetch consumes the budget and the CLI is killed mid-run — the observed flakiness.

Once tsx is a devDependency, `npm ci` installs it deterministically from the lockfile during the workflow's existing "Install dependencies" step (which is also covered by `actions/setup-node`'s npm cache), and `npx tsx` becomes a pure local lookup with zero network I/O. **No test file changes are needed** — this transparently fixes not just `tests/helpers/cli.ts` but the ~20 other test files that inline their own `execAsync('npx', ['tsx', CLI_PATH, …])` calls (e.g. `tests/complexity-tracking.test.ts`, `tests/config-set-edit.test.ts`, `tests/cli-metta-guard-bash-integration.test.ts`, `tests/context-stats.test.ts`).

### Version to pin

Latest stable is **tsx 4.23.12** (published 2026-08-11).[^2] Its manifest (npm registry, verified directly):

- `dependencies`: `esbuild: ~0.28.0` (plus optional `fsevents: ~2.3.3` for macOS)
- `engines`: `node >=18.0.0` (project requires >=22 — fine)

This is an unusually clean fit for this repo:

- The lockfile **already contains `esbuild@0.28.1`** and all `@esbuild/*` platform binary packages (including `@esbuild/linux-x64` for ubuntu-latest CI), so adding tsx adds essentially one package to the tree.
- The existing `overrides` entry `"esbuild": ">=0.28.1"` in `package.json` is *satisfied natively* by tsx's `~0.28.0` range — no override conflict, no forced-mismatch risk right now.

Recommend `"tsx": "^4.23.12"` (caret, matching the convention of every other devDependency in `package.json`; `npm ci` pins to the lockfile's exact version regardless, so CI is deterministic either way).

## Required changes (file-by-file)

1. **`package.json`** — add to `devDependencies` (alphabetical position between `@types/node` and `typescript`):
   ```json
   "tsx": "^4.23.12"
   ```
2. **`package-lock.json`** — regenerate via `npm install --save-dev tsx@^4.23.12` (never hand-edit). Expected delta: root `devDependencies` mirror + one new `node_modules/tsx` package entry (~15 lines); `esbuild@0.28.1` and all `@esbuild/*` platform entries already exist, unchanged.
3. **`spec/project.md`** (line 17) — the constitution's toolchain line currently reads: `**Toolchain:** \`tsc\` for build, \`npm\` for package management (tsx is not currently part of the dev loop)`. This parenthetical becomes false and must be updated, e.g.: `(tsx is a devDependency used only by the test suite to run the CLI from source; \`tsc\` remains the sole build path)`. Note the line was already *de facto* inaccurate — the test suite has depended on tsx via npx all along; this change makes the docs honest rather than introducing a new tool.
4. **`CLAUDE.md`** — the Stack section embeds the same sentence; regenerate via the refresh flow (or edit in lockstep with `spec/project.md`) so constitution and CLAUDE.md stay consistent.
5. **No changes** to `tests/helpers/cli.ts`, any test file, or `.github/workflows/ci.yml`. The helper's comment ("Behavior is identical — do NOT switch to dist") is preserved exactly.

## Pros

- **Minimal diff, zero test-file churn**: two manifest files + one doc line fix ~20 call sites at once.
- **Deterministic**: `npm ci` installs the lockfile-pinned tsx; no per-invocation registry resolution, no npx-cache nondeterminism, works offline after install.
- **Removes the entire flake mechanism** rather than papering over it (vs. raising the 10s timeout, which just widens the race).
- **Preserves test intent**: tests keep exercising the CLI from TypeScript source pre-build, matching CI's test-before-build ordering.
- **Consistent with existing constraints**: esbuild 0.28.1 already in the tree satisfies both tsx's `~0.28.0` and the repo's `esbuild >= 0.28.1` override; no dependency conflicts introduced.
- **Honest manifest**: the test suite's real runtime dependency is finally declared, so `npm ci && npm test` is self-contained on any fresh machine, not just CI.

## Cons / Risks

- **Constitution touch required**: `spec/project.md` and `CLAUDE.md` must be updated in the same change or the docs contradict `package.json`. (One line each; low effort but easy to forget.)
- **Residual per-invocation latency**: each `runCli` still pays npx local-resolution overhead (~50–150 ms) plus tsx/esbuild transform of the CLI module graph (~200–500 ms). That cost exists today on warm caches, so this is *no regression* — but it is slower than a hypothetical run-from-`dist` approach. Optional follow-up (out of scope): exec `node_modules/.bin/tsx` or `node --import tsx` directly to shave the npx layer.
- **Supply chain**: one new direct devDependency (`tsx`, maintained by privatenumber, tens of millions of weekly downloads[^2]); its only runtime dep, esbuild, is already in the tree and covered by the existing `npm audit --audit-level=high` CI job and the `esbuild >= 0.28.1` override.
- **esbuild override drift**: if esbuild later ships `0.29.x`/`0.30.x`, the blanket `>=0.28.1` override could force tsx onto an esbuild outside its tested `~0.28.0` range on a future `npm install`. Mitigation: lockfile pins until someone regenerates it; tsx historically tracks new esbuild minors within days.
- **Platform binary edge case**: npm's known optional-dependency lockfile issue (npm/cli#4828 class) can drop `@esbuild/*` platform packages when a lockfile is regenerated. Current lockfile (npm 10.9.4) records all platforms including `@esbuild/linux-x64`, so CI on ubuntu-latest is covered; keep regenerating the lockfile with npm >= 10.
- **Does not touch the 10 s timeout**: an extremely slow runner could still hit it from process-spawn cost alone, but with the multi-second registry fetch eliminated, local cold-start (~1–2 s) leaves ample headroom.

## Verdict

**9/10** — smallest possible deterministic fix that eliminates the root cause (network I/O inside a timed exec) with no test changes, no CI changes, and no dependency conflicts; the only real cost is a one-line constitution/doc update acknowledging tsx as a test-suite devDependency.

[^1]: https://docs.npmjs.com/cli/v11/commands/npx accessed 2026-08-11
[^2]: https://www.npmjs.com/package/tsx accessed 2026-08-11 (latest: 4.23.12); manifest verified via https://registry.npmjs.org/tsx/4.23.12
