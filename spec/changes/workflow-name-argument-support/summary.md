# Summary: workflow-name-argument-support

## What changed

`/metta-propose` and `/metta-auto` skill orchestrators now parse a `--workflow <name>` token from `$ARGUMENTS` and thread it through to `metta propose --workflow <name>`. Default behavior (no flag) stays on the `standard` workflow.

## Files modified

- `src/templates/skills/metta-propose/SKILL.md` (+ byte-identical deployed mirror)
- `src/templates/skills/metta-auto/SKILL.md` (+ byte-identical deployed mirror)
- `spec/changes/workflow-name-argument-support/intent.md` (sync with REQ-3 reality)
- `tests/grounding.test.ts`, `tests/skill-discovery-loop.test.ts` — no net change (REQ-3 byte-identity tests restored after a temporary weakening was reverted)

## Files added

- `spec/issues/full-workflow-references-missing-template-files-domain-resea.md` — logged follow-up for the missing `full`-workflow stage templates (`domain-research`, `architecture`, `ux-spec`)

## Verification

- `diff` between source templates and deployed copies: empty (REQ-3 byte-identity preserved)
- `npx tsc --noEmit`: clean
- `npm test`: 526/526 pass
- 3-reviewer parallel pass: resolved to PASS after fix commits

## End-to-end scope

- `--workflow standard` (default) and `--workflow quick` work fully.
- `--workflow full` now *reaches* `metta propose` via the skill path but still crashes downstream because stage templates are missing — tracked in the new issue for a follow-up change.

## Resolves

- Unblocks `--workflow` flag access from AI orchestrator sessions
- Logs `full-workflow-references-missing-template-files-domain-resea` as the next step to make `full` end-to-end reachable

## Non-goals

- Creating the missing `full`-workflow templates (separate issue)
- Any CLI surface change — `metta propose --workflow` already existed
- Other skills (`/metta-quick`, `/metta-fix-issues`, etc.)
