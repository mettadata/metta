# CI test flakiness from undeclared tsx dependency in the CLI test helper

**Captured**: 2026-08-11
**Status**: logged
**Severity**: major

## Symptom
On main run 31445864846 (2026-08-11), CI showed 6 scattered fast failures across `tests/cli-status.test.ts` and `tests/cli-complete.test.ts` — ENOENT for `/tmp/metta-cli-*/.metta/config.yaml` (install died before scaffolding the config) and "Unexpected end of JSON input" (empty stdout from a CLI process killed mid-run) — while the identical commit passes 36/36 locally.

## Root Cause Analysis
The CLI test helper `runCli` execs `npx tsx src/cli/index.ts` with a hard 10s timeout, but `tsx` is not declared anywhere in `package.json` (CLAUDE.md explicitly notes "tsx is not currently part of the dev loop"). Locally, `npx` resolves tsx from a warm npx cache, so invocations are fast and deterministic. On cold CI runners, `npm ci` installs only declared dependencies — tsx is never installed — so `npx` may resolve tsx from the npm registry per invocation. Any slow or failed registry fetch consumes the 10s `execFile` timeout and kills the CLI mid-test, producing exactly the observed failure shapes: an install that dies before writing `.metta/config.yaml` (ENOENT on later reads) and a killed process whose empty stdout fails JSON parsing. The CI job order compounds this: `npm test` runs before `npm run build`, so no `dist/` exists at test time and the tsx runtime path is the only one exercised.

### Evidence
- `tests/helpers/cli.ts:38` — `runCli` execs `npx tsx src/cli/index.ts` with `timeout: 10000`, so any npx resolution latency counts against the 10s window and a timeout kills the CLI mid-run.
- `package.json:43` — `devDependencies` contains only `@types/node`, `typescript`, and `vitest`; tsx is undeclared, so `npm ci` never installs it and cold-cache npx must hit the registry.
- `.github/workflows/ci.yml:32` — the gates job runs `npm test` before `npm run build`, confirming tests depend entirely on the undeclared tsx runtime and cannot fall back to `dist/`.

## Candidate Solutions
1. **Add tsx as a devDependency** — Declare tsx in `package.json` so `npm ci` installs it and `npx tsx` resolves locally and deterministically on every runner. Smallest possible diff and no change to test behavior. Tradeoff: contradicts the stated policy that tsx is not part of the dev loop, and adds a runtime dependency solely for tests.
2. **Run tests against the built dist/ CLI** — Change `runCli` to exec `node dist/cli/index.js` and reorder CI so `npm run build` precedes `npm test` (tsc build is already a gate). Removes the tsx runtime entirely, aligning with the dev-loop policy. Tradeoff: `tests/helpers/cli.ts:12` explicitly warns "do NOT switch to dist" for behavior parity, and the dev loop must rebuild before every test run or risk testing stale code.
3. **Raise the 10s runCli timeout for CI headroom** — Bump the `execFile` timeout (or make it environment-sensitive) so cold-cache npx fetches fit inside the window. Tradeoff: treats the symptom, not the cause — a failed or very slow registry fetch still breaks the run, and every genuine hang now takes longer to fail.

