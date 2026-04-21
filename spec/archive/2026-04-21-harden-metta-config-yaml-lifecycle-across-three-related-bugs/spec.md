# harden-metta-config-yaml-lifecycle-across-three-related-bugs

## ADDED: Requirement: Shared setProjectField config-writer helper

A new module `src/config/config-writer.ts` MUST export an async function with the signature
`setProjectField(root: string, path: string[], value: unknown): Promise<void>`. The function
MUST read `<root>/.metta/config.yaml`, parse the file content with `yaml.parseDocument` to
obtain a mutable Document object, call `doc.setIn(path, value)` to update the target node,
then write the serialized document back to disk. When the file does not exist the function
MUST throw an error rather than silently create a new file. The write MUST be idempotent:
calling `setProjectField` twice with identical arguments MUST leave the on-disk file
byte-for-byte identical to its state after the first call. YAML comments and blank lines
that are not part of the mutated node MUST be preserved in the serialized output. The module
MUST be barrel-exported from `src/index.ts`.

### Scenario: idempotent re-write produces no diff

- GIVEN `.metta/config.yaml` exists with content `project:\n  stacks: ["typescript"]`
- WHEN `setProjectField(root, ['project', 'stacks'], ['typescript'])` is called twice in sequence
- THEN a byte-level diff of the file before and after the second call shows no difference

### Scenario: comment above mutated key is preserved

- GIVEN `.metta/config.yaml` contains the line `# project-specific override` immediately above
  a `stacks:` line under `project:`
- WHEN `setProjectField(root, ['project', 'stacks'], ['typescript', 'node'])` is called
- THEN the written file still contains `# project-specific override` on the line immediately
  preceding the `stacks:` key

---

## ADDED: Requirement: metta install writes stacks via the shared helper

The function `writeStacksToConfig` in `src/cli/commands/install.ts` MUST be replaced entirely
with a call to `setProjectField(root, ['project', 'stacks'], stacks)`. The existing
implementation that splits the file into lines, searches with the regex `/^\s*stack:\s*"/`,
and splices replacement lines MUST be removed. No other code path in `install.ts` MAY
perform string-based or regex-based mutation of `.metta/config.yaml`. After the refactor,
re-running `metta install` on a project whose `.metta/config.yaml` already carries a
`stacks:` entry MUST result in exactly one `stacks:` key under `project:` — the value is
overwritten in place, not appended. Projects that accumulated duplicate `stacks:` lines from
prior buggy installs MAY still have those duplicates until `metta doctor --fix` is run; this
requirement covers new writes only.

### Scenario: re-run idempotency — single stacks key after two installs

- GIVEN a project with `.metta/config.yaml` containing exactly one `stacks: ["typescript"]`
  entry under `project:`
- WHEN `metta install` is invoked a second time against the same project
- THEN the resulting `.metta/config.yaml` contains exactly one occurrence of the key `stacks:`
  under `project:` and the file parses as valid YAML with no duplicate map keys

### Scenario: three pre-existing duplicate stacks lines become one after install

- GIVEN `.metta/config.yaml` contains three `stacks:` lines under `project:` accumulated from
  prior buggy install runs
- WHEN `metta install` is invoked
- THEN the resulting file contains exactly one `stacks:` line under `project:` reflecting the
  stacks detected during this install run

---

## ADDED: Requirement: config-loader hard-fails on YAML parse errors

`loadYamlFile` in `src/config/config-loader.ts` MUST throw a typed error class named
`ConfigParseError` when the YAML parser raises an exception during parsing. `ConfigParseError`
MUST carry at minimum two fields: `filePath: string` (the absolute path of the file that
failed) and `parserMessage: string` (the original message from the YAML parser, which
typically includes a line number). `loadYamlFile` MUST NOT return `null` on parse failures
— `null` is reserved exclusively for the file-not-found (ENOENT) case. `ConfigLoader.load()`
MUST propagate `ConfigParseError` to its caller without suppression. Every metta CLI command
that calls `ConfigLoader.load()` — including but not limited to `metta status`, `metta propose`,
`metta plan`, `metta execute`, `metta verify`, `metta ship`, and `metta complete` — MUST catch
`ConfigParseError`, print a human-readable message to stderr that includes the file path, a
line number (sourced from `parserMessage` when available), and the literal text
`run: metta doctor --fix`, then exit with a non-zero status code. The only commands exempt
from this hard-fail behaviour are `metta doctor` and `metta doctor --fix`, which MUST remain
operable on a corrupt config file.

### Scenario: corrupt config blocks metta status with actionable message

- GIVEN `.metta/config.yaml` contains two `stacks:` keys at the top level of the `project:`
  mapping, making it invalid for strict-mode YAML parsers
- WHEN the developer runs `metta status`
- THEN the command exits non-zero and its stderr output contains the substring
  `.metta/config.yaml` and the substring `metta doctor --fix`

### Scenario: metta doctor is not blocked by the same corrupt config

- GIVEN the same `.metta/config.yaml` with duplicate `stacks:` keys that causes `metta status`
  to exit non-zero
- WHEN the developer runs `metta doctor` (without `--fix`)
- THEN the command exits 0 (or non-zero only due to a failed diagnostic check, not due to a
  `ConfigParseError`) and does not print `metta doctor --fix` as a remediation for the parse
  error itself

---

## ADDED: Requirement: metta doctor --fix repairs duplicate-keys and schema-invalid config

`src/cli/commands/doctor.ts` MUST accept a `--fix` flag on the `doctor` subcommand. When
`--fix` is provided, the doctor command MUST: (a) read `.metta/config.yaml` using a lenient
parse path — specifically `yaml.parseDocument` with duplicate-key tolerance — so that the
command does not itself throw on corrupt input; (b) deduplicate all duplicate map keys
anywhere in the document by retaining the LAST occurrence of each key and discarding earlier
ones; (c) parse the deduplicated plain-object form against `ProjectConfigSchema` and drop any
key-value pairs that fail validation, printing one line to stdout per dropped key in the form
`Dropped invalid key: <key-path>`; (d) write the repaired document back to
`.metta/config.yaml` using `setProjectField` or a direct `yaml.Document` serialize-and-write;
(e) when git is available in the project root and the file was actually changed, auto-commit
the repaired file with the commit subject exactly `chore: metta doctor repaired .metta/config.yaml`,
including only `.metta/config.yaml` in the commit diff. `metta doctor --fix` MUST NOT
hard-fail on a `ConfigParseError` — it MUST parse the raw file bytes in lenient mode.

### Scenario: three duplicate stacks lines collapsed to one with auto-commit

- GIVEN `.metta/config.yaml` contains three `stacks:` entries under `project:` with different
  values (`["typescript"]`, `["node"]`, `["rust"]`) accumulated from repeated buggy installs
- WHEN the developer runs `metta doctor --fix`
- THEN the resulting `.metta/config.yaml` contains exactly one `stacks:` key under `project:`
  with the value from the last (third) occurrence (`["rust"]`), and `git log -1 --format=%s`
  outputs `chore: metta doctor repaired .metta/config.yaml`

### Scenario: schema-invalid key is dropped with a reported line

- GIVEN `.metta/config.yaml` contains a top-level key `foo: "bar"` that is not present in
  `ProjectConfigSchema` (which uses `.strict()`)
- WHEN the developer runs `metta doctor --fix`
- THEN the `foo:` key is absent from the written file, and stdout contains a line matching
  `Dropped invalid key: foo`

---

## ADDED: Requirement: ProjectConfigSchema carries a verification section

`src/schemas/project-config.ts` MUST define a new exported Zod schema named
`VerificationConfigSchema` as a `z.object` with exactly two fields: `strategy` typed as
`z.enum(['tmux_tui', 'playwright', 'cli_exit_codes', 'tests_only'])` (required) and
`instructions` typed as `z.string().optional()` (optional). The enum values MUST be the four
listed exactly — no aliases, no additional values. The top-level `ProjectConfigSchema` MUST
add an optional field `verification: VerificationConfigSchema.optional()` to its object
definition. Because `ProjectConfigSchema` uses `.strict()`, no undeclared sub-key under
`verification:` MAY be present without triggering a Zod validation failure. The
`VerificationConfig` TypeScript type MUST be exported as `z.infer<typeof VerificationConfigSchema>`.

### Scenario: valid verification block is accepted by Zod

- GIVEN a plain JavaScript object `{ project: { name: "foo" }, verification: { strategy: 'playwright' } }`
- WHEN `ProjectConfigSchema.parse(obj)` is called
- THEN parsing succeeds and the returned value has `verification.strategy === 'playwright'`

### Scenario: invalid strategy enum value is rejected with a field-level error

- GIVEN a plain JavaScript object `{ verification: { strategy: 'magic' } }`
- WHEN `ProjectConfigSchema.safeParse(obj)` is called
- THEN `result.success` is `false` and `result.error.issues` contains at least one issue whose
  `path` includes `'verification'` and `'strategy'`

---

## ADDED: Requirement: /metta-init Round 4 captures verification strategy

The SKILL.md file at `.claude/skills/metta-init/SKILL.md` AND the template copy at
`src/templates/skills/metta-init/SKILL.md` MUST each be updated to add a Round 4 section
titled "Round 4 — Verification Strategy" that appears after the existing Round 3 section.
Round 4 MUST use `AskUserQuestion` to present the four enum values
`tmux_tui`, `playwright`, `cli_exit_codes`, and `tests_only` as selectable options for
the verification strategy, along with the mandatory exit option
`I'm done — proceed with these answers`. When the user selects a strategy, Round 4 MUST
issue a second `AskUserQuestion` for free-form `verification.instructions` text (e.g.
tmux pane identifier, Playwright base URL, CLI entry command). After Round 4 completes,
the orchestrator MUST pass the collected `verification_strategy` and `verification_instructions`
values to the `metta-discovery` subagent (or an equivalent config-write step) so that
`setProjectField(root, ['verification', 'strategy'], strategy)` and, when instructions are
non-empty, `setProjectField(root, ['verification', 'instructions'], instructions)` are both
called before the agent returns. The two SKILL.md files MUST be byte-identical.

### Scenario: selecting tmux_tui with instructions writes verification block

- GIVEN a developer running `/metta-init` on a fresh project completes Rounds 1 through 3
- WHEN Round 4 prompts appear and the developer selects `tmux_tui` and enters instructions
  `Pane: zeus:1`
- THEN after `/metta-init` exits, `.metta/config.yaml` contains a `verification:` block with
  `strategy: tmux_tui` and `instructions: "Pane: zeus:1"`, and
  `ProjectConfigSchema.parse(yaml.parse(content))` succeeds

### Scenario: the two SKILL.md copies are byte-identical after the update

- GIVEN the SKILL.md update has been applied
- WHEN a byte-level diff is run between `.claude/skills/metta-init/SKILL.md` and
  `src/templates/skills/metta-init/SKILL.md`
- THEN the diff is empty — the files are identical

---

## ADDED: Requirement: metta instructions verification injects strategy into agent context

`src/cli/commands/instructions.ts` MUST load the project config via `ConfigLoader.load()` and,
when the requested `artifactId` argument is `'verification'`, append two new fields to the
`context` object in the JSON output: `verification_strategy` (type `string | null`) and
`verification_instructions` (type `string | null`). When the project config contains a
`verification.strategy` value, `verification_strategy` MUST be set to that string verbatim
without any translation, defaulting, or normalisation. When `verification.instructions` is
present, `verification_instructions` MUST be set to that string verbatim. Both fields MUST be
`null` when the `verification` section is absent from the config or when the field within it
is absent. These two fields MUST appear as top-level keys of `context`, distinct from all
existing fields already present in the instructions output payload.

### Scenario: both fields populated when config has a full verification block

- GIVEN `.metta/config.yaml` contains
  `verification:\n  strategy: playwright\n  instructions: "http://localhost:3000"`
- WHEN `metta instructions verification --json` is run against the project
- THEN the emitted JSON object satisfies
  `output.context.verification_strategy === 'playwright'` and
  `output.context.verification_instructions === 'http://localhost:3000'`

### Scenario: both fields are null when verification block is absent

- GIVEN `.metta/config.yaml` has no `verification:` key
- WHEN `metta instructions verification --json` is run
- THEN the emitted JSON object satisfies `output.context.verification_strategy === null` and
  `output.context.verification_instructions === null`

---

## ADDED: Requirement: verifier agents error on missing verification.strategy in non-default projects

The verifier agent template(s) under `src/templates/agents/` AND the corresponding deployed
copies under `.claude/agents/` MUST include an instruction block that applies the following
logic when the agent reads its context payload from `metta instructions verification --json`:

When `verification_strategy` is `null` AND the project has at least one user-authored change
(determined by inspecting `spec/changes/` for directories containing a `stories.md` or
`intent.md` file), the verifier MUST NOT silently select any default strategy. Instead, the
verifier MUST emit a structured error message to stderr that: (1) names the file
`.metta/config.yaml` as the location requiring update, (2) lists all four valid strategy
values `tmux_tui | playwright | cli_exit_codes | tests_only`, (3) includes the exact
command string `/metta-init` that the user can copy and run to supply the missing strategy,
and (4) exits non-zero before performing any verification step.

When `verification_strategy` is `null` AND no user-authored changes exist (first-run
verification on a freshly installed project with no changes in `spec/changes/`), the
verifier MAY default to `tests_only` and MUST emit an informational note to stderr stating
that it is defaulting to `tests_only` and how to configure an explicit strategy.

### Scenario: legacy project config triggers a hard error with copy-pasteable remediation

- GIVEN `.metta/config.yaml` has no `verification:` block
- AND `spec/changes/` contains at least one subdirectory with a `stories.md` file
- WHEN a verifier agent is spawned during `metta verify` and reads its context
- THEN the verifier's stderr output contains the literal string `/metta-init` and the literal
  string `.metta/config.yaml`, and the agent exits non-zero without running any test command

### Scenario: first-run verification with no changes defaults to tests_only with informational note

- GIVEN `.metta/config.yaml` has no `verification:` block
- AND `spec/changes/` is empty or contains no subdirectory with a `stories.md` file
- WHEN a verifier agent reads its context
- THEN the verifier emits an informational note (not an error) to stderr mentioning
  `tests_only` as the defaulted strategy and continues to run verification
