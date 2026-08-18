# orchestration-guard

## ADDED: Requirement: Worktree Edits Are Allowed Under the Inverted-Hosting Topology

When a guarded Write/Edit/NotebookEdit/MultiEdit targets a file under `.metta/worktrees/<change>/`, the guard-edit hook MUST allow the edit (exit 0) whenever an active metta change is visible from either the target file's checkout root or the session's checkout root. In particular, the inverted-hosting topology — where the change's state (`spec/changes/<name>/.metta.yaml`) lives in the main checkout's `spec/changes/` and the worktree checkout carries no change state of its own — MUST NOT produce a block. The hook MUST NOT treat a successful no-active-changes answer from the target's checkout root as sufficient grounds to block while the session's checkout reports an active change.

*Trace: intent problem statement (zeus false-positive block, 2026-08-18); US-1.*

### Scenario: Inverted-hosting topology edit is allowed

- GIVEN a main checkout hosting `spec/changes/<name>/.metta.yaml` for an active change
- AND a worktree at `.metta/worktrees/<name>/` that does not carry that change state in its own `spec/changes/`
- WHEN a subagent issues a Write or Edit targeting a file inside the worktree
- THEN the guard-edit hook exits 0 and the edit proceeds

### Scenario: Empty answer from the target root alone does not block

- GIVEN the inverted-hosting topology above
- WHEN the hook's active-change probe rooted at the target's checkout reports no active changes
- AND an active change is visible from the session's checkout root
- THEN the hook allows the edit rather than blocking on the target-root answer alone

### Scenario: Subagents no longer need the heredoc fallback

- GIVEN a consumer project running the fixed hooks with an active change in the inverted-hosting topology
- WHEN a subagent executes inside `.metta/worktrees/<change>/` and lands its edits via the Write/Edit tools
- THEN every edit passes the guard without resorting to a bash heredoc bypass

## ADDED: Requirement: Canonical Worktree Topology Remains Allowed

The guard-edit hook MUST continue to allow (exit 0) guarded edits targeting worktree-hosted files when the change state lives inside the worktree's own checkout (`spec/changes/<name>/.metta.yaml` present in the worktree) — the canonical topology fixed by PR #57. The fix for the inverted-hosting topology MUST NOT regress this behavior.

*Trace: US-2; intent acceptance shape (canonical PR #57 topology).*

### Scenario: Canonical topology edit is still allowed

- GIVEN a worktree at `.metta/worktrees/<name>/` whose own checkout contains `spec/changes/<name>/.metta.yaml` for an active change
- WHEN a subagent issues a Write or Edit targeting a file inside that worktree
- THEN the guard-edit hook exits 0 and the edit proceeds

## ADDED: Requirement: Guard Still Blocks When No Change Is Active in Either Root

When no active metta change is visible from the target file's checkout root or from the session's checkout root, the guard-edit hook MUST block guarded edits to non-allow-listed paths with exit 2 and MUST emit guidance to start a change (e.g. via `metta quick`). The fix MUST NOT convert the guard into an unconditional allow.

*Trace: US-2; intent acceptance shape (protective behavior preserved).*

### Scenario: No active change anywhere still blocks

- GIVEN a metta project with no active change in the session's checkout
- AND a target path whose checkout root also reports no active change
- WHEN a Write or Edit targets a guarded path that matches no allow-list entry
- THEN the hook exits 2 with the no-active-change guidance message

## ADDED: Requirement: Probe Failures Continue to Fail Open

Any failure of the hook's active-change probe — `metta` missing from PATH, a non-zero exit, invalid or unparseable JSON output, or a probe timeout — MUST continue to result in the hook exiting 0 (fail open), for every probe the hook performs. The fix MUST NOT introduce a probe whose failure blocks an edit.

*Trace: US-2; intent Out of Scope (fail-open policy unchanged).*

### Scenario: Each probe-failure mode fails open

- GIVEN a guarded edit under evaluation
- WHEN the active-change probe fails in any mode — metta not on PATH, non-zero exit, invalid JSON, or timeout
- THEN the hook exits 0 and the edit proceeds

## ADDED: Requirement: Init-Phase and Issues Allow-Lists Are Unchanged

The guard-edit hook's no-active-change allow-lists MUST remain unchanged in content and semantics: the exact-path init-phase allow-list (`spec/project.md`, `.metta/config.yaml`) and the directory-prefix allow-list (`spec/issues/` restricted to `.md` files) MUST continue to permit those writes without an active change, and no new paths are added or removed by this fix.

*Trace: US-2; intent Out of Scope (allow-lists unchanged).*

### Scenario: Allow-listed paths still pass without an active change

- GIVEN a metta project with no active change visible from any checkout root
- WHEN a Write targets `spec/project.md`, `.metta/config.yaml`, or a `.md` file under `spec/issues/`
- THEN the hook exits 0 and the write proceeds

## ADDED: Requirement: Regression Tests Exercise Real Discovery Semantics for the Inverted Topology

The guard-edit test suite's worktree-awareness cases MUST exercise the real CLI's change-discovery behavior — or a faithful reproduction of its one-directional discovery (main root aggregates worktree changes; a worktree root does not consult the parent checkout) — against the inverted-hosting topology. The suite MUST NOT rely solely on a shim `metta` binary that answers by cwd for topology coverage, and the inverted-topology test MUST be demonstrably capable of failing against the pre-fix behavior.

*Trace: US-3; intent contributing gap (shim-based suite blind spot).*

### Scenario: Inverted-topology test catches the original defect

- GIVEN the regression test reproducing the inverted-hosting topology against real (or faithfully reproduced one-directional) discovery semantics
- WHEN the test runs against the pre-fix hook/CLI behavior
- THEN it fails, demonstrating it would have caught the original false-positive block

### Scenario: Topology coverage does not come from a cwd-answering shim

- GIVEN the worktree-awareness cases in the guard-edit test suite
- WHEN they probe active-change discovery for the canonical and inverted topologies
- THEN the answer derives from real CLI resolution and aggregation semantics (or an equivalent faithful reproduction), not a shim that answers by cwd

### Scenario: Both topologies are covered alongside existing cases

- GIVEN the extended guard-edit test suite
- WHEN the full test run executes
- THEN it covers the canonical topology, the inverted-hosting topology, the no-active-change block, and every fail-open probe-failure mode
