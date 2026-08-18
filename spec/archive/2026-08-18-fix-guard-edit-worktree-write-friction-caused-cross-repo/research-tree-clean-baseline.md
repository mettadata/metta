# Research: main-checkout tree-clean baseline and verification (layer 3)

> Change: `fix-guard-edit-worktree-write-friction-caused-cross-repo`
> Scope: recording a `git status --porcelain --untracked-files=no` baseline of the MAIN
> checkout before worktree execution begins, comparing at `metta complete implementation`
> and at ship preflight, failing loudly on newly-dirty paths (pre-existing dirt = warning only).

## 1. Current state

### Where the only porcelain gate lives today

`src/ship/merge-safety.ts:114-132` — the `preflight` step runs
`git status --porcelain --untracked-files=no` against `this.cwd` (the checkout being
shipped) and hard-fails on ANY dirt with a generic detail
(`'working tree has uncommitted changes to tracked files'`). No path listing, no
attribution, no distinction between the operator's own edits and executor contamination.
Result shape is `MergeSafetyStep { step, status: 'pass'|'fail'|'skip', detail? }`
(`merge-safety.ts:9-13`); each failing step returns `{ status: 'failure', steps }` and
`ship.ts` exits 1 on failure / 2 on conflict (`src/cli/commands/ship.ts:61-62`).

Important nuance: `ship` constructs the pipeline with `ctx.projectRoot`
(`src/cli/commands/ship.ts:38`), and ship is normally invoked from the main checkout — so
the existing preflight *already* hard-fails a contaminated main checkout, but (a) only at
ship, far too late, (b) with no path diagnostic, and (c) it equally hard-blocks the
operator's own legitimate in-flight edits (no warning-vs-fail distinction). The new step
adds attribution, not the first-ever check.

### Where `complete implementation` is handled

`src/cli/commands/complete.ts:91-706`. Pre-complete gates (stories validation, delta-spec
target checks) run at lines 168-226, **before** `markArtifact(..., 'complete')` at line
230. Everything implementation-specific today (post-impl scoring, tasks ticking, lines
510-624) runs *after* the artifact is already marked complete and is advisory-only. A
contamination gate that "fails the completion" must therefore be inserted **before line
230**, alongside the existing gate pattern. The error boundary (`complete.ts:701-705`)
prints `{ error: { code: 4, type: 'complete_error', message } }` in `--json` mode and
exits 4.

### Where implementation execution begins (code hook)

`src/cli/commands/instructions.ts:140-189` — when `metta instructions implementation` is
issued and the artifact status is `ready`/`in_progress`, the command best-effort stamps
`artifact_timings[implementation].started` (write-once) inside a try/catch that never
blocks the workflow. This is the exact code-level moment "before implementation execution
begins", and it already has write-once semantics to copy.

### Worktree topology and root resolution

- `resolveProjectRoot` (`src/cli/helpers.ts:54-66`): nearest ancestor with
  `spec/changes/`; invoked from inside a worktree it returns the **worktree root**, not
  the main checkout.
- `resolveChangeRoot(projectRoot, metadata)` (`src/cli/helpers.ts:92-102`): returns the
  worktree path only when `metadata.worktree` is set and strictly contained under
  `<projectRoot>/.metta/worktrees/`; otherwise `projectRoot`.
- `metadata.worktree` is injected **transiently** by `ArtifactStore.getChange()` when the
  change is discovered under `<root>/.metta/worktrees/<name>/` and is deliberately never
  persisted (`src/artifacts/artifact-store.ts:139-165` strips the machine-specific host
  path before writes). Consequence: invoked from *inside* the worktree, discovery is
  local and `metadata.worktree` is `undefined` — the change does not look worktree-hosted.
- Precedent for deriving the hosting checkout from a worktree root: the guard-edit hook
  does pure path math — a metta worktree root is exactly `<H>/.metta/worktrees/<name>`
  (`.claude/hooks/metta-guard-edit.mjs:75-88`), and
  `detectWorktreeChangeName(cwd)` (`src/util/git-worktree.ts:22-43`) does the equivalent
  segment matching in TypeScript. A config-agnostic alternative is
  `git rev-parse --path-format=absolute --git-common-dir` from inside the worktree, which
  returns the shared main `.git` dir; its dirname is the main checkout root.[^1]

### State persistence machinery

- `StateStore` (`src/state/state-store.ts:26-154`): Zod-validated `read`/`write` (safeParse
  before every persist, `StateValidationError` with typed issues), `acquireLock` with
  stale-lock handling. `createCliContext` already wires `ctx.stateStore = new
  StateStore(join(root, '.metta'))` (`src/cli/helpers.ts:128`).
- `ChangeMetadataSchema` is `.strict()` (`src/schemas/change-metadata.ts:100-125`) — any
  new field on `.metta.yaml` requires a schema addition, and that file is git-tracked
  under `spec/changes/<change>/` and auto-committed by complete (`complete.ts:692-700`).
- Gitignore status in the main checkout: `.metta/scratch/`, `.metta/worktrees/`,
  `.metta/logs/` are ignored (root `.gitignore`); `.metta/config.yaml` and `.metta/gates/`
  are tracked. `.metta/scratch/` is the established home for transient runtime state
  (skill-session credentials).

### git config toggle

`GitConfigSchema` (`src/schemas/project-config.ts:20-33`): `enabled` (default true),
`worktree.enabled` (default true), `worktree.dir` (default `.metta/worktrees`).
`setupChangeWorktree` (`src/util/git-worktree.ts:90-136`) returns mode `skipped` when
`git.enabled === false` and mode `fallback` (no worktree) when worktrees are disabled or
`worktree add` fails — in both cases no `worktree` path exists, so the change is
non-worktree-hosted and layer 3 must not engage.

### Test patterns

- `tests/merge-safety.test.ts`: `mkdtemp` fixture + real `git init` + real commits,
  asserts on `result.steps` / `result.status`. The main-checkout step tests fit this
  harness directly (add a linked worktree via `git worktree add` in the fixture).
- `tests/state-store.test.ts`, `tests/git-worktree.test.ts` exist — near-1:1 ratio means
  the new module gets its own test file.
- `tests/cli-complete.test.ts`, `tests/cli-worktree-change-root.test.ts`,
  `tests/complete-stamps-timings.test.ts` show how complete/instructions are exercised.

## 2. Options evaluated

### 2a. Where to store the baseline

| Option | Pros | Cons |
|---|---|---|
| **A. Field on the change's `.metta.yaml`** (`ChangeMetadataSchema`) | Single store, `artifactStore.updateChange` exists, travels with the change | File is git-tracked and auto-committed; machine-specific absolute paths and dirty-file lists would enter repo history and merge to main at ship. Directly contradicts the store's own precedent of stripping machine-specific data (`artifact-store.ts:159-165`). Also fails the spec text "persisted ... under `.metta/`". **Reject.** |
| **B. File under `spec/changes/<change>/`** | Visible next to artifacts | Same tracked-file problems as A; pollutes the spec tree with runtime state. **Reject.** |
| **C. Main checkout `.metta/scratch/tree-baselines/<change>.yaml` via `StateStore`** | Gitignored (never dirties main itself; untracked so invisible to `-uno` porcelain either way); matches the transient-runtime-state precedent (skill-session tokens); Zod-validated via existing `StateStore`; satisfies "Zod-validated state under `.metta/`" | Baseline must be addressed at the **main** root explicitly (not `ctx.stateStore` when invoked in-worktree); needs cleanup on ship/abandon; consumer projects need `.metta/scratch/` ignored (verify install template; the file being untracked keeps `-uno` checks unaffected regardless) |
| **D. Extend `.metta/state.yaml` (`StateFileSchema`)** | Reuses an existing file | Global single file, schema migration risk, lock contention with unrelated writers, lingering entries. **Reject.** |

**C wins.** Suggested path: `scratch/tree-baselines/<change>.yaml` relative to
`<mainRoot>/.metta` (i.e. a `StateStore(join(mainRoot, '.metta'))`).

### 2b. When to capture

| Option | Assessment |
|---|---|
| At propose/quick (worktree creation) | Too early — every operator edit to main between propose and execute is misattributed as contamination. |
| **At `metta instructions implementation` (status `ready`/`in_progress`), write-once** | Matches the spec's "before implementation execution begins"; the exact code hook already exists (`instructions.ts:140-189` started-stamp block) with the right best-effort + write-once semantics. Re-dispatch after a failed verify does **not** re-baseline (write-once), so contamination from an earlier attempt is still caught. **Recommended.** |
| In skill/orchestrator prose | Violates the code-not-prose principle this change exists to enforce. Reject. |

Capture behavior: run `git status --porcelain --untracked-files=no` at the main root; if
entries exist, emit a stderr warning listing pre-existing dirty paths (never block);
persist `{ change, main_root, recorded_at, entries }`. Wrap in try/catch mirroring the
timings stamp — a git failure (git absent, `git.enabled: false` edge, non-repo) warns
and skips, never blocks instructions.

### 2c. Module shape and placement

New module `src/util/git-tree-baseline.ts` (alongside `git-worktree.ts`), test
`tests/git-tree-baseline.test.ts`. Functional core / imperative shell:

- Pure: `parsePorcelain(raw: string): TreeEntry[]` (recommend `--porcelain=v1 -z` for
  NUL-safe parsing of paths with spaces and `R old -> new` rename records; still the
  porcelain format the spec names), and
  `diffTreeState(baseline: TreeEntry[], current: TreeEntry[]): { newDirt: TreeEntry[]; preExisting: TreeEntry[] }` —
  a path is *new dirt* when absent from the baseline map **or** when its XY status
  changed (spec: "became dirty (or changed state)").
- Shell: `captureMainTreeBaseline(mainRoot, change)` /
  `compareMainTree(mainRoot, change)` using `execFile` (pattern:
  `git-worktree.ts:1-7`) + a `StateStore` rooted at `join(mainRoot, '.metta')`.
- Schema: new `src/schemas/tree-baseline.ts` exporting a `.strict()`
  `MainTreeBaselineSchema` (`change`, `main_root`, `recorded_at` datetime,
  `entries: [{ path, status }]`), barrel-exported from `src/schemas/index.ts`.
- Error: `MainTreeContaminationError extends Error` carrying `newDirt: TreeEntry[]`
  (typed hierarchy convention), thrown by the complete-gate wrapper, not by the pure core.

### 2d. Detecting "worktree-hosted" + resolving the main root at check time

Two invocation topologies:

1. **From the main checkout (normal skill flow):** `metadata.worktree` is injected →
   `resolveChangeRoot(ctx.projectRoot, metadata) !== ctx.projectRoot` is the predicate;
   main root = `ctx.projectRoot`. Zero new machinery.
2. **From inside the worktree:** `metadata.worktree` is `undefined` (local discovery), so
   the predicate above is false. Detect via
   `detectWorktreeChangeName(ctx.projectRoot) === changeName`; derive the main root by
   stripping the `<worktreeDir>/<name>` suffix (path math per the guard-edit precedent),
   optionally cross-checked with `git rev-parse --path-format=absolute --git-common-dir`
   (dirname of the returned `.git` = main root).[^1] Ship this as a small helper
   `resolveMainCheckoutRoot(projectRoot, changeName, metadata): string | null` next to
   `resolveChangeRoot` (null ⇒ not worktree-hosted ⇒ layer 3 disengaged).

The `git.enabled: false` / worktree-fallback cases need no special code: no worktree ⇒
`metadata.worktree` absent and `detectWorktreeChangeName` misses ⇒ helper returns null ⇒
no baseline, no checks — exactly the spec's "non-worktree changes see no behavior change".

### 2e. Completion-gate wiring and failure UX

In `complete.ts`, add a gate **before `markArtifact` (line 230)**, guarded by
`artifactId === 'implementation' && mainRoot !== null`:

- No baseline recorded → warn on stderr ("no baseline; cannot attribute main-checkout
  dirt") and pass — changes started before this feature must not brick.
- Baseline exists → `compareMainTree`; `newDirt.length > 0` → throw
  `MainTreeContaminationError` with a message listing exactly the new paths (and their
  status codes) plus remediation guidance: "If these are your own edits, commit or stash
  them in the main checkout and re-run `metta complete implementation`." Pre-existing
  paths appear only as a stderr warning, never in the failure list.
- The existing boundary keeps exit code 4; in `--json` mode differentiate via
  `type: 'main_tree_contamination'` (an `instanceof` check at the boundary) so automation
  can distinguish it from generic completion errors. Exit-code consistency with other
  complete failures beats inventing a new code.
- Detection performs **only** `git status` against main — no checkout/reset/stash (spec:
  never mutates the main checkout).

### 2f. Ship preflight wiring

`MergeSafetyPipeline` today knows only branch names + cwd. Options:

- **(i) Pipeline reads state itself** — couples merge-safety to StateStore/ArtifactStore;
  harder to test; rejects the current clean dependency shape.
- **(ii) Caller-supplied check input (recommended):** `ship.ts` derives the change name
  from the `metta/<change>` branch (the pipeline already does this regex for
  finalize-check, `merge-safety.ts:90`), resolves worktree-hostedness + baseline, and
  passes an optional `mainCheckout?: { root: string; baselineEntries?: TreeEntry[] }`
  into the pipeline (constructor option or a `run` options object). The pipeline adds a
  step `main-checkout-clean` immediately after `finalize-check` and before the existing
  `preflight`:
  - not worktree-hosted / no input → `skip` ("non-worktree change")
  - baseline present, new dirt → `fail`, `detail` naming the newly-dirty paths → overall
    `failure` (exit 1 via existing ship handling)
  - baseline present, only pre-existing dirt → `pass` with a warning detail
  - no baseline → `skip` with detail ("no baseline recorded — cannot attribute dirt");
    the legacy `preflight` step still provides the absolute backstop when shipping from
    the main checkout.

  Non-worktree ships see an added `skip` step but identical ordering semantics and result
  shape for every existing step; if the spec's "step sequence identical" scenario is read
  strictly, emit the step only when `mainCheckout` input is provided (worktree-hosted),
  which keeps non-worktree step lists byte-identical. Recommend the strict reading.

Note the pre-existing-dirt tension: the legacy `preflight` step will still hard-fail an
operator-dirty main checkout when shipping from main (it must — `git checkout`/merge need
a clean tree). That is unchanged pre-existing behavior, not a regression; the "warn, never
hard-block" requirement binds the **new** step only.

## 3. Edge cases

- **Untracked-file blind spot.** `--untracked-files=no` (pinned by the spec) means a bash
  heredoc *creating a new file* in main is invisible to layer 3. The zeus incident
  modified tracked files (` M`), which is caught. Creation is covered by layer 2
  (guard-bash write targets). Upside: `-uno` also prevents false positives from operator
  scratch files and from the baseline file itself. Accepted residual; worth one sentence
  in the design doc.
- **Renames/spaces in paths.** Use `--porcelain=v1 -z` and parse NUL records (rename
  entries carry two fields); avoids misparsing `R  old -> new` and quoted paths.
- **Status-code transitions.** ` M` → `MM` or `M ` (partial staging by the operator)
  counts as "changed state" ⇒ flagged. This is deliberate per spec but is also the main
  false-positive source; remediation guidance covers it.
- **Retry loops.** Baseline is write-once per change; verify-fail → re-execute →
  re-complete keeps comparing against the original pre-execution snapshot.
- **Missing baseline at compare time** (feature shipped mid-flight, scratch wiped,
  baseline recorded on another machine): warn + pass (complete), skip (ship). Never fail
  on absence.
- **`main_root` mismatch**: persisted `main_root` differing from the resolved root
  (checkout moved) ⇒ treat as missing baseline (warn), don't compare apples to oranges.
- **Concurrent changes.** Two worktree-hosted changes executing simultaneously both
  baseline the same main checkout independently (per-change files) — contamination by
  change A during change B's window flags in both; acceptable, the diagnostic says
  "during the execution window", not "by this executor".
- **Baseline file lifecycle.** Delete best-effort on ship success and on
  abandon/cleanup paths; stale files are harmless (keyed by change name) but tidy-up
  matches the scratch conventions.
- **Locking.** Single writer (instructions, write-once) + readers; no `acquireLock`
  needed. Keep the option open via the `<file>.lock` convention if propose-time capture
  is ever added.

## 4. Risks and tradeoffs

- **False positives from concurrent operator edits to main** during long executions are
  the top UX risk. Mitigated by: `-uno` (new files never flag), actionable remediation
  text (commit/stash and re-run — the re-check is fresh each attempt, so cleared paths
  pass), and warnings (not blocks) for anything already dirty at baseline time.
- **False negatives:** contamination that is committed to main (not just working-tree),
  new untracked files, and edits made after `complete implementation` but before ship in
  a non-worktree-relevant window. Layers 1-2 are the compensating controls; ship's
  `main-checkout-clean` re-compare narrows the window.
- **In-worktree CLI invocation** relies on path-math main-root derivation; a consumer
  with a customized `git.worktree.dir` breaks the `.metta/worktrees` segment match. The
  `--git-common-dir` cross-check closes that hole; recommend implementing derivation as
  path-math first, git-common-dir fallback.[^1]
- **Schema surface:** no change to `ChangeMetadataSchema` needed (a deliberate win —
  nothing machine-specific enters the tracked `.metta.yaml`). New schema file only.
- **Spec-literal vs `-z`:** adding `-z`/`--porcelain=v1` flags beyond the spec's literal
  command string is an implementation refinement of the same porcelain format; note it in
  the design doc so verification doesn't flag drift.

## 5. Recommendation

1. **New module** `src/util/git-tree-baseline.ts` + `src/schemas/tree-baseline.ts`
   (strict, barrel-exported): pure `parsePorcelain`/`diffTreeState`, shell
   `captureMainTreeBaseline`/`compareMainTree` over a `StateStore` rooted at
   `<mainRoot>/.metta`, storing `scratch/tree-baselines/<change>.yaml`;
   `MainTreeContaminationError` typed error.
2. **Capture** in `instructions.ts` inside (or beside) the existing best-effort
   `started`-stamp block for `implementation` (`instructions.ts:140-189`): write-once,
   warn on pre-existing dirt, never block, only when
   `resolveMainCheckoutRoot(...)` returns a root.
3. **Gate** in `complete.ts` **before** `markArtifact` (line 230) for
   `artifactId === 'implementation'`: throw `MainTreeContaminationError` listing only new
   paths; boundary keeps exit 4 and emits `type: 'main_tree_contamination'` in JSON;
   warn-and-pass when no baseline.
4. **Ship**: `ship.ts` resolves change/baseline from the `metta/<name>` branch and passes
   optional `mainCheckout` input; `MergeSafetyPipeline` adds a `main-checkout-clean` step
   (after `finalize-check`, before `preflight`) emitted only for worktree-hosted ships —
   fail on new dirt, pass+warn on pre-existing-only, skip without baseline. Existing
   steps, ordering, and result shape untouched for non-worktree ships.
5. **Root resolution helper** `resolveMainCheckoutRoot` in `cli/helpers.ts` next to
   `resolveChangeRoot`: metadata-injected worktree ⇒ `projectRoot`; else
   `detectWorktreeChangeName` + path-math with `git rev-parse --path-format=absolute
   --git-common-dir` fallback; null ⇒ layer 3 disengaged (covers `git.enabled: false`
   and worktree-fallback modes for free).
6. **Tests** (near 1:1): `tests/git-tree-baseline.test.ts` (pure parse/diff matrix:
   clean, pre-dirty, new-dirty, status-transition, rename, spaces; shell capture/compare
   against a real `mkdtemp` git repo per the merge-safety fixture pattern);
   merge-safety additions in `tests/merge-safety.test.ts` (worktree fixture via
   `git worktree add`; fail/warn/skip matrix; non-worktree step-list byte-identity);
   complete-gate coverage in the `cli-complete` harness (fails against pre-change
   behavior, listing only new paths; no-baseline warn-pass; non-worktree unchanged).

**Rationale:** every piece rides an existing, proven pattern in this codebase — StateStore
Zod round-trip, best-effort instrumentation block, pre-complete gate placement,
`MergeSafetyStep` result shape, guard-edit root derivation math — so the change is
additive, non-worktree paths are provably untouched, and nothing machine-specific ever
enters a git-tracked file.

[^1]: https://git-scm.com/docs/git-rev-parse accessed 2026-08-18 — `--git-common-dir`
    shows `$GIT_COMMON_DIR` (the common dir shared across worktrees; from a linked
    worktree this is the main checkout's `.git`), and `--path-format=absolute` makes it
    absolute and canonical.
