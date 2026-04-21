# Research: Init Round 4 + Verifier Context Wiring

**Change:** harden-metta-config-yaml-lifecycle-across-three-related-bugs
**Date:** 2026-04-20
**Scope:** Add verification strategy discovery (Round 4) to `/metta-init`, persist under
`verification:` in `.metta/config.yaml`, inject into `metta-verifier` agent context via
`metta instructions verification --json`.

---

## 1. Codebase Baseline

Files examined:
- `.claude/skills/metta-init/SKILL.md` and `src/templates/skills/metta-init/SKILL.md` — byte-identical (parity confirmed); 163 lines, three-round loop.
- `src/cli/commands/instructions.ts` — artifact → agent lookup, delegates to `InstructionGenerator.generate()`.
- `src/context/instruction-generator.ts` — `generate()` calls `ContextEngine.resolve(artifactType, ...)` then template render; returns `InstructionOutput` with a `context` field that today only carries `project` (from `spec/project.md`).
- `src/context/context-engine.ts` — `CONTEXT_MANIFESTS['verification']` lists `required: ['spec', 'tasks', 'summary']`, `optional: ['research_contracts', 'research_schemas', 'design']`; budget 120 000 tokens. No project-config injection anywhere in the engine.
- `src/cli/commands/config.ts` — exposes `config get <key>` and `config set <key> <value>`. The `set` subcommand is a **stub**: it logs "edit .metta/config.yaml directly for now" and does nothing.
- `src/schemas/project-config.ts` — `ProjectConfigSchema` uses `.strict()`; there is NO `verification` key today. Adding one requires a schema change or the new key will fail Zod validation and be rejected by `ConfigLoader`.
- `.claude/agents/metta-verifier.md` and `src/templates/agents/metta-verifier.md` — byte-identical (4 rules, no project-config awareness, hardcoded gate commands `npm test`, `npm run lint`, `npx tsc --noEmit`).

---

## 2. Design Question Answers

### 2.1 Round 4 Placement

Round 4 belongs immediately after Round 3 (Conventions) and before Step 3 (Build `<DISCOVERY_ANSWERS>`). The exit-criterion comment at the top of the DISCOVERY LOOP currently reads "all three rounds have completed" — it must be updated to "all four rounds".

The `<DISCOVERY_ANSWERS>` XML block must gain a `<verification>` element so the `metta-discovery` subagent writes the verification block into `.metta/config.yaml`.

**Sketch of the SKILL.md edit (applies to both deployed copies):**

```
## Round 4 — Verification Strategy

   Conditional on R3 completion. No web-search needed for this round.
   Cap: 3 AskUserQuestion calls.

   - "How does a successful verification run look for this project?"
     → [Run the test suite (tests_only),
        CLI commands and exit codes (cli_exit_codes),
        Playwright / browser end-to-end (playwright),
        tmux TUI session observation (tmux_tui),
        I'm done — proceed with these answers]

   - "Any additional verification instructions the verifier agent should follow?"
     → [free text entry, I'm done — proceed with these answers]

   - "Are there gate commands to run? (default: npm test, npm run lint, npx tsc --noEmit)"
     → [Use defaults, Override (describe), I'm done — proceed with these answers]
```

Update the exit-criterion line to: "Exit the loop when (a) all **four** rounds have completed, or (b) the user selects the early-exit option."

Update the between-round status line template: after R3 print
`Resolved: identity, stack, conventions. Open: verification — proceeding to Round 4.`
After R4: `Resolved: all questions. Proceeding to metta-discovery subagent.`

Add `<verification>` to the `<DISCOVERY_ANSWERS>` block:

```xml
<DISCOVERY_ANSWERS>
  <project>...</project>
  <stack>...</stack>
  <conventions>...</conventions>
  <architectural_constraints>...</architectural_constraints>
  <quality_standards>...</quality_standards>
  <off_limits>...</off_limits>
  <verification>
    strategy: <!-- one of: tmux_tui | playwright | cli_exit_codes | tests_only -->
    instructions: <!-- free-form text or empty -->
    gate_override: <!-- comma-separated commands, or "defaults" -->
  </verification>
</DISCOVERY_ANSWERS>
```

### 2.2 Persistence Path

Three options evaluated:

**(a) New CLI subcommand** (`metta config set-verification-strategy <enum>`): Requires adding a new Commander subcommand, updating `ProjectConfigSchema`, writing the YAML file. The existing `config set` stub does not write. This is net-new CLI surface and touches three files just for persistence.

**(b) Hand answers to `metta-discovery` agent, which writes `.metta/config.yaml`**: The discovery agent is already tasked with writing `.metta/config.yaml`. It already receives `<DISCOVERY_ANSWERS>` inline. Adding `<verification>` to the XML and updating the discovery agent's task instruction is a minimal diff — no CLI changes, no new commands. The skill prompt today already says "Also update `discovery.output_paths.config` with the project name, description, and stack" — verification slots in alongside those.

**(c) Inline shell step in the skill** (`node -e ...` or a helper): Non-idiomatic; the skill pattern uses agent subagents for file writes, not raw `node -e` one-liners. Violates "No string literal templates in TypeScript code" and fragile against schema changes.

**Recommendation: option (b).** It is consistent with the existing pattern, requires no new CLI command, and keeps persistence logic in one place (the discovery agent).

The discovery agent's task instruction gains one clause:

> "Also write a `verification:` block in `.metta/config.yaml` using the answers in `<verification>`:
> `verification:\n  strategy: <strategy>\n  instructions: "<instructions>"\n  gates: [<gate_override or defaults>]`"

The `.metta/config.yaml` MUST block in the SKILL.md gains the new section:

```yaml
project:
  name: "<project name>"
  description: "<description>"
  stack: "<comma-separated stack>"
verification:
  strategy: "<one of: tmux_tui | playwright | cli_exit_codes | tests_only>"
  instructions: "<free-form text>"
  gates: []   # empty = use verifier defaults
```

### 2.3 Verifier Agent Context Wiring

**Current path for any artifact (trace for `verification`):**

1. Skill (e.g., `metta-verify`) calls `metta instructions verification --json`.
2. `instructions.ts` → `InstructionGenerator.generate({ artifact, ... })`.
3. `generate()` calls `ContextEngine.resolve('verification', changePath, specDir, budget)`.
4. `ContextEngine` looks up `CONTEXT_MANIFESTS['verification']` and loads the listed files. It has no knowledge of `.metta/config.yaml`.
5. `generate()` returns `InstructionOutput`; the `context` field today only carries `project` (from `spec/project.md` via `extractProjectContext`).
6. The calling skill embeds the JSON output into the subagent prompt.

**Where to inject:** `InstructionGenerator.generate()` currently receives a `CliContext` (via `createCliContext()` in `instructions.ts`) indirectly through `ContextEngine`. The cleanest injection point is in `instructions.ts`, after `ctx.instructionGenerator.generate(...)` returns, by reading `ctx.configLoader.load()` and merging the `verification` block into the output before serializing. This avoids changing `InstructionGenerator`'s interface in a way that bleeds config concerns into the context engine.

**Minimal diff sketch for `src/cli/commands/instructions.ts`:**

```typescript
// After: const output = await ctx.instructionGenerator.generate({ ... })

const cfg = await ctx.configLoader.load()
const verificationConfig = (cfg as Record<string, unknown>).verification as
  { strategy?: string; instructions?: string; gates?: string[] } | undefined

if (artifactId === 'verification' && verificationConfig) {
  output.context = {
    ...output.context,
    verification_strategy: verificationConfig.strategy ?? 'tests_only',
    verification_instructions: verificationConfig.instructions ?? '',
    verification_gates: verificationConfig.gates ?? [],
  }
}
```

Note: `InstructionOutput.context` is typed as
`{ project?: string; existing_specs?: string[]; active_gaps?: string[] }`.
Adding `verification_strategy` etc. requires either widening the type to
`Record<string, unknown>` in the `context` field, or adding explicit optional keys.
The widening is simpler and consistent with the field's current looseness.

**metta-verifier agent prompt insertion:**

Add a new section between "## Your Role" and "## Rules" in both
`.claude/agents/metta-verifier.md` and `src/templates/agents/metta-verifier.md`:

```markdown
## Verification Context

When spawned via `metta instructions verification --json`, the JSON payload includes:
- `context.verification_strategy` — one of `tests_only | cli_exit_codes | playwright | tmux_tui`
- `context.verification_instructions` — project-specific free-form notes
- `context.verification_gates` — ordered list of gate commands (empty = use defaults below)

Honor these fields:
- If `verification_strategy` is absent or the field is missing entirely from the payload:
  - If `spec/archive/` and `spec/changes/` are both empty (first-run heuristic): default
    to `tests_only` and note: "No verification strategy configured. Defaulting to tests_only.
    Run `/metta-init` to configure a project-specific strategy."
  - Otherwise (legacy project with history): emit a hard error and stop:
    "ERROR: verification.strategy missing from .metta/config.yaml. This project has existing
    changes but no verification strategy. Add it by running `/metta-init` (re-runs discovery)
    or editing .metta/config.yaml directly:
    \`\`\`yaml
    verification:
      strategy: tests_only   # or: cli_exit_codes | playwright | tmux_tui
      instructions: ""
      gates: []
    \`\`\`"
- If `verification_gates` is non-empty, run those commands instead of the defaults.
- If `verification_instructions` is non-empty, apply those instructions during verification.
```

### 2.4 Missing-Strategy Error Message

`src/cli/commands/config.ts` has a `config set` subcommand but it is a stub — it prints
"edit .metta/config.yaml directly for now" and does not write. Therefore:

- Pointing the user at `metta config set verification.strategy <value>` would be misleading; the command does nothing.
- `/metta-init` is overkill (reruns all four rounds).
- The correct error message is a literal YAML snippet to paste, plus the option to re-run `/metta-init` for interactive re-discovery.

**Exact error text (canonical):**

```
ERROR: verification.strategy missing from .metta/config.yaml.
This project has existing changes but no verification strategy configured.

Fix options:
  (a) Re-run `/metta-init` to re-run interactive discovery (sets strategy automatically).
  (b) Edit .metta/config.yaml directly and add:

      verification:
        strategy: tests_only   # or: cli_exit_codes | playwright | tmux_tui
        instructions: ""
        gates: []
```

### 2.5 First-Run vs Legacy Distinction

**Heuristic:** check whether `spec/changes/` and `spec/archive/` are both empty (no
`.md` files in either tree). If both are empty, this is effectively a first-run or
no-op project. If either contains content, the project has a history and the missing
`verification.strategy` is a legacy gap.

This is reliable because:
- `metta propose` always creates a directory under `spec/changes/`.
- `metta ship` always moves content to `spec/archive/`.
- A project that has never run `metta propose` has no changes or archive entries.
- A freshly installed project (`metta install` + `metta init` not yet completed) also has
  empty changes and archive — correctly classified as first-run.

Edge case: a project ran `metta propose` but the user deleted the change folder manually.
This is unusual enough to accept the false-positive (legacy treated as first-run).

**Implementation in verifier:**

```typescript
// pseudo-code for the verifier skill / agent check
const hasHistory = (
  glob('spec/changes/**/*.md').length > 0 ||
  glob('spec/archive/**/*.md').length > 0
)
const strategy = context.verification_strategy
if (!strategy) {
  if (hasHistory) { /* hard error */ } else { /* soft default */ }
}
```

---

## 3. Schema Change Required

`ProjectConfigSchema` uses `.strict()`. A new `verification:` key must be added or
`ConfigLoader` will silently drop it (the Zod strict parse fails and falls back to
file-only config, which also fails — the load throws). The new schema block:

```typescript
export const VerificationConfigSchema = z.object({
  strategy: z.enum(['tmux_tui', 'playwright', 'cli_exit_codes', 'tests_only']).optional(),
  instructions: z.string().optional(),
  gates: z.array(z.string()).default([]),
}).strict()

export type VerificationConfig = z.infer<typeof VerificationConfigSchema>

// In ProjectConfigSchema:
verification: VerificationConfigSchema.optional(),
```

This must land before any `.metta/config.yaml` files start including `verification:`,
or existing configs will throw on `ConfigLoader.load()`.

---

## 4. Concrete Recommendation

### Summary

| Concern | Decision |
|---|---|
| Round 4 placement | After R3, before Step 3 (build XML); update exit-criterion and status line wording |
| Persistence | Option (b): discovery agent writes `verification:` block via `<DISCOVERY_ANSWERS><verification>` |
| Verifier wiring | Inject in `instructions.ts` post-generate; add `verification_strategy/instructions/gates` to `context` |
| Missing-strategy error | YAML snippet + `/metta-init` option; do NOT reference `metta config set` (stub) |
| First-run detection | `spec/changes/` and `spec/archive/` both empty → first-run |
| Schema | Add `VerificationConfigSchema` to `project-config.ts` before any config writes |

### Execution Order

1. `src/schemas/project-config.ts` — add `VerificationConfigSchema` and `verification` field. **Must be first** to avoid breaking `ConfigLoader`.
2. `src/cli/commands/instructions.ts` — inject `verification_strategy/instructions/gates` into `output.context` when `artifactId === 'verification'`.
3. `.claude/agents/metta-verifier.md` + `src/templates/agents/metta-verifier.md` — add "## Verification Context" section (must stay byte-identical).
4. `.claude/skills/metta-init/SKILL.md` + `src/templates/skills/metta-init/SKILL.md` — add Round 4, update exit-criterion, update `<DISCOVERY_ANSWERS>` schema, update discovery agent task clause (must stay byte-identical).
5. `src/cli/commands/config.ts` — optionally implement `config set` for real (not strictly required by this spec but the stub is misleading in error messages).

### Round 4 Final Text (canonical)

```markdown
## Round 4 — Verification Strategy

   Conditional on R3 completion. No web-search needed for this round.
   Cap: 3 AskUserQuestion calls.

   - "How does a successful verification run look for this project?"
     → [Run the test suite (tests_only),
        CLI commands and exit codes (cli_exit_codes),
        Playwright / browser end-to-end (playwright),
        tmux TUI session observation (tmux_tui),
        I'm done — proceed with these answers]

   - "Any additional verification instructions for the verifier agent? (optional)"
     → [free text entry, I'm done — proceed with these answers]

   - "Gate commands to run? (defaults: npm test, npm run lint, npx tsc --noEmit)"
     → [Use defaults, Override (describe), I'm done — proceed with these answers]
```

### Discovery Agent Task Clause Addition

Append to the task instruction in Step 4 of SKILL.md:

> "Also write a `verification:` block in `.metta/config.yaml` from `<verification>`:
> `verification:\n  strategy: <value>\n  instructions: "<value>"\n  gates: []` (or populated
> gate list). If `<verification>` is empty (early exit before R4), omit the `verification:`
> block entirely — do not write a block with empty/null values."

### `instructions.ts` Injection Snippet

```typescript
// Add after: const output = await ctx.instructionGenerator.generate({ ... })
if (artifactId === 'verification') {
  const cfg = await ctx.configLoader.load() as ProjectConfig & {
    verification?: { strategy?: string; instructions?: string; gates?: string[] }
  }
  const v = cfg.verification
  ;(output.context as Record<string, unknown>).verification_strategy =
    v?.strategy ?? null
  ;(output.context as Record<string, unknown>).verification_instructions =
    v?.instructions ?? ''
  ;(output.context as Record<string, unknown>).verification_gates =
    v?.gates ?? []
}
```

### Verifier Agent Prompt Insertion (both copies)

Insert between `## Your Role` and `## Rules`:

```markdown
## Verification Context

The JSON payload from `metta instructions verification --json` may include:
- `context.verification_strategy`: `tests_only | cli_exit_codes | playwright | tmux_tui`
- `context.verification_instructions`: project-specific free-form notes
- `context.verification_gates`: ordered gate commands (empty = use defaults)

Rules for missing strategy:
- `spec/changes/` and `spec/archive/` both empty (first run): default to `tests_only`,
  note "No verification strategy configured — defaulting to tests_only. Run `/metta-init`
  to set a project-specific strategy."
- Either directory non-empty (legacy project): hard error —
  "ERROR: verification.strategy missing from .metta/config.yaml. Fix by running
  `/metta-init` or adding to .metta/config.yaml:
  `verification:\n  strategy: tests_only\n  instructions: \"\"\n  gates: []`"
```
