# fix-ci-test-flakiness-undeclared-tsx-dependency

## Problem

CI runs on `main` fail intermittently even when the identical commit passes all 36 tests locally. On run 31445864846 (2026-08-11), six fast failures scattered across `tests/cli-status.test.ts` and `tests/cli-complete.test.ts` showed two shapes: ENOENT for `/tmp/metta-cli-*/.metta/config.yaml` (a `metta install` subprocess killed before it scaffolded the config) and "Unexpected end of JSON input" (a CLI subprocess killed mid-run, leaving empty stdout for `JSON.parse`).

The root cause is an undeclared runtime dependency in the CLI test path. `runCli` in `tests/helpers/cli.ts:38` execs `npx tsx src/cli/index.ts` with a hard 10s `execFile` timeout, but `tsx` appears nowhere in `package.json` (devDependencies at `package.json:43` are only `@types/node`, `typescript`, `vitest`) — consistent with the constitution's statement that "tsx is not currently part of the dev loop." Locally, `npx` resolves tsx from a warm cache so invocations are fast and deterministic. On cold CI runners, `npm ci` never installs tsx, so `npx` may fetch it from the npm registry per invocation; any slow or failed fetch burns the 10s timeout and kills the CLI mid-test, producing exactly the observed failure shapes. The CI job order compounds the exposure: `.github/workflows/ci.yml:32` runs `npm test` before `npm run build`, so no `dist/` exists at test time and the tsx execution path is the only one exercised.

Affected parties:
- **Metta maintainers**, who see red CI on green commits, lose trust in the gate signal, and waste time re-running jobs or triaging phantom failures.
- **The change lifecycle itself**: metta's finalize/ship gates require tests to pass, so nondeterministic CI directly blocks shipping unrelated changes.
- **Every current and future CLI integration test** that goes through `runCli` — the flake surface grows with each new lifecycle test.

## Proposal

Make the CLI integration tests deterministic on cold runners by eliminating the undeclared, network-resolved tsx dependency from the test execution path (or, at minimum, making the CLI runtime an explicitly declared, offline-resolvable dependency). Concretely, this change will:

1. Change how `runCli` in `tests/helpers/cli.ts` locates and executes the CLI so that every binary/runtime it invokes is guaranteed present after `npm ci`, with no per-invocation registry fetches. The specific mechanism (running the built `dist/cli/index.js`, declaring tsx as a devDependency, or another deterministic runner) is a design-phase decision — candidate trade-offs are documented in the issue and must be reconciled with both the constitution's "tsx is not part of the dev loop" statement and the helper's own "do NOT switch to dist" comment at `tests/helpers/cli.ts:12`; whichever loses must be updated so no stale guidance survives.
2. Align `.github/workflows/ci.yml` job ordering with the chosen mechanism (e.g., build before test if tests exercise `dist/`), so CI exercises the same execution path developers do.
3. Keep the local dev loop working: `npm test` from a fresh clone plus `npm ci` must pass without any manual pre-step beyond what the npm scripts themselves encode.
4. Update the stale in-code comments and, if the mechanism touches the dev-loop policy, the constitution wording — so code, CI, and stated policy agree.

Success criteria: `npm test` passes on a cold CI runner with no network access beyond `npm ci`; no test subprocess resolves a binary that is not installed by `npm ci`; the 10s `runCli` timeout is only ever spent on actual CLI work, not dependency resolution.

## Impact

- **`tests/helpers/cli.ts`** — the `runCli` helper (and `CLI_PATH`) changes execution mechanism; all CLI integration tests that call it inherit the fix with no per-test edits expected.
- **`.github/workflows/ci.yml`** — the gates job step ordering may change (build before test) depending on the chosen mechanism; the audit job is untouched.
- **`package.json`** — possibly gains a devDependency (tsx) or a script adjustment (e.g., pretest build), depending on the design decision.
- **Constitution / CLAUDE.md wording** — the "tsx is not currently part of the dev loop" statement is either reaffirmed (by removing tsx from the test path) or revised (by declaring it); one of the two must happen.
- **Developer experience** — test runs may get a build step or a new install-time dependency; either way behavior becomes deterministic. No production/runtime code paths change: `src/cli/index.ts` behavior, published package contents, and end-user CLI behavior are unaffected.
- **Risk** — if tests move to `dist/`, a stale build could mask source changes locally; the design must prevent that (e.g., scripted rebuild before test) rather than rely on developer discipline.

## Out of Scope

- Choosing the final mechanism in this intent — solution selection (dist-based execution vs. declared tsx vs. other) belongs to research/design; this document only fixes the problem frame and constraints.
- Raising the 10s `runCli` timeout as the fix — it treats the symptom, not the undeclared dependency, and is explicitly rejected as a standalone remedy (a timeout adjustment may accompany the real fix only if the chosen mechanism justifies it).
- Any behavioral change to the CLI itself (`src/cli/**`), its commands, output formats, or exit codes.
- Rewriting or restructuring the CLI test suites beyond what the helper change requires; test assertions and coverage stay as they are.
- Broader CI hardening (retries, caching strategy overhauls, matrix builds, flake quarantine tooling) beyond the step reordering directly required by the chosen mechanism.
- Adding tsx (or any runtime) to production `dependencies` or the published package.
- Fixing other, unrelated sources of test flakiness, should any exist.
