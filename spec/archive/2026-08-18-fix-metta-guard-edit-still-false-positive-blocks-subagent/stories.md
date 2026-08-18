# fix-metta-guard-edit-still-false-positive-blocks-subagent — User Stories

## US-1: Subagent edits into a worktree are allowed under inverted-hosting topology

**As a** metta adopter running subagent-driven execution in a consumer project (e.g. zeus)
**I want to** have my subagents' Write/Edit calls into `.metta/worktrees/<change>/` allowed when the change is active but its state lives in the main checkout's `spec/changes/`
**So that** subagents use the proper Write/Edit tools instead of falling back to bash heredocs that bypass the guard and degrade edit quality and auditability
**Priority:** P1
**Independent Test Criteria:** In a fixture where a main checkout hosts `spec/changes/<name>/.metta.yaml` for an active change and its worktree at `.metta/worktrees/<name>/` carries no change state, a Write/Edit into the worktree passes the guard-edit hook with exit 0.

**Acceptance Criteria:**
- **Given** a main checkout hosting `spec/changes/<name>/.metta.yaml` for an active change and a worktree at `.metta/worktrees/<name>/` that does not carry that state **When** a subagent issues Write/Edit against a file inside the worktree **Then** the guard-edit hook allows the edit (exit 0)
- **Given** the inverted-hosting topology above **When** the hook evaluates the edit and the target-checkout probe reports no active changes **Then** the change visible from the session's checkout is sufficient to allow — the hook does not block on the target-root answer alone
- **Given** the fix has shipped and a consumer reinstalls hooks **When** subagents execute inside `.metta/worktrees/<change>/` during an active change **Then** no heredoc fallback is needed to land edits

## US-2: Guard protection and canonical topology behavior are preserved

**As a** metta project maintainer relying on the guard-edit hook to protect spec and state files
**I want to** keep the hook's existing correct behaviors — allowing the canonical PR #57 topology, blocking when no change is active anywhere, and failing open on probe errors — exactly as they are today
**So that** fixing the false positive does not weaken the guard's protective posture or regress previously fixed topologies
**Priority:** P1
**Independent Test Criteria:** The existing guard-edit test suite plus new topology cases confirm exit 0 for the canonical worktree topology, exit 2 when neither checkout has an active change, and unchanged fail-open behavior for every probe-failure mode.

**Acceptance Criteria:**
- **Given** the canonical topology where change state lives inside the worktree's own `spec/changes/` **When** a subagent edits a worktree-hosted file **Then** the hook still allows the edit — no regression from PR #57 behavior
- **Given** no active change in either the target's checkout or the session's checkout **When** a Write/Edit targets a guarded path **Then** the hook still blocks with exit 2
- **Given** any probe failure (metta missing from PATH, non-zero exit, invalid JSON, timeout) **When** the hook evaluates an edit **Then** it continues to fail open, unchanged
- **Given** the init-phase allow-list and `spec/issues/` prefix allow-list **When** the fix lands **Then** their contents and semantics are unchanged

## US-3: Regression tests exercise real discovery semantics for the inverted topology

**As a** metta contributor maintaining the guard-edit hook
**I want to** have the worktree-awareness test suite exercise the real CLI's one-directional change discovery (or a faithful reproduction of it) against the inverted-hosting topology
**So that** this class of topology bug can never again ship undetected behind a cwd-answering shim, as happened with PR #57
**Priority:** P2
**Independent Test Criteria:** A test exists that reproduces the inverted-hosting topology against real CLI discovery semantics — not a shim that answers by cwd — and fails when run against the pre-fix hook behavior.

**Acceptance Criteria:**
- **Given** the guard-edit test suite **When** the inverted-hosting topology test runs against the unfixed hook/CLI behavior **Then** it fails, demonstrating the test would have caught the original defect
- **Given** the test suite's worktree-awareness cases **When** they probe active-change discovery **Then** the answer comes from the real CLI's resolution and aggregation logic (or an equivalent faithful reproduction), not a shim `metta` binary that answers by cwd
- **Given** the extended suite **When** the full test run executes **Then** both canonical and inverted-hosting topologies are covered alongside the existing no-active-change and fail-open cases
