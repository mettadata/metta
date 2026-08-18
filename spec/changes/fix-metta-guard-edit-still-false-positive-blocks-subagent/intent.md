# fix-metta-guard-edit-still-false-positive-blocks-subagent

## Problem

Subagents in consumer projects are still false-positive blocked by the `metta-guard-edit` PreToolUse hook when writing or editing files under `.metta/worktrees/<change>/` — the exact symptom PR #57 (fix-metta-guard-edit-worktree-blind, 2026-08-08) was supposed to end. Reported live by the zeus consumer session on 2026-08-18, running freshly installed hooks (not a stale copy): the hook exits 2 with "no active metta change", and subagents fall back to bash heredocs to get their edits through — bypassing the guard entirely and degrading edit quality and auditability.

The root cause is a topology asymmetry, reproduced exactly in a consumer-shaped fixture. PR #57's fix handles the canonical topology, where the change's state (`spec/changes/<name>/.metta.yaml`) lives inside the worktree's own checkout. What still blocks is the **inverted-hosting topology**: the change state lives in the MAIN checkout's `spec/changes/` while the edit target lives under `.metta/worktrees/<change>/`. The hook resolves the target's git toplevel (the worktree), runs `metta status --json` with cwd there, and the CLI's `resolveProjectRoot` stops at the worktree's `.git` without consulting the parent checkout (`src/cli/helpers.ts:58-64`). Change discovery is one-directional: the main root aggregates `<root>/.metta/worktrees/*/spec/changes/` (`src/artifacts/artifact-store.ts:208-220`), but a worktree-rooted store never looks back at the main checkout. The worktree therefore reports the empty envelope `{"changes":[],"message":"No active changes"}` — and that empty envelope is the hook's ONLY fail-closed path (`.claude/hooks/metta-guard-edit.mjs:94-116`). Every probe *failure* (metta missing, non-zero exit, schema error, timeout) fails open; only this successful-but-wrong-root answer hard-blocks. `metta status` from the session cwd (the main checkout) resolves the change fine, but the hook never asks that root.

Affected: every consumer project running metta's installed hooks where a change's worktree checkout does not carry its own change state — i.e., subagent-driven execution inside `.metta/worktrees/<change>/` during an active change. Zeus hit this in production use; any metta adopter using the worktree execution model can hit it.

A contributing gap: the guard-edit test suite's worktree-awareness tests (`tests/metta-guard-edit.test.ts:252-264`) substitute a shim `metta` binary that answers by cwd, so the real CLI's one-directional discovery asymmetry is never exercised by tests — which is how PR #57 shipped believing the topology was covered.

## Proposal

Eliminate the false-positive block for the inverted-hosting topology so that subagent Write/Edit calls targeting files under `.metta/worktrees/<change>/` are allowed whenever the change is active and visible from either the target's checkout or the session's checkout.

The approach decision is deliberately deferred to the research/design phase. Three candidate directions are on the table, to be evaluated (individually or in combination):

1. **Two-root probe with either-allows semantics (hook-level, minimal direct fix).** After a successful empty envelope from the target's checkout root, re-probe `metta status --json` with cwd set to the hook's session root (`process.cwd()`); allow if either root reports an active change. Fixes the reproduced topology without touching the CLI. Tradeoff: a second subprocess on the would-block path adds latency; slightly weakens the guard.
2. **Bidirectional CLI discovery.** Teach `resolveProjectRoot` / `ArtifactStore` that a worktree checkout whose own `spec/changes` is empty should resolve the parent main checkout (via the gitdir pointer or `git worktree list`) and aggregate its changes. Fixes the hook plus `metta instructions` / `metta tokens record` invoked from worktree cwds. Tradeoff: broadens status semantics for every CLI consumer; touches core resolution.
3. **Canonical state hosting.** Guarantee the worktree always carries its change state (commit `spec/changes/<name>/` into the worktree at propose/quick time; repair on worktree re-creation). Tradeoff: does not protect in-flight changes already in the inverted state; adds commit side effects to propose/quick.

Regardless of the chosen direction, this change MUST include a regression test that exercises the real CLI (or an equivalent faithful reproduction of its one-directional discovery) against the inverted-hosting topology — the current shim-based suite cannot catch this class of bug, and closing that test blind spot is in scope.

Acceptance shape (topology-level, approach-agnostic):

- Given a main checkout hosting `spec/changes/<name>/.metta.yaml` for an active change, and a worktree at `.metta/worktrees/<name>/` that does not carry that state, when a subagent issues Write/Edit against a file inside the worktree, then the guard-edit hook allows the edit (exit 0).
- Given the canonical PR #57 topology (state inside the worktree's own `spec/changes/`), when a subagent edits a worktree-hosted file, then the hook still allows — no regression.
- Given no active change in either the target's checkout or the session checkout, when a Write/Edit targets a guarded path, then the hook still blocks (exit 2) — the guard's protective behavior is preserved.
- Given any probe failure (metta missing from PATH, non-zero exit, invalid JSON, timeout), when the hook evaluates an edit, then it continues to fail open, unchanged.

## Impact

- **`.claude/hooks/metta-guard-edit.mjs`** — the probe/decision logic around lines 94-116 changes (directly under option 1; indirectly under options 2/3 its behavior changes because the CLI's answers change). The fail-open error handling and the init-phase allow-lists are preserved.
- **`src/cli/helpers.ts` (`resolveProjectRoot`) and `src/artifacts/artifact-store.ts` (change discovery)** — modified only if option 2 is selected; that would change `metta status`, `metta instructions`, and `metta tokens record` behavior when invoked from a worktree cwd (they would begin seeing main-checkout-hosted changes). Under options 1/3 these are untouched.
- **Propose/quick worktree-creation flow** — modified only if option 3 is selected (committing change state into the worktree; repair on re-creation).
- **`tests/metta-guard-edit.test.ts`** — the worktree-awareness suite is extended (or restructured) so the inverted-hosting topology is exercised against real discovery semantics, not a cwd-answering shim.
- **Consumer projects (zeus and others)** — after the fix ships and hooks are reinstalled, subagent Write/Edit inside `.metta/worktrees/<change>/` works during active changes; the heredoc fallback workaround becomes unnecessary.
- **Guard security posture** — either-allows semantics (option 1) marginally widens the allow surface: an edit into a worktree is permitted when only the session root has an active change. This is the intended behavior for the reproduced topology; research must confirm it does not open unintended paths (e.g., edits into unrelated checkouts).
- **Specs** — the `orchestration-guard` capability spec (and `artifact-store`/`state-store` if option 2 lands) gains requirements covering the inverted-hosting topology.

## Out of Scope

- **Redesigning the guard's trust model** — the two-tier skill authorization (metta-guard-bash, session tokens, fork-tier identity) is untouched; this change only fixes the guard-edit active-change probe.
- **Changing the fail-open policy for probe failures** — probe errors (metta missing, timeout, bad JSON) continue to fail open; hardening those paths is a separate concern.
- **The init-phase allow-list and `spec/issues/` prefix allow-list** — their contents and semantics are unchanged.
- **General multi-repo or nested-worktree support** — only the metta-managed `.metta/worktrees/<change>/` topology is addressed; arbitrary user-created git worktrees outside that layout are not a target.
- **Fixing `metta instructions` / `metta tokens record` from worktree cwds as a goal in itself** — if option 2 is chosen they improve as a side effect, but this change is not committed to delivering that unless the design selects that direction.
- **Migrating or repairing existing in-flight inverted-state changes in consumer projects** — beyond whatever the selected fix inherently handles, no separate migration tooling is built.
- **Hook installation/distribution mechanics** — how consumers receive updated hooks (install/refresh flow) is unchanged; zeus's report confirms the hooks were fresh, so distribution is not the defect.
