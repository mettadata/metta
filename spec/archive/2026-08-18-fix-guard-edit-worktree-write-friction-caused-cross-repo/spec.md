# orchestration-guard

> Delta spec for `fix-guard-edit-worktree-write-friction-caused-cross-repo`. All requirements
> merge into the `orchestration-guard` capability. Layer 3 (main-checkout tree-clean
> verification) touches surfaces also described by `finalize-ship` (`src/ship/merge-safety.ts`
> preflight) — those requirements are folded here under orchestration-guard per the
> one-capability-per-delta rule, with cross-references in the text.

## ADDED: Requirement: Executor Shell Writes Are Anchored Under change_root

The shipped executor agent template (`src/templates/agents/metta-executor.md`) MUST carry an
explicit shell-write path-discipline rule: every file write the executor performs via Bash —
output redirection (`>`, `>>`), heredoc, `tee`, `cp`, `mv`, or a script it authors and runs —
MUST target an absolute path under the `change_root` provided in the executor's prompt. Writing
via Bash to any path outside `change_root` MUST be forbidden by the template's Rules. The rule
MUST forbid the executor from re-deriving target paths from its own reading of the repository
layout when a prompt-provided `change_root` exists — the prompt-provided root is authoritative.
Existing deviation rules and the completion contract in the template MUST be unchanged.
Trace: intent Problem defect 1 (unguarded bash-write fallback); intent Proposal 1; US-1.

### Scenario: Executor template forbids bash writes outside change_root
- GIVEN the shipped `metta-executor.md` agent template
- WHEN its Rules section is read
- THEN it contains a rule requiring all bash-mediated file writes (redirection, heredoc, `tee`, `cp`, `mv`, scripts) to target absolute paths under the prompt-provided `change_root`, and forbidding bash writes to any path outside `change_root`

### Scenario: Existing executor rules are preserved
- GIVEN the amended `metta-executor.md` template
- WHEN its Deviation Rules and completion contract are compared against the pre-change template
- THEN they are unchanged — the path-discipline rule is additive


## ADDED: Requirement: Silent-Write Anomaly Triggers STOP-and-Report, Never a Bash Fallback

The executor template MUST instruct that when an `Edit` or `Write` tool call reports success but
the target file is unchanged on disk, the executor MUST verify the write landed (e.g. via `Read`
or `cat` after a suspicious result), and on confirming the mismatch MUST STOP and report the
anomaly to the orchestrator. The template MUST explicitly forbid the fallback observed in the
zeus incident: falling back to bash writes (heredoc, script, redirection) against re-derived
paths after a non-landing Edit/Write result. The STOP-report MUST identify the target path and
the observed success-without-effect behavior so the orchestrator can escalate.
Trace: intent Problem (silent-success/no-write Edit variant, zeus 2026-08-18); intent Proposal 1; US-1.

### Scenario: Non-landing Edit result leads to STOP, not bash fallback
- GIVEN an executor whose `Edit`/`Write` call reports success but the target file content on disk is unchanged
- WHEN the executor verifies the write and detects the mismatch
- THEN its instructions require it to STOP and report the anomaly (target path, success-without-effect observation) to the orchestrator rather than rewriting the file via bash against re-derived paths

### Scenario: Template inspection finds no sanctioned bash-fallback path
- GIVEN the amended `metta-executor.md` template
- WHEN its instructions are inspected for any path that permits recovering from a non-landing Edit/Write by writing the same content via bash
- THEN no such path exists — the only sanctioned response to a silent-write anomaly is STOP-and-report


## ADDED: Requirement: Verifier Carries the Same Shell-Write Path Discipline

The shipped verifier agent template (`src/templates/agents/metta-verifier.md`) MUST carry the
same shell-write path-discipline rule as the executor template: bash-mediated file writes MUST
target absolute paths under the prompt-provided `change_root`, writes outside `change_root` are
forbidden, and a silent-write anomaly requires STOP-and-report rather than a bash fallback. The
verifier is the other persona that routinely holds Bash inside worktree-hosted changes and MUST
NOT be left as an unguarded path for the same failure mode.
Trace: intent Proposal 1 (verifier parity); US-1.

### Scenario: Verifier template contains the path-discipline rule
- GIVEN the shipped `metta-verifier.md` agent template
- WHEN its Rules are read
- THEN the same shell-write path-discipline rule present in `metta-executor.md` — change_root-anchored bash writes, forbidden outside-change_root writes, STOP-and-report on silent-write anomalies — is present


## ADDED: Requirement: Execute Skill Contract Binds Executors to Path Discipline and Escalates STOP-Reports

The `metta-execute` skill template (`src/templates/skills/metta-execute/SKILL.md`) MUST state in
its executor-spawn contract that spawned executors are bound by change_root path discipline, and
MUST instruct the orchestrator that an executor STOP-report about non-landing Edit/Write results
is escalated to the user. The skill MUST NOT instruct or permit the orchestrator to work around
such a report — e.g. by re-dispatching the executor with instructions to write via bash, or by
performing the write itself outside the worktree.
Trace: intent Proposal 1 (skill contract); US-1 acceptance criterion 4.

### Scenario: Skill contract escalates a silent-write STOP-report
- GIVEN the `metta-execute` skill template and an executor STOP-report about non-landing edits reaching the orchestrator
- WHEN the orchestrator consults the skill's instructions for what to do
- THEN the skill directs escalation to the user and contains no instruction to work around the anomaly via bash writes or orchestrator-performed writes outside the change worktree

### Scenario: Spawn contract names the path-discipline binding
- GIVEN the `metta-execute` skill template's executor-spawn contract
- WHEN it is read
- THEN it states that executors are bound by change_root path discipline for all shell writes


## ADDED: Requirement: Guard-Bash Blocks Bash Write Targets That Resolve Into the Main Checkout

When the session has a worktree-hosted active change context, the guard-bash hook
(`.claude/hooks/metta-guard-bash.mjs`) MUST extract candidate write targets from the evaluated
Bash command — output redirections (`>`, `>>`), heredoc targets, `tee` argument paths, and the
destination arguments of `cp` and `mv` — and MUST block (exit 2) any command whose extracted
absolute target resolves inside the main checkout root but outside the change worktree and
outside legitimately-shared paths. The rejection stderr MUST name the offending target path and
the expected change_root prefix so the caller can correct the command. A write targeting a path
inside the active change's own worktree checkout MUST NOT be blocked by this check.
Trace: intent Problem defect 2 (guard-bash blind to write targets); intent Proposal 2; US-2.

### Scenario: Redirection into the main checkout is blocked with a diagnostic
- GIVEN an active worktree-hosted change and a Bash command redirecting output (`>` or `>>`) to an absolute path inside the main checkout root but outside the change worktree
- WHEN the guard evaluates the command
- THEN the guard exits 2 and stderr names the offending path and the expected change_root prefix

### Scenario: Heredoc, tee, cp, and mv targets are covered
- GIVEN an active worktree-hosted change
- WHEN a Bash command writes into the main checkout via a heredoc target, a `tee` argument, or a `cp`/`mv` destination argument resolving to an absolute main-checkout path outside the worktree
- THEN each form is blocked with exit 2 and the same diagnostic shape as the redirection case

### Scenario: Writes inside the change's own worktree pass
- GIVEN an active worktree-hosted change
- WHEN a Bash command writes via any of the covered forms to an absolute path inside the change's own worktree checkout
- THEN the write-target check does not block the command

### Scenario: No worktree-hosted active change means no write-target check
- GIVEN a session with no worktree-hosted active change context (no active change, or an active change hosted in the main checkout)
- WHEN any bash write command is evaluated
- THEN the write-target check does not apply and imposes no block


## ADDED: Requirement: Write-Target Heuristic Fails Open on Unparseable Commands and Ignores Non-Write Commands

The write-target check MUST be explicitly heuristic and fail open: any command whose write
targets the heuristic cannot confidently resolve — command substitution, compound or exotic
quoting, `eval`/`xargs` indirection, arbitrary interpreters writing files (e.g. `python -c`),
or unknown commands — MUST be allowed rather than blocked. Commands that perform no file writes
MUST NOT be affected by the check at all. The check MUST NOT block relative-path writes (only
absolute targets resolving into the main checkout are in scope) and MUST NOT block writes to
legitimately-shared paths. A full bash parser is explicitly out of scope; the fail-open set is
an accepted residual, consistent with the guard's tolerant philosophy.
Trace: intent Proposal 2 (fail-open philosophy); intent Out of Scope (no full bash parser); US-3.

### Scenario: Unresolvable write targets fail open
- GIVEN an active worktree-hosted change and a Bash command whose write target cannot be confidently resolved (command substitution in the target, exotic quoting, or an arbitrary interpreter performing the write)
- WHEN the guard evaluates the command
- THEN the command is allowed — the heuristic fails open rather than guessing

### Scenario: Non-write commands are untouched
- GIVEN an active worktree-hosted change and a Bash command that performs no file writes (e.g. `git status`, `npm test`, `ls`)
- WHEN the guard evaluates the command
- THEN the write-target check imposes no block and adds no rejection path for it


## ADDED: Requirement: Write-Target Check Leaves Existing Guard-Bash Behavior Unchanged

Adding the write-target check MUST be behavior-preserving for every existing guard-bash path:
the Tier-1 fork-identity authorization, the Tier-2 session-credential mechanism, the
allow/block/unknown subcommand classification lists, tokenization and chain-separator
segmentation, the background-Bash rejection, and audit logging MUST all be unchanged. No metta
subcommand moves between tiers or lists in this change, and projects without an active
worktree-hosted change MUST observe no new blocking behavior of any kind.
Trace: intent Impact (existing metta-CLI authorization tiers untouched); US-3 acceptance criterion 3.

### Scenario: Pre-existing guard-bash test suite passes unmodified
- GIVEN the full pre-existing guard-bash test coverage for tier authorization, classification, tokenization, and background-Bash rejection
- WHEN the suite runs against the hook with the write-target check added
- THEN every pre-existing test passes without modification to its expected outcomes

### Scenario: metta CLI invocations are classified exactly as before
- GIVEN a `metta <cmd>` invocation of any allowed, blocked, or unknown subcommand
- WHEN the guard evaluates it after the write-target check is added
- THEN the allow/block/fail-closed outcome and rejection reason are identical to pre-change behavior


## ADDED: Requirement: Write-Target Check Ships in the Hook Template

The write-target check MUST be mirrored into the shipped guard-bash hook template (the template
counterpart of `.claude/hooks/metta-guard-bash.mjs` copied to `dist/` at build time, per the
template-files convention), so consumer projects installing or updating metta receive the
protection. The repo-local hook and the shipped template MUST carry the same write-target
behavior.
Trace: intent Proposal 2 (template mirror); US-2 acceptance criterion 4.

### Scenario: Consumer install receives the write-target check
- GIVEN the shipped hook template set after this change
- WHEN a consumer installs metta and the guard-bash hook is placed in their project
- THEN the installed hook includes the write-target check with the same block/fail-open behavior as metta's own repo-local hook


## ADDED: Requirement: Main-Checkout Cleanliness Baseline Is Recorded Before Worktree Execution

Before implementation execution begins on a worktree-hosted change, the pipeline MUST record a
baseline of the MAIN checkout's working-tree state via `git status --porcelain
--untracked-files=no` run against the main checkout root. The baseline MUST be persisted as
Zod-validated state under `.metta/` and implemented as a reusable TypeScript module following
the functional-core/imperative-shell convention (pure baseline/compare logic, I/O at the
edges). Pre-existing dirt captured in the baseline MUST be surfaced as a warning at recording
time, not a hard block (see the pre-existing-dirt requirement below). Non-worktree changes MUST
NOT record a baseline and MUST see no behavior change.
Trace: intent Problem defect 3 (no cross-checkout contamination detection); intent Proposal 3; US-4, US-5.

### Scenario: Baseline is recorded as validated state at execution start
- GIVEN a worktree-hosted change about to begin implementation execution
- WHEN execution starts
- THEN a `git status --porcelain --untracked-files=no` baseline of the main checkout is recorded as Zod-validated state under `.metta/`

### Scenario: Non-worktree changes skip the baseline
- GIVEN a change hosted in the main checkout (no worktree)
- WHEN implementation execution starts
- THEN no main-checkout baseline is recorded and execution proceeds exactly as before this change


## ADDED: Requirement: Implementation Completion Fails on New Main-Checkout Dirt

At implementation completion for a worktree-hosted change — the `metta complete implementation`
handling — the pipeline MUST re-run `git status --porcelain --untracked-files=no` against the
main checkout and compare against the recorded baseline. If the main checkout carries
modifications not present in the baseline (newly-dirty paths attributable to the execution
window), completion MUST fail with a diagnostic listing exactly the newly-dirty paths. The
failure MUST NOT attempt automatic remediation of the main checkout — restoring it stays a
human decision, per the no-destructive-git-ops constraint. A clean comparison (no new dirt)
MUST allow completion to proceed unchanged, and non-worktree changes MUST bypass the check
entirely.
Trace: intent Proposal 3; intent Out of Scope (no automatic remediation); US-4.

### Scenario: New main-checkout dirt fails completion with the offending paths
- GIVEN a worktree-hosted change whose execution window modified files in the main checkout that were clean in the baseline
- WHEN `metta complete implementation` runs
- THEN completion fails and the diagnostic lists the newly-dirty main-checkout paths

### Scenario: Clean run completes unchanged
- GIVEN a worktree-hosted change with a recorded baseline and no new main-checkout modifications during execution
- WHEN `metta complete implementation` runs
- THEN the cleanliness check passes and completion behavior is identical to pre-change behavior

### Scenario: Detection never mutates the main checkout
- GIVEN a completion failed by the cleanliness check
- WHEN the failure path is inspected
- THEN it performs no git operation that modifies the main checkout's working tree — it reports and fails only


## ADDED: Requirement: Ship Preflight Verifies Main-Checkout Cleanliness for Worktree-Hosted Changes

For a worktree-hosted change entering ship, the merge-safety pipeline
(`src/ship/merge-safety.ts`) MUST include an early preflight step that checks the MAIN
checkout's cleanliness in addition to the existing preflight check on the checkout being
shipped (today's `git status --porcelain --untracked-files=no` at the preflight step). Newly-
dirty main-checkout paths (relative to the recorded baseline, when one exists) MUST fail the
preflight with a step result whose detail names the paths, consistent with the existing
`MergeSafetyStep` result shape. For non-worktree ships, the existing steps, their ordering
semantics, and the result shape MUST be unchanged. (This step lives in a `finalize-ship`
surface; its requirement is carried here under orchestration-guard as the delta's single
capability.)
Trace: intent Proposal 3 (ship preflight); intent Impact (merge-safety scope); US-4 acceptance criterion 3.

### Scenario: Ship preflight catches main-checkout contamination
- GIVEN a worktree-hosted change entering ship with newly-dirty paths in the main checkout
- WHEN the merge-safety preflight runs
- THEN a main-checkout cleanliness step fails before the merge proceeds, with a detail naming the dirty paths

### Scenario: Non-worktree ships are unchanged
- GIVEN a ship of a change hosted in the main checkout
- WHEN the merge-safety pipeline runs
- THEN the step sequence, ordering semantics, and result shape are identical to pre-change behavior


## ADDED: Requirement: Pre-Existing Main-Checkout Dirt Warns but Never Hard-Blocks

A main checkout that is already dirty before worktree execution begins — the user's own
in-flight edits — MUST NOT hard-block execution, completion, or ship. The baseline comparison
MUST attribute dirt to the execution window: paths dirty in the baseline are pre-existing and
surfaced as warnings only; only paths that became dirty (or changed state) after the baseline
MUST count as contamination. A completion or ship failure diagnostic MUST list only the new
paths, never the pre-existing ones.
Trace: intent Proposal 3 (baseline comparison flags only NEW dirt); US-5.

### Scenario: Pre-existing dirt produces a warning at execution start
- GIVEN a main checkout with pre-existing uncommitted modifications to tracked files
- WHEN worktree execution begins and the baseline is recorded
- THEN the pre-existing dirt is captured in the baseline and surfaced as a warning, and execution is not blocked

### Scenario: Completion passes with pre-existing dirt and no new dirt
- GIVEN that same pre-existing dirt and no additional main-checkout modifications during execution
- WHEN `metta complete implementation` runs
- THEN the cleanliness check passes

### Scenario: Only new paths appear in the failure diagnostic
- GIVEN pre-existing dirt plus exactly one new file modified in the main checkout during the execution window
- WHEN completion runs and fails the cleanliness check
- THEN the diagnostic lists only the one new path, not the pre-existing dirty paths


## ADDED: Requirement: Tests Cover Write-Target Classification and Tree-Clean Detection

The test suite MUST cover the new surfaces at the near 1:1 test-to-source ratio: (a) unit tests
for the guard-bash write-target extraction and classification — an allowed-vs-blocked matrix
spanning redirection, heredoc, `tee`, `cp`/`mv` forms, worktree-internal targets, and the
fail-open cases (unparseable targets, non-write commands, no worktree-hosted change context) —
following the existing hook test harness pattern; (b) unit tests for the tree-clean
baseline/compare module, including pre-existing-dirt attribution and the new-dirt-only
diagnostic; and (c) tests for the merge-safety preflight addition, including the non-worktree
unchanged-behavior case. The blocking tests MUST be demonstrably capable of failing against the
pre-change hook and pipeline behavior.
Trace: intent Tests section; US-2, US-3, US-4, US-5 independent test criteria.

### Scenario: Write-target matrix distinguishes blocked from allowed
- GIVEN the guard-bash write-target unit tests
- WHEN the allowed-vs-blocked matrix runs
- THEN main-checkout-targeting redirection/heredoc/`tee`/`cp`/`mv` cases assert exit-2 blocks with path-naming diagnostics, and worktree-internal, unparseable, non-write, and no-worktree-context cases assert the command passes

### Scenario: Baseline/compare module tests cover dirt attribution
- GIVEN the tree-clean module's unit tests
- WHEN they run against baselines with clean, pre-dirtied, and newly-dirtied main-checkout states
- THEN they assert warnings for pre-existing dirt, failure listing only new paths for execution-window dirt, and a pass for the clean case

### Scenario: New blocking tests fail against pre-change behavior
- GIVEN the write-target block tests and the completion/ship contamination tests
- WHEN they are run against the pre-change hook and pipeline
- THEN they fail, demonstrating each would have caught the zeus contamination incident
