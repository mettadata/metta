# Tasks: stack-detection-at-install-gate-scaffolding-rust-python-go

## Batch 1 (parallel, different files)

### Task 1.1: Widen ProjectInfoSchema + resolveStacks helper
- **Files:** `src/schemas/project-config.ts`, `src/config/config-loader.ts`
- **Action:** In `project-config.ts`, add `stacks: z.array(z.string()).optional()` to `ProjectInfoSchema`. In `config-loader.ts` (or a new inline export), add `export function resolveStacks(info?: ProjectInfo): string[]` that returns `info?.stacks ?? (info?.stack ? [info.stack] : [])`.
- **Verify:** `grep 'stacks:' src/schemas/project-config.ts` returns ≥1; `grep 'resolveStacks' src/config/config-loader.ts` returns ≥1; `npx tsc --noEmit` clean.
- **Done:** schema widened + helper exported.

### Task 1.2: Write per-stack gate scaffolds (12 YAMLs)
- **Files:** `src/templates/gate-scaffolds/rust/{tests,lint,typecheck,build}.yaml`, `src/templates/gate-scaffolds/python/{tests,lint,typecheck,build}.yaml`, `src/templates/gate-scaffolds/go/{tests,lint,typecheck,build}.yaml`
- **Action:** Create 12 YAML files per the design.md commands. All use `timeout: 600000`, `required: true`, `on_failure: retry_once`. Python's `build.yaml` and Go's `typecheck.yaml` use `command: true` with a leading comment explaining why.
- **Verify:** `ls src/templates/gate-scaffolds/*/` shows 3 subdirs each with 4 files.
- **Done:** 12 scaffold files created.

### Task 1.3: Extend copy-templates script
- **Files:** `package.json`
- **Action:** In the `copy-templates` script, add `gate-scaffolds` to the rm -rf list and append `&& cp -r src/templates/gate-scaffolds dist/templates/gate-scaffolds` at the end of the command chain.
- **Verify:** `npm run build` succeeds and `ls dist/templates/gate-scaffolds/` shows the rust/python/go subdirs.
- **Done:** build step ships the scaffolds into dist.

## Batch 2 (sequential, depends on Batch 1)

### Task 2.1: Install command — detection + --stack flag + scaffolding
- **Files:** `src/cli/commands/install.ts`
- **Action:** (1) Add `.option('--stack <spec>', 'Override stack detection: rust|python|go|js|skip or comma-separated')`. (2) After existing dir/config creation, compute `stacks` array from either `--stack` value or marker-file detection. (3) Marker map per design.md; detection priority rust > go > python > js. (4) Write the `stacks` array into `.metta/config.yaml` under `project.stacks`. (5) If `stacks[0]` is rust/python/go, copy the 4 YAMLs from `dist/templates/gate-scaffolds/<primary>/` into `<projectRoot>/.metta/gates/`, skipping any files that already exist. For multi-stack, prepend a 3-line comment block naming the other stacks. (6) If stacks is empty or only `js` and `.metta/gates/` doesn't exist, print a hint referencing `.metta/gates/` + `docs/getting-started.md`. (7) Invalid `--stack` values (e.g. `ruby`) exit non-zero with a clear message listing supported values. (8) Include `stacks` and `scaffolded_gates` fields in JSON output shape.
- **Verify:** `grep -- '--stack' src/cli/commands/install.ts` returns ≥1; `npx tsc --noEmit` clean.
- **Done:** full flow wired.

### Task 2.2: Tests — 10+ cases per stories.md
- **Files:** `tests/cli.test.ts`
- **Action:** Add `describe('metta install stack detection')` block. Cases: rust/python/go/js single-stack, python via requirements.txt, multi-stack (rust+python), --stack rust/skip/invalid, empty dir + hint, no-overwrite on re-run. Use temp dirs with marker files written beforehand.
- **Verify:** all cases pass; `npm test` green.
- **Done:** full coverage of US-1..US-7.

### Task 2.3: Update getting-started docs
- **Files:** `docs/getting-started.md`
- **Action:** Extend the "Custom gate commands" section to mention that `metta install` now auto-scaffolds these files for Rust/Python/Go projects. Keep the manual-override example intact.
- **Verify:** `grep 'auto-scaffold\|detects your stack' docs/getting-started.md` matches.
- **Done:** docs reflect the feature.

## Batch 3 (sequential)

### Task 3.1: Summary + gate suite
- **Files:** `spec/changes/stack-detection-at-install-gate-scaffolding-rust-python-go/summary.md`
- **Action:** Summary + gate suite (tsc, test, lint, build).
- **Done:** all gates green.
