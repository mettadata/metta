# Research: fix-ci-only-test-setup-failures-runcli-swallows-install

## Decision: Loud setup helper + CI-only vitest file-serialization (combined)

### Approaches Considered

1. **Loud setup helper** (selected) — Add `execCliRaw` → `CliSetupError` + `runCliOrThrow` + `installFixture` to `tests/helpers/cli.ts`; migrate the discarded-result install call sites. Measured landscape: 180 install call sites in 15 files; **166 bare (silent) sites**, of which 162 are the identical line `await runCli(['install', '--git-init'], tempDir)` — mechanically sed-able to `await installFixture(tempDir)`. All 14 result-captured sites (including the one intentional-failure install at `tests/cli-install.test.ts:436`) are excluded by construction, and `cli-install.test.ts`'s own bare sites stay on `runCli` because install behavior is what that file tests. `runCli`'s resolve-always contract stays byte-identical for the ~13 tests asserting `code !== 0`. Details: `research-loud-setup-helper.md`.

2. **Cap CI concurrency** (selected) — CI-only `fileParallelism: !isCI` in `vitest.config.ts`. Evidence from real CI runs corrected two assumptions: the runner is effectively **4-core** (observed ~2.9× parallelism → 4 fork workers), and per-project serialization of only the heavy `cli-*` files is **unsupported on the pinned vitest 3.2.6** (all parallelism knobs are documented root-only `NonProjectOption`s), so the targeted split is deferred to a vitest 4 upgrade. Full serialization is the only supported config that deterministically prevents concurrent exec storms; estimated CI Test step cost +6–10 min (~6.2 → ~12–16 min). Fallback if that proves too slow: `maxWorkers: isCI ? 2 : undefined` (+2–3 min, mitigation only — acceptable only because the loud helper makes any residual flake self-diagnosing). Details: `research-ci-concurrency-cap.md`.

3. **Reduce per-call process cost** — Replace `execFile('npx', ['tsx', CLI_PATH, ...])` with `execFile('node', ['--import', TSX_LOADER, CLI_PATH, ...])` where `TSX_LOADER = import.meta.resolve('tsx')` (resolved once in-repo; bare `--import tsx` fails from temp cwds). Measured: 3 → 1 process per call and ~1.79 s → ~0.91 s per invocation across ~670 call sites; still tests from source (the prebuilt-`dist` variant was rejected — it re-imports this project's stale-dist bug class). **Not selected for this change**: it is outside the spec's six requirements, and 18 test files inline their own npx exec copies that would need sweeping — a larger blast radius than this fix warrants. Recorded as a high-value follow-up (it would claw back most of approach 2's CI wall-clock cost). Details: `research-process-cost.md`.

### Rationale

The issue has two stacked defects, and the two selected approaches map to them exactly:

- **Diagnosability (defect 1):** the loud setup helper converts the current invisible failure (dead install child → misleading downstream ENOENT) into an immediate error carrying argv, cwd, exit code, signal, and 8 KiB stderr/stdout tails — first-class signal reporting the current stderr-marker approach loses. It also covers the "exited 0 but wrote no `.metta/config.yaml`" corner. This is required regardless of the concurrency fix: even a serialized suite can lose a setup child to a slow cold tsx compile inside the 10 s timeout.
- **CI-only failure trigger (defect 2):** serializing test files in CI removes the 4-workers × 3-process-exec-chain storm (~16–20 concurrent processes on 4 cores) that matches the observed failure signature. It is a 3-line, fully supported config change, reproducible locally with `CI=1 npm test`, and preserves local parallelism.

Combined, CI goes green deterministically and any future regression fails loudly with the true errno instead of a phantom flake. The wall-clock cost is bounded and recoverable later (vitest 4 per-project split, or the process-cost follow-up).

### Artifacts Produced

- [Research: loud setup helper](research-loud-setup-helper.md)
- [Research: CI concurrency cap](research-ci-concurrency-cap.md)
- [Research: per-call process cost](research-process-cost.md)
