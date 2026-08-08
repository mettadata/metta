# Research: Worktree-aware active-change resolution for token recording

Topic: how the PostToolUse token-recording hook (and `metta tokens record` itself) should
resolve WHICH change to record against, given an arbitrary invocation cwd (main checkout
root or inside `.metta/worktrees/<change>/`).

All paths below are relative to the change worktree root
`/home/utx0/Code/metta/.metta/worktrees/fix-automatic-token-recording-via-posttooluse-hook-remove/`.

## Current behavior

### `metta tokens record` resolution today

`src/cli/commands/tokens.ts:30-44`:

- `createCliContext()` is called with no argument, so the project root is
  `resolveProjectRoot(process.cwd())` (`src/cli/helpers.ts:101-102`, `51-63`) — the nearest
  ancestor of cwd that has its own `spec/changes/` directory, never escaping the containing
  git checkout.
- Resolution order is exactly two rules: explicit `--change` wins (`tokens.ts:36-37`);
  otherwise auto-select **iff** `ctx.artifactStore.listChanges()` returns exactly one name.
- Zero active changes → `Error('No active changes.')`; multiple → `Multiple changes: ...
  Use --change <name>.` Both exit 4 with a typed JSON error under `--json`
  (`tokens.ts:38-44`, `73-83`). Nothing is written on failure.
- There is **no cwd-based rule**: cwd only matters indirectly via where
  `resolveProjectRoot` lands.

### What discovery and writes already handle (PR #57 aftermath)

Change discovery is already worktree-aware when invoked from the **main root**:

- `createCliContext` wires `worktreesDir: resolve(root, DEFAULT_WORKTREE_DIR)` into the
  `ArtifactStore` (`src/cli/helpers.ts:110-116`).
- `listChanges()` aggregates local `spec/changes/*/` **plus**
  `<root>/.metta/worktrees/<host>/spec/changes/<name>/.metta.yaml` entries, worktree copies
  winning slug collisions (`src/artifacts/artifact-store.ts:187-222`, `243-269`).
- `updateChange()` resolves the hosting worktree via `findWorktreeHost(name)` and writes
  through `stateForHost(host)` into the worktree's own `.metta.yaml`
  (`artifact-store.ts:155-179`), stripping the transient injected `worktree` host path so
  it is never persisted.

Consequences for the two common cwds:

| Invocation cwd | What happens today |
|---|---|
| Main root, exactly one active (worktree-hosted) change | Works: auto-select finds it, `updateChange` writes into the worktree's `.metta.yaml`. |
| Main root, **two+** active changes | Hard error exit 4 — even though one of them may be "the" change the just-finished Task ran for. This is the gap the spec delta closes for the worktree-cwd case only. |
| Inside `.metta/worktrees/<c>/` | `resolveProjectRoot` roots at the worktree checkout (it has its own `spec/changes/`), so `listChanges()` sees only that checkout's local changes — normally exactly one → auto-select works. The worktree's own `.metta/worktrees/` is empty, so no aggregation noise. |

So the remaining unhandled cases are: (a) worktree cwd whose checkout somehow carries more
than one `spec/changes/` entry (auto-select would refuse; the worktree name disambiguates),
and (b) any cwd where multiple actives are visible and none is implied by the cwd —
which per the spec delta must stay a safe typed failure.

### The worktree-blindness history (resolved issues, all under `spec/issues/resolved/`)

- `metta-guard-edit-mjs-blocks-edit-write-for-all-subagents.md` (observed 2026-07-26) and
  `metta-guard-edit-hook-is-worktree-blind-blocks-all-subagent.md` (observed 2026-08-08):
  the guard-edit hook probed `metta status --json` with `cwd: process.cwd()` (main root),
  which saw an empty `spec/changes/` while the change lived only in the worktree, so every
  legitimate worktree edit was blocked. The CLI shared the blindness
  (`createCliContext` rooted at cwd, store read only `<root>/spec/changes`).
- Fixes shipped: PR #57 made discovery aggregate worktree-hosted changes (above), and the
  guard-edit hook now resolves the **edit target's** checkout root via
  `git -C <nearest-existing-ancestor> rev-parse --show-toplevel` and probes status there
  (`.claude/hooks/metta-guard-edit.mjs:47-73`, `82-94`). PR #59
  (`root-invoked-instructions-context-complete-emit-main-root.md`,
  `instruction-payload-output-path-is-cwd-relative...`) added the pure
  `resolveChangeRoot(projectRoot, metadata)` helper (`src/cli/helpers.ts:89-99`) so
  lifecycle commands re-root change paths at the hosting worktree, with a containment
  guard that only honors hosts strictly under `<projectRoot>/.metta/worktrees/`.

The lesson recorded in those issues: duplicating active-change semantics **inside a hook**
drifts from CLI behavior (option 3 tradeoff in the guard-edit issue). The shipped fixes
consistently pushed resolution into the CLI/store and kept hooks thin.

### How existing hooks derive paths

- `.claude/hooks/metta-session-mint.mjs:48-49` — uses the hook payload's cwd:
  `const cwd = event.cwd ?? process.cwd()`; all paths joined from it.
- `.claude/hooks/metta-guard-bash.mjs:139-141`, `154-159`, `220` — same pattern:
  `event.cwd` for the session-token path and the bypass log.
- `.claude/hooks/metta-guard-edit.mjs` — the exception, because its anchor is the **edit
  target file**, not the session: it realpath-normalizes the target
  (`toPhysicalPath`, lines 30-45) and asks git for that target's toplevel
  (`resolveTargetRoot`, lines 54-73), falling back to physical `process.cwd()`.

`cwd` is a documented common input field delivered to every Claude Code hook event,
including PostToolUse, so the new hook can rely on it the same way mint/guard-bash do.[^1]

## Worktree layout facts

- `DEFAULT_WORKTREE_DIR = '.metta/worktrees'` (`src/util/git-worktree.ts:10`), relative to
  the project root. `setupChangeWorktree` creates the worktree at
  `<projectRoot>/<git.worktree.dir>/<changeName>` on branch `metta/<changeName>`
  (`git-worktree.ts:44-60`) — **the worktree directory name IS the change name.**
- The dir is configurable (`git.worktree.dir`, `WorktreeGitConfig`), but the codebase
  precedent is default-dir-only awareness: both `createCliContext`
  (`helpers.ts:110-111`) and `resolveChangeRoot` (`helpers.ts:94`) hardcode
  `DEFAULT_WORKTREE_DIR`. A custom dir already degrades those paths today.
- "Active change" means: `spec/changes/<name>/.metta.yaml` exists — locally
  (`artifact-store.ts:225-241`) or inside a worktree host (`artifact-store.ts:243-269`).
  There is no separate registry; directory + metadata file is the ground truth.
- Each worktree checkout is a full checkout of the change branch: it has its own
  `spec/changes/<name>/` and its own `spec/` root, which is why `resolveProjectRoot`
  from inside it roots there.

## Spec-delta alignment

The change's own spec (`spec/changes/fix-automatic-token-recording-via-posttooluse-hook-remove/spec.md`)
already fixes the resolution contract:

- "Worktree-Aware Change Resolution For Token Recording" (spec.md:34-53): cwd at or below
  `.metta/worktrees/<change>/` → attribute to `<change>`, **taking precedence over the
  how-many-active-changes rule**; otherwise `--change` wins, else single-active
  auto-select, else the existing typed error with **no write** — "records are never
  misattributed as a fallback". Must hold for both hook-driven and direct invocation.
- "Tokens Record CLI Command" (spec.md:122-141) restates the full ordering:
  `--change` > worktree cwd > single active > typed exit-4 naming candidates.
- "Non-Blocking Token Recording Hook Failure" (spec.md:56-76): the hook swallows a
  non-zero `metta tokens record` exit (stderr note only), exits 0, and MUST NOT write
  error state into `.metta/`. The "logged gap" therefore materializes not as a hook-side
  write but as the TOKENS.md GAPS section (hook-health indicator, spec.md:167-183): an
  `artifact_timings` key with no matching `token_usage` record reads as a hook coverage
  miss.

## Options considered

**A. Hook-side resolution** — the hook path-matches its `cwd` against
`.metta/worktrees/<name>/` and passes `--change <name>` explicitly.
Pros: no CLI change for the worktree rule. Cons: duplicates active-change semantics in a
hook — exactly the drift pattern the guard-edit issues document as a rejected tradeoff;
untestable by Vitest alongside the CLI suite; and it would violate the spec anyway, which
requires the same resolution when the command is invoked directly.

**B. CLI-side pure path resolution (recommended)** — the hook stays dumb: it spawns
`metta tokens record` with `{ cwd: input.cwd ?? process.cwd() }` (the mint/guard-bash
pattern) and passes **no** `--change`. `tokens.ts` gains one rule: derive the change name
from the invocation cwd via a new pure helper that scans the resolved cwd's path segments
for the `.metta` + `worktrees` adjacent pair and returns the following segment.
Pros: single source of truth, matches the spec's "applies both when the hook invokes and
when invoked directly", pure path math (functional core) mirroring `resolveChangeRoot`,
trivially unit-testable, consistent with the codebase's default-dir-only precedent.
Cons: does not honor a custom `git.worktree.dir` (pre-existing, shared limitation).

**C. git-subprocess resolution** — like guard-edit, run
`git rev-parse --show-toplevel` from cwd and compare the toplevel against
`<mainRoot>/.metta/worktrees/*`. Pros: robust to symlinks and custom worktree dirs.
Cons: impure and slower in the CLI's functional core; still needs the basename→change-name
mapping; guard-edit needed git only because its anchor was a *file target* possibly
outside cwd — here the cwd itself is the spec-mandated anchor. Overkill.

**Recommendation: B**, with one hardening idea borrowed from guard-edit: normalize the cwd
with `resolve()` (and optionally realpath the existing path) before segment matching.

## Proposed resolution algorithm

Ordered rules inside the `tokens record` action (replacing `tokens.ts:35-44`):

1. **Explicit `--change <name>`** → use it verbatim (existing behavior; `getChange`
   failure surfaces as the existing typed error).
2. **Worktree cwd** → `detectWorktreeChangeName(process.cwd())` returns a candidate when
   the resolved (symlink-normalized where the path exists) cwd contains the segment pair
   `.metta`/`worktrees` with a following segment; take the **last** occurrence pair so a
   hypothetical nested layout binds to the innermost worktree. If a candidate exists,
   **bind to it unconditionally** — do not fall through to rule 3. If the candidate is not
   an active change (no `.metta.yaml` anywhere discovery can see), fail with the typed
   error and write nothing. Falling through instead would risk exactly the misattribution
   the spec forbids (cwd says `beta`, only `alpha` is active → a fall-through would record
   against `alpha`).
3. **Single active change** → `listChanges()` returns exactly one → use it (existing
   behavior, including main-root aggregation of worktree-hosted changes).
4. **Otherwise** → existing typed error (`error: { code: 4, ... }` naming candidates),
   `process.exit(4)`, no write. When the caller is the hook, the hook swallows this
   (exit 0, stderr diagnostic), and the missed run surfaces later in TOKENS.md's GAPS
   section — the "skip with logged gap" outcome, with the log living in the report rather
   than in hook-written state (which spec.md:58 forbids).

Hook side (`metta-tokens-record.mjs`): parse stdin payload; if it is a completed Task call
with a usage field, spawn
`execFile('metta', ['tokens', 'record', ..., '--source', 'hook'], { cwd: input.cwd ?? process.cwd() })`.
No `--change` flag, no path logic in the hook. All failures swallowed; always exit 0.

Note on expected coverage: an orchestrator session normally keeps its cwd at the **main
root** even while driving a worktree-hosted change (skills use `git -C {change_root}`, not
`cd`). So in practice rule 2 fires when a session/skill-host runs inside the worktree, and
rule 3 carries the common single-active main-root case; concurrent multi-change sessions
at the main root deliberately skip (rule 4) rather than guess.

## Files to change

- `src/util/git-worktree.ts` — add pure
  `detectWorktreeChangeName(cwd: string, worktreeDir = DEFAULT_WORKTREE_DIR): string | null`
  (path-segment math only, no I/O). This module already owns `DEFAULT_WORKTREE_DIR`, keeping
  the layout knowledge in one place. (Alternative home: `src/cli/helpers.ts` next to
  `resolveChangeRoot` — acceptable, but it drags CLI-layer imports into what should be
  functional core.)
- `src/cli/commands/tokens.ts` — replace the two-rule block at lines 35-44 with the
  four-rule ordering above (plus the `--source` option handled by the sibling research
  track; same file, coordinate the edit).
- `src/templates/hooks/metta-tokens-record.mjs` **and** `.claude/hooks/metta-tokens-record.mjs`
  (new, byte-identical per the spec) — spawn with `cwd: input.cwd ?? process.cwd()`.
- `.claude/settings.json` — PostToolUse registration for the Task matcher (existing
  PreToolUse entries untouched).
- `tests/tokens-command.test.ts` — extend with: worktree-cwd attribution beating
  multiple-actives; stale-worktree-cwd typed failure with no write; unchanged single-active
  and multi-active-no-cwd behavior. Add unit tests for `detectWorktreeChangeName` in the
  git-worktree test file (1:1 test ratio convention).

## Risks

- **Main-root sessions with multiple active changes still skip.** The hook payload cwd is
  the session cwd, not the subagent's working dir, so rule 2 rarely rescues concurrent
  multi-change sessions; their runs land in GAPS. Accepted by the spec ("never
  misattributed as a fallback"), but worth stating in the design so the GAPS wording sets
  expectations.
- **Custom `git.worktree.dir` is not honored** by segment matching — same pre-existing
  limitation as `createCliContext` (`helpers.ts:111`) and `resolveChangeRoot`
  (`helpers.ts:94`). Configured-away worktree dirs silently fall back to rules 3/4.
- **Symlinked cwds** can hide the `.metta/worktrees` segments from pure path matching;
  guard-edit realpaths for this reason (`metta-guard-edit.mjs:30-45`). Mitigate with a
  best-effort `realpathSync` on the cwd (it always exists), tolerating failure.
- **Dir-name/change-name invariant**: rule 2 trusts `basename(worktree) === changeName`,
  guaranteed by `setupChangeWorktree` for created/attached/reused modes. A hand-made
  mismatch fails safely (typed error, no write) because the derived name has no
  `.metta.yaml` — but the error message should name the derivation so the failure is
  diagnosable.
- **Coordination with the sibling `--source`/dedupe work**: both tracks edit
  `tokens.ts`; the resolution refactor should land as one coherent edit of the action
  body to avoid conflicting rewrites.

[^1]: https://code.claude.com/docs/en/hooks accessed 2026-08-08 — `cwd` ("Current working directory when the hook is invoked") is listed among the common input fields every hook event receives.
