# harden-metta-config-yaml-lifecycle-across-three-related-bugs

## Problem

Three independent defects converge on the `.metta/config.yaml` lifecycle and collectively degrade every actor that depends on the config being readable and accurate.

First, `writeStacksToConfig` in `src/cli/commands/install.ts` uses a regex (`/^\s*stack:\s*"/`) that only recognises the legacy singular `stack:` field. The function itself writes the plural `stacks: [...]` form, which the regex silently misses; the else-branch then appends a second `stacks:` line on every re-install. Real projects have already accumulated duplicate lines (Zeus: 3, metta's own repo: 2), making the config file technically invalid YAML for consumers that reject duplicate map keys.

Second, `loadYamlFile` in `src/config/config-loader.ts` catches YAML parse errors, emits a single-line warning to stderr, and returns null. The caller proceeds with default config, so stack-driven gate scaffolding, verification strategy, and every other config-derived behaviour silently disables. AI orchestrators that rely on stderr signal lose it in the noise; users whose stacks-list is corrupt never discover the problem until a gate fails for an unrelated-looking reason.

Third, the `/metta-init` discovery loop captures identity, stack, and conventions but has no round dedicated to how the running application should be exercised during verification. Verifier agents today run tests, tsc, and lint only. For projects where meaningful verification means starting a TUI pane, navigating a Playwright browser, or invoking a CLI end-to-end, the agents are flying blind. There is nowhere in the config to persist this guidance, so every verification cycle either over-counts (passes when the app is broken) or under-counts (flags test noise as failures).

Affected actors: AI orchestrators running metta commands (hit the warning noise and lose signal), developers using `metta install` on established projects (silently accumulate duplicate config lines), users of any stack-driven feature such as gate scaffolding (feature quietly disables on corrupt config), and verifier agents (lack the per-project context needed to exercise the application).

## Proposal

Five deliverables harden the config lifecycle end-to-end.

**1. Shared config-writer helper (`src/config/config-writer.ts`, new).** Introduces `setProjectField(root, path, value)` built on `yaml.parseDocument` mutation so comments are preserved and all writes go through a single, tested code path. Both install and init consume this helper; no caller does ad-hoc string munging or regex replacement against the YAML file again.

**2. Install refactor (`src/cli/commands/install.ts`).** Replaces `writeStacksToConfig`'s regex-based string mutation with a call to `setProjectField`. Re-running `metta install` on a config that already carries a `stacks` list becomes idempotent — the value is overwritten in place rather than appended.

**3. Loader hard-fail and doctor --fix (`src/config/config-loader.ts`, `src/cli/commands/doctor.ts`).** `loadYamlFile` changes from catch-and-warn to throw with a typed `ConfigParseError` that includes file path and line number. Every metta command propagates this error and exits non-zero with a human-readable message that names the corrupt file and instructs the user to run `metta doctor --fix`. The `--fix` flag is added to the existing `doctor` command; its repair scope is exactly: (a) deduplicate map keys in `.metta/config.yaml` (keep last occurrence, healing the install-bug output), and (b) strip keys that fail `ProjectConfigSchema` validation, reporting each removal. Successful repair auto-commits with `chore: metta doctor repaired .metta/config.yaml`. `metta doctor` and `metta doctor --fix` are the only commands exempt from the hard-fail — they must remain runnable on a corrupt config.

**4. Init Round 4 and schema field (`src/cli/commands/init.ts`, `.claude/skills/metta-init/SKILL.md`, `src/templates/skills/metta-init/SKILL.md`, `src/schemas/project-config.ts`).** A new Round 4 is added to the metta-init discovery loop, dedicated to verification strategy. The agent elicits which strategy applies (`tmux_tui`, `playwright`, `cli_exit_codes`, or `tests_only`) and any per-project instructions (tmux pane name, Playwright base URL, entry command, etc.). `ProjectConfigSchema` gains a `verification` object with two fields: `strategy` (strict enum, required) and `instructions` (free-form markdown string, optional). Init persists both via the shared config-writer helper.

**5. Verifier context injection (`src/cli/commands/instructions.ts`, verifier agent template(s) under `src/templates/agents/`).** `metta instructions verification --json` injects `verification_strategy` and `verification_instructions` into the agent context payload. Verifier agent templates read these fields alongside tests/tsc/lint results. When the fields are absent (legacy configs), the verifier emits a structured error that names the command the user must run to supply a verification strategy (either `metta init --verify-strategy` or `metta config set-verification-strategy <enum>`, to be resolved at plan time); it does not silently fall back.

## Impact

Eight source files are touched or created by this change:

- `src/config/config-writer.ts` — new file; shared YAML-mutation helper and its tests
- `src/config/config-loader.ts` — parse-error handling changed from warn-and-null to throw
- `src/cli/commands/install.ts` — `writeStacksToConfig` replaced with config-writer helper call
- `src/cli/commands/doctor.ts` — `--fix` flag added with dedup + schema-repair logic
- `src/cli/commands/init.ts` — Round 4 verification-strategy discovery added
- `src/schemas/project-config.ts` — `verification.strategy` enum and `verification.instructions` string added to `ProjectConfigSchema`
- `src/cli/commands/instructions.ts` — `verification` artifact type injected into context payload
- `src/templates/agents/` (verifier agent template) — reads `verification_strategy` / `verification_instructions`; emits structured error on absence

Downstream: any code that calls `loadYamlFile` and previously tolerated null silently will now receive an exception. The `metta doctor` command's interface gains a new `--fix` flag. Projects without a `verification` section in their config will receive a hard error from the verifier agent on their next verification run, directing them to configure the strategy before proceeding.

## Out of Scope

- **No broader doctor auto-repair.** `metta doctor --fix` repairs `.metta/config.yaml` only. Gate files, `state.yaml`, workflow files, and any other artefacts in `.metta/` are not touched by the repair pass.
- **No schema migration of existing configs.** There is no automatic upgrade applied at startup or at install time to add the `verification` section to configs that predate this change. The doctor handles ad-hoc repair on demand; intentional additions (like setting a verification strategy) require the user to re-run init or a dedicated config command.
- **No verifier execution-policy changes.** This change delivers only the plumbing: carrying `verification_strategy` and `verification_instructions` into agent context and detecting their absence. How a verifier agent actually starts a TUI, drives Playwright, or invokes a CLI is a per-agent execution concern outside this scope.
- **No new top-level `metta fix-config` command.** Repair capability is added to the existing `metta doctor` command via the `--fix` flag. No new top-level command is introduced.
