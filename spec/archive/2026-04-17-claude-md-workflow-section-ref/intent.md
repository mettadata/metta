# claude-md-workflow-section-ref

## Problem

The `## Metta Workflow` section generated into every project's `CLAUDE.md` is internally inconsistent. The `### How to work` block — authored in the previous change `claude-md-workflow-section-man` — mandates:

> **AI orchestrators MUST invoke the matching metta skill — never call the CLI directly.**

Immediately below that mandate, `buildWorkflowSection()` in `src/cli/commands/refresh.ts` emits five CLI-reference groups listing `metta propose`, `metta quick`, `metta plan`, `metta execute`, `metta verify`, `metta finalize`, `metta ship`, and so on as the canonical Lifecycle, Status, Specs & Docs, Organization, and System verbs. An AI orchestrator reading the section encounters the mandate, then reads a structured list of `metta <cmd>` invocations with no skill alternative named — and may rationally conclude those CLI commands are the skill-adjacent correct form.

The user identified this directly: **"skill commands not cli commands."**

The root cause is that `buildWorkflowSection()` was not updated when the mandate was introduced. The mandate lives in `workflowPrimerLong()` (a shared helper in `workflow-primer.ts`), which `buildWorkflowSection()` calls first. The five CLI-reference groups that follow are emitted by `buildWorkflowSection()` itself. The mandate and the tables were authored in separate contexts and are now in direct conflict within the same rendered output.

## Proposal

Replace the five CLI-reference groups currently emitted by `buildWorkflowSection()` in `src/cli/commands/refresh.ts` with skill-reference groups listing all 18 installed `/metta-*` skills, organized by purpose. The replacement MUST cover every skill in the installed set and MUST NOT introduce any `metta <cmd>` CLI invocation forms in the new groups.

The five replacement skill-reference groups are:

**Lifecycle skills** — the primary change-driving skills an AI orchestrator reaches for first:
- `/metta-propose <description>` — start a non-trivial change (new feature, multi-file edit, API surface change)
- `/metta-quick <description>` — small, scoped fix (bug fix, one-file edit, minor refactor)
- `/metta-auto <description>` — full lifecycle loop without manual stage transitions
- `/metta-plan` — build planning artifacts for the current change
- `/metta-execute` — run the implementation stage
- `/metta-verify` — verify implementation against spec
- `/metta-ship` — finalize, archive, run gates, and merge branch to main

**Status skills** — query current state without mutating anything:
- `/metta-status` — current change status
- `/metta-progress` — project-level dashboard across all active changes
- `/metta-next` — what to do next given current state

**Organization skills** — manage issues, backlog, and fixes:
- `/metta-issue <description>` — log a new issue to `spec/issues/`
- `/metta-fix-issues <slug>` — resolve a logged issue from `spec/issues/`
- `/metta-backlog` — review and manage the prioritized backlog

**Spec management skills** — import, gap analysis, and constitution checks:
- `/metta-import` — import existing code into specs
- `/metta-fix-gap` — resolve reconciliation gaps between spec and code
- `/metta-check-constitution` — audit project against constitutional rules

**Setup skills** — initialization and regeneration:
- `/metta-init` — initialize metta in a new project
- `/metta-refresh` — regenerate `CLAUDE.md` and other derived files

Skills intentionally omitted from the skill-reference groups:

- `complete` — internal to the skill flow; no standalone skill wrapper. Skills call `metta complete` internally when an artifact is ready; AI orchestrators never invoke it directly.
- `finalize` — absorbed into `/metta-ship`; no separate skill.
- CLI-only commands (`instructions`, `answer`, `validate-stories`, `cleanup`, `reconcile`, `doctor`, `config`, `gate`, `context`) — have no skill form. Human terminal users reach them via `metta --help`; they are outside the AI orchestrator surface.

The `workflowPrimerLong()` helper (the "How to work," "Forbidden," and "Primary entry points" blocks) is NOT changed. Those blocks are correct and live in `workflow-primer.ts`, not in `buildWorkflowSection()`.

## Impact

- **AI orchestrators** reading a refreshed `CLAUDE.md` will see skill invocations (`/metta-propose`, `/metta-quick`, etc.) as the named reference forms in every group. No CLI command form appears after the mandate. The contradiction is eliminated.
- **Human terminal users** are unaffected. The "How to work" block already scopes the mandate to AI orchestrator sessions; humans at a terminal still use `metta <cmd>` via the CLI as before. The CLI reference tables are removed from the AI-facing `CLAUDE.md` section intentionally — human users rely on `metta --help`, not the generated markdown.
- **Existing projects** receive the corrected text on their next `metta refresh` run. No manual migration is required.
- **One file changes:** `src/cli/commands/refresh.ts`, function `buildWorkflowSection()`. No schema changes, no Zod changes, no state file changes, no interface changes, no new dependencies.

## Out of Scope

- Changes to `workflow-primer.ts` or the `workflowPrimerLong()` helper. The "How to work," "Forbidden," and "Primary entry points" blocks are correct as written after `claude-md-workflow-section-man`.
- Changes to the 18 `/metta-*` skill files themselves. Skill logic, prompts, and subagent chains are not touched.
- Changes to `src/delivery/claude-code-adapter.ts` or any other tool adapter. Adapters delegate to `buildWorkflowSection()` via the shared helper; no adapter-level edits are needed.
- Adding enforcement inside `metta complete` to reject stub or placeholder artifact content. That is tracked separately in `spec/issues/metta-complete-accepts-stub-placeholder-artifacts-on-intent-.md`.
- Automated migration of existing projects' `CLAUDE.md` files. Projects pick up the fix through `metta refresh`.
- Documentation of CLI-only commands (`doctor`, `config`, `gate`, `context`, etc.) anywhere inside the generated `CLAUDE.md` workflow block. Those commands remain accessible via `metta --help` and are not part of the AI orchestrator surface.
