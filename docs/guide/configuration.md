# Configuration Guide

This guide explains how to customize metta on your project through
`.metta/config.yaml`. Every field documented here is defined by
`ProjectConfigSchema` in `src/schemas/project-config.ts` — that Zod schema is
the source of truth, and config is validated against it on every read.

Related reading:

- [CLI Reference](./cli-reference.md) — the `metta config` commands.
- [Data Model](../internals/data-model.md) — how config and state are structured internally.

---

## Where configuration lives

metta merges configuration from four layers. Lower layers are defaults; higher
layers override them.

| Layer | Source | Scope | Committed? |
|-------|--------|-------|------------|
| 1 (lowest) | `~/.metta/config.yaml` | Global — applies to all your projects | n/a (user home) |
| 2 | `<project>/.metta/config.yaml` | Project — shared with the team | Yes |
| 3 | `<project>/.metta/local.yaml` | Local overrides for one machine | No (gitignored) |
| 4 (highest) | `METTA_*` environment variables | Per-invocation overrides | n/a |

Layers 1–3 are deep-merged (objects merge key-by-key; arrays and scalars are
replaced wholesale), then environment overrides are applied, and the result is
validated once against `ProjectConfigSchema`. Unknown top-level keys are
rejected — the schema is `.strict()`.

Loading is implemented in `src/config/config-loader.ts`.

### Environment variable overrides

Any environment variable prefixed with `METTA_` is mapped onto the config tree.
Segments are separated by a **double underscore** (`__`) so that keys containing
a single underscore (like `api_key_env`) are unambiguous. The remainder of the
name is lower-cased.

```bash
# defaults.workflow = "fast"
export METTA_DEFAULTS__WORKFLOW=fast

# defaults.mode = "autonomous"
export METTA_DEFAULTS__MODE=autonomous

# providers.anthropic.api_key_env = "MY_KEY_VAR"
export METTA_PROVIDERS__ANTHROPIC__API_KEY_ENV=MY_KEY_VAR
```

Values are coerced: `true`/`false` become booleans, an all-digits string becomes
an integer, and everything else stays a string.

Notes:

- `METTA_SKILL` is reserved as a runtime signal and is **not** treated as a
  config override.
- If a `METTA_*` variable would make the config invalid, the bad override is
  **ignored** (with a warning to stderr) and the file-only config is used —
  provided the file-only config is itself valid.
- Loaded config is cached per `ConfigLoader` instance; changing `process.env`
  after load does not take effect until the cache is cleared. metta creates a
  fresh loader per command, so this only matters for long-lived processes.

---

## Editing configuration

You can edit `.metta/config.yaml` by hand, or use the `metta config` commands.

### `metta config get <key>`

Reads a value using dot notation. Prints the resolved value (after all layers
are merged).

```bash
metta config get defaults.workflow
metta config get git.protected_branches
```

### `metta config set <key> <value>`

Writes a value into the **project** `.metta/config.yaml` (layer 2).

- It uses a comment-preserving writer (`setProjectField` in
  `src/config/config-writer.ts`): existing comments and flow-style sequences are
  retained where possible.
- It is **validate-and-restore**: after writing, the file is reloaded and
  validated against the schema. If validation fails, the original bytes are
  restored so an invalid value never persists on disk, and the command reports
  `Rejected: … (config restored)`.
- The value is coerced exactly like environment overrides: `true`/`false` →
  boolean, a clean integer → number, otherwise a string.
- The file must already exist (run `metta install` first); `set` does not create
  it.

```bash
metta config set defaults.mode autonomous
metta config set auto.max_cycles 5
```

### `metta config edit [target]`

Opens a file in your editor (`$VISUAL`, then `$EDITOR`). The optional `target`
selects what to open:

- `config` (default) → `.metta/config.yaml`
- `constitution` → `spec/project.md`

```bash
metta config edit            # opens .metta/config.yaml
metta config edit constitution
```

If neither `$VISUAL` nor `$EDITOR` is set, the command tells you which file to
edit directly.

---

## Configuration sections

All sections are optional unless noted. Defaults below are the schema defaults
that apply when a field is omitted.

### `project`

Project identity and conventions. This object is optional, but when present
`name` is required.

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `name` | string | — (required) | Project name. |
| `description` | string | — | Short project description. |
| `stack` | string | — | Single tech stack (legacy form). |
| `stacks` | string[] | — | List of detected/declared stacks. Preferred over `stack`. |
| `conventions` | string | — | Free-form notes on project conventions. |

`stacks` takes precedence over `stack`; if only `stack` is set it is promoted to
a single-element list.

```yaml
project:
  name: my-app
  description: A composable widget service
  stacks:
    - typescript
    - node
```

### `defaults`

Default workflow behavior for new changes.

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `workflow` | string | `standard` | Default workflow name applied to new changes. |
| `mode` | enum: `interactive`, `autonomous`, `supervised` | `supervised` | Default execution mode. |

```yaml
defaults:
  workflow: standard
  mode: supervised
```

### `providers`

A map of named AI provider configurations (the key is your label, e.g.
`anthropic`). Each entry is `.strict()`.

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `provider` | string | — (required) | Provider identifier. |
| `model` | string | — | Model name to use. |
| `api_key_env` | string | — | Name of the environment variable holding the API key. |

```yaml
providers:
  anthropic:
    provider: anthropic
    model: claude-opus-4
    api_key_env: ANTHROPIC_API_KEY
```

### `git`

Git integration and merge-safety settings.

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `enabled` | boolean | `true` | Whether metta performs git operations. |
| `commit_convention` | enum: `conventional`, `none`, `custom` | `conventional` | Commit message style. |
| `commit_template` | string | — | Template used when `commit_convention` is `custom`. |
| `protected_branches` | string[] | `["main", "master"]` | Branches metta refuses to commit to / mutate directly. |
| `merge_strategy` | enum: `ff-only`, `no-ff`, `squash` | `ff-only` | Strategy used when merging a change branch. |
| `snapshot_retention` | enum: `until_ship`, `always`, `never` | `until_ship` | How long workflow snapshots are kept. |
| `create_pr` | boolean | `false` | Whether ship opens a pull request instead of merging directly. |
| `pr_base` | string | `main` | Base branch for created pull requests. |

```yaml
git:
  enabled: true
  protected_branches:
    - main
    - release
  merge_strategy: no-ff
  create_pr: true
  pr_base: main
```

### `docs`

Documentation generation settings. This section has a default of `{}`, so the
field defaults below apply even if you omit `docs` entirely.

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `output` | string | `./docs` | Directory where generated docs are written. |
| `generate_on` | enum: `finalize`, `verify`, `manual` | `finalize` | When docs are generated. |
| `types` | string[] | `["architecture", "api", "changelog", "getting-started"]` | Which doc types to generate. |

```yaml
docs:
  output: ./docs
  generate_on: finalize
  types:
    - architecture
    - api
    - changelog
    - getting-started
```

### `verification`

Selects how the verifier confirms an implementation works. The configured
`strategy` and free-form `instructions` are passed to the metta-verifier
subagent; when this section is absent both are emitted as `null` and the
verifier falls back to its defaults.

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `strategy` | enum: `tests_only`, `cli_exit_codes`, `playwright`, `tmux_tui` | — (required) | Verification approach (see below). |
| `instructions` | string | — | Extra free-form guidance for the verifier. |

See [Verification strategy](#verification-strategy) below for what each option
means.

```yaml
verification:
  strategy: cli_exit_codes
  instructions: |
    Run `mytool --check` against the fixtures in test/data and confirm exit 0.
```

### `gates`

Inline gate definitions, keyed by gate name. Most projects define gates as
standalone files instead (see [Custom gates](#custom-gates)), but you can also
declare them here. Each entry is `.strict()`.

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `command` | string | — (required) | Shell command to run for the gate. |
| `timeout` | integer (ms) | — | Max run time in milliseconds (positive integer). |
| `required` | boolean | — | Whether failure blocks the workflow. |
| `on_failure` | enum: `retry_once`, `stop`, `continue_with_warning` | — | What to do when the gate fails. |

```yaml
gates:
  smoke:
    command: npm run smoke
    timeout: 60000
    required: true
    on_failure: stop
```

### `auto`

Settings for the full-lifecycle auto loop (`metta auto`).

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `max_cycles` | integer | `10` | Maximum number of discover→build→verify cycles (positive integer). |
| `ship_on_success` | boolean | `false` | Whether to ship automatically once verification passes. |

```yaml
auto:
  max_cycles: 5
  ship_on_success: false
```

### `cleanup`

Housekeeping settings.

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `log_retention_days` | integer | `30` | How many days of logs to keep (positive integer). |

```yaml
cleanup:
  log_retention_days: 30
```

### `models`

Model-tier routing for agent roles. Planning-cohort roles (proposer, specifier,
product, researcher, architect, planner) and the **reviewer and verifier always
run on the session's inherited (top-tier) model** regardless of this section —
only the executor on `trivial`- and `quick`-tier changes can be routed to a
cheaper model. Removing the `models` block entirely means every role resolves
to `inherit` (the pre-existing default behavior).

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `profile` | enum: `quality`, `balanced`, `budget` | — | Named routing profile for trivial/quick executors (see table below). |
| `executor.trivial` | enum: `sonnet`, `opus`, `haiku`, `fable`, `inherit` | — | Explicit model for executors on trivial-tier changes. |
| `executor.quick` | enum: `sonnet`, `opus`, `haiku`, `fable`, `inherit` | — | Explicit model for executors on quick-tier changes. |
| `reviewer` | literal: `inherit` | — | Documentation-only; the reviewer is always `inherit`. |
| `verifier` | literal: `inherit` | — | Documentation-only; the verifier is always `inherit`. |

The three profiles route trivial/quick executors as follows:

| Profile | Executor on `trivial` | Executor on `quick` | Planning / review / verify |
|---------|----------------------|--------------------|-----------------------------|
| `quality` | inherit | inherit | inherit |
| `balanced` | sonnet | sonnet | inherit |
| `budget` | haiku | sonnet | inherit |

**Precedence:** an explicit `executor.trivial` / `executor.quick` entry wins
over the named `profile`'s expansion for that tier key. Standard-tier and
higher changes always run executors at `inherit`, whatever this section says.

`metta install` scaffolds new projects with `profile: balanced`:

```yaml
models:
  # Model-tier routing: planning/review always top-tier; executors on
  # trivial/quick changes run sonnet. Alternatives: quality (all top-tier), budget (haiku/sonnet).
  profile: balanced
```

Example with an explicit executor override (trivial routed to haiku, quick
falling back to the balanced profile's sonnet):

```yaml
models:
  profile: balanced
  executor:
    trivial: haiku
```

---

## Custom gates

Gates are commands metta runs to validate a change (tests, lint, typecheck,
etc.). Project-local gate files live in `.metta/gates/<name>.yaml`. A
project-local gate **overrides the built-in gate of the same name**, so you can
redefine `tests`, `lint`, `typecheck`, `build`, or `stories-valid` for your
project, or add new gates.

A gate file follows `GateDefinitionSchema` (`src/schemas/gate-definition.ts`):

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `name` | string | — (required) | Gate name. |
| `description` | string | — (required) | What the gate checks. |
| `command` | string | — (required) | Shell command to run. |
| `timeout` | integer (ms) | `120000` | Max run time in milliseconds. |
| `required` | boolean | `true` | If true, failure blocks the workflow. |
| `on_failure` | enum: `retry_once`, `stop`, `continue_with_warning` | `retry_once` | Action taken when the gate fails. |

`on_failure` values:

- `retry_once` — run the command once more before deciding.
- `stop` — halt the workflow on failure.
- `continue_with_warning` — record a warning but proceed.

Example — `.metta/gates/tests.yaml` overriding the built-in test gate:

```yaml
name: tests
description: Run project test suite
command: npm test
timeout: 300000
required: true
on_failure: stop
```

Example — a new project-specific gate, `.metta/gates/smoke.yaml`:

```yaml
name: smoke
description: Run smoke checks against a local server
command: npm run smoke
timeout: 60000
required: false
on_failure: continue_with_warning
```

> The inline `gates:` section in `config.yaml` (see above) uses a slightly
> different shape — it has no `name`/`description` (the key is the name) and no
> field defaults. Standalone `.metta/gates/*.yaml` files are the more common
> way to define gates.

---

## Verification strategy

The `verification.strategy` field tells the verifier how to confirm an
implementation works. Set it with `metta config set verification.strategy <value>`
or in `config.yaml`:

| Strategy | Meaning |
|----------|---------|
| `tests_only` | Rely on the project's test suite and gates; no separate runtime check. |
| `cli_exit_codes` | Drive the tool from the command line and assert on process exit codes. |
| `playwright` | Use Playwright to verify browser/web UI behavior. |
| `tmux_tui` | Drive a terminal UI inside a tmux session to verify interactive behavior. |

Pair the strategy with `instructions` to give the verifier concrete steps:

```yaml
verification:
  strategy: tmux_tui
  instructions: |
    Launch the TUI with `npm start`, send the keystroke sequence to open the
    dashboard, and confirm the status pane renders without errors.
```

```bash
metta config set verification.strategy tests_only
```
