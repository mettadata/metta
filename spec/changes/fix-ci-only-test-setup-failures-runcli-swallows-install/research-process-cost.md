# Research: Reduce per-call process cost of `runCli`

Change: `fix-ci-only-test-setup-failures-runcli-swallows-install`
Angle: drop the `npx` wrapper (and ideally the tsx CLI wrapper) so each CLI test invocation spawns fewer processes and starts faster.
Date: 2026-08-11. Measurements on local Linux (Fedora, Node v22.22.0, npm 10.9.4, tsx 4.23.12, warm caches) inside the change worktree.

## Problem summary

CI-only failures on 2-core GitHub runners: `metta install` children spawned during test setup die in ~1s with no stderr. Every `runCli` call in `tests/helpers/cli.ts` execs `npx tsx src/cli/index.ts ...`, a 3-process chain (npx wrapper node → tsx CLI node → tsx's actual worker node — process-tree check below confirms the tsx CLI forks a child). The repo has ~670 `runCli(` call sites plus 18 test files that inline their own `execAsync('npx', ['tsx', CLI_PATH, ...])` copies (e.g. `tests/context-stats.test.ts:13`, `tests/tokens-command.test.ts:18`, `tests/cli-propose-stop-after.test.ts:16`). Hundreds of 3-process spawns across concurrent vitest workers plausibly exhausts spawn resources (EAGAIN/ENOMEM) on a 2-core runner.

## Current mechanism

`tests/helpers/cli.ts`:
- `CLI_PATH = <repo>/src/cli/index.ts`; `runCli` runs `execFile('npx', ['tsx', CLI_PATH, ...args], { cwd, timeout })` where `cwd` is usually a temp project dir **outside the repo**.
- A contract comment (lines 11–15) pins tsx as a declared devDependency so `npx` resolves the local binary without a registry fetch. Note: the comment's guarantee is load-bearing — `npx` still burns time on cache/binstub resolution every call even when local.
- CI (`.github/workflows/ci.yml`) runs `npm ci` then `npm test` (vitest, default pool/worker settings — `vitest.config.ts` sets no concurrency limits).

## Alternatives compared

Benchmark: 5 sequential `... src/cli/index.ts --help` runs from the worktree root.

| Variant | Total (5 runs) | Per call | node processes per call |
|---|---|---|---|
| A. `npx tsx` (current) | 8.93 s | ~1.79 s | 3 |
| B. `node_modules/.bin/tsx` directly | 5.77 s | ~1.15 s | 2 |
| C. `node --import <tsx loader>` | 4.55 s | ~0.91 s | 1 |
| D. `node dist/cli/index.js` (prebuilt) | 2.31 s | ~0.46 s | 1 (+ one 6.8 s `npm run build`) |

Process counts verified empirically: running `tsx -e "console.log(process.ppid)"` shows the inner process's parent is the tsx CLI wrapper, not the shell (tsx CLI forks a child node); `node --import <loader>` reports the shell as parent (single process). This matches tsx's docs: the loader/`--import` mode "is limited to adding support for loading TypeScript/ESM files" — no watch mode, no warning suppression — i.e. it is the in-process hook path, while the CLI is a wrapper.[^1]

### A. Status quo — `npx tsx`
- Pros: none beyond inertia.
- Cons: slowest (~1.79 s/call), 3 processes/call, npx cache/binstub lookup every call, worst spawn pressure. This is the suspect.

### B. Resolve `node_modules/.bin/tsx` directly
- `join(REPO_ROOT, 'node_modules', '.bin', 'tsx')` — verified it exists after `npm ci` (symlink → `../tsx/dist/cli.mjs`) and works with an absolute path when `cwd` is a temp dir with no `node_modules`.
- Pros: minimal diff (swap the argv), 36 % faster, drops one process.
- Cons: still 2 processes/call (tsx CLI forks); `.bin` shims differ on Windows (`tsx.cmd`) — this project targets Linux CI (`ubuntu-latest`) and Linux dev, so a soft concern only; path breaks silently if npm ever hoists differently (workspaces — not used here).

### C. `node --import <tsx loader> src/cli/index.ts`  ← recommended
- tsx docs: `node --import tsx ./file.ts` registers TS+ESM support for both module and CJS contexts (Node ≥ 20.6; project requires ≥ 22).[^1]
- **Critical gotcha, verified**: bare `node --import tsx <file>` **fails when `cwd` is a temp dir** — Node resolves the bare specifier `tsx` relative to the subprocess cwd, and runCli's cwd is a temp project with no `node_modules`. Fix: resolve the loader to an absolute `file://` URL **once, inside the helper**, which runs in-repo under vitest:
  ```ts
  const TSX_LOADER = import.meta.resolve('tsx')
  // → file:///…/node_modules/tsx/dist/loader.mjs (verified; equals tsx's "." export)
  execFile('node', ['--import', TSX_LOADER, CLI_PATH, ...args], { cwd, timeout })
  ```
  Verified end-to-end via `execFile` from a no-`node_modules` temp cwd: exits 0, correct `--help` output. `import.meta.resolve('tsx')` verified working on Node 22.22 in this repo; it follows tsx's export map, so no hardcoded `dist/loader.mjs` internal path.
- Verified stderr is clean — no `ExperimentalWarning` noise on Node 22.22/tsx 4.23.12 that could break the tests asserting `stderr === ''` (e.g. `tests/metta-guard-bash.test.ts`).
- Pros: 1 process/call (3× fewer than today), ~2× faster startup, still runs **from source** (no staleness), fully cross-platform (`node` + file URL, no `.bin` shims), tsx stays a declared devDependency exactly as the existing contract comment requires.
- Cons: loses tsx-CLI-only conveniences (none used by `runCli`); slightly less obvious invocation, mitigated by updating the helper's contract comment.

### D. Build once, run `node dist/cli/index.js`
- Fastest per call (~0.46 s, 4× vs today) and 1 process; build cost is a one-off 6.8 s (could live in vitest `globalSetup`).
- Cons that outweigh the speed: this project has a live class of **stale-dist bugs** (see `spec/issues/` — "hooks-and-statusline-execute-stale-main-checkout-dist" — and the pending stale-dist fix in project memory); tests would exercise compiled output that can drift from `src/` whenever someone runs tests without rebuilding locally, converting the CI flake into a "tests pass against yesterday's code" hazard. Also couples every test run to the full `tsc` + template-copy pipeline and to `dist/` mutation racing a developer's `npm run dev`. Rejected for test-harness use.

## Risks (for the recommended option C)

1. **cwd-relative specifier resolution** — the one real trap; solved by resolving the loader URL in the helper (in-repo) and passing an absolute `file://` URL. Never pass bare `--import tsx` to a subprocess with a temp cwd.
2. **Drift in inline copies** — 18 test files duplicate the npx exec instead of calling `runCli`. The fix must sweep them (best: route them through the helper, or export a shared `cliArgv()`/`execCli` from `tests/helpers/cli.ts`), or CI pressure only partially drops.
3. **Contract comment accuracy** — lines 11–15 of `tests/helpers/cli.ts` document the npx/tsx resolution contract. Must be rewritten: tsx remains a required devDependency (the loader lives in `node_modules/tsx`), but the "npx resolves the local binary" rationale becomes "the helper resolves tsx's loader via `import.meta.resolve` at module load; a missing tsx now fails fast at import time instead of flaking at exec time" — a strictly better failure mode.
4. **Env passing** — unchanged: `execFile` inherits `process.env` by default in both old and new forms; no PATH dependence remains at all (no `npx`, no `.bin`), which removes an implicit env assumption rather than adding one.
5. **npm workspaces / hoisting** — not used in this repo; `import.meta.resolve` would keep working even if they were, unlike a hardcoded `.bin` path.
6. **tsx upgrades** — the `"."` export is tsx's stable public loader entry (export map checked, tsx 4.23.12); `import.meta.resolve('tsx')` tracks it automatically.
7. **Does this fully fix CI?** — Plausibly but not provably: it cuts per-call processes 3→1 and startup ~2×, directly attacking the spawn-exhaustion hypothesis, but if the root cause is something else (e.g. vitest worker count × per-test children), pairing with a vitest concurrency cap remains a cheap belt-and-braces addition. This research angle only claims the process-cost reduction.

## Recommended option

**Option C** — replace `execFile('npx', ['tsx', CLI_PATH, …])` with `execFile('node', ['--import', TSX_LOADER, CLI_PATH, …])` where `TSX_LOADER = import.meta.resolve('tsx')` computed once in `tests/helpers/cli.ts`; sweep the 18 inline-npx test files onto the shared helper; update the helper's contract comment. Option B is the fallback if `--import` misbehaves on some future Node/tsx combo (keep it in the commit message as the known-good alternative).

## Verdict

`node --import <resolved tsx loader>` gives a 3× reduction in processes per CLI invocation and ~2× faster startup (measured ~1.79 s → ~0.91 s per call, ~670 call sites) while still testing from source, with zero new dependencies and one well-understood gotcha (cwd-relative resolution) already designed around and verified. It is the best cost/risk point among the four options; the prebuilt-dist option is faster still but re-imports this project's known stale-dist bug class into the test harness and is rejected.

[^1]: https://tsx.is/node (mirrored at https://www.npmjs.com/package/tsx) — "Node.js Loader: pass tsx to the `--import` flag"; loader mode limitations (no CLI features). Accessed 2026-08-11 via search snippet; direct fetch of tsx.is failed: local TLS issuer error. Loader behavior, Node-version floor, and cwd-resolution behavior all verified empirically in this worktree (Node 22.22.0, tsx 4.23.12).
