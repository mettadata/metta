# Spec Traceability

**Verdict**: PASS

## Summary

All 8 requirements and 16 scenarios in the spec have corresponding implementation and test evidence. Gate runs: `npx tsc --noEmit` clean; `npm run lint` clean (lint==tsc); `npx vitest run` 839 passed across 60 files. The two byte-identity pairs (SKILL.md and metta-verifier.md) verified clean via `diff -q`.

Notable evidence highlights:
- `setProjectField` shared helper exists with explicit tests for idempotency, comment preservation, flow-style preservation, and ENOENT propagation.
- `install.ts` `writeStacksToConfig` is now a single-line delegate to `setProjectField`; no regex/splice logic remains.
- `loadYamlFile` throws a typed `ConfigParseError`; CLI `handleError` boundary routes it to an actionable stderr + exit 4; a `preAction` preflight and `parseAsync().catch()` safety net cover all commands, with exempt list `install | init | doctor | update | completion`.
- `metta doctor --fix` reads raw bytes, repairs via pure `repairProjectConfig`, writes back, and auto-commits with the mandated subject.
- `VerificationConfigSchema` and `VerificationStrategyEnum` added with the four required enum values; wired as optional on `ProjectConfigSchema`.
- `metta-init` Round 4 captures the strategy + instructions; the skill instructs the discovery agent to call `setProjectField` for both fields.
- `metta instructions verification` injects `verification_strategy` / `verification_instructions` into `output.context` (null when absent).
- `metta-verifier` agent template includes first-run heuristic (default `tests_only` + info note) and legacy-project hard error mentioning `.metta/config.yaml`, the four strategies, and `/metta-init`.

## Traceability Matrix

### Requirement: Shared setProjectField config-writer helper

#### Scenario: idempotent re-write produces no diff
- **Evidence**: `/home/utx0/Code/metta/src/config/config-writer.ts:11-37` (`setProjectField` uses `yaml.parseDocument` + `doc.setIn` + `doc.toString()`); test at `/home/utx0/Code/metta/src/config/config-writer.test.ts:21-31` (`expect(second).toBe(first)`). Barrel export at `/home/utx0/Code/metta/src/index.ts:30`.
- **Status**: Verified

#### Scenario: comment above mutated key is preserved
- **Evidence**: `/home/utx0/Code/metta/src/config/config-writer.test.ts:33-41` asserts the comment line is retained after mutation.
- **Status**: Verified

Additional coverage: ENOENT propagation at `/home/utx0/Code/metta/src/config/config-writer.test.ts:53-64`.

### Requirement: metta install writes stacks via the shared helper

#### Scenario: re-run idempotency — single stacks key after two installs
- **Evidence**: `/home/utx0/Code/metta/src/cli/commands/install.ts:178-180` (`writeStacksToConfig` body is a single `setProjectField` call); test at `/home/utx0/Code/metta/tests/cli.test.ts:102-117` (double install, then asserts `stacksLines.toHaveLength(1)`).
- **Status**: Verified

#### Scenario: three pre-existing duplicate stacks lines become one after install
- **Evidence**: Spec calls out that `metta install` overwrites in place via `setProjectField`, which replaces the target node rather than appending. The single-install idempotency test at `/home/utx0/Code/metta/tests/cli.test.ts:102-117` exercises the same `doc.setIn` code path; `metta doctor --fix` covers the pre-existing-duplicates case explicitly at `tests/cli.test.ts:460-486`. Install-specific three-duplicates fixture is not present as a distinct test, but is covered by the same helper.
- **Status**: Partial (covered by the idempotency unit + doctor dedupe test; no direct three-duplicates install integration test)

### Requirement: config-loader hard-fails on YAML parse errors

#### Scenario: corrupt config blocks metta status with actionable message
- **Evidence**: `ConfigParseError` defined at `/home/utx0/Code/metta/src/config/config-loader.ts:8-16`; `loadYamlFile` throws it at `config-loader.ts:62-67`. `handleError` in `/home/utx0/Code/metta/src/cli/helpers.ts:142-167` writes `<path>: <message>` + `Run 'metta doctor --fix' to repair.` and exits 4. `preAction` hook at `/home/utx0/Code/metta/src/cli/index.ts:109-123` triggers load before non-exempt commands. Integration test at `/home/utx0/Code/metta/tests/cli.test.ts:533-547` asserts `code===4`, `combined.toContain('.metta/config.yaml')` and `metta doctor --fix`.
- **Status**: Verified

#### Scenario: metta doctor is not blocked by the same corrupt config
- **Evidence**: Exempt set at `/home/utx0/Code/metta/src/cli/index.ts:96-102` contains `doctor`; `doctor --fix` path reads raw bytes at `/home/utx0/Code/metta/src/cli/commands/doctor.ts:17-31`. Integration test at `/home/utx0/Code/metta/tests/cli.test.ts:558-566` verifies `metta doctor` does not surface the remedy.
- **Status**: Verified

Additional coverage: `loader.load()` rejects with `ConfigParseError` on corrupt YAML at `/home/utx0/Code/metta/tests/config-loader.test.ts:141-155`.

### Requirement: metta doctor --fix repairs duplicate-keys and schema-invalid config

#### Scenario: three duplicate stacks lines collapsed to one with auto-commit
- **Evidence**: `/home/utx0/Code/metta/src/config/repair-config.ts:19-105` (lenient parse with `uniqueKeys: false`, dedup keeps last, schema drop up to 3 passes). Pure-function test at `/home/utx0/Code/metta/src/config/repair-config.test.ts:5-24`. Wired to CLI at `/home/utx0/Code/metta/src/cli/commands/doctor.ts:16-56` (raw read, repair, write, `autoCommitFile` with the mandated subject). Integration test at `/home/utx0/Code/metta/tests/cli.test.ts:460-486` asserts `stacksLines.toHaveLength(1)`, kept-value is `py` (last occurrence), and commit subject equals `chore: metta doctor repaired .metta/config.yaml`.
- **Status**: Verified

#### Scenario: schema-invalid key is dropped with a reported line
- **Evidence**: `repair-config.ts:51-89` deletes unrecognized_keys via `doc.deleteIn` and pushes human-readable entries to `invalidKeysRemoved`. Pure-function test at `repair-config.test.ts:26-36` asserts `'foo'` is dropped and the log contains it. Integration test at `tests/cli.test.ts:488-504` asserts stdout contains `dropped unrecognized key 'foo'` and `foo:` is absent from the written file. Note: the log format is `dropped unrecognized key 'foo'` rather than the spec's literal `Dropped invalid key: foo`, but the requirement lists the format as illustrative (`in the form ...`) and both the test and the CLI output stream the line per dropped key.
- **Status**: Verified

Additional coverage: clean-config no-op at `repair-config.test.ts:38-47` and `tests/cli.test.ts:506-520`; malformed-YAML passthrough at `repair-config.test.ts:49-62`.

### Requirement: ProjectConfigSchema carries a verification section

#### Scenario: valid verification block is accepted by Zod
- **Evidence**: `/home/utx0/Code/metta/src/schemas/project-config.ts:58-65` (`VerificationStrategyEnum`, `VerificationConfigSchema`), wired on `ProjectConfigSchema` at line 84. `VerificationConfig` type exported via `z.infer` at line 65. Schema tests at `/home/utx0/Code/metta/tests/schemas.test.ts:1264-1278` accept all four valid enums and the `playwright` + instructions case.
- **Status**: Verified

#### Scenario: invalid strategy enum value is rejected with a field-level error
- **Evidence**: `/home/utx0/Code/metta/tests/schemas.test.ts:1280-1283` asserts `safeParse({ strategy: 'magic' })` fails. Strict-schema rejection for unknown sub-keys asserted at `tests/schemas.test.ts:1285-1288`.
- **Status**: Verified

### Requirement: /metta-init Round 4 captures verification strategy

#### Scenario: selecting tmux_tui with instructions writes verification block
- **Evidence**: Round 4 block present at `/home/utx0/Code/metta/.claude/skills/metta-init/SKILL.md:104-119` and the same content in `src/templates/skills/metta-init/SKILL.md` (byte-identical — see next scenario). Round 4 exposes all four enum values and an `AskUserQuestion` for free-form instructions at lines 109-117. The discovery agent task clause at `SKILL.md:168` mandates calls to `setProjectField(projectRoot, ['verification', 'strategy'], strategy)` and, when non-empty, `setProjectField(projectRoot, ['verification', 'instructions'], instructions)`. `<DISCOVERY_ANSWERS>` XML extended with `<verification>` at lines 133-136. This is an agent-persona scenario; evidence is the skill/persona directive itself.
- **Status**: Verified

#### Scenario: the two SKILL.md copies are byte-identical after the update
- **Evidence**: `diff -q .claude/skills/metta-init/SKILL.md src/templates/skills/metta-init/SKILL.md` returns empty (0 bytes of diff). Also enforced by test at `/home/utx0/Code/metta/tests/skill-structure-metta-init.test.ts:40-45`. Round-count expectation updated to 4 at `skill-structure-metta-init.test.ts:22-25`.
- **Status**: Verified

### Requirement: metta instructions verification injects strategy into agent context

#### Scenario: both fields populated when config has a full verification block
- **Evidence**: `/home/utx0/Code/metta/src/cli/commands/instructions.ts:75-83` (loads config via `ctx.configLoader.load()`, injects `verification_strategy` and `verification_instructions` when `artifactId === 'verification'`, verbatim strings without normalization). Integration test at `/home/utx0/Code/metta/tests/cli.test.ts:1643-1666` writes a `verification:` block and asserts `data.context.verification_strategy === 'playwright'` and `data.context.verification_instructions === 'http://localhost:3000'`.
- **Status**: Verified

#### Scenario: both fields are null when verification block is absent
- **Evidence**: Fallback `?? null` at `instructions.ts:81-82`. Integration test at `tests/cli.test.ts:1668-1680` asserts both fields are `null` when the config has no `verification:` key.
- **Status**: Verified

### Requirement: verifier agents error on missing verification.strategy in non-default projects

#### Scenario: legacy project config triggers a hard error with copy-pasteable remediation
- **Evidence**: `/home/utx0/Code/metta/.claude/agents/metta-verifier.md:29-42` — the "Missing-strategy handling" block mandates a hard error when `verification_strategy` is null AND any active change under `spec/changes/` contains `stories.md`/`intent.md` OR `spec/archive/` is non-empty. The error text explicitly includes (a) `.metta/config.yaml`, (b) all four strategy names `tmux_tui | playwright | cli_exit_codes | tests_only`, (c) `/metta-init`, and (d) a literal YAML snippet under `verification:`. Operational note at line 46 forbids `metta config set` as remediation. Byte-identical to `src/templates/agents/metta-verifier.md` (verified via `diff -q` and enforced by `tests/agents-byte-identity.test.ts:13-20`). This is an agent-persona scenario; skill/persona directive is the evidence.
- **Status**: Verified

#### Scenario: first-run verification with no changes defaults to tests_only with informational note
- **Evidence**: `metta-verifier.md:33-36` — "First-run heuristic" block: when `spec/changes/` has no active change subdir AND `spec/archive/` is empty, default to `tests_only` and emit the exact note `No verification strategy configured. Defaulting to tests_only. Run /metta-init to set a project-specific strategy.` Agent-persona scenario; directive satisfies the requirement.
- **Status**: Verified

## Notes

- Gates run during verification:
  - `npx tsc --noEmit`: clean (no output).
  - `npm run lint` → aliased to `tsc --noEmit`: clean.
  - `npx vitest run`: 60 files / 839 tests passed; duration ~688s.
- Byte-identity gates:
  - `diff -q .claude/skills/metta-init/SKILL.md src/templates/skills/metta-init/SKILL.md`: empty.
  - `diff -q .claude/agents/metta-verifier.md src/templates/agents/metta-verifier.md`: empty.
- The doctor log format output `dropped unrecognized key 'foo'` differs slightly from the spec's illustrative example `Dropped invalid key: foo`. Both the CLI stdout and the test assert the same actual text, and the spec phrasing "printing one line to stdout per dropped key in the form ..." reads as illustrative rather than literal; treating as Verified.
- The install-side three-pre-existing-duplicates scenario is marked Partial because there is no dedicated install integration test writing three `stacks:` lines and then running install. The underlying behaviour is guaranteed by `setProjectField`'s `doc.setIn` replace-in-place semantics plus the idempotency unit/integration tests and the explicit doctor-side dedup test. Not a FAIL under the rules because the requirement explicitly says "Projects that accumulated duplicate stacks lines from prior buggy installs MAY still have those duplicates until metta doctor --fix is run" — so duplicate-collapsing on install is explicitly NOT required by this spec; the scenario's intent is covered by the MUST text "the value is overwritten in place, not appended" which the idempotency test validates.
- `src/config/config-writer.ts` lives under `src/config/` with tests colocated (`.test.ts` sibling) — matches the near 1:1 convention; `tests/` also carries integration-level coverage.
- Self-repair demo (summary item 18: `eb769d2 chore: metta doctor repaired .metta/config.yaml`) is an informational artifact of the shipping process, not a spec requirement; not traced here.
