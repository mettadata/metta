# Summary: fix-milestone-status-write-once-dead-field-no-close

## What changed

Milestones gained a validated write-back lifecycle. Previously `metta milestone create` wrote `status: open` permanently — no CLI path could close a milestone, edit its body, or change its target (issue `milestone-status-is-a-write-once-dead-field-with-no-close-or`).

## Implementation (7 tasks, 4 batches)

- **Schema** (`src/schemas/milestone-frontmatter.ts`): status enum extended to `open | closed | abandoned`; default and `.strict()` unchanged. Commit `3864badc5`.
- **Store** (`src/milestones/milestones-store.ts`): exported `MilestonePatch` and `update(slug, patch)` — read → patch → full-frontmatter Zod re-validation **before any I/O** → write; failing patches provably leave the file byte-identical; `clearTarget` removes the key entirely. Commit `3864badc5`.
- **Rollup** (`src/milestones/milestone-rollup.ts`): two-state sort replaced with a rank comparator (open first, terminal group slug-ascending — behavior-identical for open/closed-only inputs); exported shared `MILESTONE_MARKERS` (`▸`/`✓`/`✗`). Commit `959e2805d`.
- **CLI** (`src/cli/commands/milestone.ts`): new `milestone close <slug> [--abandoned]` (conflict pre-check, `chore: close milestone <slug>` auto-commit) and `milestone update <slug>` (`--name/--target/--clear-target/--description/--status`, Commander `conflicts`/`choices`, `chore: update milestone <slug>`); shared `commitMilestones` helper extracted from `create`; all failures exit 4 with typed JSON envelopes (`branch_guard`/`not_found`/`milestone_conflict`/`milestone_error`). Commit `5a4e3406d`.
- **Renderers** (`src/cli/commands/status.ts`, `progress.ts`): abandoned milestones render red `✗` via `MILESTONE_MARKERS`; open/closed output byte-identical to pre-change. Commits `e0063d78b`, `6429c7b88`.
- **Guard/mint hooks** (deployed + `src/templates/hooks/` mirrors, byte-identical): `milestone close`/`update` join the Tier-2 blocked set; `SKILL_SCOPES['metta-backlog']` gains `milestone:close`/`milestone:update`; 7 new guard test cases close the previously-empty milestone coverage gap. Commit `8541e2f2b`.
- **Skill** (`.claude/skills/metta-backlog/SKILL.md` + template mirror): milestone actions now `create | list | show | close | update` with dispatch branches for both new verbs. Commit `df57b4692`.

## Verification during implementation

Every task ran `npx tsc --noEmit` (clean) and its focused vitest suites (all green), including 309 guard-hook tests, byte-identity pins for hook mirrors, byte-compat ordering pins for the rollup sort, and byte-identical-file assertions for all failure paths.

## Notable deviations

- Task 1.1 pre-widened `MilestoneRollup.status` (one line) because the enum extension broke compilation — work the design assigned to the rollup component anyway.
- Task 3.3's test landed in `tests/cli-status.test.ts` (the file actually covering progress milestone rendering) rather than the plan's speculative `progress-secondary-line.test.ts`; a brief mid-batch file overlap between tasks 3.2/3.3 was reconciled with no lost work.

## Risks

- `status: abandoned` files fail validation under older metta builds (accepted one-way door, documented in intent).
- `update` re-serializes frontmatter via YAML.stringify — hand-edited key order/comments are normalized (accepted; hand-editing is the workflow this change eliminates).
