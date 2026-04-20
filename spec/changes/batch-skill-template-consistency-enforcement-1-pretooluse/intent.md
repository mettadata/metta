# batch-skill-template-consistency-enforcement-1-pretooluse

## Problem

The metta framework relies on prose-only conventions in two categories that have been observed failing in practice.

**CLI access enforcement is prose-only and violated in production.** `CLAUDE.md` states "AI orchestrators MUST invoke the matching metta skill — never call the CLI directly," but there is no mechanical check. In a recent session an AI orchestrator issued `metta issue` directly four separate times despite the explicit prohibition. The rule exists to prevent incomplete artifact authoring — the skills wrap subagent personas that write real content; raw CLI calls bypass those guarantees and have shipped stub artifacts (see `spec/issues/metta-complete-accepts-stub-placeholder-artifacts-on-intent-.md`). Without enforcement at the tool boundary the rule cannot be relied upon.

**Fan-out subagents write to `/tmp` paths that are lost before the orchestrator can merge them.** The `metta-propose` skill has two fan-out steps that instruct parallel reviewer and verifier agents to write their findings to `/tmp/review-correctness.md`, `/tmp/review-security.md`, `/tmp/review-quality.md` (step 5) and `/tmp/verify-tests.md`, `/tmp/verify-tsc-lint.md`, `/tmp/verify-scenarios.md` (step 6). The orchestrator is supposed to merge these into `review.md` and `verify.md`, but `/tmp` paths are volatile — they are not co-located with the change, not committed to git, and are silently lost when the session or sub-process exits. Three framework issues were logged for this pattern (research fan-out has already been fixed in `fix-three-issues-1-elevate-research-synthesis-numbered-step`; review and verify fan-out remain unfixed).

Together these two gaps mean an AI session can break the workflow silently: executing prohibited CLI calls and losing review/verify artifacts with no error.

## Proposal

**1. PreToolUse Bash hook — mechanical CLI access enforcement.**

Introduce `src/templates/hooks/metta-guard-bash.mjs` (and its byte-identical mirror `.claude/hooks/metta-guard-bash.mjs`). The hook follows the established `metta-guard-edit.mjs` pattern: reads the Claude hook event JSON from stdin, inspects `tool_input.command`, and blocks state-mutating metta commands with exit code 2 and a message directing the caller to the correct skill.

Blocked command patterns (matched against the Bash command string):

```
metta (propose|quick|auto|complete|finalize|ship|issue|fix-issue|fix-gap|refresh|import|install|init)
metta backlog (add|done|promote)
metta changes abandon
```

Read-only commands pass through unconditionally: `metta status`, `metta instructions`, `metta issues list`, `metta gate list`, `metta progress`, `metta changes list`, `metta doctor`.

Non-Bash tool events (tool name is not `Bash`) pass through immediately (exit 0) — the hook is scoped to shell invocations only.

Bypass mechanism: if the environment variable `METTA_SKILL=1` is present, the hook exits 0 without checking the command. Skills set this variable before calling `metta <cmd>` via Bash, so legitimate skill-driven CLI calls are never blocked. This is simpler than a dedicated binary and requires no new install artifacts.

Emergency bypass: disable the hook entry in `.claude/settings.local.json`, matching the `metta-guard-edit.mjs` convention documented in the error message.

`metta install` registers the hook in `settings.json` alongside the existing `metta-guard-edit` hook in the `PreToolUse` block.

**2. Review fan-out path fix — step 5 of metta-propose.**

Update `src/templates/skills/metta-propose/SKILL.md` step 5 (and `.claude/skills/metta-propose/SKILL.md` mirror) to mandate that each parallel reviewer writes output to `spec/changes/<name>/review/<persona>.md`:

- `review/correctness.md`
- `review/security.md`
- `review/quality.md`

The prose MUST explicitly forbid `/tmp` paths. The orchestrator merges these files into `review.md` from the change directory, where they are co-located with the change and will be committed.

**3. Verify fan-out path fix — step 6 of metta-propose.**

Update `src/templates/skills/metta-propose/SKILL.md` step 6 (and `.claude/` mirror) to mandate that each parallel verifier writes output to `spec/changes/<name>/verify/<aspect>.md`:

- `verify/tests.md`
- `verify/tsc-lint.md`
- `verify/scenarios.md`

The prose MUST explicitly forbid `/tmp` paths. Same merge pattern as review.

Both path fixes use a directory structure (`review/correctness.md`, not `review-correctness.md`) for clear grouping under the change and consistency with how the rest of the change artifact tree is organized.

## Impact

Files created or modified:

| File | Change |
|------|--------|
| `src/templates/hooks/metta-guard-bash.mjs` | NEW — PreToolUse Bash hook implementation |
| `.claude/hooks/metta-guard-bash.mjs` | NEW — byte-identical mirror of above |
| `src/templates/skills/metta-propose/SKILL.md` | MODIFIED — step 5 review fan-out paths, step 6 verify fan-out paths |
| `.claude/skills/metta-propose/SKILL.md` | MODIFIED — byte-identical mirror of above |
| `src/cli/commands/install.ts` | MODIFIED — register `metta-guard-bash.mjs` in `settings.json` PreToolUse block alongside existing `metta-guard-edit` hook |
| `src/templates/settings/` | MODIFIED if install emits a settings.json template — update PreToolUse block there too |
| `tests/metta-guard-bash.test.ts` | NEW — unit tests covering: mutating commands blocked, read-only commands pass, `METTA_SKILL=1` bypass passes, non-Bash tool events pass |
| `tests/install.test.ts` | MODIFIED — assert install registers the new hook in the PreToolUse block |
| `tests/skill-discovery-loop.test.ts` | MODIFIED if applicable — byte-identity assertions for `metta-propose/SKILL.md` must continue to pass after path updates |

Runtime behavior changes:

- AI orchestrators issuing any blocked metta command via Bash without `METTA_SKILL=1` receive an exit-2 error with a message naming the correct skill to invoke.
- Review and verify artifacts produced by `metta-propose` fan-out subagents are now persisted under the change directory and survive session cleanup.
- No change to the human CLI experience — humans running metta commands in a terminal are unaffected (no hook fires outside an AI tool session).

## Out of Scope

- Applying the `/tmp`-path fix to `/metta-quick` or `/metta-fix-issues` skill templates. Only `/metta-propose` is touched in this change; the other skills are tracked separately if needed.
- Applying the `/tmp`-path fix to the research fan-out. That step was already fixed in the prior `fix-three-issues-1-elevate-research-synthesis-numbered-step` change merged to main.
- Extending `metta-guard-bash.mjs` to block non-metta shell commands (scope is metta CLI enforcement only).
- Adding a `metta doctor` subcommand (tracked separately in backlog).
- Changing the severity or enforcement of any other `CLAUDE.md` prose rule beyond the CLI-access rule.
- GUI or dashboard changes.
- Changes to any other skill template (`metta-quick`, `metta-fix-issues`, `metta-plan`, `metta-execute`, `metta-verify`, `metta-ship`).
