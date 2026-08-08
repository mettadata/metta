# UAT: fix-metta-guard-edit-worktree-blind

- **Change**: fix-metta-guard-edit-worktree-blind
- **Generated**: 2026-08-08
- **Source**: intent + summary (reduced)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

*Reduced script — derived from intent/summary; steps are confirmation prompts.*

### Intent proposal

#### Step 1.1
- **Do**: Confirm: Teach `createCliContext` to resolve the containing worktree root: when `cwd` is inside a `.metta/worktrees/<change>/` checkout (or any git worktree with its own `spec/changes/`), root the context at that worktree's top level so `metta status`, `metta instructions`, and the artifact store see that worktree's changes natively.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: When run from the main checkout root, `metta status --json` MUST additionally aggregate active changes discovered under `.metta/worktrees/*/spec/changes/`, reporting each change with its hosting worktree path. If the same change slug exists in both the main checkout and a worktree, the worktree copy wins and the collision is surfaced as a warning — never silently merged.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: Before probing, the hook resolves the git top-level of the tree containing the edit target by walking up from the nearest existing ancestor of the target path (targets often don't exist yet for Write), then runs `git rev-parse --show-toplevel` there.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.4
- **Do**: Confirm: The `metta status --json` probe runs with `cwd` set to that resolved root, and `relPath` for the allowlist is computed against the same root. Edits inside a worktree with an active change are allowed; edits inside a worktree with no active change are blocked exactly as in the main checkout today.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.5
- **Do**: Confirm: Failure tolerance is preserved: if git or metta is missing, times out, or the target is outside any repo, the hook allows (current bootstrap-friendly philosophy unchanged).
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

`metta-guard-edit` no longer probes `metta status --json` at `process.cwd()`. It now extracts the edit target first, walks up from the target's nearest existing ancestor (Write targets often don't exist yet) to the containing checkout via `git rev-parse --show-toplevel` (5s timeout), and runs both the status probe and the allowlist `relPath` computation against that resolved root. Edits inside `.metta/worktrees/<change>/` checkouts with an active change are now allowed; edits inside a change-less worktree — and in the main checkout with no active change — are blocked exactly as before. Every failure mode (git missing, metta missing, target outside any repo, timeout) falls back to the previous tolerant cwd-rooted behavior. The installed hook and the template remain byte-identical (asserted by test).

#### Step 2.1
- **Do**: Confirm: `createCliContext` roots the context via a new `resolveProjectRoot()`: nearest ancestor of cwd with its own `spec/changes/`, never escaping the containing git checkout, falling back to cwd (pre-init projects unchanged). Invocations from inside a worktree checkout or any subdirectory now root at that checkout's top level.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: `ArtifactStore` accepts an optional `worktreesDir`. When set (the CLI passes `<root>/.metta/worktrees`), change discovery (`listChanges`, new `discoverChanges`) and change resolution by name (`getChange`, `updateChange`, `markArtifact`, artifact reads/writes, `archive`/`abandon`) additionally cover `.metta/worktrees/<name>/spec/changes/` checkouts. `metta status --json` from the main root reports each hosted change with its hosting worktree path (`worktree` field, injected on read when the stored metadata predates worktree mode — JSON shape stays additive). On a slug collision the worktree copy wins and a warning is printed to stderr — never silently merged. `createChange` now also rejects slugs already hosted in a worktree.
- **Observe**: behaves as described
- [ ] Pass
