# Guard-edit worktree Write friction caused cross-repo contamination of consumer main working tree

**Captured**: 2026-08-18
**Status**: logged
**Severity**: major

## Symptom

Reported by the zeus consumer session (2026-08-18). Inside a metta change worktree, `Edit`/`Write` tool calls silently no-opped: the tool reported success but the worktree file on disk stayed pristine — a new variant distinct from the fixed exit-2 inverted-topology block (PR #90, which zeus had installed). Seeing its edits not land, the metta-executor fell back to the entrenched write-via-bash-script workaround using ABSOLUTE paths that resolved into the MAIN checkout: `/home/utx0/Code/zeus/src/config.rs` and `config_registry.rs` were modified in main's working tree while the executor's git commits landed on the change worktree branch. The code it committed was never the code it wrote to disk, and main was silently contaminated. The operator caught it by eye, restored main; the change branch survived intact. This is the third distinct worktree-write failure mode after metta-guard-edit-hook-is-worktree-blind (2026-08-08, resolved) and the inverted-topology false positive (PR #90, resolved), with guard-edit-worktree-name-match-hardening-follow-up still open.

## Root Cause Analysis

Three compounding defects. (A) Silent-success/no-write: the guard-edit hook itself cannot produce this — it is a pure PreToolUse allow/block gate that only ever exits 0 (allow) or 2 (block) and never emits hook JSON output that could rewrite tool input, so a "success" tool result that leaves no disk write must arise from the harness side — most plausibly the Claude Code worktree file-tracking layer (EnterWorktree/checkpointing) interacting with the hook's exit-0 path, or allow-with-modified-input semantics elsewhere in the hook chain. Reproduction across worktree topologies is required; metta has no test coverage for this interaction. (B) The fallback was unguarded: the executor agent template contains zero path discipline — no requirement that shell writes use change_root-relative paths, no prohibition on absolute-path writes outside change_root — and `metta-guard-bash.mjs` (489 lines) analyzes only `metta` CLI invocations, performing no redirection/heredoc/tee target analysis, so a bash write into the main checkout during a worktree-hosted change passes clean. (C) No post-run tree-clean verification: the only `git status --porcelain` check in the pipeline runs at ship-merge preflight; nothing checks the MAIN checkout at executor completion, so cross-checkout contamination stays invisible until a human looks.

### Evidence

- `.claude/hooks/metta-guard-edit.mjs:97` — the hook's entire flow after stdin parse is exit-0 allow or exit-2 block with a stderr message; it never emits modified-input JSON, so the silent-success/no-write variant cannot originate in this hook's own code and points at harness worktree file-tracking interaction.
- `src/templates/agents/metta-executor.md:22` — the executor Rules section has no path discipline: nothing requires worktree-anchored relative paths for shell writes and nothing forbids absolute-path writes outside change_root, leaving the heredoc/script fallback free to target the main checkout.
- `src/ship/merge-safety.ts:123` — `git status --porcelain --untracked-files=no` runs only as ship-merge preflight; there is no main-checkout cleanliness check in the executor completion contract, so zeus's contamination was catchable only by human eyes.

## Candidate Solutions

1. **Reproduce and fix the silent-success/no-write Edit path** — Build an instrumented repro harness that exercises Edit/Write across the full worktree topology matrix (canonical, inverted-hosting, symlinked session paths, harness-managed vs metta-managed worktrees) and captures tool result vs on-disk state, then fix or document the harness interaction; fold the matrix into a consolidated worktree-write-reliability capability spec so all three historical failure modes get exhaustive regression coverage. Tradeoff: the root cause likely lives in Claude Code harness internals (worktree file tracking) outside metta's control, so the outcome may be a detection/mitigation layer rather than a true fix, and the repro may be nondeterministic.

2. **Path discipline plus guard-bash write-target check** — Amend executor/verifier agent templates and skill instructions to REQUIRE change_root-relative, worktree-anchored paths for ANY shell write and forbid absolute-path writes outside change_root; extend metta-guard-bash with a content check that blocks bash commands whose redirection/heredoc/tee/cp targets resolve into the main checkout while the active change is worktree-hosted. Tradeoff: shell write-target extraction is inherently heuristic (guard-bash already documents brace-group and escaped-quote residual gaps), so false negatives remain possible and false positives could block legitimate writes, reinforcing the workaround culture the fix targets.

3. **Post-run main-checkout tree-clean verification** — Add a `git status --porcelain` check on the MAIN checkout to the executor completion contract and to the orchestrator ship steps, failing loudly on unexpected modifications whenever the active change is worktree-hosted; record a pre-execution baseline so pre-existing operator dirt is distinguished from executor-introduced contamination. Tradeoff: detection, not prevention — the contamination has already happened when it fires, and baseline bookkeeping adds state that can itself go stale or misattribute legitimate concurrent operator edits in main.

