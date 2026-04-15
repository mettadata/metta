# t6-per-phase-context-budgeting — Specification

## MODIFIED: context-engine

### Manifests (recalibrated budgets)

The system MUST set default budgets per artifact type as follows (updated from v0.1):

| Artifact Type | Required Sources | Optional Sources | Budget (tokens) |
|---|---|---|---|
| `intent` | _(none)_ | `project_context`, `existing_specs` | 50,000 |
| `stories` | `intent` | `project_context`, `existing_specs` | 50,000 |
| `spec` | `intent`, `stories` | `project_context`, `existing_specs`, `research` | 60,000 |
| `research` | `spec` | `project_context`, `existing_specs`, `architecture` | 80,000 |
| `design` | `research`, `spec` | `architecture`, `project_context` | 100,000 |
| `tasks` | `design`, `spec` | `research_contracts`, `research_schemas`, `architecture` | 100,000 |
| `execution` | `tasks` | `research_contracts`, `research_schemas` | 150,000 |
| `verification` | `spec`, `tasks`, `summary` | `research_contracts`, `research_schemas`, `design` | 120,000 |

**Scenarios**

Given an `intent` artifact manifest,
When `getManifest('intent')` is called,
Then the returned `budget` MUST equal `50000`.

Given an `execution` artifact manifest,
When `getManifest('execution')` is called,
Then the returned `budget` MUST equal `150000`.

### Smart-Zone Warnings in LoadedContext

`LoadedContext` MUST expose a `warning` field of type `'smart-zone' | 'over-budget' | null`:

- `null` when `totalTokens / budget < 0.8`
- `'smart-zone'` when `0.8 <= totalTokens / budget < 1.0`
- `'over-budget'` when any required/optional file was truncated OR `totalTokens >= budget`

`LoadedContext` MUST also expose a `droppedOptionals: string[]` field listing optional sources that were skipped because the remaining budget was less than 100 tokens.

**Scenarios**

Given a context load where `totalTokens = 32000` and `budget = 40000`,
When the context is built,
Then `warning` MUST equal `'smart-zone'` and `droppedOptionals` MUST be an empty array.

Given a context load where one optional file was skipped due to remaining budget under 100 tokens,
When the context is built,
Then `droppedOptionals` MUST contain that source's path and `warning` MUST equal `'over-budget'`.

Given a context load where `totalTokens = 20000` and `budget = 50000`,
When the context is built,
Then `warning` MUST be `null`.

### Section Filtering Fallback

When loading an optional dependency whose token count exceeds the remaining budget, the engine MUST attempt the `skeleton` strategy (headings + first paragraph) before dropping the file entirely. If the skeleton still exceeds remaining budget, the file MUST be dropped and recorded in `droppedOptionals`.

This MUST only apply to optional dependencies. Required dependencies continue to truncate as before.

**Scenarios**

Given an optional dependency of 30,000 tokens and 5,000 tokens remaining budget,
When the context is built,
Then the engine MUST first attempt `headingSkeleton` transformation;
And if the skeleton fits, it MUST be loaded with `strategy: 'skeleton'`;
And if the skeleton still exceeds budget, the file MUST be dropped and added to `droppedOptionals`.

Given a required dependency of 30,000 tokens and 5,000 tokens remaining budget,
When the context is built,
Then the file MUST be truncated (current behavior preserved, strategy defaults apply).

## ADDED: context-stats-command

### CLI Command

The system MUST expose a CLI command `metta context stats` that reports token utilization per artifact for a given change.

Flags:
- `--change <name>` (optional — defaults to the single active change; errors if multiple/none)
- `--artifact <kind>` (optional — limits output to a single artifact kind)
- `--json` (inherits global flag)

### Output (text mode)

Text output MUST be a table with columns: `artifact`, `tokens`, `budget`, `%`, `recommendation`.

Recommendation values:
- `ok` — utilization < 80%
- `smart-zone` — 80% ≤ utilization < 100%
- `fan-out` — utilization ≥ 100% AND artifact kind is `execution`
- `split-phase` — utilization ≥ 100% AND artifact kind is not `execution`

### Output (JSON mode)

JSON output MUST be an object with fields:
- `change: string`
- `artifacts: Array<{ artifact: string, tokens: number, budget: number, utilization: number, recommendation: string, droppedOptionals: string[] }>`

The exit code MUST be `0` even when utilization exceeds 100% (this is a warning, not an error).

**Scenarios**

Given an active change with an intent artifact whose loaded context is 10,000 tokens against the 50,000 budget,
When I run `metta context stats --change <name> --json`,
Then the output MUST contain an `artifacts` entry with `tokens: 10000`, `budget: 50000`, `utilization: 0.2`, `recommendation: "ok"`.

Given an active change with an execution artifact whose loaded context exceeds the budget,
When I run `metta context stats --change <name> --json`,
Then the recommendation for that artifact MUST equal `"fan-out"` and the process MUST exit `0`.

Given no active changes and no `--change` flag,
When I run `metta context stats`,
Then the command MUST exit with a non-zero status and a message indicating no active change was found.

Given multiple active changes and no `--change` flag,
When I run `metta context stats`,
Then the command MUST exit non-zero with a message listing the active changes.

## MODIFIED: instruction-generator

### Warning Field in Instructions JSON

`metta instructions <artifact> --json` MUST include, within the existing `budget` object, an optional `warning` field:
- absent when utilization < 80%
- `"smart-zone"` when 80% ≤ utilization < 100%
- `"over-budget"` when utilization ≥ 100% or any file was dropped/truncated

When `warning` is present, a `dropped_optionals: string[]` field MUST also be present (may be empty for `smart-zone`).

**Scenarios**

Given a context load where `totalTokens / budget = 0.65`,
When `metta instructions <artifact> --json` is invoked,
Then the `budget` object MUST NOT contain a `warning` field.

Given a context load where `totalTokens / budget = 0.9`,
When the command is invoked,
Then `budget.warning` MUST equal `"smart-zone"` and `budget.dropped_optionals` MUST be an array (possibly empty).

Given a context load where an optional file was dropped,
When the command is invoked,
Then `budget.warning` MUST equal `"over-budget"` and `budget.dropped_optionals` MUST include that file's relative path.
