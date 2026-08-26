# Milestone status is a write-once dead field with no close or update path

**Captured**: 2026-08-25
**Status**: logged
**Severity**: major

## Symptom
`metta milestone create` writes `status: open` (plus `name`, optional `target`, and a free-form body) to `spec/milestones/<slug>.md`, and no CLI path can ever change any of it afterward. Reported by the zeus session (2026-08-26): milestone `m1-real-trade-exit-correctness` has all attached issues resolved yet permanently reports `status: open` with a body still reading "In flight as PR #24"; `m6`'s body still lists a prerequisite that is now satisfied. The system of record lies about shipped work.

## Root Cause Analysis
The milestone feature shipped write-once by construction. `MilestonesStore` (added in `1fdda43d2`) exposes only `create`, `list`, `show`, and `exists` — there is no update/write-back method, and `create` explicitly refuses to overwrite an existing file. The CLI command group (`registerMilestoneCommand`) registers only `create`, `list`, and `show` subcommands, so no user-facing verb exists to transition status, edit the body, or change the target. The schema already models a `closed` state (`z.enum(['open', 'closed'])`) and downstream consumers render it (`milestone list` prints a `✓` marker and the rollup sort orders closed milestones last), meaning the read path fully supports a lifecycle that the write path never implements. Status can only be `open` unless a human hand-edits the YAML frontmatter — which bypasses Zod validation and auto-commit entirely. Nothing in the rollup path (`computeMilestoneRollups`) feeds resolution counts back into status either, so "all issues resolved" is computed and displayed but never acted on.

### Evidence
- `src/milestones/milestones-store.ts:87` — store API is `create`/`list`/`show`/`exists` only; no update method exists, and `create` throws if the file already exists, so frontmatter written at creation is permanent.
- `src/cli/commands/milestone.ts:44` — `registerMilestoneCommand` wires only `create`, `list`, `show`; there is no `close` or `update` subcommand.
- `src/schemas/milestone-frontmatter.ts:26` — `status: z.enum(['open', 'closed']).default('open')` proves the closed state is modeled and validated, yet only the default is ever reachable through the CLI (and no `abandoned` value exists at all).

## Candidate Solutions
1. **Add `metta milestone close <slug>` and `metta milestone update <slug>`** — add a store-level `update(slug, patch)` that reads the file, applies the patch (status transition open→closed/abandoned, body replacement, target change/clear), re-validates the full frontmatter through `MilestoneFrontmatterSchema` before write, and auto-commits like `create` does. Extend the status enum with `abandoned`. This is the direct fix matching the sibling `IssuesStore` resolve pattern. Tradeoff: grows CLI surface and requires updating the guard hook allow-list plus rollup/list/show renderers to handle the new `abandoned` state.

2. **Derive status automatically from issue rollups** — treat `status` as computed: a milestone whose attached issues are all resolved renders as closed in `list`/`show`/`progress`, with no explicit close verb. Tradeoff: status stops being a deliberate user decision — a milestone with zero attached issues or with scope beyond its issues (docs, UAT) would auto-close prematurely, stale bodies still cannot be edited, and `abandoned` remains unrepresentable.

3. **Minimal close-only + auto-close-eligible surfacing** — implement only `metta milestone close <slug>` (status flip with validation and auto-commit), and add a warning in `milestone list`/`show` and progress rollups when all attached issues are resolved but status is still open ("eligible for close"). Tradeoff: body and target remain uneditable, so stale descriptions like "In flight as PR #24" persist until a follow-up `update` command lands.

