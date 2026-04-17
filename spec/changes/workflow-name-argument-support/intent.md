# workflow-name-argument-support

## Problem

The metta CLI accepts `metta propose --workflow <name>` where `<name>` is one of `standard` (default), `quick`, or `full`. The `full` workflow adds three artifact stages absent from `standard`: `domain-research` (up front, before `intent`), `architecture` (after `design`, before `tasks`), and `ux-spec` (also after `design`, before `implementation`). Together these ten artifacts provide the deeper coverage needed for large, cross-cutting changes.

Both `/metta-propose` and `/metta-auto` skill templates hardcode `metta propose "$ARGUMENTS" --json` on their first step. They never thread a `--workflow` flag through to the CLI. CLAUDE.md mandates that AI orchestrators invoke the matching skill rather than calling the CLI directly, so `full` is effectively unreachable from Claude Code sessions: an orchestrator cannot select it without violating that rule. The restriction is not theoretical — the issue log (`spec/issues/metta-complete-accepts-stub-placeholder-artifacts-on-intent-.md`) documents harm from bypassing skill guarantees.

## Proposal

Teach both skill templates to parse a `--workflow <name>` token from `$ARGUMENTS` before constructing the `metta propose` call.

**Parsing rule (applied by the orchestrator reading the skill):**
If `$ARGUMENTS` contains the token `--workflow` followed by a single token (the name), extract both tokens as the workflow flag and treat the remainder of the string as the change description. If `--workflow` is absent, the orchestrator passes no flag and the CLI defaults to `standard`.

**Step 1 substitution in both skills:**

Before: `metta propose "$ARGUMENTS" --json`

After: `metta propose "<description>" --workflow <name> --json`

where `<description>` is `$ARGUMENTS` with the `--workflow <name>` pair removed, and `<name>` is the extracted value. When no `--workflow` token is present, the invocation reverts to `metta propose "$ARGUMENTS" --json` (unchanged behavior).

**Validation strategy:** The orchestrator does not pre-validate `<name>`. If the value is unrecognized, `metta propose` exits non-zero and surfaces its own error message; the skill propagates that failure to the user. No allow-list check is added to the skill.

**Handling `full` workflow artifacts in the existing loop:** Both skills use a per-artifact loop driven by `metta instructions <artifact> --json --change <name>`, which returns the correct agent persona for any artifact the workflow defines. The `domain-research`, `architecture`, and `ux-spec` stages are handled automatically by this loop without per-stage special-casing. The skill body adds a one-sentence note to that effect so orchestrators do not attempt manual intervention for those stages.

**Files changed:**
- `src/templates/skills/metta-propose/SKILL.md` — step 1 rewritten; artifact-loop note added
- `src/templates/skills/metta-auto/SKILL.md` — step 1 rewritten; artifact-loop note added

Both source templates AND their byte-identical deployed copies under `.claude/skills/` are updated (REQ-3 byte-identity requirement, from archived change `iterative-discovery-metta-prop`).

## Impact

- **Two source files change:** `src/templates/skills/metta-propose/SKILL.md` and `src/templates/skills/metta-auto/SKILL.md`.
- **No CLI change:** `metta propose --workflow <name>` already exists and already accepts `full`; `src/cli/commands/propose.ts` is unchanged.
- **No schema change:** No Zod schemas, YAML workflow definitions, or state-file shapes are affected.
- **No new skill file:** The change is a text edit to existing skill templates, not a new skill.
- **Test surface:** These files are markdown templates, not compiled code. If `tests/delivery.test.ts` or any other test asserts on the literal contents of either SKILL.md, those assertions must be updated to reflect the new step-1 text; the test logic itself does not change.
- **Orchestrator behavior at runtime:** Any Claude Code session invoking `/metta-propose --workflow full <description>` will now correctly call `metta propose "<description>" --workflow full --json`, branch into `metta/<change-name>`, and proceed through all ten `full`-workflow artifacts via the existing loop.
- **Backward compatibility:** Invocations without `--workflow` behave identically to today. No existing sessions, state files, or archived changes are affected.

## Out of Scope

- **Creating the missing `full`-workflow template files (`domain-research.md`, `architecture.md`, `ux-spec.md`)** — tracked separately as issue `full-workflow-references-missing-template-files-domain-resea`.
- **Other skills.** `/metta-quick`, `/metta-fix-issues`, and any future skills are not changed by this work.
- **Changes to workflow definitions.** The `full.yaml`, `standard.yaml`, and `quick.yaml` workflow files are not modified.
- **CLI argument-parsing changes.** `src/cli/commands/propose.ts` already parses `--workflow`; no changes are needed there.
- **A dedicated `/metta-full` shortcut skill.** A new skill that wraps `--workflow full` was considered and rejected to keep the skill surface small; the flag-passthrough approach is sufficient.
- **Pre-validation of workflow names inside the skill.** The CLI is the single source of truth for valid workflow names; duplicating an allow-list in markdown risks drift.
- **`metta auto` CLI command.** Only the skill templates are in scope; the `auto` CLI command (`src/cli/commands/auto.ts`) is unchanged.
