# Summary: claude-md-workflow-section-ref

## What changed

`buildWorkflowSection()` now emits five skill-reference groups (`Lifecycle skills`, `Status skills`, `Organization skills`, `Spec management skills`, `Setup skills`) covering all 18 installed `/metta-*` skills, replacing the previous CLI-command reference that contradicted the newly-codified "AI orchestrators MUST invoke the matching metta skill — never call the CLI directly" mandate.

## Files modified

- `src/cli/commands/refresh.ts` — `buildWorkflowSection()` bullet blocks
- `tests/refresh.test.ts` — assertions updated; added exhaustive skill-presence check and section-header check

## Verification

- `npx tsc --noEmit`: clean
- `npm test`: 526/526 (42 files)
- 3-reviewer parallel pass: all PASS, no critical or warning findings

## Resolves

User feedback "skill commands not cli commands" after dogfooding the previous `claude-md-workflow-section-man` change.

## Non-goals (out of scope)

- `workflow-primer.ts` (already correct post-`-man` change)
- Skill definitions themselves
- Other tool adapters
- CLI-only commands without skill wrappers (`instructions`, `answer`, `validate-stories`, `cleanup`, `reconcile`, `doctor`, `config`, `gate`, `context`) — humans at terminal reach these via `metta --help`
