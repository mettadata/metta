# Research: Option 3 — Canonical State Hosting

Evaluated approach: guarantee the worktree always carries its own change state by (a) committing `spec/changes/<name>/` into the change branch at propose/quick time and (b) repairing missing worktree state on worktree re-creation/access — so that the PR #57 canonical-topology fix in `metta-guard-edit.mjs` suffices and the inverted-hosting topology never blocks.

## 1. Trace: where change state is written today, and when it is committed

All references are to the change worktree checkout at `/home/utx0/Code/metta/.metta/worktrees/fix-metta-guard-edit-still-false-positive-blocks-subagent`.

**Creation (propose/quick).** Both commands derive the change name first, create the worktree, then write state *inside the worktree*:

- `src/cli/commands/propose.ts:59-76` and `src/cli/commands/quick.ts:32-48` — `setupChangeWorktree(ctx.projectRoot, changeName, config.git)` runs BEFORE any state write; then `workCtx = gitSetup.worktree !== null ? createCliContext(gitSetup.worktree) : ctx`, and `workCtx.artifactStore.createChange(...)` writes `spec/changes/<name>/.metta.yaml` into the **worktree's working tree**.
- `src/artifacts/artifact-store.ts:76-134` (`createChange`) performs a validated `StateStore.write` only — **no git add/commit**. The state file is born as an *untracked* file in the worktree.
- `src/util/git-worktree.ts:90-136` (`setupChangeWorktree`) — modes: `created` (new branch via `worktree add -b`), `attached` (branch exists), `reused` (worktree dir exists), `fallback` (in-place `checkout -b` on the MAIN checkout when worktrees are disabled or `worktree add` fails), `skipped`.

**First commit of state.** `metta complete` is the first thing that tracks the state directory: `src/cli/commands/complete.ts:621-629` does `git add spec/changes/<name>` + `git commit -m "docs(<name>): complete <artifactId>"` with `cwd = changeRoot` (the worktree for hosted changes). So:

- **The `.metta.yaml` IS eventually committed to the change branch — but only from the first `metta complete` onward.** Between change creation and the first complete (which in a quick-workflow change is essentially the entire execution phase), the state exists only as an untracked working-tree file in the worktree.
- Finalize commits the archive move (`src/cli/commands/finalize.ts:207-223`, `chore(<name>): archive and finalize`, `cwd = hostRoot`).

**Discovery is one-directional.** `resolveProjectRoot` (`src/cli/helpers.ts:53-65`) stops at the worktree's `.git` file; `ArtifactStore.discoverChanges` (`src/artifacts/artifact-store.ts:202-271`) aggregates local changes plus `<root>/.metta/worktrees/*/spec/changes/`, but a store rooted AT a worktree never looks back at the parent checkout. This is the asymmetry the hook trips over (`.claude/hooks/metta-guard-edit.mjs:94-116`): probe cwd = target's checkout root → empty envelope → hard block.

### Why the inverted topology arises at all

Current propose/quick **do not produce** the inverted topology — they write state into the worktree (canonical). The generators are:

1. **Legacy changes / older installed CLIs.** Worktree-hosted state creation shipped in the archived change `spec/archive/2026-07-25-when-starting-change-propose-quick-create-git-worktree/` — whose summary explicitly lists **"migration of in-flight changes"** as deferred out of scope. Any change created before a consumer's CLI picked that up has state at the main root; if a worktree exists (or is later attached) for it, the topology is inverted. Zeus's report confirms *fresh hooks*, not a fresh CLI or a freshly created change — this is the most plausible genesis for the live incident.
2. **A still-live current-code sequence (reconstructed):** `metta quick X` hits the fallback path (`worktree add` fails → in-place `checkout -b` on main, `src/util/git-worktree.ts:143-154`) → state written to the MAIN checkout's `spec/changes/X/` and never committed to the branch. User switches main back to `main` (untracked state travels with the working tree). A later `metta quick X` re-run: `setupChangeWorktree` now succeeds in `attached` mode (branch exists, dir doesn't) — the branch it checks out **does not contain the state** — then `createChange` throws `Change 'X' already exists` (`artifact-store.ts:89-94`, main-local copy found), leaving behind exactly: main hosts state, attached worktree carries none. Inverted.
3. **Worktree loss during the untracked window.** Between creation and first `complete`, deleting the worktree dir and re-attaching the branch (manually or via a future cleanup flow) drops the state from the worktree because it was never committed. (This particular sequence loses the state entirely rather than inverting it, but it is the window the creation-time commit closes.)

The reproduction fixture at `/tmp/claude-1000/-home-utx0-Code-metta/f721eca9-fa6e-4c82-bcc1-bfdab33150f2/scratchpad/consumer` is a hand-built minimal instance of the end state: main checkout on `main` hosting `spec/changes/demo-change/.metta.yaml` (quick workflow, `current_artifact: tasks`), plus a real linked worktree at `.metta/worktrees/demo-change/` (gitdir pointer into `.git/worktrees/demo-change`, branch `change`) whose checkout has `spec/issues/` but **no `spec/changes/`**. It does not encode a genesis sequence — it asserts the topology directly.

## 2. Implementation sketch

Two parts, both required for the option to mean anything:

**Part A — commit state at creation (closes generator 3, hardens 2).**

- After `createChange` in `propose.ts` / `quick.ts` (worktree mode only): scoped `git add spec/changes/<name>` + `git commit -m "chore(<name>): create change state"`, `cwd = gitSetup.worktree`, best-effort with swallowed failures — mirroring the existing `complete.ts:621-629` pattern (NOT `autoCommitFile`, whose other-dirty-tracked-files guard would refuse in `reused`/`attached` worktrees carrying in-flight work). A small helper (e.g. `commitChangeScope(root, name, message)`) shared with `complete.ts` fits the "consolidate-git-commit" TODO at `helpers.ts:207`.
- Effect: the change branch carries `spec/changes/<name>/.metta.yaml` from birth; any future `git worktree add` from that branch reproduces the canonical topology.

**Part B — repair for existing inverted changes.** This is where the option gets hard:

- `setupChangeWorktree`'s `attached`/`reused` modes could copy `<projectRoot>/spec/changes/<name>/` into the worktree when the worktree lacks it — but **that path is unreachable for an existing change**: propose/quick call `createChange` immediately after, which throws `already exists`, and nothing else calls `setupChangeWorktree`. `metta cleanup` is a stub (`src/cli/commands/cleanup.ts` — hardcoded zero-work output). So "repair on worktree re-creation" has no existing trigger point.
- Repair-on-access is the realistic variant: in main-rooted read/orchestration commands (`instructions`, `status`, `complete`), detect *local change `<name>` exists AND `.metta/worktrees/<name>/` exists AND the worktree lacks `spec/changes/<name>/.metta.yaml`* → copy (or `git mv`-equivalent migrate) the state into the worktree and commit there. Detection is convention-based and feasible; `findWorktreeHost` / `discoverChanges` already walk the right directories.
- Fatal asymmetry: **the hook's own probe cannot trigger repair.** The probe runs `metta status --json` with cwd = the worktree; a worktree-rooted store cannot see the main checkout without Option 2's bidirectional machinery. Repair only happens when some main-rooted metta command runs between now and the subagent's edit. Skill-driven flows do call `metta instructions` from the session root before dispatching subagents, so in practice healing would usually precede the edit — but this is a behavioral dependency on orchestration discipline, not a guarantee, and a mid-execution subagent retry after a fresh block gets nothing.

## 3. Does it satisfy this change's spec?

**Not as written.** `spec.md` requirement 1 ("Worktree Edits Are Allowed Under the Inverted-Hosting Topology", scenarios at lines 9-27) constructs the inverted state as a GIVEN and requires the hook to exit 0 *in that topology*. Option 3 never makes the hook allow in that topology — it prevents or heals the topology. The mandated regression test ("inverted-topology test catches the original defect", spec lines 84-88) cannot pass under Option 3 without inserting a repair step into the arrangement, which changes what is being tested. Choosing Option 3 standalone means rewriting the spec's acceptance shape, or pairing it with Option 1/2. The spec's own framing ("visible from either the target's checkout or the session's checkout") presumes a probe-side fix.

## 4. Migration hole

Acknowledged in the intent (line 21) and confirmed by the trace:

- In-flight inverted changes in consumers (zeus's live case) get nothing from Part A. Part B heals them only after (i) the consumer upgrades the **CLI**, not just the hooks — a heavier distribution step than Options 1/2's hook-only or hook+CLI paths — and (ii) a main-rooted repair-triggering command runs.
- The intent's Out of Scope explicitly excludes building migration tooling ("Migrating or repairing existing in-flight inverted-state changes … no separate migration tooling is built"), which is in direct tension with Part B being the only piece of this option that addresses the reported incident.

## 5. Commit side effects and finalize interaction

- **Extra commit per change creation** on the change branch (`chore(<name>): create change state`). Benign: `complete` already produces `docs(<name>): complete <artifact>` commits on the same branch; ship/merge carries them to main; finalize's archive commit (`finalize.ts:207-223`) already scopes `git add` to the touched paths and will record the `spec/changes/<name>` deletion identically whether the files became tracked at creation or at first complete.
- **`.metta.yaml` tracked from birth** means every `updateChange`/`markArtifact`/tokens write dirties a tracked file mid-flight. `autoCommitFile`'s dirty-tree guard operates in the MAIN checkout for main-rooted commands (issue/roadmap/refresh), so it is unaffected; but any future clean-tree precondition on the worktree (merge-safety checks at ship) will see a dirty tracked file where it previously saw an untracked one — needs a check against `MergeSafetyPipeline` expectations during design if this option proceeds.
- Fallback mode (no worktree) must skip Part A's commit entirely — committing state onto a branch the MAIN checkout is sitting on is the historical in-place behavior and must not gain a surprise auto-commit.
- `finalize`/spec merging is otherwise untouched: `hostRoot` resolution via `getChange`'s injected host is unchanged, and for legacy main-hosted changes finalize already correctly operates at the main root.

## 6. Test strategy

- **Part A:** extend `tests/cli-propose-worktree.test.ts` — after `metta quick`/`propose`, assert the branch contains the state (`git ls-tree metta/<name> -- spec/changes/<name>/.metta.yaml`), and assert a fresh `git worktree add` of the branch into a new dir reproduces the canonical topology.
- **Part B:** build the inverted fixture exactly as the scratchpad consumer does (main hosts state on `main`; attached worktree without `spec/changes/`), run the repair-triggering command from the main root, assert state lands and is committed in the worktree, then run the **real hook against the real CLI** (no shim) and assert exit 0.
- **Spec-mandated regression test:** the current suite's shim answers by cwd (`tests/metta-guard-edit.test.ts:252-264`) and cannot express the asymmetry. A real-CLI harness is needed under ANY option and is a shared cost. Under Option 3 specifically, the pre-fix-fails test (spec lines 84-88) only works if the test asserts "inverted + repair command → allow", which is a weaker and spec-divergent statement than "inverted → allow".
- Fallback-mode and reused/attached-mode propose tests to confirm Part A never commits in the main checkout and never fails change creation on git errors.

## 7. Effort estimate

- Part A (creation-time commit + tests): ~0.5 day. Low risk.
- Part B (repair-on-access: detection, copy+commit plumbing, trigger-point selection, tests across attached/reused/legacy fixtures): ~1.5-2 days. Medium risk — read commands acquiring git-write side effects is a behavioral change needing careful scoping.
- Real-CLI hook regression harness (shared with other options): ~0.5-1 day.
- Total: **~2.5-3.5 days**, versus roughly a day for Option 1 including the shared harness.

## 8. Pros / cons

**Pros**
- Attacks the root cause (state not durable in the branch) rather than the symptom; aligns with "git as the transaction log".
- Zero widening of the guard's allow surface — the hook logic is untouched; best security posture of the three options.
- Part A is cheap, independently valuable hardening (survives worktree re-creation; makes `git worktree remove` cleaner), and composes with Option 1 or 2.
- Also fixes `metta instructions`/`tokens record` from worktree cwds for new changes (they see local state).

**Cons**
- **Does not satisfy the spec as written**: the hook still blocks whenever the inverted topology exists at edit time; the acceptance scenarios and the mandated regression test presume a probe-side fix.
- **Does not help zeus's live incident** without Part B *and* a consumer CLI upgrade *and* a main-rooted command running first — a chain of preconditions where Option 1 needs only a hook refresh.
- Repair has no natural trigger today (`setupChangeWorktree` is unreachable for existing changes; `cleanup` is a stub); repair-on-access puts git writes inside read paths and leans on orchestration discipline for timing.
- Tension with the intent's Out of Scope (no migration tooling) — the only part of this option that addresses the report is, functionally, migration tooling.
- Cannot protect against generator 2's variant where `createChange` throws after attaching a bare worktree — that needs its own fix regardless.

## 9. Recommendation score

**3 / 10** as the selected approach for this change.

Rationale: Option 3 is prevention, not cure. Current propose/quick already produce the canonical topology, so the marginal prevention value is the untracked-window and re-creation edge cases; meanwhile the reproduced, spec-encoded failure — an inverted topology that already exists at edit time — still blocks, the mandated regression test cannot pass in its specified form, and the live consumer incident is only resolved through a repair mechanism the intent's Out of Scope discourages, gated on a CLI upgrade. Recommend **against** selecting Option 3 standalone; recommend Part A (creation-time scoped commit, ~0.5 day) as a low-cost hardening companion to whichever probe-side fix (Option 1 or 2) is selected, since it shrinks the population of future inverted/lost-state changes at negligible cost.
