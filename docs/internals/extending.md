# Extending Metta

A contributor's guide to adding new pieces to metta: CLI commands, gates, workflow tiers, skills/agents, and AI providers. Each section shows where files go, the required shape, a minimal real example, how the piece is discovered and wired, and a short checklist.

For the big-picture component map, see [architecture.md](./architecture.md).

## Ground rules (apply to every extension)

These conventions are enforced across the codebase — violate them and CI (or a reviewer) will bounce the change.

- **Templates are files, never string literals.** Workflows, gates, artifacts, skills, and agents live as real files under `src/templates/`. The build copies them to `dist/templates/` (`copy-templates`). Never inline template content as a TypeScript string literal.
- **`.js` import extensions everywhere.** This is a Node16 ESM, ESM-only package. Every relative import must end in `.js` (e.g. `import { createCliContext } from '../helpers.js'`), even though the source file is `.ts`.
- **Validate all state and config with Zod.** Anything read from disk (YAML, JSON) is parsed through a Zod schema before use. New on-disk shapes get a new schema under `src/schemas/`.
- **Byte-identity for deployed template families.** `agents`, `skills`, `hooks`, and `statusline` have a committed deployed copy under `.claude/` that must be **byte-for-byte identical** to its `src/templates/` source. `tests/template-deploy-sync.test.ts` auto-discovers every source file and asserts the deployed copy matches. If you edit one of these templates, update the deployed `.claude/` copy in the same commit. (Workflows, gates, and artifacts are excluded — they ship via `dist/`, not a committed `.claude/` copy.)
- **No singletons, no unvalidated writes, no CommonJS.** Stateful modules are classes constructed per call (see `createCliContext()`); contracts are interfaces.
- `camelCase` functions/variables, `PascalCase` classes/types, `kebab-case` filenames. Conventional commits.

---

## 1. Adding a CLI command

### Where files go

- Command module: `src/cli/commands/<name>.ts`
- Wired into: `src/cli/index.ts`

### Shape

Every command exports a single `register<Name>Command(program: Command): void` function that registers itself on the shared Commander `program`. It builds its dependencies through `createCliContext()`, honours the global `--json` flag via `outputJson()`, and exits non-zero on error.

### Minimal example

Model a new command on `src/cli/commands/status.ts`:

```ts
import { Command } from 'commander'
import { createCliContext, outputJson, getErrorMessage } from '../helpers.js'

export function registerWidgetsCommand(program: Command): void {
  program
    .command('widgets')
    .description('List widgets for the active change')
    .argument('[change]', 'Change name')
    .option('--change <name>', 'Change name (alternative to positional)')
    .action(async (changeName, options) => {
      changeName = changeName ?? options.change
      const json = program.opts().json        // global --json lives on program
      const ctx = createCliContext()

      try {
        const changes = await ctx.artifactStore.listChanges()
        if (json) {
          outputJson({ changes })
        } else {
          console.log(changes.join('\n'))
        }
      } catch (err) {
        const message = getErrorMessage(err)
        if (json) {
          outputJson({ error: { code: 4, type: 'widgets_error', message } })
        } else {
          console.error(`Widgets failed: ${message}`)
        }
        process.exit(4)            // non-zero exit signals failure to callers/skills
      }
    })
}
```

### How it's wired

Add an import and a call in `src/cli/index.ts`:

```ts
import { registerWidgetsCommand } from './commands/widgets.js'
// ...
registerWidgetsCommand(program)
```

Notes:
- `createCliContext()` (in `src/cli/helpers.ts`) constructs every store/engine the command needs (`artifactStore`, `workflowEngine`, `gateRegistry`, `configLoader`, …). Don't `new` these up yourself — pull them off the context.
- The `--json` flag is a **global** option, read via `program.opts().json`, not a per-command option.
- Error envelope convention: `{ error: { code, type, message } }` in JSON mode, `process.exit(4)` for ordinary failures.
- A `preAction` hook in `index.ts` fails fast on a corrupt `.metta/config.yaml` for every command except a small repair-surface allowlist (`install`, `init`, `doctor`, `update`, `completion`). If your command must run on a broken config, add it to `CONFIG_PARSE_EXEMPT_COMMANDS`.

### Checklist

- [ ] `src/cli/commands/<name>.ts` exports `register<Name>Command(program)`
- [ ] Dependencies come from `createCliContext()`
- [ ] Handles `--json` via `program.opts().json` + `outputJson()`
- [ ] Errors print and `process.exit` non-zero (JSON error envelope when `--json`)
- [ ] Imported and called in `src/cli/index.ts` (with `.js` extension)
- [ ] Paired test under `tests/` (near 1:1 source-to-test ratio)

---

## 2. Adding a gate

A gate is a named pass/fail check (lint, tests, typecheck, custom validation) bound to a workflow artifact.

### Where files go

- Built-in gate: `src/templates/gates/<name>.yaml`
- Project-local override: `.metta/gates/<name>.yaml` (in a consuming project, not this repo)

### Shape

Validated by `GateDefinitionSchema` (`src/schemas/gate-definition.ts`):

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `name` | string | yes | — | Unique key; also how workflows reference the gate |
| `description` | string | yes | — | |
| `command` | string | yes | — | Shell command; exit 0 = pass |
| `timeout` | int (ms) | no | `120000` | Process group is SIGTERM'd, then SIGKILL'd after 1s |
| `required` | bool | no | `true` | |
| `on_failure` | enum | no | `retry_once` | One of `retry_once`, `stop`, `continue_with_warning` |

The schema is `.strict()` — unknown keys are rejected.

### Minimal example

`src/templates/gates/tests.yaml`:

```yaml
name: tests
description: Run project test suite
command: npm test
timeout: 300000
required: true
on_failure: stop
```

### How it's discovered and wired

- `GateRegistry.loadFromDirectory(dir)` (`src/gates/gate-registry.ts`) reads every `*.yaml`/`*.yml` in a directory, parses each through `GateDefinitionSchema`, and registers it by `name`. A missing/empty directory is silently fine.
- Built-ins load from `src/templates/gates` (resolved via `new URL('../../templates/gates', import.meta.url)` — see `src/cli/commands/verify.ts`).
- **Project-local override:** load `.metta/gates/` *after* the built-in directory. `register()` keys by `name`, so a same-named project gate replaces the built-in one (last write wins). This is how a consuming project swaps `npm test` for, say, `cargo test`.
- **Binding to a workflow:** add the gate's `name` to an artifact's `gates: [...]` array in a workflow YAML (see section 3). On failure, `on_failure: stop` halts the remaining gate run; subsequent gates are reported as `skip`.

### Checklist

- [ ] `src/templates/gates/<name>.yaml` with `name`/`description`/`command`
- [ ] No unknown keys (schema is `.strict()`)
- [ ] `command` exits 0 on success
- [ ] Referenced from the relevant workflow artifact's `gates: []`
- [ ] (If override-able) documented that `.metta/gates/<name>.yaml` replaces it
- [ ] Paired test under `tests/`

---

## 3. Adding a workflow tier

A workflow tier defines the ordered artifact pipeline (intent → spec → … → implementation → verification) for a complexity level. Built-in tiers: `trivial`, `quick`, `standard`, `full`.

### Where files go

- Built-in tier: `src/templates/workflows/<name>.yaml`
- Project-local override: `.metta/workflows/<name>.yaml` (in a consuming project)

### Shape

Validated by `WorkflowDefinitionSchema` (`src/schemas/workflow-definition.ts`), `.strict()`:

Top level: `name` (string), `version` (positive int), optional `description`, optional `extends` (name of a base workflow), `artifacts[]`, optional `overrides[]`.

Each entry in `artifacts[]`:

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Unique artifact id (e.g. `spec`) |
| `type` | string | Artifact type (e.g. `spec`, `execution`, `verification`) |
| `template` | string | Artifact template filename (resolved from the artifact templates dir) |
| `generates` | string | Output path/glob the artifact produces |
| `requires` | string[] | Ids of upstream artifacts — defines the DAG / build order |
| `agents` | string[] | Subagent personas that author this artifact (e.g. `proposer`) |
| `gates` | string[] | Gate names run for this artifact (see section 2) |

`overrides[]` (used with `extends`) re-specify a subset of `requires`/`agents`/`gates` for a given `id`.

### Minimal example

A trimmed `src/templates/workflows/standard.yaml` (two-artifact slice):

```yaml
name: standard
description: Standard workflow for medium-complexity features
version: 1

artifacts:
  - id: intent
    type: intent
    template: intent.md
    generates: intent.md
    requires: []
    agents: [proposer]
    gates: []

  - id: spec
    type: spec
    template: spec.md
    generates: spec.md
    requires: [intent]
    agents: [specifier]
    gates: [stories-valid]
```

The `requires` edges define the dependency DAG; the engine derives the build order from them.

### How it's discovered and wired

- `WorkflowEngine.loadWorkflow(name, searchPaths)` (`src/workflow/workflow-engine.ts`) resolves a workflow by searching an ordered list of directories. Callers pass project-local first, then built-in:

  ```ts
  const builtinWorkflows = new URL('../../templates/workflows', import.meta.url).pathname
  const projectWorkflows = join(ctx.projectRoot, '.metta', 'workflows')
  const graph = await ctx.workflowEngine.loadWorkflow(name, [projectWorkflows, builtinWorkflows])
  ```

  (See `src/cli/commands/propose.ts`.) First match wins, so `.metta/workflows/<name>.yaml` overrides a built-in of the same name.
- `extends` lets a tier inherit a base workflow's artifacts and apply `overrides`.
- The resolved graph exposes `buildOrder`; `metta propose --stop-after <id>` validates against it (only planning-phase ids, never `implementation`/`verification`).

### Checklist

- [ ] `src/templates/workflows/<name>.yaml` with `name`, `version`, `artifacts[]`
- [ ] Every `requires` id references a real artifact id (no dangling/cyclic deps)
- [ ] Each `agents` name maps to an installed agent persona (section 4)
- [ ] Each `gates` name maps to a registered gate (section 2)
- [ ] No unknown keys (schema is `.strict()`)
- [ ] Paired test under `tests/`

---

## 4. Adding a skill / agent template

Skills are the `/metta-*` slash commands an AI orchestrator invokes; agents are the subagent personas they dispatch. Both are **deployed template families** subject to the byte-identity rule.

### Where files go

- Skill: `src/templates/skills/<name>/SKILL.md` (a directory per skill)
- Agent: `src/templates/agents/<name>.md` (a single markdown file)
- Deployed copies (must stay byte-identical): `.claude/skills/<name>/SKILL.md` and `.claude/agents/<name>.md`

### Shape

**Skill** — `SKILL.md` with YAML frontmatter then the orchestration prose. From `src/templates/skills/metta-propose/SKILL.md`:

```markdown
---
name: metta:propose
description: Start a new change with Metta
argument-hint: "<description of what you want to build>"
allowed-tools: [Read, Write, Grep, Glob, Bash, Agent]
context: fork
agent: metta-skill-host
---

You are the **orchestrator** for a new spec-driven change...
```

Key frontmatter fields: `name` (the slash command, `metta:<x>`), `description`, `allowed-tools`. Skills that must run in an isolated subagent context declare `context: fork` plus `agent: metta-skill-host` — the host subagent is what lets skill-initiated `metta <cmd>` CLI calls bypass the guard hook.

**Agent** — `<name>.md` with frontmatter then the persona instructions. From `src/templates/agents/metta-constitution-checker.md`:

```markdown
---
name: metta-constitution-checker
description: "Checks a spec.md against the project constitution (Conventions + Off-Limits sections)"
tools: [Read]
color: yellow
---

You are a constitutional compliance checker...
```

Key frontmatter fields: `name` (must match the filename), `description`, `tools` (the agent's tool allowlist), optional `color`.

### How it's deployed and wired

- `installCommands(adapter, projectRoot)` (`src/delivery/command-installer.ts`) is called by `metta install` (`src/cli/commands/install.ts`). It recursively copies each skill directory under `src/templates/skills/` to the adapter's skills dir, and each `*.md` under `src/templates/agents/` to `.claude/agents/`.
- A skill's `agents: [...]` references in a workflow tier, and the agent personas the skill dispatches, must name real installed agents.

### The byte-identity rule (do not skip)

`agents` and `skills` are in the `FAMILIES` list in `tests/template-deploy-sync.test.ts`. That test auto-discovers every file under each `src/templates/<family>` and asserts a **byte-identical** copy exists at the matching `.claude/<family>` path, and that no orphan deployed files linger. So:

- Editing `src/templates/agents/<name>.md` **requires** updating `.claude/agents/<name>.md` to match exactly, in the same change.
- Adding a new skill/agent template **requires** committing its `.claude/` deployed copy too.
- Removing one **requires** removing the deployed copy (orphans fail the test).

A past incident (`metta-verifier-deployed-agent-copy-drifted-from-template`) shipped a stale agent for weeks because the deployed copy drifted — this test exists to prevent a recurrence.

### Checklist

- [ ] Skill: `src/templates/skills/<name>/SKILL.md` with `name`/`description`/`allowed-tools`
- [ ] Agent: `src/templates/agents/<name>.md` with `name` (= filename) / `description` / `tools`
- [ ] Byte-identical deployed copy committed under `.claude/skills/` or `.claude/agents/`
- [ ] No orphan files left in `.claude/` (removed templates also remove deployed copies)
- [ ] Any `agents`/`gates` references resolve to real installed pieces
- [ ] `tests/template-deploy-sync.test.ts` passes

---

## 5. Adding an AI provider

A provider wraps an LLM SDK behind metta's `AIProvider` interface so the rest of the system stays vendor-neutral.

### Where files go

- Interface and registry: `src/providers/provider.ts` (existing — don't duplicate)
- New provider: `src/providers/<vendor>-provider.ts`

### Shape

Implement the `AIProvider` interface from `src/providers/provider.ts`:

```ts
export interface AIProvider {
  id: string
  generateText(prompt: string, options?: GenerateOptions): Promise<string>
  generateObject<T>(prompt: string, schema: z.ZodSchema<T>, options?: GenerateOptions): Promise<T>
  streamText(prompt: string, options?: GenerateOptions): AsyncGenerator<string>
}
```

`GenerateOptions` carries `maxTokens`, `temperature`, `system`, `stopSequences`. Throw the typed `ProviderError(message, provider, statusCode?, retryAfter?)` for vendor failures — don't leak raw SDK errors.

### Minimal example

Follow `src/providers/anthropic-provider.ts`. The load-bearing patterns:

- `readonly id = '<vendor>'` — the registry key.
- API key resolution prefers an explicit `apiKey`, else reads `process.env[config.apiKeyEnv]`.
- `generateObject` reuses `generateText` with a JSON-only system prompt, `JSON.parse`es the result, then validates with `schema.safeParse(...)` — a parse or validation failure throws `ProviderError`. This is the Zod-validation-at-the-edge pattern for model output.
- Map vendor rate-limit errors to a `ProviderError` with `statusCode` and `retryAfter`.

### How it's registered

`ProviderRegistry` (in `provider.ts`) keys providers by `id`:

```ts
const registry = new ProviderRegistry()
registry.register(new MyVendorProvider({ apiKeyEnv: 'MYVENDOR_API_KEY' }))
const provider = registry.get('myvendor')
```

Today providers are constructed directly at the call site (e.g. `new AnthropicProvider({ apiKeyEnv: 'ANTHROPIC_API_KEY' })` in `src/cli/commands/check-constitution.ts`) rather than centrally wired — register or instantiate yours wherever it's consumed, keyed by its `id`.

### Checklist

- [ ] `src/providers/<vendor>-provider.ts` implements `AIProvider` (all three methods)
- [ ] Unique `id`; API key resolved from explicit value or `apiKeyEnv`
- [ ] `generateObject` validates model output through the passed Zod schema
- [ ] Vendor failures wrapped in `ProviderError` (with `statusCode`/`retryAfter` for rate limits)
- [ ] Registered/constructed by `id` at the consuming call site
- [ ] Paired test under `tests/`

---

## See also

- [architecture.md](./architecture.md) — component map and capability specs (WorkflowEngine, GateRegistry, Artifact Store, Schemas, etc.)
- `CLAUDE.md` (repo root) — conventions and the metta workflow rules
