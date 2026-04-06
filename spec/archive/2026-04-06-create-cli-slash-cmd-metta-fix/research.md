# Research: metta fix-gap — Implementation Approach

**Change:** create-cli-slash-cmd-metta-fix  
**Date:** 2026-04-06  
**Status:** Complete

---

## Decision

**Skill-orchestrated** (Approach 2): The CLI command handles argument parsing, gap validation, severity sorting, `--json` output formatting, and gap file removal. The actual pipeline execution — propose through ship — is driven by a `/metta:fix-gap` skill that invokes the CLI phases, spawning subagents exactly as the existing `metta-auto` and `metta-propose` skills do. The CLI emits structured JSON that the skill streams back into the conversation.

---

## Context

The fix-gap pipeline is a multi-agent workflow spanning eight distinct phases (propose → plan → execute → review ×3 → verify → finalize → ship). Each phase is already implemented as a CLI command with a corresponding skill. The question is who drives the sequencing: the CLI binary itself via `execFile` calls, or a skill that calls `metta` subcommands and spawns subagents.

Two existing precedents in the codebase are instructive:

- `auto.ts` uses the CLI command as a stub that outputs a message and delegates. The real lifecycle is driven by `.claude/skills/metta-auto/SKILL.md`, which spawns per-artifact subagents and manages the review-fix and verify-fix loops.
- `propose.ts` is a thin CLI command (creates the change directory, checks out a branch) and a corresponding `metta-propose` skill handles discovery, artifact agents, review, verify, finalize, and merge.
- `finalize.ts` directly calls library code (`Finalizer`) and `execFile` for git. It does not shell out to other `metta` CLI subcommands.

The fix-gap pipeline is structurally closer to `auto`/`propose` (multi-phase, agent-driven) than to `finalize` (single-phase, library call).

---

## Approaches Considered

### Approach 1: CLI-orchestrated

The `fix-gap` CLI command itself drives the full pipeline by calling each phase via `execFile('metta', ['propose', ...])`, `execFile('metta', ['plan'])`, etc., collecting exit codes, and halting or continuing as appropriate.

**How it would work:**

```typescript
// src/cli/commands/fix-gap.ts (abbreviated)
const phases = [
  ['propose', `--from-gap`, slug, `--discovery`, `batch`],
  ['plan'],
  ['execute'],
  ['next'], ['next'], ['next'],
  ['verify'],
  ['finalize'],
  ['ship', '--branch', `metta/${changeName}`],
]
for (const phase of phases) {
  const result = await execAsync('metta', phase, { cwd: projectRoot })
  if (result exit code !== 0) { report failure; break }
}
await gapsStore.remove(slug)
await execAsync('git', ['commit', '-m', `chore(${slug}): gap resolved`])
```

**Pros:**

- The full pipeline can run from a plain terminal without any AI session open.
- All phases run as actual subprocesses with real exit codes and real stdout/stderr, matching what a developer would see running each command manually.
- Error handling at the orchestration layer is simple: non-zero exit code = halt.
- No skill file to maintain in parallel with the CLI command.

**Cons:**

- Each phase is an opaque subprocess. The CLI cannot pass structured context between phases (e.g., the change name returned by `propose --json` must be parsed from the JSON output of the prior step, adding parsing fragility).
- The propose, review, and verify phases rely on AI agents (via the existing skills) to produce artifact content. A bare `execFile('metta', ['propose', ...])` only creates the change directory; the real propose work — discovery, artifact generation, review, verification — lives in the `metta-propose` skill, which is invoked by Claude, not by the CLI binary. Shelling out to `metta propose` from the CLI does not actually run the AI agents.
- There is no mechanism in the CLI for spawning parallel review or verify agents (`metta-auto` fans out three reviewers and three verifiers in parallel; `execFile` would run them sequentially, breaking the intended workflow pattern).
- The command becomes a long-running process that blocks a terminal for the full duration of multi-phase AI work (potentially many minutes). There is no resumption path.
- This pattern conflicts with how `auto.ts` handles the same problem: `auto.ts` explicitly delegates to the skill layer rather than encoding pipeline logic in the CLI binary.

**Verdict:** Approach 1 produces a CLI that calls `metta propose` and gets back a change directory, but the phases that actually require AI agents (artifact writing, review, verify) require a skill invocation, not a CLI subprocess. The CLI cannot self-drive AI agent work.

---

### Approach 2: Skill-orchestrated (recommended)

The CLI command handles all pure-TypeScript concerns:

- Argument parsing and validation
- `GapsStore.exists` / `GapsStore.show` for gap lookup
- Severity keyword scanning (raw file content, case-insensitive, with critical > medium > low precedence)
- Severity-based sorting for `--all`
- `--json` output formatting (phases array, summary object, error schema)
- `GapsStore.remove` and the gap-resolved git commit on success

The skill file `.claude/skills/metta-fix-gap/SKILL.md` handles all multi-agent orchestration:

- Calls `metta fix-gap <slug> --json` or reads gap details directly
- Invokes `metta propose --from-gap <slug> --discovery batch`
- Spawns artifact subagents per the existing per-artifact loop pattern
- Fans out three metta-reviewer subagents in parallel, then three metta-verifier subagents in parallel
- Runs `metta finalize` and `metta ship`
- Calls `metta fix-gap --remove-gap <slug>` (or directly calls `GapsStore.remove`) after ship succeeds
- For `--all`: iterates severity-sorted gaps from `metta gaps list --json`, calling the single-gap pipeline per gap

The slash command `.claude/commands/fix-gap.md` is a thin wrapper that invokes the skill, mirroring the existing `metta-auto` skill's pattern.

**Pros:**

- Consistent with the existing architecture. Every multi-agent lifecycle (`metta auto`, `metta propose`) is skill-orchestrated; adding a third divergent pattern would create maintenance burden and confuse contributors.
- Parallel review and verify fan-out (three agents each) works correctly because the skill layer has access to the `Agent` tool. `execFile` from the CLI binary has no equivalent.
- The CLI binary does the work it is good at: typed argument parsing, validated I/O, structured JSON output. The skill does the work it is good at: agent spawning, context passing between phases, decision loops.
- The `--json` flag serves its specified purpose: the slash command invokes `metta fix-gap <slug> --json` and streams the JSON output, with the skill producing the actual pipeline work in parallel.
- Structured context (change name, artifact paths) flows naturally between subagents through files in `spec/changes/<change>/`, not through parsing subprocess stdout.
- The CLI command implementing gap validation, severity sorting, and the `--all` batching loop is still fully testable in Vitest with no subprocess or AI dependency.

**Cons:**

- Terminal-only use (no Claude session) cannot run the full AI pipeline. However, this is true for all existing metta lifecycle commands: `metta plan`, `metta execute`, `metta review`, and `metta verify` all produce stub output without a skill invocation. The CLI alone is not designed to drive AI agent work.
- Two artifacts must be kept in sync: the CLI command and the skill file. This mirrors the existing `auto.ts` / `metta-auto/SKILL.md` split and is already the established pattern.
- The `--json` output contract (phases array, `failed_phase`, summary) requires the skill to track phase results and pass them back to the CLI for final emission, or for the CLI to emit the JSON object after the skill completes. This requires a clear handoff protocol, documented in the skill.

---

## Rationale

The deciding factor is that the phases requiring orchestration — artifact generation, parallel review, parallel verify — are AI agent operations. The CLI binary executes TypeScript; it cannot spawn three parallel `metta-reviewer` agents or drive interactive artifact writing. This is why `auto.ts` is a stub that says "run metta propose to begin discovery" rather than calling `execFile('metta', ['propose'])` itself.

Approach 1 produces a CLI command that calls `metta propose` and gets back a branch, then calls `metta plan` and gets back nothing useful (plan is stub output in the CLI; it requires a metta-planner subagent to write `plan.md`). The pipeline would stall at the first AI-dependent phase.

Approach 2 places the pipeline logic exactly where the existing codebase places all multi-agent lifecycle logic: in a skill file. The CLI command provides the well-typed, testable, exit-code-correct surface that the spec requires — gap existence checks, severity classification, `--all` batching, `--json` output, `GapsStore.remove` on success — and the skill file drives the agent work using the same patterns already proven in `metta-auto` and `metta-propose`.

---

## Implementation Boundary

| Concern | Owner |
|---|---|
| `GapsStore.exists` / `show` / `list` / `remove` | CLI command (`fix-gap.ts`) |
| Severity keyword scanning | CLI command (`fix-gap.ts`) |
| Severity sort for `--all` | CLI command (`fix-gap.ts`) |
| `--json` output schema | CLI command (`fix-gap.ts`) |
| Gap-resolved git commit (`chore(<slug>): gap resolved`) | CLI command (`fix-gap.ts`) |
| Exit codes (0, 4, non-zero on failure) | CLI command (`fix-gap.ts`) |
| Propose → plan → execute → review ×3 → verify → finalize → ship | Skill (`metta-fix-gap/SKILL.md`) |
| Parallel review fan-out (3 reviewers) | Skill (`metta-fix-gap/SKILL.md`) |
| Parallel verify fan-out (3 verifiers) | Skill (`metta-fix-gap/SKILL.md`) |
| Slash command entry point | `.claude/commands/fix-gap.md` (thin wrapper invoking skill) |
| Gap table display (no-arg invocation) | `.claude/commands/fix-gap.md` (calls `metta gaps list --json`, renders table) |

---

## Files to Create

- `src/cli/commands/fix-gap.ts` — CLI command
- `src/cli/commands/fix-gap.test.ts` — Vitest unit tests (severity parsing, sort, JSON output, error paths)
- `.claude/skills/metta-fix-gap/SKILL.md` — skill orchestrating the multi-agent pipeline
- `.claude/commands/fix-gap.md` — slash command entry point
- Registration in `src/cli/index.ts` (or equivalent entry point)
