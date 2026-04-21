# Summary: harden-metta-config-yaml-lifecycle-across-three-related-bugs

Closes three related bugs/features that all touched `.metta/config.yaml` lifecycle: the producer bug that duplicated `stacks:` lines on every `metta install`, the consumer bug that silently fell back to defaults on YAML parse errors, and the missing per-project verification-strategy field. All three are replaced with a single coherent pipeline: write via `yaml.parseDocument` through a shared helper, hard-fail on corrupt config, repair via `metta doctor --fix`, and capture verification strategy at init.

## Deliverables

### Schema
1. **`src/schemas/project-config.ts`** — added `VerificationStrategyEnum` (`tmux_tui | playwright | cli_exit_codes | tests_only`) and `VerificationConfigSchema`. Wired as optional top-level `verification` field on `ProjectConfigSchema`. Pre-requisite for every write path below.

### Shared config-write surface
2. **`src/config/config-writer.ts`** (new) — exports `setProjectField(root, path, value)`. Uses `yaml.parseDocument` + `doc.setIn` + `doc.toString()`. Preserves comments, preserves flow vs block sequence style, idempotent on re-write, propagates ENOENT.
3. **`src/config/config-writer.test.ts`** (new) — 4 tests: idempotent re-write, comment preservation, flow-style preservation, ENOENT propagation.

### Pure repair
4. **`src/config/repair-config.ts`** (new) — exports pure `repairProjectConfig(source: string): RepairResult`. Parses leniently with `{ uniqueKeys: false }`, dedupes by keeping last occurrence, drops Zod-invalid keys via `doc.deleteIn`, up to 3 passes. No I/O.
5. **`src/config/repair-config.test.ts`** (new) — 4 tests: dedup collapses duplicates, schema-invalid key dropped, clean config no-op, malformed YAML passthrough.

### Hard-fail consumer
6. **`src/config/config-loader.ts`** — `loadYamlFile` now throws `ConfigParseError` (exported) instead of warning + returning null. ENOENT path unchanged.
7. **`tests/config-loader.test.ts`** — extended to assert `loader.load()` rejects with `ConfigParseError` on corrupt config and still returns defaults on ENOENT. Replaced the prior silent-fallback test.

### CLI error boundary
8. **`src/cli/helpers.ts`** — `handleError` dispatches on `ConfigParseError`, writing `<path>: <message>` + `Run 'metta doctor --fix' to repair.` to stderr and exiting 4 (`--json` emits structured error envelope).
9. **`src/cli/index.ts`** — `preAction` preflight hook runs `ConfigLoader.load()` before every command except `install`, `init`, `doctor`, `update`, `completion` (the repair/bootstrap surfaces). `parseAsync().catch()` safety net renders the same remedy if a `ConfigParseError` escapes a command's own try/catch.

### Install refactor
10. **`src/cli/commands/install.ts`** — `writeStacksToConfig` body replaced with a single `setProjectField(root, ['project', 'stacks'], stacks)` call. Regex/findIndex/splice logic removed.

### Doctor --fix
11. **`src/cli/commands/doctor.ts`** — new `--fix` flag. Reads raw `.metta/config.yaml` (bypasses `ConfigLoader` so it works on corrupt files), calls `repairProjectConfig`, writes back if changed, auto-commits with `chore: metta doctor repaired .metta/config.yaml`. Diagnostic-only behavior preserved when `--fix` is absent.

### Verification context
12. **`src/cli/commands/instructions.ts`** — when `artifactId === 'verification'`, injects `verification_strategy` and `verification_instructions` (null when absent) into `output.context`.

### Skill + agent plumbing
13. **`.claude/skills/metta-init/SKILL.md` + `src/templates/skills/metta-init/SKILL.md`** — added Round 4 (Verification Strategy) with two `AskUserQuestion` prompts (enum strategy + free-form instructions), updated exit-criterion counter to four rounds, extended `<DISCOVERY_ANSWERS>` XML with `<verification>`, added discovery-agent clause to call `setProjectField` after writing constitution. Byte-identical copies.
14. **`.claude/agents/metta-verifier.md` + `src/templates/agents/metta-verifier.md`** — new `## Verification Context` section reading `context.verification_strategy` / `context.verification_instructions`, first-run heuristic (default `tests_only` + info note), legacy-project hard error with literal YAML snippet, operational note forbidding `metta config set` as remediation. Byte-identical copies.

### Tests
15. **`tests/cli.test.ts`** — extended with: (a) install idempotency asserts exactly one `stacks:` line after two installs; (b) corrupt-config error boundary (3 tests); (c) instructions verification context (2 tests); (d) `metta doctor --fix` (3 tests — dedup auto-commit, schema-invalid key drop, no-op on clean config).
16. **`tests/skill-structure-metta-init.test.ts`** — updated round-count expectations from 3 to 4 and dropped stale `REQ-35` tag.

### Barrel exports
17. **`src/index.ts`** — exports `./config/config-writer.js` and `./config/repair-config.js`.

### Self-repair
18. **`.metta/config.yaml`** — the metta repo's own config had two duplicate `stacks: ["js"]` lines. Running `node dist/cli/index.js doctor --fix` collapsed them to one and auto-committed (`eb769d2 chore: metta doctor repaired .metta/config.yaml`). Demonstrates the fix end-to-end on a live instance of the original bug.

## Verification state

- `npx tsc --noEmit` clean
- `npx vitest run` — 835/835 tests green across 60 files
- `diff -q` confirms byte-identical SKILL.md and metta-verifier.md pairs
- The YAML-parse-warning spam (visible throughout this session on every metta command) is gone after self-repair

## Non-goals honored

- No migration of existing project configs beyond the self-repair demo — other projects (including zeus) run `metta doctor --fix` on demand.
- No broader doctor auto-repair for gate files or state.yaml (scope is `.metta/config.yaml` only).
- No verifier agents actually executing strategies against running apps — only the plumbing (schema + context injection + persona guidance). Per-strategy execution is a follow-up.
- No new top-level `metta fix-config` command — `metta doctor --fix` is the repair surface.
- No new npm dependencies — `yaml@2.8.3` already installed.

## Follow-ups

- The still-stub `metta config set` command (noted in research) should eventually become a real writer using `setProjectField`. Tracked informally; create an issue if this blocks another change.
- Per-strategy verifier execution (tmux driver, Playwright driver, CLI-exit-code comparator) is deferred to a future change.
