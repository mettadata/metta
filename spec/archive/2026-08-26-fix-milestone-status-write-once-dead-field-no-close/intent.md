# fix-milestone-status-write-once-dead-field-no-close

## Problem

Milestone status is a write-once dead field. `metta milestone create` writes `status: open` (plus `name`, optional `target`, and a free-form description body) to `spec/milestones/<slug>.md`, and no CLI path can ever change any of it afterward:

- `MilestonesStore` (`src/milestones/milestones-store.ts`) exposes only `create`, `list`, `show`, and `exists` — there is no update/write-back method, and `create` explicitly throws if the file already exists.
- `registerMilestoneCommand` (`src/cli/commands/milestone.ts`) wires only `create`, `list`, and `show` subcommands — no user-facing verb can transition status, edit the body, or change/clear the target.
- Meanwhile the read path fully supports a lifecycle the write path never implements: `MilestoneFrontmatterSchema` models `status: z.enum(['open', 'closed'])`, `milestone list` renders a `✓` marker for closed milestones, and the rollup sort orders closed milestones last. The `closed` state is modeled, rendered, and unreachable.

Who is affected: anyone using milestones as a system of record — reported concretely by the zeus session (2026-08-26), where milestone `m1-real-trade-exit-correctness` has all attached issues resolved yet permanently reports `status: open` with a body still reading "In flight as PR #24", and `m6`'s body still lists a prerequisite that is now satisfied. The only workaround is hand-editing YAML frontmatter, which bypasses Zod validation and auto-commit entirely — violating the project's "no unvalidated state writes" constraint. Downstream, `metta status` and `metta progress` surface these rollups, so the dashboards lie about shipped work.

## Proposal

Give milestones a real lifecycle by adding a validated update path — candidate solution 1 from the issue, matching the sibling `IssuesStore` resolve pattern:

1. **Store: `MilestonesStore.update(slug, patch)`** — reads the existing milestone file, applies a patch (status transition, name change, description replacement, target set/change/clear), re-validates the resulting frontmatter through `MilestoneFrontmatterSchema` before write, and writes via `StateStore` like `create` does. Fails with a clear error when the milestone does not exist. No unvalidated state ever reaches disk.

2. **Schema: extend the status enum with `abandoned`** — `z.enum(['open', 'closed', 'abandoned'])` in `src/schemas/milestone-frontmatter.ts`, so milestones that are dropped (rather than achieved) are representable and distinguishable from completed ones. The store's `Milestone` interface status union is updated to match.

3. **CLI: `metta milestone close <slug>`** — transitions `open → closed` (or `abandoned` via a flag such as `--abandoned`). Idempotency/conflict behavior (already-closed) reports a clear error with the standard JSON error envelope, consistent with existing milestone subcommands. Auto-commits with a conventional `chore:` message following the `create` pattern, respecting the same main-branch guard (`--on-branch` acknowledgment).

4. **CLI: `metta milestone update <slug>`** — edits mutable fields via options (e.g. `--name`, `--target`, `--clear-target`, `--description`), including reopening or otherwise setting status where explicitly requested. Same validation, branch-guard, auto-commit, and `--json` output conventions as the other milestone subcommands.

5. **Renderers: handle `abandoned`** — `milestone list` marker and rollup ordering (`computeMilestoneRollups` sort), `milestone show` status line, and the `status`/`progress` milestone sections render the new state sensibly instead of crashing or mislabeling.

6. **Guard allow-list** — the `metta-guard-bash` hook's command allow-list is extended so the new `milestone close` / `milestone update` verbs are invocable from authorized skill contexts, consistent with how existing milestone verbs are authorized.

7. **Tests** — store, schema, and CLI test coverage for the new paths, maintaining the near 1:1 test-to-source ratio (update semantics, validation rejection, not-found errors, status transitions including `abandoned`, target clearing, renderer output for the new state).

## Impact

- `src/milestones/milestones-store.ts` — new `update` method; `Milestone.status` type widens to include `'abandoned'`. Existing `create`/`list`/`show`/`exists` behavior is unchanged.
- `src/schemas/milestone-frontmatter.ts` — status enum gains `abandoned`. Backward compatible for reads: all existing files carry `open` or `closed`, both still valid. Forward compatibility caveat: files written with `status: abandoned` will fail validation under older builds of metta.
- `src/cli/commands/milestone.ts` — two new subcommands; existing subcommand output (human and `--json`) is unchanged for the `open`/`closed` states. `list`/`show`/rollup rendering gains handling for `abandoned`.
- `src/milestones/milestone-rollup.ts` — sort/marker logic accounts for `abandoned` (grouped with terminal states, after open milestones).
- `metta status` / `metta progress` — milestone sections inherit the new state through the shared rollup path; existing output for `open`/`closed` milestones stays byte-compatible.
- Guard hook allow-list — gains the two new milestone verbs; no change to the trust-tier model.
- Existing milestone files on disk — untouched by this change itself; users can now close stale milestones (e.g. `m1-real-trade-exit-correctness`) through a validated, auto-committed path instead of hand-editing YAML.

## Out of Scope

- **Automatic status derivation from issue rollups** (candidate 2) — closing remains an explicit human/orchestrator decision; a milestone with all issues resolved is not auto-closed, because issue counts do not necessarily represent the milestone's full scope.
- **"Eligible for close" advisory warnings** in `list`/`show`/`status`/`progress` (part of candidate 3) — a possible follow-up, not part of this fix.
- **Milestone deletion or renaming (slug changes)** — `update` patches fields within an existing file; it does not move or remove files.
- **Reassigning issues between milestones** — issue-side `milestone:` frontmatter editing stays with the issue tooling.
- **Closed/abandoned-milestone archival** — terminal milestones remain in `spec/milestones/`; no archive move is introduced.
- **Interactive editor flows** (e.g. `$EDITOR`-based body editing) — updates are option-driven only.
- **Changes to milestone attachment semantics or rollup counting rules** — `computeMilestoneRollups` counting logic is untouched beyond ordering/marker support for the new state.
