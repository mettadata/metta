# Research: Option 2 — Bidirectional CLI Discovery

Change: `fix-metta-guard-edit-still-false-positive-blocks-subagent`
Evaluated approach: teach the CLI that a metta-managed worktree checkout should consult its parent main checkout during change discovery, so `metta status --json` invoked with cwd inside `.metta/worktrees/<change>/` sees main-hosted changes — fixing the guard-edit false positive with zero hook changes.

## 1. Current behavior (verified against source)

- `resolveProjectRoot` (`src/cli/helpers.ts:53-65`) walks up from cwd; returns the first dir with `spec/changes/`, else stops at the first dir with a `.git` entry and returns the start. From inside `.metta/worktrees/<name>/` the worktree root wins either way (its `.git` **file** stops the walk; if the worktree carries an empty `spec/changes/` that dir wins). The parent main checkout is never consulted.
- `ArtifactStore` discovery (`src/artifacts/artifact-store.ts:202-271`) is one-directional: a store gets a `worktreesDir` option (`createCliContext`, `helpers.ts:112-118`) and aggregates `<worktreesDir>/<name>/spec/changes/` **downward**. A worktree-rooted store has a `worktreesDir` pointing at `<worktree>/.metta/worktrees` (empty), so it lists only its own local changes — the empty envelope the hook hard-blocks on.
- The hook (`.claude/hooks/metta-guard-edit.mjs:94-116`) probes `metta status --json` at the **target's** git toplevel. The inverted topology (state in main's `spec/changes/`, target in the worktree) yields `{"changes":[]}` — the only fail-closed path.
- Reproduction fixture confirmed at the scratchpad `consumer/` dir: main hosts `spec/changes/demo-change/.metta.yaml`; the worktree at `.metta/worktrees/demo-change/` has `spec/issues/` but **no** `spec/changes/`. Its `.git` is a file: `gitdir: <main>/.git/worktrees/demo-change`, and `<gitdir>/commondir` contains `../..` — i.e. the parent root is fully recoverable from two sync file reads.

## 2. Implementation sketch

### 2a. Where the change goes: ArtifactStore aggregation, NOT resolveProjectRoot

Two candidate insertion points were evaluated:

**Rejected: redirect `resolveProjectRoot` to the parent main root.** Re-rooting the whole `CliContext` at main would silently relocate the config loader, `StateStore` (`.metta/`), issues/milestones/gaps stores, scratch/session-token paths, and every git side-effect cwd for **every** command run from a worktree — including the canonical PR #57 topology, whose in-worktree semantics are explicitly documented as depending on local discovery (`resolveChangeRoot` doc comment, `helpers.ts:74-77`: "Invoked from inside a worktree, the metadata carries no injected host (discovery is local) ... in-worktree behavior is unchanged"). This variant maximizes blast radius and regresses canonical-topology guarantees. Do not do this.

**Recommended shape: symmetric aggregation option on `ArtifactStore`.** Mirror the existing `worktreesDir` option with a `parentSpecDir` (or `parentRoot`) option:

1. **Detection (new sync util, e.g. `src/util/worktree-parent.ts`)** — `resolveWorktreeParent(root: string): string | undefined`:
   - `<root>/.git` must be a regular **file** (a main checkout's `.git` is a directory — this alone guarantees the lookup never chains past one hop).
   - Parse the single `gitdir: <path>` line (resolve relative values against `root`). Expected shape: `<mainGitDir>/worktrees/<name>`.
   - Read `<gitdir>/commondir`, resolve against the gitdir → common git dir (fixture-verified: `../..` → `<main>/.git`); parent root = `dirname(commonGitDir)`. Fall back to `dirname(dirname(dirname(gitdir)))` if `commondir` is unreadable.
   - **Metta-managed containment guard**: honor the result only when `relative(join(parentRoot, '.metta', 'worktrees'), root)` is non-empty, not `..`-prefixed, not absolute — the same `path.relative` idiom `resolveChangeRoot` already uses (`helpers.ts:96-99`). Arbitrary user worktrees stay out of scope, per intent.
   - Every failure mode (no `.git` file, parse failure, missing commondir target, containment miss) returns `undefined` — behavior identical to today.
   - Pure fs reads, no subprocess. `git worktree list` / `git rev-parse --git-common-dir` were considered and rejected: they force async or `execFileSync` into the sync `createCliContext` path and add ~10-30 ms of subprocess per CLI startup for information two `readFileSync` calls provide. The `.git`-file `gitdir:` format is the stable, documented worktree layout (gitrepository-layout); metta never creates absorbed/submodule gitdirs.

2. **Wiring (`createCliContext`, `helpers.ts:103-118`)** — compute `const parentRoot = resolveWorktreeParent(root)` and pass `parentSpecDir: join(parentRoot, 'spec')` to the `ArtifactStore` when defined.

3. **`ArtifactStore` changes** (`src/artifacts/artifact-store.ts`):
   - New private `listParentHostedChanges()` — a mirror of `listLocalChanges()` reading `<parentSpecDir>/changes/*/.metta.yaml`. Reads the parent's **local** changes only — never a parent-configured store with its own `worktreesDir` (see §3, recursion/double-count).
   - `discoverChanges()` seeds the map with parent-hosted entries **first** (lowest precedence): `byName.set(name, { name, worktree: parentRoot })`, then local, then worktree-hosted — so the existing "closer copy wins" collision semantics extend naturally: a change present in both main and the worktree resolves to the worktree copy, with the existing warning machinery reporting the shadow.
   - Generalize `findWorktreeHost` → the host concept already flows through `stateForHost(host)`/`specDirFor`/`readStoredChange`; a parent host is just another `host` string, so `getChange`/`updateChange`/`markArtifact`/`writeArtifact`/`readArtifact`/`archive` route to the parent's spec dir with **no signature changes**. `DiscoveredChange.worktree` doc comment ("checkout hosting the change") stretches to cover the parent root; consumers use it exactly for "locate the owning checkout".
   - `updateChange`'s injected-host strip logic (`artifact-store.ts:167-173`) already generalizes: the parent root is discovered live, injected transiently, and stripped on round-trip writes — no machine path leaks into `.metta.yaml`.

4. **`resolveChangeRoot` extension (`helpers.ts:91-101`)** — today the containment guard only accepts a candidate under `<projectRoot>/.metta/worktrees/`; a parent-root candidate falls back to `projectRoot` (the worktree) and change-scoped paths would compute against the **wrong** checkout (artifacts live in main). Add the symmetric legitimacy rule: also accept `candidate` when **`projectRoot` is strictly contained under `<candidate>/.metta/worktrees/`** (same `path.relative` idiom, still pure path math). Exactly one ancestor can satisfy this for a given `projectRoot`, so the untrusted-persisted-value threat model is preserved: a hostile persisted `worktree:` value can only redirect to the one real parent whose worktree area contains the current root — which is the correct owner anyway.

Estimated diff: detection util ~40 lines, `ArtifactStore` ~50-60 lines, `resolveChangeRoot` ~8 lines, `createCliContext` ~5 lines, plus tests.

### 2b. Infinite recursion: structurally impossible

- The parent lookup is a **single one-hop fs read**, not a recursive store construction. `discoverChanges` on the worktree store reads the parent's `spec/changes/` directory directly; it never instantiates a parent `ArtifactStore`, so main→worktrees→main cycling cannot occur.
- Even if someone later builds a parent store, `resolveWorktreeParent` terminates at the main checkout because a main checkout's `.git` is a directory, not a `gitdir:` pointer file — detection returns `undefined` and the chain ends.
- Metta never nests worktrees inside worktrees (`setupChangeWorktree` always creates under the project root), so multi-hop chains do not arise in the managed layout; if a user manufactures one, each hop still resolves only its immediate parent's local changes.

## 3. Semantic risks

1. **Double-counting / precedence (moderate, handled).** A change present in both main and its own worktree (transitional state during finalize, or after a canonical-topology run that also left a main copy) is now visible to the worktree-rooted store twice. Seeding parent entries first makes the worktree's local copy win via the existing collision map — consistent with the established "worktree copies win" rule from main's perspective (it prefers the copy closest to the working checkout in both directions). Decision needed: emit the existing collision warning or stay silent for parent shadows; recommend warning (consistency, and it surfaces the transitional state).
2. **State writes routed across checkouts (the main risk).** Post-change, `metta complete` / `tokens record` / `iteration` / `gate` run from a worktree cwd against a main-hosted change **succeed and write main's `spec/changes/<name>/.metta.yaml`** — previously they failed with "change not found". The write target is the *correct file* (that is where the state lives), so this is arguably fixing broken behavior, but two hazards need auditing:
   - **Git side effects with mismatched cwd.** `autoCommitFile` and the "~7 git commit sites" take `projectRoot` (the worktree) as cwd; `git add` of a path inside main's tree from the worktree's cwd fails ("outside repository"), degrading to `committed: false` in `autoCommitFile` (graceful) but potentially noisier elsewhere. Commands that already route through the extended `resolveChangeRoot` get the correct cwd for free; the remainder need a pass. Uncommitted-but-correct state is the worst case observed — no corruption path identified.
   - **Concurrent writers.** A session at main and a subagent in the worktree can now both write main's `.metta.yaml`. Last-write-wins on a small YAML file; same exposure main-rooted invocations already have today, but the window widens.
3. **`finalize`/`ship` from a worktree cwd** would now resolve the main-hosted change and attempt archive/merge rooted at main's spec dir from a worktree process — untested territory. Mitigation: these are session-tier guarded commands normally run from the session (main) cwd; but the design should either verify or explicitly leave a guard ("finalize refuses parent-hosted changes from a worktree cwd") to keep scope tight.
4. **`resolveChangeRoot` widening** slightly enlarges where change-scoped git side effects may point (the parent checkout). Bounded to exactly one deterministic ancestor by the symmetric containment check; no arbitrary-path exposure.
5. **Requirement-letter gap vs the spec's "either root" phrasing.** The spec (`spec.md`, first requirement) says allow when visible from the target's root **or the session's root**. Option 2 implements the parent-main relation, not arbitrary session roots. Every concrete scenario in the spec is the parent-main relation, so all scenarios pass — but if the session cwd were some unrelated third checkout with an active change, Option 2 (correctly, and more safely than Option 1's either-allows) still blocks. This is a narrower and arguably better-scoped reading; the design phase should reconcile the requirement wording.

## 4. Blast radius — CLI consumers

`resolveProjectRoot` itself is untouched (only `createCliContext` consumes it, plus all 37 command files consume `createCliContext`). Behavior changes **only when cwd is inside a metta-managed worktree whose parent hosts changes the worktree doesn't** — i.e. exactly the broken topology. Canonical topology, main-root invocations, and non-worktree checkouts are byte-identical (detection returns `undefined`).

Commands that change behavior from a worktree cwd (inverted topology; today they all see "no changes" or error):

| Command | Today (worktree cwd, inverted) | After | Risk |
|---|---|---|---|
| `status` (hook's probe), `next`, `changes` list, `progress` | empty envelope | sees main-hosted change | none — this is the fix |
| `instructions`, `context`, `check-constitution` | change not found | resolves; change-scoped paths correct **only with the `resolveChangeRoot` extension** | low, contingent on §2a-4 |
| `tokens record` | hard error at `tokens.ts:68` ("worktree cwd names change X but it is not an active change") | binds via rule 2, writes main's state | low — intended side benefit named in the intent |
| `complete`, `iteration`, `gate`, `model-escalation`, `verify`, `plan`, `execute`, `tasks` | change not found | read/write main-hosted state from worktree process | medium — git-commit-cwd audit (§3-2) |
| `finalize`, `ship` | change not found | would operate on main's spec dir from worktree cwd | medium — verify or guard (§3-3) |
| `propose`/`quick` duplicate check (`createChange`) | worktree-blind to main-hosted names | correctly rejects duplicate slugs hosted at main | none — strictly better |

## 5. Does it fix the hook with zero hook changes?

**Yes, for the reproduced topology.** The hook probes `metta status --json` with cwd at the target's toplevel (the worktree). Post-change that probe returns the main-hosted change → `hasActiveChange` → exit 0. Verified against the hook logic and the fixture layout:
- Canonical topology: unchanged (local discovery still wins) — no regression.
- No change anywhere: parent listing is also empty → empty envelope → exit 2 preserved.
- All probe-failure fail-open paths: untouched (the hook file is not edited).
- The `.claude/hooks` / `src/templates/hooks` byte-identity test keeps passing trivially.

Residual: the hook's second potential root (session cwd) is never consulted, but under Option 2 it doesn't need to be for any spec scenario (§3-5).

## 6. Test strategy

Existing assets make this cheap to test properly:
- `tests/helpers/cli.ts` runs the **real CLI** via `npx tsx src/cli/index.ts` (`runCli`, `CLI_PATH`); `tests/cli-status.test.ts` already has a worktree-aggregation-from-main test to mirror.
- The scratchpad `consumer/` fixture demonstrates the minimal inverted-topology recipe: real `git init` + `git worktree add .metta/worktrees/demo-change`, write `.metta.yaml` under **main's** `spec/changes/demo-change/`, leave the worktree's `spec/changes` absent.

Planned coverage:
1. **Unit — `resolveWorktreeParent`** (`tests/worktree-parent.test.ts`, 1:1 ratio): real `git worktree add` fixture → resolves parent; `.git` directory → undefined; malformed gitdir file → undefined; worktree outside `.metta/worktrees/` (user worktree) → undefined; relative gitdir value.
2. **Unit — `ArtifactStore` parent consultation** (extend `tests/artifact-store.test.ts`, reusing its simulated-layout style plus a `parentSpecDir` option): parent-hosted change listed; local copy wins parent collision (+ warning decision); reads/writes route to the parent spec dir; injected parent host stripped on write.
3. **Unit — `resolveChangeRoot` symmetric containment** (extend `tests/cli-helpers.test.ts`): parent-root candidate accepted from a worktree `projectRoot`; unrelated ancestor rejected.
4. **Integration — real CLI, inverted topology** (extend `tests/cli-status.test.ts` or new `cli-worktree-inverted.test.ts`): build the consumer-shaped fixture with real git; `runCli(['--json','status'], worktreePath)` asserts the main-hosted change is reported. **This test fails against pre-fix code** (today it returns the empty envelope), satisfying the "demonstrably capable of failing" requirement.
5. **Hook regression — real discovery semantics** (extend `tests/metta-guard-edit.test.ts`): replace the cwd-answering shim with a PATH wrapper script `metta` that execs `npx tsx <CLI_PATH> "$@"` (pattern already proven by the harness), fixture as above, assert the hook exits 0 for a Write into the worktree — closing the shim blind spot named in the intent. Keep one shim-based case for the pure fail-open modes (which are about probe *failure*, not discovery).

## 7. Effort estimate

- Source: ~110-130 lines across 4 files (detection util, artifact-store, helpers, context wiring).
- Tests: ~250-350 lines across 4-5 files (including the real-CLI fixture, which is the bulk).
- Audit pass over git-commit sites for cross-checkout writes (§3-2) and a finalize-from-worktree decision (§3-3): the long tail.
- Total: **2-3 focused days** — versus roughly half a day for Option 1's hook-only fix. The real-CLI regression test (~1 day of that) is mandatory for **any** option per the spec, so the marginal cost over Option 1 is ~1-1.5 days.

## 8. Recommendation

**Score: 7/10.**

Rationale:
- **For:** fixes the defect at its actual root (the CLI's discovery asymmetry) rather than patching around it in the hook; zero hook edits, so the fail-open surface and the byte-identity contract are untouched; unblocks `metta tokens record` (which today hard-errors from a worktree cwd) and `instructions`/`context`/`next` as named side benefits; makes `createChange` duplicate detection bidirectional; the design slots cleanly into existing patterns (symmetric to the `worktreesDir` option, reuses `stateForHost` plumbing and the `path.relative` containment idiom); no new subprocesses, sync-safe, no recursion hazard; safer allow-surface than Option 1's either-allows (only the verified parent checkout is consulted, not an arbitrary session cwd).
- **Against:** meaningfully larger blast radius than the guard bug demands — every change-scoped command gains new cross-checkout read/write behavior from worktree cwds, and the write-side interactions (git-commit cwd mismatches, finalize-from-worktree) need an audit that Option 1 avoids entirely; the `resolveChangeRoot` extension touches a security-sensitive containment guard; ~2-4x the effort of Option 1.
- **Net:** this is the *durable* fix and the direction the codebase should end up in; it loses points only on proportionality of risk-to-defect for a hotfix. If the orchestrator wants the smallest safe ship, take Option 1 now and schedule this as the follow-up; if one change should end this bug class (a topology PR #57 already failed to close once via a narrow fix), Option 2 is the strongest candidate on the table and I recommend it, with the finalize/ship-from-worktree guard from §3-3 included to cap the write-side risk.
