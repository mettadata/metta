# Verification Summary: split-metta-install-metta-init

## Spec Scenarios

| ID | Scenario | Test(s) | Result |
|----|----------|---------|--------|
| S1 | fresh install in a git repo | `tests/cli.test.ts` — `metta install > outputs JSON with git_initialized when --git-init is used` (asserts `status:"initialized"`, `discovery` undefined, `mode` undefined); plus `JSON payload has no discovery or mode fields` | PASS |
| S2 | install on a project that already has .metta | `tests/cli.test.ts` — `metta install > is idempotent on an already-installed project` (second run exits 0, `committed:false`) | PASS |
| S3 | install without a git repository | `tests/cli.test.ts` — `metta install > returns git_missing JSON when no git repo detected` (exit 3, `status:"git_missing"`) | PASS |
| S4 | human-readable install output points at init | `tests/cli.test.ts` — `metta install > human-mode output directs user to metta init` (stdout contains `metta init`) | PASS |
| S5 | init before install is blocked | `tests/cli.test.ts` — `metta init > exits code 3 with metta_not_installed when .metta/ is absent` (exit 3, `error.type === 'metta_not_installed'`, message contains `metta install`) | PASS |
| S6 | init after install in a brownfield project | `tests/cli.test.ts` — `metta init > emits brownfield discovery for a Rust project` (mode brownfield, stack includes Rust, dirs include src) | PASS |
| S7 | init on a greenfield project | `tests/cli.test.ts` — `metta init > emits greenfield discovery for an empty project` (mode greenfield, empty stack/dirs) | PASS |
| S8 | init does not mutate the repository | `tests/cli.test.ts` — `metta init > does not mutate the repository` (git status + git log identical before and after) | PASS |
| S9 | skill template references init command | `tests/cli.test.ts` — `metta-init skill template > references metta init --json and not metta install --json` | PASS |

Supplementary unit coverage: `tests/commands-discovery-helpers.test.ts` (5 tests) exercises `detectBrownfield` and `buildDiscoveryInstructions` directly — `--skip-scan`, Rust detection, empty-project greenfield, and question-set branching.

## Gate Results

- **Build** (`npm run build`): PASS — tsc compiles cleanly; templates copied to `dist/`.
- **Lint** (`npx tsc --noEmit`, wired as `npm run lint`): PASS — no diagnostics.
- **Targeted tests** (`npx vitest run tests/cli.test.ts tests/commands-discovery-helpers.test.ts`): PASS — 28/28 tests pass.
- **Full test suite** (`npx vitest run`): 322 pass, 2 fail. Both failures are in `tests/refresh.test.ts` (~lines 305 and 321, asserting `CLAUDE.md` `<!-- metta:workflow-end -->` and `[Project Constitution]` reference markers). Confirmed pre-existing on `main` via a clean clone and fresh `vitest run tests/refresh.test.ts` — identical 2 failures. Unrelated to this change.
- **End-to-end smoke** (throwaway `mktemp -d`):
  - `git init` + `metta install --json` → `status:"initialized"`, no `discovery` key, no `mode` key, commit `chore: initialize metta` created.
  - `metta init --json` → `discovery.mode === "greenfield"`, git log unchanged (still one commit), working tree clean.
  - `touch Cargo.toml` + populate `src/`, re-run `metta init --json` → `discovery.mode === "brownfield"`, `detected.stack === ["Rust"]`, `detected.directories === ["src"]`.
  - Separate empty dir (no `.metta/`), `metta init --json` → exit code 3, `error.type === "metta_not_installed"`, message `No .metta/ directory found. Run \`metta install\` first.`
- **Skill template check** (`src/templates/skills/metta-init/SKILL.md`): step 1 invokes `metta init --json`; string `metta install --json` does not appear.
- **Git state**: branch `metta/split-metta-install-metta-init`, 5 implementation commits plus 1 docs commit on top of main. Working tree clean apart from an untracked `.claude/scheduled_tasks.lock` (runtime lock file, not part of this change) and this summary artifact.

## Summary

The change cleanly splits the former `metta install` command into `metta install` (scaffold-only) and `metta init` (discovery-only). Discovery helpers are extracted into `src/cli/commands/discovery-helpers.ts` and imported solely by `init.ts`; `install.ts` has no brownfield dependency. All 9 spec scenarios are covered by passing tests and additionally confirmed by end-to-end smoke runs in throwaway directories. The 2 failing tests in `tests/refresh.test.ts` are pre-existing on `main` and unrelated. Build, lint, and targeted tests are all green. The change is ready to finalize.
