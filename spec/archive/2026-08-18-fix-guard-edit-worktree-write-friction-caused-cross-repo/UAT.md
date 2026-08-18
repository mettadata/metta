# UAT: fix-guard-edit-worktree-write-friction-caused-cross-repo

- **Change**: fix-guard-edit-worktree-write-friction-caused-cross-repo
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

### US-1: Executors stop on silent-write anomalies instead of contaminating my main checkout

*Independent test:* The executor and verifier agent templates and the metta-execute skill contract each contain explicit shell-write path-discipline rules (all bash writes anchored under change_root) and a STOP-and-report rule for non-landing Edit/Write results, with the skill instructing the orchestrator to escalate such a report to the user.

#### Step 1.1
- **Setup**: the shipped `metta-executor.md` agent template
- **Do**: its Rules are read
- **Observe**: they forbid any bash-mediated file write (redirection, heredoc, `tee`, `cp`, `mv`, scripts) targeting a path outside the prompt-provided `change_root`
- [ ] Pass

#### Step 1.2
- **Setup**: an executor whose Edit/Write call reports success but leaves the target file unchanged on disk
- **Do**: the executor verifies the write and detects the mismatch
- **Observe**: its instructions require it to STOP and report the anomaly to the orchestrator rather than falling back to bash writes against re-derived paths
- [ ] Pass

#### Step 1.3
- **Setup**: the shipped `metta-verifier.md` agent template
- **Do**: its Rules are read
- **Observe**: the same shell-write path-discipline rule is present
- [ ] Pass

#### Step 1.4
- **Setup**: the `metta-execute` skill template
- **Do**: an executor STOP-report about non-landing edits reaches the orchestrator
- **Observe**: the skill instructs escalation to the user, not a workaround
- [ ] Pass

### US-2: Guard blocks bash writes that escape the worktree into my main checkout

*Independent test:* With a worktree-hosted active change context, a bash command redirecting output to an absolute path inside the main checkout is blocked (exit 2) with stderr naming the offending path and the expected change_root prefix, while the same write targeting the change worktree passes.

#### Step 2.1
- **Setup**: an active worktree-hosted change
- **Do**: a bash command writes via `>`, `>>`, heredoc, `tee`, `cp`, or `mv` to an absolute path inside the main checkout root but outside the change worktree and legitimately-shared paths
- **Observe**: the guard blocks with exit 2 and stderr naming the offending path and the expected change_root prefix
- [ ] Pass

#### Step 2.2
- **Setup**: an active worktree-hosted change
- **Do**: a bash command writes to a path inside the change's own worktree
- **Observe**: the guard allows it
- [ ] Pass

#### Step 2.3
- **Setup**: no active worktree-hosted change context
- **Do**: any bash write command runs
- **Observe**: the write-target check does not apply and the command is not blocked by it
- [ ] Pass

#### Step 2.4
- **Setup**: the shipped hook template set
- **Do**: a consumer installs metta
- **Observe**: the installed guard-bash hook includes the write-target check
- [ ] Pass

### US-3: Guard heuristic fails open so my legitimate work is never blocked

*Independent test:* A test matrix shows commands with unparseable or ambiguous write targets, non-file commands, and writes in projects without a worktree-hosted active change all pass the guard unblocked.

#### Step 3.1
- **Setup**: a bash command whose write target the heuristic cannot resolve (command substitution, exotic quoting, arbitrary interpreters)
- **Do**: the guard evaluates it
- **Observe**: the command is allowed (fail open)
- [ ] Pass

#### Step 3.2
- **Setup**: a bash command that performs no file writes
- **Do**: the guard evaluates it
- **Observe**: the write-target check imposes no block
- [ ] Pass

#### Step 3.3
- **Setup**: the existing metta-CLI two-tier authorization behavior
- **Do**: the write-target check is added
- **Observe**: existing allow/block semantics for `metta <cmd>` invocations are unchanged
- [ ] Pass

### US-4: Contamination of my main checkout is detected before completion and ship

*Independent test:* For a worktree-hosted change, `metta complete implementation` fails with a diagnostic listing newly-dirty main-checkout paths when files were modified there during execution, and ship preflight includes an equivalent main-checkout cleanliness step.

#### Step 4.1
- **Setup**: a worktree-hosted change about to begin implementation execution
- **Do**: execution starts (Run: `git status --porcelain --untracked-files=no`)
- **Observe**: a `git status --porcelain --untracked-files=no` baseline of the main checkout is recorded as Zod-validated state
- [ ] Pass

#### Step 4.2
- **Setup**: files in the main checkout were modified during the execution window
- **Do**: `metta complete implementation` runs (Run: `metta complete implementation`)
- **Observe**: completion fails with a diagnostic listing the newly-dirty paths
- [ ] Pass

#### Step 4.3
- **Setup**: a worktree-hosted change entering ship
- **Do**: merge-safety preflight runs
- **Observe**: it includes a main-checkout cleanliness check in addition to the existing checks on the checkout being shipped
- [ ] Pass

#### Step 4.4
- **Setup**: a non-worktree change or a clean run
- **Do**: completion and ship run
- **Observe**: behavior is unchanged from today
- [ ] Pass

### US-5: My own in-flight edits in main don't hard-block execution

*Independent test:* With a pre-dirtied main checkout, execution proceeds with a warning, and completion succeeds when no additional main-checkout modifications occurred during execution.

#### Step 5.1
- **Setup**: a main checkout with pre-existing uncommitted modifications
- **Do**: worktree execution begins
- **Observe**: the pre-existing dirt is recorded in the baseline and surfaced as a warning, not a hard block
- [ ] Pass

#### Step 5.2
- **Setup**: that same pre-existing dirt and no new main-checkout modifications during execution
- **Do**: `metta complete implementation` runs (Run: `metta complete implementation`)
- **Observe**: the completion's cleanliness check passes
- [ ] Pass

#### Step 5.3
- **Setup**: pre-existing dirt plus one new file modified in the main checkout during execution
- **Do**: completion runs
- **Observe**: only the new path is reported in the failure diagnostic
- [ ] Pass

## Additional scenarios

#### Step 6.1: Executor template forbids bash writes outside change_root
- **Setup**: the shipped `metta-executor.md` agent template
- **Do**: its Rules section is read
- **Observe**: it contains a rule requiring all bash-mediated file writes (redirection, heredoc, `tee`, `cp`, `mv`, scripts) to target absolute paths under the prompt-provided `change_root`, and forbidding bash writes to any path outside `change_root`
- **Machine-verified** — summary.md references "Executor template forbids bash writes outside change_root"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.2: Existing executor rules are preserved
- **Setup**: the amended `metta-executor.md` template
- **Do**: its Deviation Rules and completion contract are compared against the pre-change template
- **Observe**: they are unchanged — the path-discipline rule is additive
- **Machine-verified** — summary.md references "Existing executor rules are preserved"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.3: Non-landing Edit result leads to STOP, not bash fallback
- **Setup**: an executor whose `Edit`/`Write` call reports success but the target file content on disk is unchanged
- **Do**: the executor verifies the write and detects the mismatch
- **Observe**: its instructions require it to STOP and report the anomaly (target path, success-without-effect observation) to the orchestrator rather than rewriting the file via bash against re-derived paths
- **Machine-verified** — summary.md references "Non-landing Edit result leads to STOP, not bash fallback"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.4: Template inspection finds no sanctioned bash-fallback path
- **Setup**: the amended `metta-executor.md` template
- **Do**: its instructions are inspected for any path that permits recovering from a non-landing Edit/Write by writing the same content via bash
- **Observe**: no such path exists — the only sanctioned response to a silent-write anomaly is STOP-and-report
- **Machine-verified** — summary.md references "Template inspection finds no sanctioned bash-fallback path"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.5: Verifier template contains the path-discipline rule
- **Setup**: the shipped `metta-verifier.md` agent template
- **Do**: its Rules are read
- **Observe**: the same shell-write path-discipline rule present in `metta-executor.md` — change_root-anchored bash writes, forbidden outside-change_root writes, STOP-and-report on silent-write anomalies — is present
- **Machine-verified** — summary.md references "Verifier template contains the path-discipline rule"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.6: Skill contract escalates a silent-write STOP-report
- **Setup**: the `metta-execute` skill template and an executor STOP-report about non-landing edits reaching the orchestrator
- **Do**: the orchestrator consults the skill's instructions for what to do
- **Observe**: the skill directs escalation to the user and contains no instruction to work around the anomaly via bash writes or orchestrator-performed writes outside the change worktree
- **Machine-verified** — summary.md references "Skill contract escalates a silent-write STOP-report"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.7: Spawn contract names the path-discipline binding
- **Setup**: the `metta-execute` skill template's executor-spawn contract
- **Do**: it is read
- **Observe**: it states that executors are bound by change_root path discipline for all shell writes
- **Machine-verified** — summary.md references "Spawn contract names the path-discipline binding"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.8: Redirection into the main checkout is blocked with a diagnostic
- **Setup**: an active worktree-hosted change and a Bash command redirecting output (`>` or `>>`) to an absolute path inside the main checkout root but outside the change worktree
- **Do**: the guard evaluates the command
- **Observe**: the guard exits 2 and stderr names the offending path and the expected change_root prefix
- **Machine-verified** — summary.md references "Redirection into the main checkout is blocked with a diagnostic"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.9: Heredoc, tee, cp, and mv targets are covered
- **Setup**: an active worktree-hosted change
- **Do**: a Bash command writes into the main checkout via a heredoc target, a `tee` argument, or a `cp`/`mv` destination argument resolving to an absolute main-checkout path outside the worktree
- **Observe**: each form is blocked with exit 2 and the same diagnostic shape as the redirection case
- **Machine-verified** — summary.md references "Heredoc, tee, cp, and mv targets are covered"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.10: Writes inside the change's own worktree pass
- **Setup**: an active worktree-hosted change
- **Do**: a Bash command writes via any of the covered forms to an absolute path inside the change's own worktree checkout
- **Observe**: the write-target check does not block the command
- **Machine-verified** — summary.md references "Writes inside the change's own worktree pass"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.11: No worktree-hosted active change means no write-target check
- **Setup**: a session with no worktree-hosted active change context (no active change, or an active change hosted in the main checkout)
- **Do**: any bash write command is evaluated
- **Observe**: the write-target check does not apply and imposes no block
- **Machine-verified** — summary.md references "No worktree-hosted active change means no write-target check"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.12: Unresolvable write targets fail open
- **Setup**: an active worktree-hosted change and a Bash command whose write target cannot be confidently resolved (command substitution in the target, exotic quoting, or an arbitrary interpreter performing the write)
- **Do**: the guard evaluates the command
- **Observe**: the command is allowed — the heuristic fails open rather than guessing
- **Machine-verified** — summary.md references "Unresolvable write targets fail open"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.13: Non-write commands are untouched
- **Setup**: an active worktree-hosted change and a Bash command that performs no file writes (e.g. `git status`, `npm test`, `ls`)
- **Do**: the guard evaluates the command (Run: `git status`, `npm test`)
- **Observe**: the write-target check imposes no block and adds no rejection path for it
- **Machine-verified** — summary.md references "Non-write commands are untouched"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.14: Pre-existing guard-bash test suite passes unmodified
- **Setup**: the full pre-existing guard-bash test coverage for tier authorization, classification, tokenization, and background-Bash rejection
- **Do**: the suite runs against the hook with the write-target check added
- **Observe**: every pre-existing test passes without modification to its expected outcomes
- **Machine-verified** — summary.md references "Pre-existing guard-bash test suite passes unmodified"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.15: metta CLI invocations are classified exactly as before
- **Setup**: a `metta <cmd>` invocation of any allowed, blocked, or unknown subcommand
- **Do**: the guard evaluates it after the write-target check is added
- **Observe**: the allow/block/fail-closed outcome and rejection reason are identical to pre-change behavior
- **Machine-verified** — summary.md references "metta CLI invocations are classified exactly as before"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.16: Consumer install receives the write-target check
- **Setup**: the shipped hook template set after this change
- **Do**: a consumer installs metta and the guard-bash hook is placed in their project
- **Observe**: the installed hook includes the write-target check with the same block/fail-open behavior as metta's own repo-local hook
- **Machine-verified** — summary.md references "Consumer install receives the write-target check"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.17: Baseline is recorded as validated state at execution start
- **Setup**: a worktree-hosted change about to begin implementation execution
- **Do**: execution starts (Run: `git status --porcelain --untracked-files=no`)
- **Observe**: a `git status --porcelain --untracked-files=no` baseline of the main checkout is recorded as Zod-validated state under `.metta/`
- **Machine-verified** — summary.md references "Baseline is recorded as validated state at execution start"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.18: Non-worktree changes skip the baseline
- **Setup**: a change hosted in the main checkout (no worktree)
- **Do**: implementation execution starts
- **Observe**: no main-checkout baseline is recorded and execution proceeds exactly as before this change
- **Machine-verified** — summary.md references "Non-worktree changes skip the baseline"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.19: New main-checkout dirt fails completion with the offending paths
- **Setup**: a worktree-hosted change whose execution window modified files in the main checkout that were clean in the baseline
- **Do**: `metta complete implementation` runs (Run: `metta complete implementation`)
- **Observe**: completion fails and the diagnostic lists the newly-dirty main-checkout paths
- **Machine-verified** — summary.md references "New main-checkout dirt fails completion with the offending paths"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.20: Clean run completes unchanged
- **Setup**: a worktree-hosted change with a recorded baseline and no new main-checkout modifications during execution
- **Do**: `metta complete implementation` runs (Run: `metta complete implementation`)
- **Observe**: the cleanliness check passes and completion behavior is identical to pre-change behavior
- **Machine-verified** — summary.md references "Clean run completes unchanged"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.21: Detection never mutates the main checkout
- **Setup**: a completion failed by the cleanliness check
- **Do**: the failure path is inspected
- **Observe**: it performs no git operation that modifies the main checkout's working tree — it reports and fails only
- **Machine-verified** — summary.md references "Detection never mutates the main checkout"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.22: Ship preflight catches main-checkout contamination
- **Setup**: a worktree-hosted change entering ship with newly-dirty paths in the main checkout
- **Do**: the merge-safety preflight runs
- **Observe**: a main-checkout cleanliness step fails before the merge proceeds, with a detail naming the dirty paths
- **Machine-verified** — summary.md references "Ship preflight catches main-checkout contamination"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.23: Non-worktree ships are unchanged
- **Setup**: a ship of a change hosted in the main checkout
- **Do**: the merge-safety pipeline runs
- **Observe**: the step sequence, ordering semantics, and result shape are identical to pre-change behavior
- **Machine-verified** — summary.md references "Non-worktree ships are unchanged"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.24: Pre-existing dirt produces a warning at execution start
- **Setup**: a main checkout with pre-existing uncommitted modifications to tracked files
- **Do**: worktree execution begins and the baseline is recorded
- **Observe**: the pre-existing dirt is captured in the baseline and surfaced as a warning, and execution is not blocked
- **Machine-verified** — summary.md references "Pre-existing dirt produces a warning at execution start"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.25: Completion passes with pre-existing dirt and no new dirt
- **Setup**: that same pre-existing dirt and no additional main-checkout modifications during execution
- **Do**: `metta complete implementation` runs (Run: `metta complete implementation`)
- **Observe**: the cleanliness check passes
- **Machine-verified** — summary.md references "Completion passes with pre-existing dirt and no new dirt"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.26: Only new paths appear in the failure diagnostic
- **Setup**: pre-existing dirt plus exactly one new file modified in the main checkout during the execution window
- **Do**: completion runs and fails the cleanliness check
- **Observe**: the diagnostic lists only the one new path, not the pre-existing dirty paths
- **Machine-verified** — summary.md references "Only new paths appear in the failure diagnostic"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.27: Write-target matrix distinguishes blocked from allowed
- **Setup**: the guard-bash write-target unit tests
- **Do**: the allowed-vs-blocked matrix runs
- **Observe**: main-checkout-targeting redirection/heredoc/`tee`/`cp`/`mv` cases assert exit-2 blocks with path-naming diagnostics, and worktree-internal, unparseable, non-write, and no-worktree-context cases assert the command passes
- **Machine-verified** — summary.md references "Write-target matrix distinguishes blocked from allowed"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.28: Baseline/compare module tests cover dirt attribution
- **Setup**: the tree-clean module's unit tests
- **Do**: they run against baselines with clean, pre-dirtied, and newly-dirtied main-checkout states
- **Observe**: they assert warnings for pre-existing dirt, failure listing only new paths for execution-window dirt, and a pass for the clean case
- **Machine-verified** — summary.md references "Baseline/compare module tests cover dirt attribution"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 6.29: New blocking tests fail against pre-change behavior
- **Setup**: the write-target block tests and the completion/ship contamination tests
- **Do**: they are run against the pre-change hook and pipeline
- **Observe**: they fail, demonstrating each would have caught the zeus contamination incident
- **Machine-verified** — summary.md references "New blocking tests fail against pre-change behavior"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass
