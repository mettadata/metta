# Design: fix-ci-test-flakiness-undeclared-tsx-dependency

## Approach

Adopt the selected research approach: **declare tsx as a devDependency** so the
CLI test harness's runtime is installed by `npm ci` and resolved locally by
`npx`, never fetched from the registry at test time.

Concretely:

1. Run `npm install --save-dev tsx@^4.23.12` at the repo root, producing the
   `package.json` `devDependencies` entry and the regenerated
   `package-lock.json`. The lockfile already carries `esbuild@0.28.1` and the
   `@esbuild/*` platform binaries, satisfying tsx's `esbuild ~0.28.0` range —
   the dependency tree grows by essentially one package.
2. Reconcile stale guidance so no surviving statement contradicts the
   mechanism (spec requirement "Actionable Failures and Consistent Runtime
   Policy"):
   - `spec/project.md` Toolchain line: replace "(tsx is not currently part of
     the dev loop)" with wording stating tsx is a declared devDependency used
     by the CLI test harness (`runCli`), while `tsc` remains the build tool.
   - `CLAUDE.md` mirrors the same sentence in its Stack paragraph — update it
     identically.
   - `tests/helpers/cli.ts` header comment: retire the historical "do NOT
     switch to dist" parity note; state that the helper runs `npx tsx` against
     `src/cli/index.ts` and that tsx is a **declared devDependency** — it must
     never be removed from `package.json` while this helper execs it.
3. Make timeout kills diagnosable (spec scenario "Timeout failure is
   diagnosable"): in `runCli`'s catch block, detect a killed subprocess
   (`e.killed === true` or `e.signal` set — Node's `execFile` sets these when
   the `timeout` option fires) and append a marker line to the returned
   `stderr`, e.g. `[runCli] subprocess killed (signal=SIGTERM, timeout=10000ms)`.
   Return shape `{ stdout, stderr, code }` is unchanged, so all ~356 existing
   call sites inherit the improvement with zero edits; a test that then fails
   on empty stdout shows the kill marker in its captured stderr.
4. Add a lightweight regression guard test, `tests/cli-runtime-declared.test.ts`:
   - asserts `package.json` `devDependencies` declares `tsx` (the flake class
     cannot silently return via a dependency cleanup), and
   - asserts `runCli`'s timeout diagnosability by spawning a deliberately
     killed subprocess through the same exec options and checking the stderr
     marker (kept simple; no network, temp-dir isolated per project norms).

No changes to `.github/workflows/ci.yml`: the mechanism runs from source, so
the existing `npm ci → npm test → npm run build` order already satisfies the
"CI Ordering Consistent With Execution Path" requirement (no pre-test artifact
is needed, and CI and local runs exercise the identical `runCli` path). The
audit job is untouched.

## Components

- `package.json` / `package-lock.json` — declare and lock `tsx@^4.23.12`
  (devDependencies). Responsibility: make `npm ci` install the test runtime.
- `tests/helpers/cli.ts` — comment reconciliation + timeout kill marker in the
  `runCli` catch path. Responsibility: single shared exec path for all CLI
  integration tests; actionable failure output.
- `tests/cli-runtime-declared.test.ts` (new) — regression guard.
  Responsibility: pin the invariant "test runtime is declared" and the
  diagnosability behavior.
- `spec/project.md`, `CLAUDE.md` — constitution/docs reconciliation.
  Responsibility: no stale "tsx is not part of the dev loop" claim survives.

## Data Model

N/A — no state files, schemas, or persisted structures change; this is
dependency declaration plus test-harness and documentation edits.

## API Design

N/A — no public CLI or module API changes. `runCli`'s exported signature and
return shape are unchanged; only its `stderr` content gains a marker line when
a subprocess is killed.

## Dependencies

- **New (dev-only):** `tsx@^4.23.12` — TypeScript execute runtime used
  exclusively by the test harness. Transitive: `esbuild ~0.28.0` (already
  satisfied by locked `esbuild@0.28.1` + `@esbuild/*` binaries) and
  `get-tsconfig`.
- **Internal:** all `tests/cli-*.test.ts` files depend on
  `tests/helpers/cli.ts`; they inherit the fix with no edits.
- **Removed/none:** no dependency removals; no CI workflow dependency changes.

## Risks & Mitigations

- **Constitution drift** (doc says tsx not in dev loop): mitigated by updating
  `spec/project.md` and `CLAUDE.md` in the same change — required by the spec's
  "No contradictory guidance survives" scenario.
- **Supply-chain surface** (+1 dev dependency): tsx is pinned via caret range
  in the lockfile and installed only in dev/CI; esbuild binaries were already
  present, so the net new surface is minimal.
- **Version drift breaking the harness later:** the regression guard test
  fails fast if tsx is ever removed; lockfile pins exact versions in CI
  (`npm ci`).
- **Some 18 test files spawn `npx tsx` directly (per research-dist-cli
  findings) rather than via the shared helper:** declaring tsx fixes those
  call sites too, since local `npx` resolution is project-wide — no per-file
  edits needed. (Consolidating them onto the helper is deliberately out of
  scope.)
- **Residual genuine timeouts:** a truly slow CLI invocation still fails at
  10s, but now with an explicit kill marker instead of a bare JSON parse
  error, so it is diagnosable as a timeout rather than a flake mystery.
