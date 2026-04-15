# Intent: Constitutional Gates in Planning (T3)

## Problem

Metta's `spec/project.md` defines the project constitution — Conventions and Off-Limits sections contain fourteen actionable rules such as "No singletons", "No unvalidated state writes", "No string literal templates in TypeScript code", and "No `--force` pushes". These rules are not verified at any point during the change lifecycle. A spec can silently propose design patterns that violate these rules, and no gate catches it until a human reviewer notices during review — at which point implementation has typically already landed.

The descriptive sections of `spec/project.md` (Stack, Architectural Constraints, Quality Standards) already describe the codebase accurately. The problem is enforcement: the Conventions and Off-Limits sections are aspirational text, not an enforced contract. Planning artifacts in `spec/changes/<name>/spec.md` may describe architectures that introduce singletons, skip Zod validation, or embed YAML as string literals without any mechanical check surfacing the conflict. Reviewers catch violations inconsistently, late, and only when they happen to read the spec carefully.

The earliest possible intervention point is the end of the plan phase, after `spec.md` is written but before any implementation begins. That is where this change introduces a gate.

## Proposal

### 1. New agent: `metta-constitution-checker`

Create `src/templates/agents/metta-constitution-checker.md` — a Claude Code agent whose sole role is to read a change's `spec/changes/<name>/spec.md` alongside the Conventions and Off-Limits sections of `spec/project.md`, then emit a structured list of violations.

The agent prompt MUST establish its role in the system message and treat `spec.md` content as quoted data input, not as instructions. This defends against prompt injection via spec content. The agent produces output in the structured format consumed by the CLI command (see item 2).

A deployed copy is written to `dist/templates/agents/metta-constitution-checker.md` at build time, consistent with how existing agents in `src/templates/agents/` are handled.

### 2. New CLI command: `metta check-constitution`

Create `src/cli/commands/check-constitution.ts` and register it in the CLI.

Signature: `metta check-constitution [--change <name>]`

Behavior:
- Resolves the active change if `--change` is omitted.
- Spawns the `metta-constitution-checker` agent against `spec/changes/<name>/spec.md`.
- Parses agent output into an array of violation records: `{ article: string, severity: "critical" | "major" | "minor", evidence: string, suggestion: string }`.
- Writes the result to `spec/changes/<name>/violations.md` regardless of whether violations were found (empty list is a valid, affirmative result).
- Checks whether each `critical` or `major` violation has a matching justification entry in a `## Complexity Tracking` section at the bottom of `spec.md`. Format: one bullet per violation — `- <article>: <rationale>`.
- Exits 0 if: (a) no violations, or (b) all critical and major violations have justifications. Exits non-zero otherwise.
- `minor` violations are written to `violations.md` as advisory; they do not affect the exit code.

### 3. Plan phase post-step

After the tasks artifact is committed in the `/metta-plan-phase` skill (`src/templates/skills/metta-plan/SKILL.md`), the skill adds a post-step that calls `metta check-constitution --change <name>`. If the command exits non-zero, the skill MUST block advancement and instruct the user to add a `## Complexity Tracking` section to `spec.md` with justifications for each unjustified violation before re-running the plan phase.

### 4. New skill: `/metta-check-constitution`

Create `src/templates/skills/metta-check-constitution/SKILL.md` for standalone manual invocation. This allows engineers to run the constitutional check outside the plan phase — for example, to verify a spec after manual edits — without having to invoke the full plan workflow.

### 5. Tests

- Unit tests in `src/cli/commands/check-constitution.test.ts`: exit code 0 on empty violations, exit 0 on all violations justified, exit non-zero on unjustified critical, exit non-zero on unjustified major, exit 0 on minor-only with no justification.
- A snapshot test using a fixture `spec.md` that contains at least one deliberate constitutional violation (e.g., a design proposing a singleton registry instance) verifying the agent produces the expected `violations.md` shape.
- Skill byte-identity test confirming `metta-check-constitution/SKILL.md` and `metta-constitution-checker.md` are copied to `dist/` at build time.

## Impact

- **Plan phase latency:** Each plan phase gains approximately 30 seconds of AI checking time (one agent call). This is acceptable given the phase already runs multiple agent calls for research, design, and tasks artifacts.
- **New spec authoring:** Engineers whose specs propose designs that violate constitution principles must add a `## Complexity Tracking` section to `spec.md` with explicit rationale. This makes complexity visible in the artifact rather than buried in review comments.
- **Existing specs:** Unaffected. `spec/specs/` content is grandfathered. The checker is applied only to `spec/changes/<name>/spec.md` artifacts going forward.
- **Quick mode:** `metta quick` skips the plan phase. Constitutional checking does not apply. This is intentional — quick mode targets trivial changes where architectural violations are unlikely and the overhead is not justified.
- **`violations.md` as a record:** The artifact persists in `spec/changes/<name>/violations.md` and is archived with the change when finalized, providing a permanent record of what was considered and justified.

## Out of Scope

- Retroactive checking of specs in `spec/specs/` or `spec/archive/`.
- Auto-generating the `## Complexity Tracking` section (the user MUST author the justifications — the agent cannot justify its own violations).
- Enforcement on `spec/project.md` itself (the constitution is not self-checked).
- Per-change constitution overrides or constitution profiles.
- Checking `intent.md`, `design.md`, or `tasks.md` — only `spec.md` is evaluated.
- Checking commit messages, branch names, or implementation code for constitutional compliance.
- A UI for violation triage beyond `violations.md` content and CLI output.
- Custom severity mappings beyond the three levels (`critical`, `major`, `minor`) aligned with the existing issues taxonomy.
- Automatic retry on agent failure — the user MUST re-run; silent skip is not allowed.
