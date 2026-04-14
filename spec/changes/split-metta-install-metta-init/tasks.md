# Tasks: split-metta-install-metta-init

## Batch 1 — Extract discovery helpers (no dependencies)

### 1.1 Create `discovery-helpers.ts`

**Files:**
- `src/cli/commands/discovery-helpers.ts` (new)
- Source: `src/cli/commands/init.ts` (read; lines 24–75 and 250–342 are the source material)

**Action:** Create `src/cli/commands/discovery-helpers.ts` containing `STACK_FILES`, `BROWNFIELD_MARKERS`, `detectBrownfield`, and `buildDiscoveryInstructions` lifted verbatim from `src/cli/commands/init.ts`. Export all four symbols. Do not import this module from anywhere yet — that happens in Batch 2. No behavioral changes.

**Verify:** `npx tsx -e "import { STACK_FILES, BROWNFIELD_MARKERS, detectBrownfield, buildDiscoveryInstructions } from './src/cli/commands/discovery-helpers.js'; console.log('ok')"` from project root exits 0 with `ok`. Confirm `src/cli/commands/init.ts` is unchanged.

**Done:** Four symbols are importable from `discovery-helpers.ts`; original `init.ts` is byte-identical to before this task.

---

## Batch 2 — Implement split commands (depends on 1.1)

### 2.1 Rewrite `src/cli/commands/init.ts` as the discovery command

**Files:**
- `src/cli/commands/init.ts` (rewrite)
- `src/cli/commands/discovery-helpers.ts` (read; provides `detectBrownfield`, `buildDiscoveryInstructions`)

**Action:** Replace the entire body of `src/cli/commands/init.ts` with the new `init` command implementation. Register the command named `init` (not `install`). Add precondition check: if `.metta/config.yaml` is absent, emit `{ error: { code: 3, type: "metta_not_installed", message: "No .metta/ directory found. Run \`metta install\` first." } }` and `process.exit(3)`. Call `detectBrownfield` and `buildDiscoveryInstructions` imported from `./discovery-helpers.js`. Emit `{ discovery: <result of buildDiscoveryInstructions> }` as JSON success payload. Add `--skip-scan` option (moves from install). Write nothing to the filesystem; create no commits. Export `registerInitCommand`.

**Verify:** Scenario S5 ("init before install is blocked"): `npx tsx src/cli/index.ts --json init` in a temp dir without `.metta/` exits code 3 with `data.error.type === "metta_not_installed"`. Confirm no `import` of `detectBrownfield` remains in the old install code path.

**Done:** `registerInitCommand` exported; command named `init` registered; precondition check on `.metta/config.yaml` present; no filesystem writes on success or failure path.

---

### 2.2 Create `src/cli/commands/install.ts` as the scaffolding command

**Files:**
- `src/cli/commands/install.ts` (new)
- Source: `src/cli/commands/init.ts` before Batch 2.1 rewrites it (scaffolding body, lines 77–247)
- `src/cli/commands/discovery-helpers.ts` (do NOT import — install has no brownfield dependency)

**Action:** Create `src/cli/commands/install.ts` containing the scaffolding logic lifted from the old `src/cli/commands/init.ts`: git check, directory creation, file writes with `{ flag: 'wx' }`, command installation, `runRefresh`, git commit. Remove all calls to `detectBrownfield` and `buildDiscoveryInstructions`. Remove `--skip-scan` option. Keep `--git-init`. Remove `discovery` and `mode` keys from the JSON success payload. Change the human-mode final line from `Next: run /metta:init to complete project discovery` to `Next: run \`metta init\` to discover project context`. Export `registerInstallCommand`.

**Verify:** Scenario S4 ("human-readable install output points at init"): run `npx tsx src/cli/index.ts install --git-init` in a temp dir; stdout contains `metta init`. Confirm JSON output for `--json --git-init` does not contain `discovery` or `mode` keys.

**Done:** `registerInstallCommand` exported; no brownfield detection code present; JSON payload omits `discovery` and `mode`; final human line references `metta init`.

---

## Batch 3 — Wire up index (depends on 2.1 and 2.2)

### 3.1 Update `src/cli/index.ts` to register both commands

**Files:**
- `src/cli/index.ts` (modify)
- `src/cli/commands/install.ts` (read)
- `src/cli/commands/init.ts` (read)

**Action:** Replace the existing import of `registerInitCommand` from `./commands/init.js` with two imports: `registerInstallCommand` from `./commands/install.js` and `registerInitCommand` from `./commands/init.js`. Replace the single `registerInitCommand(program)` call with `registerInstallCommand(program)` followed by `registerInitCommand(program)`.

**Verify:** `npx tsx src/cli/index.ts --help` lists both `install` and `init` as subcommands. `npx tsx src/cli/index.ts --help` exits 0.

**Done:** Both commands appear in `--help` output; no import of the old `registerInitCommand` from `install.ts` remains.

---

## Batch 4 — Tests (depends on 3.1)

### 4.1 Update and extend `tests/cli.test.ts`

**Files:**
- `tests/cli.test.ts` (modify)

**Action:** In the existing `metta install` describe block, update the `outputs JSON with git_initialized` test (currently line 65) to assert `data.discovery === undefined` and `data.mode === undefined`. Add three new install tests: (1) JSON payload has no `discovery` or `mode` fields, (2) human-mode output contains `metta init`, (3) running install twice exits 0 with `data.committed === false` on the second run. Add a new `describe('metta init')` block with these tests: (a) exits code 3 with `data.error.type === 'metta_not_installed'` when `.metta/` is absent, (b) brownfield project emits `data.discovery.mode === 'brownfield'` with `detected.stack` including `'Rust'` and `detected.directories` including `'src'` after writing `Cargo.toml` + non-empty `src/`, (c) greenfield project emits `data.discovery.mode === 'greenfield'` with empty arrays, (d) running `metta init --json` on a clean installed repo leaves git status identical before and after. Also add a static test (no temp dir needed) that reads `src/templates/skills/metta-init/SKILL.md` and asserts it contains `metta init --json` and does not contain `metta install --json`.

**Verify:**
- S1 ("fresh install in a git repo"): install JSON test asserts `status: "initialized"`, no `discovery`, no `mode`.
- S2 ("install on a project that already has .metta"): idempotent install test asserts `committed: false`.
- S3 ("install without a git repository"): existing test at line 46 covers this — keep it, confirm it still passes.
- S4 ("human-readable install output points at init"): human-mode test asserts stdout contains `metta init`.
- S5 ("init before install is blocked"): init error test asserts code 3, `metta_not_installed`.
- S6 ("init after install in a brownfield project"): brownfield init test.
- S7 ("init on a greenfield project"): greenfield init test.
- S8 ("init does not mutate the repository"): git-status-before/after test.
- S9 ("skill template references init command"): static file read test.
- Run `npx vitest run tests/cli.test.ts`; all tests pass.

**Done:** All 9 spec scenarios covered by at least one test assertion; `npx vitest run tests/cli.test.ts` exits 0.

---

### 4.2 Create `tests/commands-discovery-helpers.test.ts`

**Files:**
- `tests/commands-discovery-helpers.test.ts` (new)
- `src/cli/commands/discovery-helpers.ts` (read)

**Action:** Write unit tests for `detectBrownfield` and `buildDiscoveryInstructions` directly, without going through the CLI binary. Cover: (1) `detectBrownfield` returns all-empty when `skipScan: true` even if stack files are present, (2) `detectBrownfield` detects Rust from `Cargo.toml` + non-empty `src/` in a temp dir, (3) `detectBrownfield` returns greenfield for an empty dir, (4) `buildDiscoveryInstructions` with `isBrownfield: true` returns `questions[0].id === 'corrections'`, (5) `buildDiscoveryInstructions` with `isBrownfield: false` returns `questions[0].id === 'description'`.

**Verify:** `npx vitest run tests/commands-discovery-helpers.test.ts` exits 0 with 5 tests passing.

**Done:** 5 unit tests pass; no CLI subprocess invoked; covers `detectBrownfield` and `buildDiscoveryInstructions` in isolation.

---

## Batch 5 — Verification (depends on 4.1 and 4.2)

### 5.1 Full build and smoke test

**Files:** None modified. Read-only verification step.

**Action:** Run the full build (`npm run build`) to confirm TypeScript compiles without errors. Run the full test suite (`npm run test` or `npx vitest run`). In a throwaway `mktemp -d` directory, run `npx tsx src/cli/index.ts install --git-init --json` and confirm JSON output contains `status: "initialized"` with no `discovery` or `mode` keys. Then run `npx tsx src/cli/index.ts init --json` in the same directory and confirm JSON output contains `discovery.mode` of either `brownfield` or `greenfield`. Confirm `src/templates/skills/metta-init/SKILL.md` contains `metta init --json` as the bash invocation on step 1.

**Verify:**
- `npm run build` exits 0 (no TypeScript errors).
- `npx vitest run` exits 0 (all tests pass).
- `metta install --json` output: `jq 'has("discovery")' === false`, `jq 'has("mode")' === false`.
- `metta init --json` output: `jq '.discovery.mode'` is `"brownfield"` or `"greenfield"`.
- `grep "metta init --json" src/templates/skills/metta-init/SKILL.md` exits 0.

**Done:** Build clean, all tests green, both commands smoke-tested end-to-end, skill template confirmed correct.

---

## Scenario Coverage

| Scenario ID | Scenario Name | Covered By Task(s) |
|-------------|---------------|--------------------|
| S1 | fresh install in a git repo | 4.1 (install JSON no `discovery`/`mode`), 5.1 (smoke) |
| S2 | install on a project that already has .metta | 4.1 (idempotent install test) |
| S3 | install without a git repository | 4.1 (existing test kept + confirmed passing) |
| S4 | human-readable install output points at init | 2.2 (implementation), 4.1 (human-mode test) |
| S5 | init before install is blocked | 2.1 (implementation), 4.1 (init error test) |
| S6 | init after install in a brownfield project | 4.1 (brownfield init test) |
| S7 | init on a greenfield project | 4.1 (greenfield init test) |
| S8 | init does not mutate the repository | 4.1 (git-status before/after test) |
| S9 | skill template references init command | 4.1 (static file read test), 5.1 (grep confirm) |
