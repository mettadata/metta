# 08 — Plugin Architecture

## Core Concept

If changing a behavior requires forking the framework, the framework failed. Metta provides five extension points, each with a manifest contract, a registry, and lifecycle hooks. Inspired by Spec Kit's extension system, simplified by GSD's pragmatism.

---

## Plugin Types

### 1. Workflow Plugins

Add new artifact types and workflow definitions.

```yaml
# .metta/plugins/data-pipeline/manifest.yaml
type: workflow
name: data-pipeline
version: 1.0.0
description: Adds schema design and migration artifacts

artifact_types:
  - id: schema-design
    template: templates/schema-design.md
    description: Database schema design document

  - id: migration-plan
    template: templates/migration-plan.md
    description: Database migration execution plan

workflows:
  - file: workflows/data-pipeline.yaml
    description: Schema → migration → pipeline workflow
```

### 2. Agent Plugins

Add new specialist personas.

```yaml
# .metta/plugins/security-agents/manifest.yaml
type: agent
name: security-agents
version: 1.0.0
description: Security-focused agent personas

agents:
  - file: agents/threat-modeler.yaml
    description: Creates threat models from specs
  - file: agents/security-reviewer.yaml
    description: Security-focused code review
  - file: agents/pentest-planner.yaml
    description: Plans penetration testing from specs
```

### 3. Provider Plugins

Add new AI model backends.

```yaml
# .metta/plugins/ollama-provider/manifest.yaml
type: provider
name: ollama-provider
version: 1.0.0
description: Local LLM support via Ollama

providers:
  - id: ollama
    module: ./provider.js
    config:
      base_url: "http://localhost:11434"
      default_model: "llama3.2"
```

Provider modules implement the `AIProvider` interface:
```typescript
interface AIProvider {
  id: string
  generateText(prompt: string, options: GenerateOptions): Promise<string>
  generateObject<T>(prompt: string, schema: ZodSchema<T>, options: GenerateOptions): Promise<T>
  streamText(prompt: string, options: GenerateOptions): AsyncGenerator<string>
}
```

### Provider System (v1)

In v1 (instruction mode), the Provider Registry is used for two operations only:

1. **Spec-compliance gate (Layer 2)** — AI-powered verification of implementation against spec scenarios
2. **`metta import` analysis** — AI-assisted reconciliation of imported specs against code

The external AI tool (Claude Code, Cursor, etc.) handles all other AI operations. The full provider system (role-based routing, fallback chains, cost tracking) is designed but activates when orchestrator mode is built.

**API Keys**: Never stored in config. Referenced via environment variables in `~/.metta/local.yaml`:

```yaml
providers:
  main:
    provider: anthropic
    api_key_env: ANTHROPIC_API_KEY
```

### 4. Gate Plugins

Add new verification checks.

```yaml
# .metta/plugins/quality-gates/manifest.yaml
type: gate
name: quality-gates
version: 1.0.0
description: Additional quality verification gates

gates:
  - file: gates/schema-drift.yaml
    description: Detect ORM changes missing migrations
  - file: gates/api-contract.yaml
    description: Verify API responses match OpenAPI spec
  - file: gates/accessibility.yaml
    description: Run accessibility checks on UI components
```

### 5. Hook Plugins

Run code before/after framework events.

```yaml
# .metta/plugins/notifications/manifest.yaml
type: hook
name: notifications
version: 1.0.0
description: Send notifications on workflow events

hooks:
  - event: artifact.complete
    command: node plugins/notifications/on-complete.js
    async: true  # Don't block the workflow
  - event: change.shipped
    command: node plugins/notifications/on-ship.js
    async: true
  - event: gate.failed
    command: node plugins/notifications/on-gate-fail.js
    async: false  # Block until notification sent
```

---

## Hook Events

| Event | Fires when | Payload |
|-------|-----------|---------|
| `workflow.start` | A new change begins | change name, workflow |
| `artifact.start` | An artifact begins building | artifact id, agent |
| `artifact.complete` | An artifact finishes | artifact id, status |
| `artifact.failed` | An artifact's gates fail | artifact id, failures |
| `execution.batch.start` | A batch begins | batch id, tasks |
| `execution.batch.complete` | A batch finishes | batch id, results |
| `execution.task.start` | A task begins | task id |
| `execution.task.complete` | A task commits | task id, commit |
| `gate.pass` | A gate passes | gate name, duration |
| `gate.fail` | A gate fails | gate name, failures |
| `change.finalized` | `metta finalize` completes | change name, archived path, merged specs |
| `change.shipped` | `metta ship` completes (merge to main or PR created) | change name, merge commit, pr url |
| `conflict.detected` | Spec merge conflict found | spec path, details |

Hooks receive the event payload as JSON on stdin and can:
- Log to external systems (Slack, Discord, email)
- Update dashboards
- Trigger CI/CD pipelines
- Block the workflow (if `async: false` and exit code != 0)

---

## Plugin Discovery & Installation

### Local Plugins
Place in `.metta/plugins/<name>/manifest.yaml`. Discovered automatically.

### Global Plugins
Place in `~/.metta/plugins/<name>/manifest.yaml`. Available across all projects.

### From Registry (future)
```bash
metta plugin install @mettadata/security-gates
metta plugin install @mettadata/ollama-provider
```

### Listing Installed Plugins
```bash
metta plugin list
```
```
Plugin                  Type      Version  Scope
data-pipeline           workflow  1.0.0    project
security-agents         agent     1.0.0    project
ollama-provider         provider  1.0.0    global
quality-gates           gate      1.0.0    project
notifications           hook      1.0.0    project
```

---

## Plugin Manifest Schema

All plugins follow the same base manifest:

```typescript
const PluginManifestSchema = z.object({
  type: z.enum(["workflow", "agent", "provider", "gate", "hook"]),
  name: z.string().regex(/^[a-z0-9-]+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string(),
  requires: z.object({
    metta: z.string().optional(),  // e.g., ">=1.0.0"
    plugins: z.array(z.string()).optional(),  // Dependencies on other plugins
  }).optional(),
}).strict()
```

The `requires` field enables plugin dependencies and version constraints.

---

## Configuration Layering

Plugin configuration follows a four-layer precedence (highest wins):

```
Environment variables         METTA_GATE_TIMEOUT=60000
  ↓ overrides
Local config (gitignored)     .metta/local.yaml
  ↓ overrides
Project config (committed)    .metta/config.yaml
  ↓ overrides
Plugin defaults               .metta/plugins/<name>/defaults.yaml
```

This lets teams set shared defaults, individuals override locally, and CI/CD inject via env vars.

---

## Safe Uninstall

Inspired by Spec Kit's hash-based tracking:

When a plugin is installed, its files are recorded in `.metta/plugins/<name>/manifest.lock`:

```yaml
installed_files:
  - path: agents/threat-modeler.yaml
    hash: "sha256:abc123..."
  - path: gates/schema-drift.yaml
    hash: "sha256:def456..."
```

On uninstall:
1. Check each file's current hash against recorded hash
2. If match: remove safely (user hasn't modified it)
3. If mismatch: warn and skip (user has customized it)
4. Remove manifest.lock

This prevents accidentally deleting user modifications.
