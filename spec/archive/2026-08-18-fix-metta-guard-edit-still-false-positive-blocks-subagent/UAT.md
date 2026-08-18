# UAT: fix-metta-guard-edit-still-false-positive-blocks-subagent

- **Change**: fix-metta-guard-edit-still-false-positive-blocks-subagent
- **Generated**: 2026-08-18
- **Source**: user stories (stories.md)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

### US-1: Subagent edits into a worktree are allowed under inverted-hosting topology

*Independent test:* In a fixture where a main checkout hosts `spec/changes/<name>/.metta.yaml` for an active change and its worktree at `.metta/worktrees/<name>/` carries no change state, a Write/Edit into the worktree passes the guard-edit hook with exit 0.

#### Step 1.1
- **Setup**: a main checkout hosting `spec/changes/<name>/.metta.yaml` for an active change and a worktree at `.metta/worktrees/<name>/` that does not carry that state
- **Do**: a subagent issues Write/Edit against a file inside the worktree
- **Observe**: the guard-edit hook allows the edit (exit 0)
- [ ] Pass

#### Step 1.2
- **Setup**: the inverted-hosting topology above
- **Do**: the hook evaluates the edit and the target-checkout probe reports no active changes
- **Observe**: the change visible from the session's checkout is sufficient to allow — the hook does not block on the target-root answer alone
- [ ] Pass

#### Step 1.3
- **Setup**: the fix has shipped and a consumer reinstalls hooks
- **Do**: subagents execute inside `.metta/worktrees/<change>/` during an active change
- **Observe**: no heredoc fallback is needed to land edits
- [ ] Pass

### US-2: Guard protection and canonical topology behavior are preserved

*Independent test:* The existing guard-edit test suite plus new topology cases confirm exit 0 for the canonical worktree topology, exit 2 when neither checkout has an active change, and unchanged fail-open behavior for every probe-failure mode.

#### Step 2.1
- **Setup**: the canonical topology where change state lives inside the worktree's own `spec/changes/`
- **Do**: a subagent edits a worktree-hosted file
- **Observe**: the hook still allows the edit — no regression from PR #57 behavior
- [ ] Pass

#### Step 2.2
- **Setup**: no active change in either the target's checkout or the session's checkout
- **Do**: a Write/Edit targets a guarded path
- **Observe**: the hook still blocks with exit 2
- [ ] Pass

#### Step 2.3
- **Setup**: any probe failure (metta missing from PATH, non-zero exit, invalid JSON, timeout)
- **Do**: the hook evaluates an edit
- **Observe**: it continues to fail open, unchanged
- [ ] Pass

#### Step 2.4
- **Setup**: the init-phase allow-list and `spec/issues/` prefix allow-list
- **Do**: the fix lands
- **Observe**: their contents and semantics are unchanged
- [ ] Pass

### US-3: Regression tests exercise real discovery semantics for the inverted topology

*Independent test:* A test exists that reproduces the inverted-hosting topology against real CLI discovery semantics — not a shim that answers by cwd — and fails when run against the pre-fix hook behavior.

#### Step 3.1
- **Setup**: the guard-edit test suite
- **Do**: the inverted-hosting topology test runs against the unfixed hook/CLI behavior
- **Observe**: it fails, demonstrating the test would have caught the original defect
- [ ] Pass

#### Step 3.2
- **Setup**: the test suite's worktree-awareness cases
- **Do**: they probe active-change discovery
- **Observe**: the answer comes from the real CLI's resolution and aggregation logic (or an equivalent faithful reproduction), not a shim `metta` binary that answers by cwd
- [ ] Pass

#### Step 3.3
- **Setup**: the extended suite
- **Do**: the full test run executes
- **Observe**: both canonical and inverted-hosting topologies are covered alongside the existing no-active-change and fail-open cases
- [ ] Pass

## Additional scenarios

#### Step 4.1: Inverted-hosting topology edit is allowed
- **Setup**: a main checkout hosting `spec/changes/<name>/.metta.yaml` for an active change; a worktree at `.metta/worktrees/<name>/` that does not carry that change state in its own `spec/changes/`
- **Do**: a subagent issues a Write or Edit targeting a file inside the worktree
- **Observe**: the guard-edit hook exits 0 and the edit proceeds
- [ ] Pass

#### Step 4.2: Empty answer from the target root alone does not block
- **Setup**: the inverted-hosting topology above
- **Do**: the worktree checkout's own `spec/changes/` carries no state for the change; an active change is visible from the hosting checkout root
- **Observe**: the hook allows the edit rather than blocking on the worktree checkout's answer alone
- [ ] Pass

#### Step 4.3: Subagents no longer need the heredoc fallback
- **Setup**: a consumer project running the fixed hooks with an active change in the inverted-hosting topology
- **Do**: a subagent executes inside `.metta/worktrees/<change>/` and lands its edits via the Write/Edit tools
- **Observe**: every edit passes the guard without resorting to a bash heredoc bypass
- [ ] Pass

#### Step 4.4: Canonical topology edit is still allowed
- **Setup**: a worktree at `.metta/worktrees/<name>/` whose own checkout contains `spec/changes/<name>/.metta.yaml` for an active change
- **Do**: a subagent issues a Write or Edit targeting a file inside that worktree
- **Observe**: the guard-edit hook exits 0 and the edit proceeds
- [ ] Pass

#### Step 4.5: No active change anywhere still blocks
- **Setup**: a metta project with no active change in the session's checkout; a target path whose checkout root also reports no active change
- **Do**: a Write or Edit targets a guarded path that matches no allow-list entry
- **Observe**: the hook exits 2 with the no-active-change guidance message
- [ ] Pass

#### Step 4.6: Each probe-failure mode fails open
- **Setup**: a guarded edit under evaluation
- **Do**: the active-change probe fails in any mode — metta not on PATH, non-zero exit, invalid JSON, or timeout
- **Observe**: the hook exits 0 and the edit proceeds
- [ ] Pass

#### Step 4.7: Allow-listed paths still pass without an active change
- **Setup**: a metta project with no active change visible from any checkout root
- **Do**: a Write targets `spec/project.md`, `.metta/config.yaml`, or a `.md` file under `spec/issues/`
- **Observe**: the hook exits 0 and the write proceeds
- [ ] Pass

#### Step 4.8: Inverted-topology test catches the original defect
- **Setup**: the regression test reproducing the inverted-hosting topology against real (or faithfully reproduced one-directional) discovery semantics
- **Do**: the test runs against the pre-fix hook/CLI behavior
- **Observe**: it fails, demonstrating it would have caught the original false-positive block
- [ ] Pass

#### Step 4.9: Topology coverage does not come from a cwd-answering shim
- **Setup**: the worktree-awareness cases in the guard-edit test suite
- **Do**: they probe active-change discovery for the canonical and inverted topologies
- **Observe**: the answer derives from real CLI resolution and aggregation semantics (or an equivalent faithful reproduction), not a shim that answers by cwd
- [ ] Pass

#### Step 4.10: Both topologies are covered alongside existing cases
- **Setup**: the extended guard-edit test suite
- **Do**: the full test run executes
- **Observe**: it covers the canonical topology, the inverted-hosting topology, the no-active-change block, and every fail-open probe-failure mode
- [ ] Pass
