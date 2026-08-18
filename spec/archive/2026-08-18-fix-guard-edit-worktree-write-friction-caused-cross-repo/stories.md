# fix-guard-edit-worktree-write-friction-caused-cross-repo — User Stories

## US-1: Executors stop on silent-write anomalies instead of contaminating my main checkout

**As a** developer running metta changes in worktrees on my own project
**I want to** have the executor (and verifier) personas bound by change_root path discipline — and required to STOP and report when Edit/Write tools report success without landing on disk
**So that** a harness-level write failure surfaces to me as an escalation instead of an agent silently improvising bash writes into my main working tree, diverging committed code from on-disk code

**Priority:** P1
**Independent Test Criteria:** The executor and verifier agent templates and the metta-execute skill contract each contain explicit shell-write path-discipline rules (all bash writes anchored under change_root) and a STOP-and-report rule for non-landing Edit/Write results, with the skill instructing the orchestrator to escalate such a report to the user.

**Acceptance Criteria:**
- **Given** the shipped `metta-executor.md` agent template **When** its Rules are read **Then** they forbid any bash-mediated file write (redirection, heredoc, `tee`, `cp`, `mv`, scripts) targeting a path outside the prompt-provided `change_root`
- **Given** an executor whose Edit/Write call reports success but leaves the target file unchanged on disk **When** the executor verifies the write and detects the mismatch **Then** its instructions require it to STOP and report the anomaly to the orchestrator rather than falling back to bash writes against re-derived paths
- **Given** the shipped `metta-verifier.md` agent template **When** its Rules are read **Then** the same shell-write path-discipline rule is present
- **Given** the `metta-execute` skill template **When** an executor STOP-report about non-landing edits reaches the orchestrator **Then** the skill instructs escalation to the user, not a workaround

---

## US-2: Guard blocks bash writes that escape the worktree into my main checkout

**As a** developer whose project has a worktree-hosted metta change in flight
**I want to** have the guard-bash hook detect bash write targets (redirections, heredocs, `tee`, `cp`/`mv` destinations) that resolve into the main checkout and block them with an actionable error
**So that** even a misbehaving or misinstructed agent cannot mutate my main working tree from inside a change worktree

**Priority:** P1
**Independent Test Criteria:** With a worktree-hosted active change context, a bash command redirecting output to an absolute path inside the main checkout is blocked (exit 2) with stderr naming the offending path and the expected change_root prefix, while the same write targeting the change worktree passes.

**Acceptance Criteria:**
- **Given** an active worktree-hosted change **When** a bash command writes via `>`, `>>`, heredoc, `tee`, `cp`, or `mv` to an absolute path inside the main checkout root but outside the change worktree and legitimately-shared paths **Then** the guard blocks with exit 2 and stderr naming the offending path and the expected change_root prefix
- **Given** an active worktree-hosted change **When** a bash command writes to a path inside the change's own worktree **Then** the guard allows it
- **Given** no active worktree-hosted change context **When** any bash write command runs **Then** the write-target check does not apply and the command is not blocked by it
- **Given** the shipped hook template set **When** a consumer installs metta **Then** the installed guard-bash hook includes the write-target check

---

## US-3: Guard heuristic fails open so my legitimate work is never blocked

**As a** developer using bash freely inside a metta session
**I want to** have the write-target check fail open on anything it cannot confidently parse (command substitution, compound quoting, unknown commands) and never touch non-file commands
**So that** the new protection cannot false-positive my legitimate workflow to a halt — it only blocks the specific dangerous pattern it can prove

**Priority:** P2
**Independent Test Criteria:** A test matrix shows commands with unparseable or ambiguous write targets, non-file commands, and writes in projects without a worktree-hosted active change all pass the guard unblocked.

**Acceptance Criteria:**
- **Given** a bash command whose write target the heuristic cannot resolve (command substitution, exotic quoting, arbitrary interpreters) **When** the guard evaluates it **Then** the command is allowed (fail open)
- **Given** a bash command that performs no file writes **When** the guard evaluates it **Then** the write-target check imposes no block
- **Given** the existing metta-CLI two-tier authorization behavior **When** the write-target check is added **Then** existing allow/block semantics for `metta <cmd>` invocations are unchanged

---

## US-4: Contamination of my main checkout is detected before completion and ship

**As a** developer relying on metta's completion and ship gates
**I want to** have the main checkout's tree-clean state baselined before worktree execution starts and re-verified at executor completion and at ship preflight
**So that** any cross-checkout contamination that slips past prevention is caught by the pipeline with a clear diagnostic — instead of being caught only by my eyes after merge

**Priority:** P1
**Independent Test Criteria:** For a worktree-hosted change, `metta complete implementation` fails with a diagnostic listing newly-dirty main-checkout paths when files were modified there during execution, and ship preflight includes an equivalent main-checkout cleanliness step.

**Acceptance Criteria:**
- **Given** a worktree-hosted change about to begin implementation execution **When** execution starts **Then** a `git status --porcelain --untracked-files=no` baseline of the main checkout is recorded as Zod-validated state
- **Given** files in the main checkout were modified during the execution window **When** `metta complete implementation` runs **Then** completion fails with a diagnostic listing the newly-dirty paths
- **Given** a worktree-hosted change entering ship **When** merge-safety preflight runs **Then** it includes a main-checkout cleanliness check in addition to the existing checks on the checkout being shipped
- **Given** a non-worktree change or a clean run **When** completion and ship run **Then** behavior is unchanged from today

---

## US-5: My own in-flight edits in main don't hard-block execution

**As a** developer with uncommitted personal edits sitting in my main checkout
**I want to** have pre-existing main-checkout dirt surfaced as a warning while only NEW dirt attributable to the execution window fails completion
**So that** the contamination detector protects me without forcing me to stash or commit my own unrelated work before running a metta change

**Priority:** P2
**Independent Test Criteria:** With a pre-dirtied main checkout, execution proceeds with a warning, and completion succeeds when no additional main-checkout modifications occurred during execution.

**Acceptance Criteria:**
- **Given** a main checkout with pre-existing uncommitted modifications **When** worktree execution begins **Then** the pre-existing dirt is recorded in the baseline and surfaced as a warning, not a hard block
- **Given** that same pre-existing dirt and no new main-checkout modifications during execution **When** `metta complete implementation` runs **Then** the completion's cleanliness check passes
- **Given** pre-existing dirt plus one new file modified in the main checkout during execution **When** completion runs **Then** only the new path is reported in the failure diagnostic
