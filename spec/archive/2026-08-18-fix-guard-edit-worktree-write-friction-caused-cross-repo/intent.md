# fix-guard-edit-worktree-write-friction-caused-cross-repo

> Fixes issue: `spec/issues/guard-edit-worktree-write-friction-caused-cross-repo.md` (severity: major)

## Problem

During a worktree-hosted metta change on the zeus consumer project (2026-08-18), `Edit`/`Write` tool calls inside the change worktree reported success while leaving the worktree files on disk untouched — a silent-success/no-write variant distinct from the already-fixed exit-2 inverted-topology block (PR #90). Seeing its edits not land, the metta-executor fell back to writing files via bash (heredoc/script) using absolute paths that resolved into the MAIN checkout: `/home/utx0/Code/zeus/src/config.rs` and `config_registry.rs` were modified in main's working tree while the executor's commits landed on the worktree branch. The committed code was never the code written to disk, and main was silently contaminated — caught only by the operator's eyes.

Three compounding defects let this happen:

1. **Unguarded bash-write fallback.** The executor agent template (`src/templates/agents/metta-executor.md`) has no path discipline for shell writes — nothing requires change_root-anchored paths and nothing forbids absolute-path writes outside change_root. The `metta-execute` skill instructs the orchestrator to pass `change_root` into executor prompts, but the executor persona itself carries no corresponding rule.
2. **Guard-bash is blind to write targets.** `.claude/hooks/metta-guard-bash.mjs` analyzes only `metta <cmd>` invocations. A bash redirection, heredoc, `tee`, or `cp`/`mv` targeting the main checkout during a worktree-hosted change passes clean — no redirection/write-target analysis exists at all.
3. **No cross-checkout contamination detection.** The only `git status --porcelain` gate in the pipeline runs at ship-merge preflight against the checkout being shipped (`src/ship/merge-safety.ts:123`). Nothing verifies the MAIN checkout is still clean when an executor working in a worktree finishes, so contamination stays invisible until a human notices.

The upstream trigger — the silent-success/no-write Edit behavior — cannot originate in `metta-guard-edit.mjs` itself: after stdin parse the hook only ever exits 0 (allow) or 2 (block with stderr) and never emits hook JSON that could rewrite tool input. The defect lives in Claude Code harness internals (worktree file-tracking / checkpointing interacting with the exit-0 path), which metta cannot deterministically fix.

**Who is affected:** every consumer project running metta changes in worktrees (the default topology), plus metta's own development. Impact is data-loss class: silent divergence between committed code and on-disk code, plus unreviewed mutations to the main working tree.

## Proposal

Defense in depth: prevent the dangerous fallback (layers 1–2) and detect contamination if anything slips through (layer 3). This is the third worktree-write failure mode; the fix targets the parts metta controls.

### 1. Path discipline in agent templates and skill instructions (prevention — instructions)

- Amend `src/templates/agents/metta-executor.md` Rules with explicit shell-write path discipline: all file writes performed via Bash (redirection, heredoc, `tee`, `cp`, `mv`, scripts) MUST target absolute paths under the `change_root` provided in the prompt; writing to any path outside `change_root` is forbidden. If `Edit`/`Write` tools report success but the target file is unchanged on disk (verify with `Read` or `cat` after a suspicious result), the executor MUST STOP and report the anomaly to the orchestrator instead of falling back to bash writes against re-derived paths.
- Apply the same shell-write path discipline rule to `src/templates/agents/metta-verifier.md` (the other persona that routinely holds Bash inside worktree-hosted changes and could repeat the fallback).
- Amend the `metta-execute` skill template (`src/templates/skills/metta-execute/SKILL.md`) so the orchestrator's executor-spawn contract states that executors are bound by change_root path discipline and that an executor STOP-report about non-landing edits is escalated to the user, not worked around.

### 2. Guard-bash write-target analysis (prevention — enforcement)

- Extend `.claude/hooks/metta-guard-bash.mjs` with a bash write-target check: when the session has a worktree-hosted active change context, extract candidate write targets from the command — output redirections (`>`, `>>`), heredoc targets, `tee` arguments, and destination arguments of `cp`/`mv` — and block (exit 2, actionable stderr naming the offending path and the expected change_root prefix) any absolute target that resolves inside the main checkout root but outside the change worktree and outside legitimately-shared paths.
- The check is explicitly heuristic and fails open on anything it cannot parse (compound quoting, command substitution, unknown commands), preserving the guard's tolerant philosophy: it must never block a write inside the active change's own checkout, non-file commands, or work in projects without an active worktree-hosted change.
- Mirror the change into the shipped hook template so consumer installs receive it (hooks are template files copied at build time, per convention).

### 3. Main-checkout tree-clean verification (detection)

- Add a main-checkout cleanliness check to the executor-completion path: before implementation execution begins on a worktree-hosted change, record a `git status --porcelain --untracked-files=no` baseline of the MAIN checkout; at executor completion (the `metta complete implementation` handling), re-run the check and fail the completion with a clear diagnostic listing the newly-dirty paths if the main checkout picked up modifications during execution. Implemented as a reusable TypeScript module (functional core, imperative shell) with Zod-validated state for the stored baseline, plus wiring into the completion command path.
- Add the same main-checkout check as an early ship preflight step for worktree-hosted changes in `src/ship/merge-safety.ts` (today's preflight only inspects the checkout being merged), so contamination that predates the fix or slips past layer 2 is caught before merge rather than after.
- A pre-existing dirty main checkout (user's own in-flight edits) must not hard-block execution — the baseline comparison flags only NEW dirt attributable to the execution window; pre-existing dirt is surfaced as a warning.

### Tests

Unit tests for the guard-bash write-target extraction/classification (allowed vs blocked matrix, fail-open cases), for the tree-clean baseline/compare module, and for the merge-safety step addition — maintaining the near 1:1 test-to-source ratio. Hook behavior tests follow the existing hook test harness pattern.

## Impact

- `.claude/hooks/metta-guard-bash.mjs` (and its shipped template counterpart) gains a new blocking class. Risk: heuristic false positives blocking legitimate bash writes; mitigated by scoping the check to worktree-hosted-active-change contexts only, restricting it to absolute-path targets inside the main checkout, and failing open on unparseable commands. The existing metta-CLI authorization tiers are untouched.
- `src/templates/agents/metta-executor.md` and `metta-verifier.md` grow new Rules entries; existing deviation rules and completion contract are unchanged. Executors will now STOP on silent-write anomalies instead of self-healing via bash — this trades autonomous progress for correctness, surfacing the harness bug to the user instead of contaminating checkouts.
- `src/templates/skills/metta-execute/SKILL.md` orchestrator instructions grow the path-discipline contract and the escalation rule.
- `metta complete implementation` handling gains a baseline/compare step for worktree-hosted changes; non-worktree changes and clean runs see no behavior change. New Zod-validated baseline state under `.metta/`.
- `src/ship/merge-safety.ts` gains one additional preflight step for worktree-hosted changes; existing steps, ordering semantics, and result shape for non-worktree ships are unchanged.
- No change to `metta-guard-edit.mjs` allow/block semantics — the exit-0/exit-2 contract stays as-is.

## Out of Scope

- **Fixing the silent-success/no-write Edit/Write behavior itself.** The root cause sits in Claude Code harness internals (worktree file-tracking / checkpointing); metta cannot deterministically fix it. This change mitigates (STOP-and-report instruction, post-write verification guidance) and detects; a repro harness across the worktree topology matrix is a separate investigation, to be logged upstream if reproduced.
- **A full bash parser for write-target extraction.** The guard-bash check is heuristic by design (redirections, heredocs, `tee`, `cp`/`mv` destinations); command substitution, `eval`, `xargs`, arbitrary interpreters (`python -c` writing files), and exotic quoting fail open and are not covered.
- **Guarding writes to unrelated third repos.** The write-target check scopes to the main-checkout-vs-worktree relationship of the active change; arbitrary cross-repo writes elsewhere on disk remain out of scope.
- **`guard-edit-worktree-name-match-hardening-follow-up`** — the still-open sibling issue remains a separate change.
- **Automatic remediation of detected contamination.** Detection fails the completion/ship step with a diagnostic; restoring the main checkout stays a human decision (per the no-destructive-git-ops constraint).
- **Retroactive scanning of consumer projects** for past contamination.
