# Design: harden-metta-config-yaml-lifecycle-across-three-related-bugs

## Approach

Three independent research axes converge on a coherent set of decisions that reinforce each other:

**Decision 1 — yaml.parseDocument-based writes via a shared `setProjectField` helper.**
All config writes go through a single, tested function in `src/config/config-writer.ts` that uses `yaml.parseDocument(source)` + `doc.setIn(path, value)` + `doc.toString()`. This replaces the regex/splice approach in `writeStacksToConfig` (lines 177-208 of `install.ts`) and is the persistence path for Round 4 verification answers. The Document API preserves comments attached to AST nodes (`commentBefore`, `comment`), detects and mirrors the existing flow vs block style of array nodes, and achieves idempotency naturally: `setIn` replaces the value node in-place rather than appending a new mapping pair, so calling the function twice with identical arguments produces byte-identical output after the first trailing-newline normalization.

**Decision 2 — Pure `repairProjectConfig` routine behind `metta doctor --fix`.**
Doctor repair lives in `src/config/repair-config.ts` as a pure function with no I/O. It parses with `yaml.parseDocument(source, { uniqueKeys: false })` so it tolerates the exact corrupt output produced by the legacy regex writer. Dedup semantics are last-occurrence-wins, which matches the install-time append pattern (the newest install's intent is at the bottom). Schema-invalid key removal is surgical: iterate Zod `unrecognized_keys` issues and call `doc.deleteIn([...issue.path, badKey])` per offender. A bounded re-parse loop (max 3 passes) handles cascading Zod issues. The `doctor.ts` action handler owns all I/O (read, call pure function, write, commit). Doctor bypasses `ConfigLoader` entirely — it reads the raw file and hands bytes directly to `repairProjectConfig` — so it remains operable on a corrupt config after the hard-fail change lands.

**Decision 3 — Schema-first ordering.**
`VerificationConfigSchema` and the optional `verification` field on `ProjectConfigSchema` MUST be added before any SKILL.md or write code is deployed. Because `ProjectConfigSchema` uses `.strict()`, writing a `verification:` block to `.metta/config.yaml` before the schema change lands causes `ConfigLoader.load()` to throw on every subsequent read. This means Batch 1 of the implementation is schema-only, and Round 4 write code is Batch 2 or later.

These three decisions reinforce each other in a closed cycle: the `yaml.parseDocument` path is shared between `setProjectField` (writes) and `repairProjectConfig` (repair), concentrating all YAML mutation logic in two modules with no regex-based string munging anywhere else. Hard-failing the consumer (`ConfigLoader`) + making `metta doctor --fix` the sole escape hatch + keeping doctor lenient via `{ uniqueKeys: false }` eliminates the failure mode where a corrupt config silently degrades all stack-driven features. Schema-first ordering prevents `setProjectField` and Round 4 persistence from triggering a self-inflicted regression before the schema is ready to accept the new key.

## Components

Components are listed in implementation dependency order. Nothing should be written before its prerequisite in this list.

### 1. `src/schemas/project-config.ts` (modify)

**Responsibility:** Add `VerificationConfigSchema` and wire the optional `verification` field into `ProjectConfigSchema`. This is the prerequisite for every other component in this change.

Adds two new exports:
- `VerificationStrategyEnum` — `z.enum(['tmux_tui', 'playwright', 'cli_exit_codes', 'tests_only'])`
- `VerificationConfigSchema` — `z.object({ strategy: VerificationStrategyEnum, instructions: z.string().optional() }).strict()`
- `VerificationConfig` type — `z.infer<typeof VerificationConfigSchema>`

Extends `ProjectConfigSchema` with `verification: VerificationConfigSchema.optional()`.

Must be barrel-exported from `src/index.ts` alongside the existing schema exports.

### 2. `src/config/config-writer.ts` (new)

**Responsibility:** Single entry point for all YAML writes to `.metta/config.yaml`. Exported function: `setProjectField(root: string, path: string[], value: unknown): Promise<void>`.

Reads `<root>/.metta/config.yaml` via `readFile` (throws `ENOENT` if absent — callers must ensure the file exists before calling). Parses with `YAML.parseDocument(raw)`. Checks `doc.errors.length > 0` and throws the first parse error if present. When `value` is an array, detects whether the existing node at `path` is a `YAMLSeq` with `flow = true`, and if so constructs a new `YAMLSeq` with `flow = true` and individual `Scalar` items to preserve flow style; otherwise calls `doc.setIn(path, value)` directly. Writes `doc.toString()` back to disk.

Must be barrel-exported from `src/index.ts`.

### 3. `src/config/repair-config.ts` (new)

**Responsibility:** Pure repair logic with no I/O. Exported interface and function:

```typescript
export interface RepairResult {
  source: string              // final YAML string (equals input when changed=false)
  duplicatesRemoved: string[] // human-readable label per duplicate removed
  invalidKeysRemoved: string[] // human-readable label per invalid key dropped
  changed: boolean
}

export function repairProjectConfig(source: string): RepairResult
```

Step 1: parse leniently with `yaml.parseDocument(source, { uniqueKeys: false })`. Step 2: dedup all top-level and nested map keys (last-occurrence-wins) by walking `YAMLMap.items` in reverse, tracking seen keys in a `Set`, and splicing out earlier duplicates. Step 3: call `ProjectConfigSchema.safeParse(doc.toJSON())`; for each `unrecognized_keys` issue, call `doc.deleteIn([...issue.path, badKey])` per offending key; for other issue types (type/enum violations), call `doc.deleteIn(issue.path)`. Repeat step 3 up to 3 times to handle cascading issues. String-compare `doc.toString()` against `source` to determine `changed`.

Must be barrel-exported from `src/index.ts`.

### 4. `src/config/config-loader.ts` (modify)

**Responsibility:** Change `loadYamlFile` from catch-and-warn to throw on YAML parse errors. Add and export `ConfigParseError`.

`ConfigParseError extends Error` carries:
- `path: string` — absolute file path of the failing config file
- `cause: unknown` — original exception from the YAML parser (often includes line number in `message`)
- `parserMessage: string` — convenience string from `cause.message ?? String(cause)`

Change the inner `try/catch` in `loadYamlFile` (currently lines 52-57): instead of `process.stderr.write(...)` + `return null`, throw `new ConfigParseError(filePath, err)`.

`null` return from `loadYamlFile` remains valid only for the `ENOENT` case (file not found).

`ConfigLoader.load()` propagates `ConfigParseError` without suppression — it must not be caught in the Zod error handler block at line 136.

Top-level CLI error boundary (the `try/catch` in each command's `.action()` handler, or a shared handler in `src/cli/helpers.ts`) must catch `ConfigParseError`, print to stderr: `${err.path}: ${err.parserMessage}\nRun 'metta doctor --fix' to repair.`, then call `process.exit(4)`.

**Important exception:** `metta doctor` and `metta doctor --fix` MUST NOT pass through `ConfigLoader.load()` for the file being repaired. The `--fix` action handler reads the raw file bytes and passes them directly to `repairProjectConfig`. The standard diagnostic checks in `registerDoctorCommand` that do not parse `.metta/config.yaml` via `ConfigLoader` are unaffected.

### 5. `src/cli/commands/install.ts` (modify)

**Responsibility:** Delete `writeStacksToConfig`'s regex/splice body; replace with a call to `setProjectField`.

Delete lines 187-208 (the `const stacksLine`, `const lines`, `const stackIdx`, all splice/append logic, and the `writeFile` call). Replace with:

```typescript
await setProjectField(root, ['project', 'stacks'], stacks)
```

Import `setProjectField` from `../../config/config-writer.js`. The `import { readFile, writeFile }` can drop `writeFile` if it is no longer used after this change.

### 6. `src/cli/commands/doctor.ts` (modify)

**Responsibility:** Add `--fix` flag that reads raw config bytes, calls `repairProjectConfig`, writes and auto-commits the result.

Add `.option('--fix', 'Repair duplicate keys and schema-invalid entries in .metta/config.yaml')` to the `doctor` command registration.

When `options.fix` is truthy, the action handler:
1. Reads `.metta/config.yaml` via `readFile`. If the file does not exist, prints `No .metta/config.yaml found — nothing to repair.` and returns.
2. Calls `repairProjectConfig(source)` to get `{ source: repairedSource, duplicatesRemoved, invalidKeysRemoved, changed }`.
3. If `!changed`, prints `.metta/config.yaml is already valid — no changes needed.` and exits 0.
4. In human mode, prints:
   ```
   Repaired .metta/config.yaml:
     - removed duplicate key 'stacks' (kept last occurrence)
     - dropped unrecognized key 'foo'
   ```
   (one line per entry in `duplicatesRemoved` and `invalidKeysRemoved`)
5. Writes `repairedSource` back to `.metta/config.yaml`.
6. Calls `autoCommitFile(ctx.projectRoot, configPath, 'chore: metta doctor repaired .metta/config.yaml')`.
7. In `--json` mode, emits `{ repair: { duplicates_removed: string[], invalid_keys_removed: string[], committed: boolean, commit_sha: string | null } }`.
8. Exits 0 on success; exits 4 if the write or commit throws.

Does NOT call `assertOnMainBranch`. Does NOT call `ConfigLoader.load()` for the file being repaired.

### 7. `src/cli/commands/instructions.ts` (modify)

**Responsibility:** Inject `verification_strategy` and `verification_instructions` into the context payload when `artifactId === 'verification'`.

After the `const output = await ctx.instructionGenerator.generate({ ... })` call and before the `outputJson` call, add:

```typescript
if (artifactId === 'verification') {
  const cfg = await ctx.configLoader.load()
  const v = (cfg as Record<string, unknown>).verification as
    { strategy?: string; instructions?: string } | undefined
  ;(output.context as Record<string, unknown>).verification_strategy =
    v?.strategy ?? null
  ;(output.context as Record<string, unknown>).verification_instructions =
    v?.instructions ?? null
}
```

Both fields are `null` when `verification` is absent or when the subfield is absent. The value is passed through verbatim without translation, defaulting, or normalization. `ConfigParseError` thrown by `ctx.configLoader.load()` propagates to the existing `catch` block in `registerInstructionsCommand`, which already exits 4.

### 8. `.claude/skills/metta-init/SKILL.md` and `src/templates/skills/metta-init/SKILL.md` (modify, byte-identical)

**Responsibility:** Add Round 4 — Verification Strategy after Round 3. These two files MUST remain byte-identical after the edit.

Changes:
- Update exit-criterion line from "all three rounds have completed" to "all **four** rounds have completed".
- After the Round 3 section, add Round 4 with three `AskUserQuestion` calls:
  - Strategy selection: options are `Run the test suite (tests_only)`, `CLI commands and exit codes (cli_exit_codes)`, `Playwright / browser end-to-end (playwright)`, `tmux TUI session observation (tmux_tui)`, and `I'm done — proceed with these answers`.
  - Free-form instructions: `Any additional verification instructions for the verifier agent? (optional)` with free text entry plus the exit option.
  - Gate override: `Gate commands to run? (defaults: npm test, npm run lint, npx tsc --noEmit)` with `Use defaults`, `Override (describe)`, and the exit option.
- Update the between-round status line after R3 to: `Resolved: identity, stack, conventions. Open: verification — proceeding to Round 4.`
- Add status line after R4: `Resolved: all questions. Proceeding to metta-discovery subagent.`
- Extend the `<DISCOVERY_ANSWERS>` XML block with a `<verification>` element:
  ```xml
  <verification>
    strategy: <!-- one of: tmux_tui | playwright | cli_exit_codes | tests_only -->
    instructions: <!-- free-form text or empty -->
  </verification>
  ```
- Add one clause to the discovery agent task instruction in Step 4: "Also write a `verification:` block in `.metta/config.yaml` from `<verification>` using `setProjectField(root, ['verification', 'strategy'], strategy)` and, when instructions are non-empty, `setProjectField(root, ['verification', 'instructions'], instructions)`. If `<verification>` is empty (early exit before R4), omit the `verification:` block entirely."

### 9. `.claude/agents/metta-verifier.md` and `src/templates/agents/metta-verifier.md` (modify, byte-identical)

**Responsibility:** Add the `## Verification Context` section explaining how to read context fields and handle missing strategy. These two files MUST remain byte-identical after the edit.

Insert a new `## Verification Context` section between `## Your Role` and `## Rules`:

```markdown
## Verification Context

When spawned via `metta instructions verification --json`, the JSON payload includes:
- `context.verification_strategy` — one of `tests_only | cli_exit_codes | playwright | tmux_tui`, or `null`
- `context.verification_instructions` — project-specific free-form notes, or `null`

Rules for missing strategy (`verification_strategy` is `null`):
- If `spec/changes/` and `spec/archive/` are both empty (first-run heuristic): default to
  `tests_only` and emit an informational note to stderr: "No verification strategy configured.
  Defaulting to tests_only. Run `/metta-init` to set a project-specific strategy."
- If either directory is non-empty (legacy project with history): emit a hard error to stderr
  and exit non-zero without running any verification step:
  "ERROR: verification.strategy missing from .metta/config.yaml. This project has existing
  changes but no verification strategy configured. Fix by running `/metta-init` or adding to
  .metta/config.yaml:
  ```yaml
  verification:
    strategy: tests_only   # or: cli_exit_codes | playwright | tmux_tui
    instructions: ""
  ```"
- Do NOT reference `metta config set` — that subcommand is a stub that writes nothing.
```

### 10. Tests (new and modified)

**`src/config/config-writer.test.ts` (new)**
Unit tests for `setProjectField`:
- idempotent re-write: calling twice with identical arguments produces byte-identical on-disk content.
- comment preservation: `# project-specific override` above `stacks:` survives the call.
- flow style preservation: flow-style `stacks: ["rust"]` remains flow after update.
- ENOENT propagation: throws when config file does not exist.
- parse error propagation: throws when config is malformed YAML.

**`src/config/repair-config.test.ts` (new)**
Unit tests for `repairProjectConfig`:
- three duplicate `stacks:` lines collapsed to the last occurrence; `duplicatesRemoved` lists two entries.
- schema-invalid top-level key `foo: bar` dropped; `invalidKeysRemoved` lists one entry.
- already-valid config: `changed = false`, `repairedSource === source`.
- combined: both dedup and invalid-key removal in one pass.

**`tests/cli.test.ts` (modify, existing file)**
Extend the existing idempotency test around line 102:
- After two `metta install` runs against a project with a pre-existing `stacks:` entry, assert the `.metta/config.yaml` file contains exactly one line matching `/^\s*stacks:/`.

Add new test cases:
- Corrupt config hard-fail: write a `.metta/config.yaml` with duplicate top-level `stacks:` keys, run `metta status`, assert exit code is non-zero and stderr contains `.metta/config.yaml` and `metta doctor --fix`.
- `metta doctor --fix` dedup: write a config with three `stacks:` entries, run `metta doctor --fix`, assert exactly one `stacks:` line, assert git log subject is `chore: metta doctor repaired .metta/config.yaml`.
- `metta doctor --fix` invalid-key removal: write a config with `foo: bar` top-level key, run `metta doctor --fix`, assert `foo:` is absent from the written file.

## Data Model

### New Zod schemas in `src/schemas/project-config.ts`

```typescript
export const VerificationStrategyEnum = z.enum(['tmux_tui', 'playwright', 'cli_exit_codes', 'tests_only'])

export const VerificationConfigSchema = z.object({
  strategy: VerificationStrategyEnum,
  instructions: z.string().optional(),
}).strict()

export type VerificationConfig = z.infer<typeof VerificationConfigSchema>

// Added to ProjectConfigSchema:
// verification: VerificationConfigSchema.optional(),
```

The `strategy` field is required within the `verification` object (not optional at that level), but the entire `verification` object is optional on `ProjectConfigSchema`. This means a config without a `verification:` key is valid (legacy configs parse unchanged), but a `verification:` block that omits `strategy` is a Zod validation error.

### Canonical YAML shape

```yaml
project:
  name: zeus
  stacks: ["rust"]
verification:
  strategy: tmux_tui
  instructions: |
    Pane: zeus:1
    Scenarios: spec/changes/<change>/stories.md
```

`verification:` is a **top-level key** in the document, a sibling of `project:`, NOT nested under `project:`. This is confirmed by the research and matches the `ProjectConfigSchema` structure where `verification` is a direct field of the top-level object.

### `RepairResult` interface in `src/config/repair-config.ts`

```typescript
export interface RepairResult {
  source: string
  duplicatesRemoved: string[]
  invalidKeysRemoved: string[]
  changed: boolean
}
```

### `ConfigParseError` in `src/config/config-loader.ts`

```typescript
export class ConfigParseError extends Error {
  constructor(
    public readonly path: string,
    public readonly cause: unknown,
  ) {
    const parserMsg = cause instanceof Error ? cause.message : String(cause)
    super(`Failed to parse YAML config at ${path}: ${parserMsg}`)
    this.name = 'ConfigParseError'
    this.parserMessage = parserMsg
  }
  readonly parserMessage: string
}
```

## API Design

### `setProjectField(root: string, path: string[], value: unknown): Promise<void>`

Exported from `src/config/config-writer.ts`. Reads `<root>/.metta/config.yaml`, parses with `yaml.parseDocument`, calls `doc.setIn(path, value)` (with flow-style preservation for array values), writes `doc.toString()` back. Throws `ENOENT` if the file does not exist. Throws the first parse error if `doc.errors.length > 0`. Creates no files — callers must ensure the config file was bootstrapped by a prior `metta install`. Idempotent: two calls with identical arguments leave the file byte-for-byte identical.

### `repairProjectConfig(source: string): RepairResult`

Exported from `src/config/repair-config.ts`. Pure function, no I/O. Accepts raw YAML string; returns `RepairResult`. Tolerates duplicate keys via `{ uniqueKeys: false }`. Dedup semantics: last occurrence wins. Schema removal: surgical `doc.deleteIn` per Zod issue. Re-parse loop capped at 3 passes.

### `ConfigParseError`

Exported from `src/config/config-loader.ts`. Thrown by `loadYamlFile` when `YAML.parse(content)` raises an exception. Carries `path: string` and `parserMessage: string`. Propagated without suppression through `ConfigLoader.load()`. Caught by the top-level CLI error boundary in each command's action handler; prints `${err.path}: ${err.parserMessage}\nRun 'metta doctor --fix' to repair.` to stderr and exits 4.

### `metta doctor --fix`

Exit codes:
- `0` — repair succeeded (including the no-op case where file was already valid) and commit was created or skipped (no changes).
- `4` — write or commit failed unexpectedly.

`--json` output shape:
```json
{
  "repair": {
    "duplicates_removed": ["removed duplicate key 'stacks' (kept last occurrence)"],
    "invalid_keys_removed": ["dropped unrecognized key 'foo'"],
    "committed": true,
    "commit_sha": "a3f91c2"
  }
}
```

Human mode prints one line per removal, then the commit SHA or "Not committed: <reason>".

No `--dry-run` flag. The operation is idempotent and reversible via git.

### `metta instructions verification --json`

When `artifactId === 'verification'`, the emitted JSON object gains two new top-level keys in `context`:
- `verification_strategy: string | null` — verbatim from `config.verification.strategy`, or `null` when absent.
- `verification_instructions: string | null` — verbatim from `config.verification.instructions`, or `null` when absent.

Both fields are always present in the output (never omitted); consumers check for `null` explicitly.

## Dependencies

### Internal

- `src/config/config-writer.ts` (new) is consumed by:
  - `src/cli/commands/install.ts` — replaces `writeStacksToConfig` body
  - `src/templates/skills/metta-init/SKILL.md` (and its deployed copy) — discovery agent writes `verification:` block via this helper

- `src/config/repair-config.ts` (new) is consumed by:
  - `src/cli/commands/doctor.ts` — `--fix` action handler

- `src/schemas/project-config.ts` (modified) is consumed by:
  - `src/config/repair-config.ts` — `ProjectConfigSchema.safeParse` in repair loop
  - `src/config/config-loader.ts` — `ProjectConfigSchema.parse` (existing, unchanged call site)
  - Every file that imports `ProjectConfig` type (existing consumers are unaffected because `verification` is optional)

- `src/config/config-loader.ts` (modified) is consumed by:
  - All CLI commands that call `ConfigLoader.load()` — they gain the `ConfigParseError` propagation path
  - `src/cli/commands/instructions.ts` — new `ctx.configLoader.load()` call for verification context injection

### External

`yaml@^2.7.1` (resolved: v2.8.3) — already installed. The `yaml.parseDocument`, `doc.setIn`, `doc.deleteIn`, `YAMLSeq`, `YAMLMap`, `Scalar`, and `{ uniqueKeys: false }` parse option are all available in this version. No new npm dependencies are introduced.

`zod` — already installed. `unrecognized_keys` issue shape with `keys: string[]` confirmed available. No version change required.

## Risks & Mitigations

**1. Hard-fail blocks CI pipelines and scripts that previously tolerated a null config.**
Prior to this change, a corrupt `.metta/config.yaml` caused `loadYamlFile` to return `null` and the command proceeded with defaults. Any CI script that ran `metta` against a project with a corrupt config would have silently succeeded. After this change, the same script exits 4 with an error message.

Mitigation: the error message names the exact file and provides a one-command fix (`metta doctor --fix`). The exit code (4) is distinct from general errors, so CI scripts can specifically handle it. Teams can add `metta doctor` as a preflight step in their CI pipeline without the `--fix` flag to detect corruption early without auto-repair.

**2. Schema addition with `.strict()` breaks any config that already has an invalid key.**
The `verification` field is added as optional, so pre-existing configs that lack the key parse unchanged. However, if any existing `.metta/config.yaml` file already contains a `verification:` block with a non-enum `strategy` value (hand-written before this change), the Zod strict parse now fails it.

Mitigation: `metta doctor --fix` repairs schema-invalid keys. The error message from `ConfigParseError` directs users to run it. Because `.strict()` was already in place, any currently-passing configs are guaranteed not to have a `verification:` key with an unrecognized value today.

**3. `setProjectField` reformats the entire YAML document on first write, surprising users who added manual formatting.**
`doc.toString()` normalizes trailing newlines and may alter whitespace in regions the caller did not touch, depending on the yaml library's serialization defaults. This is a one-time reformat on first write; subsequent writes are stable.

Mitigation: flow/block style preservation is implemented for array values. Comments are preserved via the Document API's `commentBefore`/`comment` node properties. The spec explicitly lists "comment preservation" and "blank line preservation" as acceptance criteria (US-7), and the `config-writer.test.ts` unit tests verify both. The reformat is a known, documented trade-off in the research (research-yaml-document-api.md, Strategy 1 section).

**4. `metta doctor --fix` commits to the wrong branch, polluting feature-branch history.**
Unlike `metta issue`, which calls `assertOnMainBranch` because issues are canonical spec records, `metta doctor --fix` targets a local tool-config file. A developer on a feature branch may be blocked from all metta commands by the hard-fail and needs to repair before they can do anything else.

Mitigation: no `assertOnMainBranch` on `metta doctor --fix` (this is the explicit research decision from research-doctor-fix-repair.md §Q5). `autoCommitFile` already refuses to commit when other tracked files are dirty, which prevents mixing the repair commit with unrelated in-progress changes. The commit message is deterministic and easily identifiable in git history.

**5. Missing-strategy error message references a stub command, sending users to a no-op.**
`src/cli/commands/config.ts` has a `config set` subcommand that prints "edit .metta/config.yaml directly for now" and writes nothing. If the verifier agent's error text referenced `metta config set verification.strategy tests_only`, users would follow the instruction and nothing would happen.

Mitigation: all error messages in the verifier agent template and in `instructions.ts` context injection reference only `/metta-init` (interactive re-discovery) and a literal YAML snippet for direct editing. The string `metta config set` does not appear anywhere in the new error paths. This is confirmed as a critical constraint in research-init-round-4-verifier.md §2.4.

**6. Init Round 4 answers are written to config before the schema change lands, causing immediate hard-fail on next config read.**
If the SKILL.md update ships before `src/schemas/project-config.ts` is updated, the `metta-discovery` agent will write a `verification:` block that `ConfigLoader.load()` then rejects with a Zod `strict()` validation error on every subsequent command.

Mitigation: implementation must be batched with schema changes in Batch 1 before any SKILL.md or config-write code lands. The research.md §Axis 3 explicitly states "ProjectConfigSchema MUST gain the optional `verification` field FIRST." The task ordering in the plan artifact must enforce this dependency.

**7. Skill template drift between `.claude/skills/metta-init/SKILL.md` and `src/templates/skills/metta-init/SKILL.md`.**
The two copies are currently confirmed byte-identical (research-init-round-4-verifier.md §1). Any edit applied to only one copy will silently diverge them, causing inconsistent behavior between freshly installed projects and the already-deployed skill.

Mitigation: both files must be edited in the same commit and the spec requirement (spec.md, Round 4 section) explicitly states the two copies MUST be byte-identical. The same parity requirement applies to `.claude/agents/metta-verifier.md` and `src/templates/agents/metta-verifier.md`. Byte-identity is verifiable post-edit with a diff check, and the metta-issue architecture lesson (Batch B) established that parity tests should be added to the test suite to prevent future drift.
