# fix-root-invoked-instructions-context-complete-emit-main

## Problem

When `metta instructions`, `metta context stats`, or `metta complete` is run from the main
checkout root for a change hosted in a per-change worktree (`.metta/worktrees/<name>/`), the
commands *find* the change (discovery became worktree-aware in PR #57) but every path they emit
or act on is built from the wrong root. All three commands construct paths with an unconditional
`join(ctx.projectRoot, 'spec', 'changes', changeName)`:

- `src/cli/commands/instructions.ts:65-66` — `changePath` and `specDir` fed into
  `instructionGenerator.generate()`, so the emitted instructions tell the orchestrator to write
  artifacts under `<main-root>/spec/changes/<name>/` instead of the hosting worktree.
- `src/cli/commands/context.ts:52` — `changePath` used for existence check and context
  resolution, so `context stats` either reports "change directory not found" (exit 4) or reads
  a stale main-checkout copy rather than the worktree's artifacts.
- `src/cli/commands/complete.ts:157-186` — stub/length validation, the stories-valid gate, and
  the spec-delta capability gate all read artifact files from the main-checkout path; the
  auto-commit at `complete.ts:608-610` runs `git add`/`git commit` with
  `cwd: ctx.projectRoot`, committing to the main checkout instead of the worktree branch.
  `instructions.ts:187-192` has the same mis-rooted git `cwd` for its `.metta.yaml`
  auto-commit.

The failure is silent: no error or warning is raised, so an AI orchestrator following the
emitted instructions writes real artifacts to a location the worktree-hosted change never sees,
and `complete` validates (or commits) the wrong tree. The current workaround — `cd` into the
worktree before running lifecycle commands — works only because `resolveProjectRoot()`
(`src/cli/helpers.ts:50-62`) roots at the nearest ancestor with `spec/changes/`, but nothing
enforces or documents that requirement.

Affected: AI orchestrators (skills/subagents) invoking lifecycle commands from the main
checkout root, and humans running the CLI directly from the repo root while a worktree-hosted
change is active. Found during review of fix-metta-guard-edit-worktree-blind (PR #57), which
fixed status aggregation but explicitly left path emission out of scope (see the comment at
`src/cli/helpers.ts:70-72`: "status/list/resolution stay truthful").

## Proposal

Make path construction in the three lifecycle commands worktree-aware, consuming the hosting
information the store already provides (candidate solution 1 from the issue):

1. **Add a shared change-root resolution helper** (e.g. `resolveChangeRoot(ctx, changeName)`)
   in `src/cli/helpers.ts` (or a sibling module with its own test file, per the 1:1 ratio).
   It returns the worktree checkout root when the change's metadata carries a hosting
   `worktree` path — `ArtifactStore.getChange()` already injects this transiently at
   `src/artifacts/artifact-store.ts:145-147` — and falls back to `ctx.projectRoot` otherwise.
   The helper is pure given the metadata (functional core); the store lookup stays at the
   command edge.

2. **Re-root all change-scoped paths in the three commands** through the helper:
   - `instructions.ts`: `changePath`, `specDir` passed to `instructionGenerator.generate()`,
     and the git `cwd` for the `.metta.yaml` auto-commit (lines 65-66, 187-192).
   - `context.ts`: `changePath` and `specDir` for `context stats` (lines 52, 62).
   - `complete.ts`: artifact validation reads, the stories gate (`spec.md` sibling read), the
     spec-delta gate's delta read, and the auto-commit `cwd` (lines 157-186, 608-610). The
     capability spec existence check at `complete.ts:186` also resolves against the change
     root, since a git worktree checkout carries its own full `spec/specs/` tree.

3. **Behavioral guarantee:** for a worktree-hosted change, root invocation and in-worktree
   invocation produce identical emitted paths and identical git side-effect targets. For
   non-worktree changes, all paths remain exactly `ctx.projectRoot`-rooted — no behavior
   change.

4. **Tests** covering both roots for each command: main-root invocation of a worktree-hosted
   change emits worktree paths; in-worktree invocation is unchanged; non-worktree changes are
   unchanged; git auto-commit `cwd` lands in the hosting checkout.

## Impact

- **`metta instructions`** — emitted `changePath`/`specDir` (and therefore all
  instruction-contract path fields consumed by skills/subagents) change from main-root to
  worktree-root for worktree-hosted changes when invoked from the main checkout. This is the
  correction: current consumers of those paths are writing to a dead location. In-worktree
  invocations are byte-identical before and after.
- **`metta context stats`** — starts reading the worktree's artifacts instead of erroring or
  reading a stale main-checkout copy; token/budget numbers may change for worktree-hosted
  changes (they become truthful).
- **`metta complete`** — validation gates start reading the artifacts the orchestrator
  actually wrote; the auto-commit lands on the worktree branch instead of polluting the main
  checkout's index. Risk: the commit-target change is a behavioral shift for anyone who relied
  on the (wrong) main-checkout commit.
- **`src/cli/helpers.ts` / new helper module** — one new exported function plus its test file;
  `CliContext` shape is unchanged.
- **Instruction-contract and command specs** — `instruction-contracts`, `context-engine`, and
  the complete-related capability specs gain delta requirements for worktree-aware path
  emission.
- **Not affected:** `resolveProjectRoot()` semantics, `ArtifactStore` discovery/metadata
  injection (already correct from PR #57), status/list/resolution commands, non-worktree
  projects, and `.metta/workflows` / template resolution (loader search paths stay
  main-root-anchored unless a test proves they must follow the change root).

## Out of Scope

- **Refusing root invocation for worktree-hosted changes** (candidate 2) — rejected; a loud
  error does not deliver the capability and would break the primary orchestrator flow.
- **Codifying the cd-into-worktree workaround in skill files** (candidate 3) — rejected;
  leaves the CLI silently wrong for direct human use.
- **Making other commands worktree-aware** — `finalize`, `ship`, `verify`, `plan`, or any
  command not named in the issue. If review finds the same pattern elsewhere, log a follow-up
  issue rather than expanding this change.
- **Changing `resolveProjectRoot()`** — its upward-walk semantics are correct and relied upon
  by in-worktree invocation; this change layers change-root resolution on top, it does not
  alter project-root resolution.
- **Persisting worktree host paths** — the transient-injection contract in
  `ArtifactStore.getChange()`/`updateChange()` (machine-specific paths never written to
  `.metta.yaml`) is preserved untouched.
- **Worktree creation/removal lifecycle** — no changes to how worktrees are provisioned or
  cleaned up.
- **Multi-repo or nested-worktree layouts** beyond the standard
  `<root>/.metta/worktrees/<name>/` shape.
