# fix-metta-guard-edit-worktree-blind

## Problem

Since worktree-per-change became the default layout (PR #52), every standard change checks out into `.metta/worktrees/<change>/` — and two components that should recognize those checkouts are blind to them:

**1. The `metta-guard-edit` hook blocks all subagent Write/Edit inside worktree checkouts.** The hook's active-change probe runs `metta status --json` with `cwd = process.cwd()` — the main checkout root, whose `spec/changes/` is empty while the change lives in the worktree (`.claude/hooks/metta-guard-edit.mjs:30`). The probe reports "no active change", so the hook falls through to its allowlist. That allowlist computes `relPath` against the main root, so a worktree-internal target resolves to `.metta/worktrees/<change>/spec/...` and matches no allow prefix; the outside-root escape at line 74 does not apply because `.metta/worktrees/` is *inside* the root. Result: every legitimate edit to an active change's worktree is rejected with "no active metta change".

The observed failure mode is worse than an inconvenience: during the `template-version-drift` change, 15+ subagents hit the block and fell back to Bash/python3 heredoc writes — meaning the guard was bypassed entirely for exactly the edits it exists to supervise. The guard currently provides negative value for the default workflow.

**2. The CLI cannot resolve worktree-hosted changes from the repo root.** `createCliContext` (`src/cli/helpers.ts:40`) roots everything at `process.cwd()`, and the artifact store (`src/artifacts/artifact-store.ts:103`) reads only `<root>/spec/changes`. So `metta status` and `metta instructions` invoked from the main checkout report no active changes even when `.metta/worktrees/*/spec/changes/` holds one. This is the same blindness the hook inherits, and it independently breaks status/instructions for users and orchestrators operating from the repo root.

Two duplicate major-severity issues were logged for this defect (2026-07-26 during `template-version-drift`, and 2026-08-08); this change resolves both.

## Proposal

Fix both layers so the worktree layout is a first-class citizen, with the hook deriving its answer from the CLI rather than duplicating change-resolution semantics:

**CLI: worktree-aware change resolution.**
- Teach `createCliContext` to resolve the *containing* worktree root: when `cwd` is inside a `.metta/worktrees/<change>/` checkout (or any git worktree with its own `spec/changes/`), root the context at that worktree's top level so `metta status`, `metta instructions`, and the artifact store see that worktree's changes natively.
- When run from the main checkout root, `metta status --json` MUST additionally aggregate active changes discovered under `.metta/worktrees/*/spec/changes/`, reporting each change with its hosting worktree path. If the same change slug exists in both the main checkout and a worktree, the worktree copy wins and the collision is surfaced as a warning — never silently merged.

**Hook: probe and allowlist rooted at the target's worktree.**
- Before probing, the hook resolves the git top-level of the tree containing the edit target by walking up from the nearest *existing* ancestor of the target path (targets often don't exist yet for Write), then runs `git rev-parse --show-toplevel` there.
- The `metta status --json` probe runs with `cwd` set to that resolved root, and `relPath` for the allowlist is computed against the same root. Edits inside a worktree with an active change are allowed; edits inside a worktree with *no* active change are blocked exactly as in the main checkout today.
- Failure tolerance is preserved: if git or metta is missing, times out, or the target is outside any repo, the hook allows (current bootstrap-friendly philosophy unchanged).

**Template parity.** The fix lands identically in both the installed hook `.claude/hooks/metta-guard-edit.mjs` and the template `src/templates/hooks/metta-guard-edit.mjs`; the two files remain byte-identical, and a test asserts that parity so they cannot drift.

**Tests.** Unit coverage for: worktree-root resolution from an existing path, from a not-yet-existing target, from the main root; status aggregation across worktrees; slug-collision warning; hook allow/block decisions in worktree vs main-root cwd.

## Impact

- **Unblocks the default workflow.** Every worktree-per-change subagent regains supervised Write/Edit; the Bash-heredoc fallback (and the unguarded writes it implies) disappears.
- **Restores guard integrity.** The hook once again mediates the edits it was built to supervise instead of being routinely bypassed.
- **`metta status` / `metta instructions` become truthful from the repo root**, which orchestrators and the statusline depend on for routing.
- **Behavioral change to status semantics:** root-level `metta status --json` output gains worktree-hosted changes (new fields for hosting worktree path). Consumers that assumed "root status = root's own spec/changes only" see a broader answer; the JSON shape addition is additive.
- **Performance:** one extra `git rev-parse` subprocess per guarded edit in the hook (bounded by the existing 5s timeout pattern); negligible against the existing `metta status` subprocess cost.
- **Files touched:** `.claude/hooks/metta-guard-edit.mjs`, `src/templates/hooks/metta-guard-edit.mjs`, `src/cli/helpers.ts`, `src/artifacts/artifact-store.ts` (change discovery), plus matching test files.
- Resolves both logged issues (2026-07-26 and 2026-08-08 duplicates, severity major).

## Out of Scope

- **Root-level active-change registry** (a second source of truth in the main checkout's `.metta/`, written at propose/quick and cleared at ship/abandon) — rejected here for blast radius and drift risk; may be revisited if aggregation proves too slow.
- **Filesystem-structural allow in the hook** (path-shape matching or walking for `.metta.yaml` without consulting the CLI) — rejected to avoid duplicating active-change semantics in the hook.
- Changes to the `metta-guard-bash` hook, the two-tier skill authorization model, or session-token minting.
- Worktree lifecycle management itself (creation, pruning, `DEFAULT_WORKTREE_DIR` layout in `src/util/git-worktree.ts`) — the layout is taken as-is.
- Nested worktrees (a worktree inside a worktree) beyond one level of `.metta/worktrees/<change>/`.
- Extending the init-phase allowlist (`spec/project.md`, `spec/issues/`, `spec/backlog/`, etc.) — its entries and semantics are unchanged, only the root it is computed against.
- Windows-specific path handling beyond what the existing hook already covers (`isAbsolute` escape retained as-is).
- Retroactive cleanup of artifacts written via the Bash fallback during previously affected changes.
