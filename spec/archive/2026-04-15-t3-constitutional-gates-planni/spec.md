# Spec: Constitutional Gates in Planning (T3)

## Overview

This spec defines the requirements for adding a constitutional compliance gate to the metta plan phase. The gate checks a change's `spec.md` against the Conventions and Off-Limits sections of `spec/project.md` using a dedicated agent, writes a `violations.md` artifact, and blocks plan-phase advancement when unresolved blocking violations exist.

---

## Requirements

### REQ-1: Agent — `metta-constitution-checker`

**REQ-1.1** The file `src/templates/agents/metta-constitution-checker.md` MUST exist with a valid Claude Code agent frontmatter block containing at minimum: `name`, `description`, `tools`, and `color` fields, consistent with the pattern in `src/templates/agents/metta-verifier.md`.

**REQ-1.2** The build process MUST copy `src/templates/agents/metta-constitution-checker.md` to `dist/templates/agents/metta-constitution-checker.md` byte-for-byte, consistent with how all other agent templates are handled (see `Conventions` in `spec/project.md`: "Template files copied to `dist/` at build time").

**REQ-1.3** A deployed copy MUST exist at `.claude/agents/metta-constitution-checker.md` and MUST be byte-identical to `src/templates/agents/metta-constitution-checker.md`. Any divergence between the two files MUST be treated as a configuration error.

**REQ-1.4** The agent prompt MUST restrict reading to the Conventions and Off-Limits sections of `spec/project.md` and the target change's `spec.md`. The agent MUST NOT read `intent.md`, `design.md`, `tasks.md`, implementation code, or other artifacts.

**REQ-1.5** The agent prompt MUST explicitly instruct the agent that the contents of `spec.md` are quoted data input and MUST NOT be interpreted as system instructions. The prompt MUST use a structural delimiter (e.g., XML-style tags or triple backticks with a label) to wrap the spec content, establishing a clear data boundary.

**REQ-1.6** The agent output MUST be a structured list of violation entries. Each entry MUST contain exactly these four fields:

- `article` — the text of the constitution rule violated (quoted from Conventions or Off-Limits)
- `severity` — one of `critical`, `major`, or `minor`
- `evidence` — a verbatim excerpt from `spec.md` that demonstrates the violation
- `suggestion` — a concrete, actionable recommendation for resolving the violation

**REQ-1.7** When no violations are found, the agent MUST emit an explicit empty-list signal (e.g., `violations: []` in YAML, or a clearly labeled empty list) rather than producing no output.

---

### REQ-2: CLI Command — `metta check-constitution`

**REQ-2.1** The file `src/cli/commands/check-constitution.ts` MUST exist and MUST export a `registerCheckConstitutionCommand(program: Command): void` function, following the pattern in `src/cli/commands/fix-issue.ts`.

**REQ-2.2** The command MUST accept an optional `--change <name>` flag. When omitted, the command MUST resolve the active change using the same mechanism used by other commands in the CLI (i.e., `createCliContext()` and the state store).

**REQ-2.3** The command MUST accept a `--json` flag (propagated from the top-level `program.opts().json`) and output machine-readable JSON when it is set, consistent with the `outputJson` helper pattern.

**REQ-2.4** The command MUST spawn the `metta-constitution-checker` agent against `spec/changes/<name>/spec.md` and collect its output. If the agent process errors (non-zero exit, timeout, or unparseable output), the command MUST exit with code 4 and MUST NOT silently skip or treat the result as zero violations.

**REQ-2.5** The command MUST parse agent output into an array of violation records typed as `{ article: string; severity: 'critical' | 'major' | 'minor'; evidence: string; suggestion: string }`. Parsing MUST use a Zod schema, consistent with the project convention "Validate all state and config with Zod schemas".

**REQ-2.6** The command MUST write `spec/changes/<name>/violations.md` after every run, regardless of whether violations were found. The file MUST be overwritten (not appended) on each invocation.

**REQ-2.7** The command MUST apply the following exit-code logic:

- Exit 0 when: no violations exist, OR all `critical` and `major` violations each have a matching justification entry in a `## Complexity Tracking` section of `spec.md`.
- Exit 4 when: any `critical` violation lacks a justification entry.
- Exit 4 when: any `major` violation lacks a justification entry in `## Complexity Tracking`.
- Exit 4 when: the agent process itself errors or times out.

`minor` violations MUST be written to `violations.md` as advisory only and MUST NOT influence the exit code.

**REQ-2.8** A `major` violation is considered "justified" when `spec.md` contains a `## Complexity Tracking` section with a bullet of the form `- <article>: <rationale>` where `<article>` exactly matches the violation's `article` field. A `critical` violation MUST always produce exit 4 regardless of any justification entry.

---

### REQ-3: Plan Phase Integration

**REQ-3.1** The file `src/templates/skills/metta-plan/SKILL.md` MUST include a post-step after all planning artifacts (research, design, tasks) are committed. The post-step MUST invoke `metta check-constitution --change <name>`.

**REQ-3.2** If `metta check-constitution` exits non-zero, the plan skill MUST halt and MUST NOT advance to the implementation phase. The skill body MUST instruct the orchestrator to surface `spec/changes/<name>/violations.md` to the user with a message indicating which violations remain blocking.

**REQ-3.3** The plan skill MUST instruct the user to resolve blocking violations by adding or extending the `## Complexity Tracking` section in `spec.md` and re-running the plan phase (or re-invoking `metta check-constitution` before continuing).

**REQ-3.4** The plan skill MUST NOT re-run research, design, or tasks subagents when re-entered after a constitution failure. It MUST detect that those artifacts are already complete and proceed directly to the constitution check step.

---

### REQ-4: `violations.md` Artifact

**REQ-4.1** `spec/changes/<name>/violations.md` MUST be a markdown document. The file MUST begin with a YAML frontmatter block containing at minimum:

- `checked` — ISO 8601 date of the check run
- `spec_version` — the git object hash (short SHA) of `spec.md` at time of check

**REQ-4.2** When violations exist, the body MUST list each violation as a structured markdown entry with all four fields (`article`, `severity`, `evidence`, `suggestion`) clearly labeled.

**REQ-4.3** When no violations are found, the file body MUST contain the literal text "No violations found." (not an empty file, not a blank body).

**REQ-4.4** Each run MUST overwrite the file completely. The command MUST NOT append to an existing `violations.md`. This ensures the file always reflects the most recent check.

**REQ-4.5** The file MUST be committed to the change's directory and MUST be included in the change archive when `metta finalize` runs, providing a permanent compliance record.

---

### REQ-5: Skill — `/metta-check-constitution`

**REQ-5.1** The file `src/templates/skills/metta-check-constitution/SKILL.md` MUST exist with a valid skill frontmatter block (`name`, `description`, `allowed-tools`), consistent with the pattern in `src/templates/skills/metta-fix-issues/SKILL.md`.

**REQ-5.2** The build process MUST copy `src/templates/skills/metta-check-constitution/SKILL.md` to `dist/templates/skills/metta-check-constitution/SKILL.md` byte-for-byte.

**REQ-5.3** The skill body MUST invoke `metta check-constitution` (optionally with `--change <name>` determined via AskUserQuestion if no active change is detected). The skill MUST echo both the path to `violations.md` and the exit status to the user upon completion.

**REQ-5.4** The skill MUST NOT re-implement violation parsing or severity logic. All such logic lives in the CLI command; the skill is a thin orchestration wrapper.

---

## Scenarios

### Scenario 1: Agent files are byte-identical across all three locations

Given `src/templates/agents/metta-constitution-checker.md` exists and a build has been run,
When the file contents at `src/templates/agents/metta-constitution-checker.md`, `dist/templates/agents/metta-constitution-checker.md`, and `.claude/agents/metta-constitution-checker.md` are compared byte-for-byte,
Then all three files MUST be identical (same byte count, same SHA256 digest).

### Scenario 2: Agent emits well-formed violations when spec violates a rule

Given a `spec.md` that proposes "a singleton registry instance shared across all modules" as part of its design,
When the `metta-constitution-checker` agent reads `spec/project.md` (Conventions + Off-Limits) and the spec,
Then the agent output MUST include at least one violation entry where `article` is "No singletons", `severity` is `critical` or `major`, `evidence` contains a verbatim excerpt from the spec describing the singleton, and `suggestion` is a non-empty string.

### Scenario 3: Agent correctly quotes spec evidence

Given a `spec.md` containing the phrase "we store raw YAML as a string constant `TEMPLATE_YAML = '...'`",
When the checker agent produces a violation for this phrase,
Then the `evidence` field in the output MUST contain a substring that appears verbatim in the spec — the agent MUST NOT paraphrase or summarize the evidence.

### Scenario 4: Agent emits an explicit empty list when no violations exist

Given a `spec.md` that conforms to all Conventions and Off-Limits rules,
When the `metta-constitution-checker` agent processes it,
Then the agent output MUST include an explicit empty violations signal rather than producing no output, and the CLI MUST parse this as zero violations.

### Scenario 5: Clean spec produces exit 0 and an empty violations file

Given an active change whose `spec.md` contains no constitutional violations,
When `metta check-constitution --change <name>` is invoked,
Then the command exits with code 0, `spec/changes/<name>/violations.md` is written containing the text "No violations found.", and `--json` output includes `{ "violations": [], "exit": 0 }`.

### Scenario 6: Spec with minor-only violations produces exit 0 with advisory output

Given a `spec.md` that triggers one `minor` violation (e.g., a non-idiomatic but non-prohibited pattern),
When `metta check-constitution --change <name>` is invoked,
Then the command exits with code 0, the violation is written to `violations.md` with `severity: minor`, and the CLI output indicates the minor advisory without blocking.

### Scenario 7: Spec with unjustified major violation produces exit 4

Given a `spec.md` that proposes using CommonJS `require()` calls in one module, and `spec.md` does NOT contain a `## Complexity Tracking` section with a matching justification,
When `metta check-constitution --change <name>` is invoked,
Then the command exits with code 4, `violations.md` lists the violation with `severity: major`, and the error output names the blocking article.

### Scenario 8: Spec with major violation justified in Complexity Tracking produces exit 0

Given a `spec.md` that proposes a pattern matching the Off-Limits rule "No unvalidated state writes" (severity `major`), AND `spec.md` contains a `## Complexity Tracking` section with the bullet `- No unvalidated state writes: this intermediate buffer is ephemeral and never persisted; adding Zod here would require refactoring the entire streaming pipeline`,
When `metta check-constitution --change <name>` is invoked,
Then the command exits with code 0, `violations.md` lists the violation as present but justified, and no blocking error is emitted.

### Scenario 9: Spec with critical violation always exits 4 regardless of justification

Given a `spec.md` that proposes pushing with `--force` AND `spec.md` contains a `## Complexity Tracking` entry `- No --force pushes: required for this use case`,
When `metta check-constitution --change <name>` is invoked,
Then the command exits with code 4, the `violations.md` entry for the critical violation is marked unresolved, and the justification entry in `## Complexity Tracking` does not change the exit code.

### Scenario 10: Agent timeout or error produces exit 4

Given the `metta-constitution-checker` agent process exits non-zero (e.g., due to a timeout or API error),
When `metta check-constitution --change <name>` is processing the result,
Then the command MUST exit with code 4, MUST print an error message describing the agent failure, and MUST NOT write `violations.md` with a zero-violations result.

### Scenario 11: Plan phase with clean spec advances to implementation

Given a change in the plan phase where all planning artifacts (research, design, tasks) are committed and the change's `spec.md` has no blocking violations,
When the `/metta-plan-phase` skill runs its post-step invoking `metta check-constitution --change <name>`,
Then `metta check-constitution` exits 0, the skill advances to the implementation phase, and `violations.md` is written with "No violations found."

### Scenario 12: Plan phase with blocking violation halts and surfaces violations.md

Given a change in the plan phase where all planning artifacts are committed and `spec.md` contains an unjustified critical violation,
When the `/metta-plan-phase` skill runs its post-step invoking `metta check-constitution --change <name>`,
Then `metta check-constitution` exits 4, the skill halts without advancing to implementation, and the orchestrator output includes the path `spec/changes/<name>/violations.md` with instructions for the user to resolve the blocking violation and re-run.

### Scenario 13: `violations.md` is overwritten on re-run, not appended

Given a `violations.md` already exists from a prior check run containing three violation entries,
When `metta check-constitution --change <name>` is run again on an updated `spec.md` that has zero violations,
Then `violations.md` MUST contain "No violations found." and MUST NOT contain any entries from the previous run. The file byte count from the prior run MUST differ from the new file.

### Scenario 14: Skill template and deployed copy are byte-identical

Given `src/templates/skills/metta-check-constitution/SKILL.md` exists and a build has been run,
When the file contents at `src/templates/skills/metta-check-constitution/SKILL.md` and `dist/templates/skills/metta-check-constitution/SKILL.md` are compared byte-for-byte,
Then both files MUST be identical.

### Scenario 15: `/metta-check-constitution` skill invokes the CLI command

Given no `--change` flag is supplied and no active change is in progress,
When the `/metta-check-constitution` skill is invoked,
Then the skill asks the user for the change name via AskUserQuestion, then runs `metta check-constitution --change <provided-name>`, echoes the path to `violations.md`, and reports the exit status.

---

## Out of Scope

- Retroactive checking of specs in `spec/specs/` or `spec/archive/` — only `spec/changes/<name>/spec.md` is in scope.
- Auto-generating the `## Complexity Tracking` section — engineers MUST author justifications manually; the agent MUST NOT produce justifications for its own findings.
- Enforcement on `spec/project.md` itself — the constitution is not self-checked.
- Per-change constitution overrides or alternative constitution profiles.
- Checking `intent.md`, `design.md`, `tasks.md`, or any artifact other than `spec.md`.
- Checking commit messages, branch names, or implementation source code for constitutional compliance.
- Constitutional checking in `metta quick` mode — quick mode skips the plan phase and this gate intentionally.
- Automatic retry on agent failure — the user MUST re-run; silent skip is prohibited.
- A visual or web UI for violation triage beyond `violations.md` and CLI output.
- Custom severity mappings beyond the three levels (`critical`, `major`, `minor`).
- Notification or webhook integrations on violation detection.

---

## Complexity Tracking

_(None at time of writing — no constitutional violations identified in this spec.)_
