# Design: fix-guard-edit-worktree-write-friction-caused-cross-repo

## Approach

Three-layer defense-in-depth, exactly as selected in [research.md](research.md). All three
layers are additive; no existing behavior changes for non-worktree changes, non-write
commands, or metta CLI classification.

1. **Layer 1 — instruction path discipline (prevent, soft).** The executor and verifier
   personas gain a Shell-Write Path Discipline section and a new Deviation Rule 6
   (STOP-and-report on silent-write anomalies, never a bash rewrite). The `metta-execute`
   skill gains the spawn-contract binding and an escalation paragraph; six sibling
   executor-dispatching skills gain one identical escalation sentence. Every template edit
   lands byte-identically in its `.claude/` twin (hard test gate).
2. **Layer 2 — guard-bash write-target blocking (prevent, hard).** The guard-bash hook
   gains a heuristic write-target extractor (E1: `>`/`>>`, `tee`, `cp`/`mv` on the
   existing quote-mask utilities) plus target-anchored topology resolution (T1: the
   guard-edit pattern ending in one `metta status --json` probe). Confident absolute
   targets inside the hosting checkout, outside the worktree and outside `<H>/.metta/`,
   are blocked with exit 2 while the change is worktree-hosted. Whole check fails open.
3. **Layer 3 — main-checkout tree-clean detection (detect).** A write-once
   `git status --porcelain --untracked-files=no` baseline of the MAIN checkout is captured
   when implementation instructions are first issued for a worktree-hosted change; it is
   re-compared as a pre-`markArtifact` gate in `metta complete implementation` (fail on
   new dirt only) and as a caller-fed `main-checkout-clean` step in the merge-safety
   pipeline (worktree-hosted ships only). Pre-existing dirt warns, never blocks.

### Decision records (ADR-style, condensed)

| # | Decision | Rationale | Rejected |
|---|----------|-----------|----------|
| D1 | Persona-primary discipline + one-line escalation in six sibling skills (research-template Option A) | Persona file loads on every spawn regardless of dispatching skill; `quick`/`auto`/`fix-issues` run their own implementation loops (the incident shape) | Minimum 3-file compliance (leaves incident entry points uninstructed); full contract duplicated per skill (drift) |
| D2 | Regex/token extractor on existing quote-mask utilities, confidence-gated (E1) | ~80–120 lines, same idiom and fail-open direction as the rest of the hook; extra parser correctness only rescues cases the spec mandates fail-open | Shell-word parser (E2, ~300+ lines); npm AST package (E3 — hooks are dependency-free by contract) |
| D3 | Target-anchored topology via `git rev-parse --show-toplevel` + `deriveProbeRoot` + `metta status --json` `worktree` field (T1) | cwd-anchoring misses the incident (zeus ran with cwd = main checkout); `metta status --json` is the stable public contract (`src/schemas/change-metadata.ts:117`) | cwd path math (T2); direct YAML state read (T3 — fragile, bypasses aggregation) |
| D4 | Baseline stored at `<mainRoot>/.metta/scratch/tree-baselines/<change>.yaml` via `StateStore` | Gitignored/untracked (never dirties main, invisible to `-uno`); matches skill-session scratch precedent; Zod-validated via existing machinery | `.metta.yaml` field or `spec/changes/` file (machine-specific paths would enter git history — contradicts `artifact-store.ts:139-165` precedent); global `state.yaml` (contention) |
| D5 | Capture write-once inside the `instructions.ts` started-stamp block | The exact code-level "before execution begins" moment, with best-effort + write-once semantics already established there; retries keep comparing against the original snapshot | Capture at propose (misattributes operator edits); prose-only capture (violates code-not-prose) |
| D6 | Complete gate exits 4 with JSON `type: 'main_tree_contamination'` | Reuses the existing `complete.ts` error boundary; `instanceof` differentiation lets automation distinguish it without a new exit code | New exit code (breaks exit-code consistency) |
| D7 | Ship step is caller-fed (`ship.ts` resolves topology + baseline; pipeline stays state-store-free) and emitted **only** for worktree-hosted ships | Preserves the pipeline's clean dependency shape and keeps the non-worktree step list byte-identical (strict reading of the spec's "step sequence identical" scenario) | Pipeline reading StateStore/ArtifactStore itself |
| D8 | Guard check placed **before** the offender scan | A command blocked for write-target reasons must never act as a Tier-2 credential keepalive (existing "blocked command leaves every token file byte-untouched" invariant, hook lines 512–523) | After offender scan |

No new dependencies, no vendor lock-in: everything rides git, Node built-ins, and the
existing StateStore/Zod stack.

### Spec-literal refinements (so verification doesn't flag drift)

- The porcelain command is run as `git status --porcelain=v1 -z --untracked-files=no` —
  `=v1 -z` is a NUL-safe refinement of the same porcelain format the spec names
  (handles paths with spaces and `R old -> new` rename records).
- The `-uno` flag (spec-pinned) means **new untracked files created in main are invisible
  to layer 3**; that residual is covered by layer 2's write-target block. Documented
  accepted residual.

## Components

### C1 — Agent-template and skill-contract path discipline (layer 1)

All edits are **additive** (existing Deviation Rules 1–5, the Rules list, and the
completion contract are untouched — the spec's "existing rules preserved" scenario).

**`src/templates/agents/metta-executor.md`** (28 lines today; no mention of
`change_root` anywhere — confirmed):

- Append **Deviation Rule 6** after Rule 5: silent-write anomaly (Edit/Write reports
  success, change not on disk, verified via Bash) → STOP immediately; report target
  path(s), which tool claimed success, and the evidence; NEVER rewrite the content via
  bash (heredoc, redirection, script).
- Insert a new **`## Shell-Write Path Discipline`** section between Deviation Rules and
  Rules:
  - The prompt-provided `change_root` is the only authoritative root; never re-derive
    target paths from session cwd, `git rev-parse`, or repository-layout reading when a
    prompt-provided `change_root` exists.
  - Every bash-mediated file write (`>`, `>>`, heredoc, `tee`, `cp`, `mv`, self-authored
    scripts) MUST target an absolute path under `change_root`; writes outside it are
    forbidden. No prompt-provided `change_root` → no bash file writes at all; ask the
    orchestrator.
  - Verification mechanism: the existing per-task `git -C "{change_root}" status/commit`
    step doubles as write verification. Nothing to commit after a claimed-success
    Edit/Write → confirm via Bash `grep`/`cat` that the content is genuinely absent (a
    no-op edit is not an anomaly); confirmed absence → Deviation Rule 6. (No mandatory
    per-edit re-Reads — Read may share the harness's untrustworthy view, and the git step
    is free.)
  - Scope note: the rule covers writes the agent *directs* at a path, not internal
    side-writes of build/test commands (`node_modules/`, caches).

**`src/templates/agents/metta-verifier.md`** (64 lines): same Shell-Write Path
Discipline section (adapted — the verifier's only sanctioned write is the verification
artifact), plus an **appended** clarification at the line-63 heredoc-fallback
instruction: the fallback applies ONLY to an explicit refusal (`tool_use_error`); a
silent-write anomaly (success claimed, disk unchanged, verified via Bash `cat`) is
STOP-and-report, never a heredoc; when used, the heredoc target MUST be the exact
orchestrator-provided path under `change_root`. **Append, do not reword** — the three
literal strings pinned by `tests/agents-byte-identity.test.ts:23-27` must survive.

**`src/templates/skills/metta-execute/SKILL.md`**:

- Extend the spawn-contract paragraph (line 48, after the `git -C "{change_root}"`
  clause): executors are bound by change_root shell-write path discipline; include the
  `change_root` value in every executor prompt.
- Add a **Silent-write STOP handling (orchestrator)** paragraph beside the existing STOP
  handling (line 65): escalate to the user immediately with the executor's report; do NOT
  re-dispatch with bash-write instructions and do NOT perform the write yourself, in or
  outside the worktree.
- Add Rule 6's one-line form to the "include in every executor subagent prompt" Deviation
  Rules block (lines 58–63).

**Six sibling skills** (`metta-quick`, `metta-auto`, `metta-fix-issues`, `metta-fix-gap`,
`metta-propose`, `metta-verify` SKILL.md): one identical sentence in each Rules/STOP
section:

> If an executor or verifier STOP-reports a silent-write anomaly (Edit/Write success with
> no on-disk effect), escalate to the user with the report; never work around it via bash
> writes or orchestrator-performed writes.

The sentence must be byte-identical across all six (pinned by test, see C1 tests).

**Mirroring:** every file above is edited in both `src/templates/...` and its `.claude/`
twin in the same change — `tests/template-deploy-sync.test.ts` byte-identity is a hard
gate. `dist/` regenerates via `copy-templates` (package.json build); never edited by hand.

**C1 tests** — new `tests/shell-write-path-discipline.test.ts` (keeps 1:1 ratio),
following the `it.each`-over-template+deployed pattern of
`tests/agents-byte-identity.test.ts` and the SKILL_TREES pattern of
`tests/skill-template-anchoring.test.ts`:

- Pin executor markers in both copies: `'Shell-Write Path Discipline'`, `'Rule 6'`,
  `'MUST target an absolute path under'`, the bash-fallback prohibition.
- Pin the verifier refusal/silent-success split marker; existing
  `agents-byte-identity.test.ts` string pins must still pass (append-only edit).
- Pin the execute-skill escalation paragraph in both skill trees.
- Cross-skill consistency: assert the identical escalation sentence appears in all six
  sibling SKILL.md files in both trees (closes the wording-drift gap).

### C2 — Guard-bash write-target check (layer 2)

Both `.claude/hooks/metta-guard-bash.mjs` and `src/templates/hooks/metta-guard-bash.mjs`
(byte-identical today — verified; the identity test at
`tests/metta-guard-bash.test.ts:1206` enforces it forever). Hook stays dependency-free;
add `node:child_process` + `node:util` (`promisify(execFile)`) imports only.

**New functions** (placed alongside the existing tokenizer, with a KNOWN LIMITATION
header comment mirroring lines 133–152 enumerating the fail-open set):

```js
// Pure. Returns confident absolute candidate write targets, [] for most commands.
function extractWriteTargets(command) -> string[]

// Ports from metta-guard-edit.mjs, comment-annotated "port of metta-guard-edit.mjs — keep in sync":
function toPhysicalPath(p) -> string                  // nearest-existing-ancestor realpath + tail re-append
async function resolveTargetRoot(target) -> string|null   // git rev-parse --show-toplevel, 5s timeout, null on failure
function deriveProbeRoot(root) -> string              // <H>/.metta/worktrees/<name> -> H, else identity

// One cached metta status --json probe per event (cache keyed by probeRoot).
// Returns { worktreeRoot: string } when a worktree-hosted change is active, else null.
async function probeWorktreeContext(probeRoot) -> { worktreeRoot } | null

// Orchestrates T1 per target. Returns null (allow) or the block descriptor.
async function checkWriteTargets(event, targets) -> null | { target, mainRoot, worktreeRoot }
```

**Extraction rules** (per `splitCommandSegments` segment, using `computeQuoteMask` +
`stripQuoteChars`):

- Unquoted `>` runs: `>`, `>>`, and fd-prefixed `N>`/`N>>` capture the next word as a
  candidate; `>&`, `<`, `<<`/`<<<`, `>(` are skipped (note: `|`/`&` are chain separators,
  so `2>&1` splits harmlessly — the tail segment extracts nothing). Heredocs need no
  dedicated logic: the file write in `cat <<EOF > /path` is the `>` redirection (the
  exact zeus shape).
- First non-env-prefix word `tee` → all non-flag args; `cp`/`mv` → last non-flag arg,
  plus `-t <dir>` and `--target-directory=<dir>` forms.
- **Confidence gate** (where fail-open lives): a candidate counts only if the segment's
  quoting parsed (`unterminated === false`) and, after quote-stripping, it is a plain
  absolute path — starts with `/`, no `$`, backtick, `\`, or glob metacharacters.
  Relative paths, `$VAR`, `$(...)`, `~` → not extracted → allowed. (Unterminated quoting
  fails **open** here, deliberately opposite to the metta-tokenizer's fail-closed
  fallback — for write targets the spec mandates fail-open, and an unterminated quote is
  a bash syntax error that never executes.)

**Classification:** block iff physical target is inside probe root `H` AND NOT inside
worktree `W` AND NOT inside `<H>/.metta/` (shared allow set — covers `scratch/`,
`logs/`, `gates/`, and `worktrees/` itself, making sibling-worktree writes an accepted
non-goal per intent Out of Scope). Everything outside `H` (`/tmp`, scratchpad, other
repos) never matches.

**Insertion point in `main()`:** immediately after the background-Bash rejection block
(after line 425), **before** `tokenize(command)` and the offender scan (D8). Shape:

```js
try {
  const targets = extractWriteTargets(command);      // fast path: [] -> zero subprocess cost
  if (targets.length > 0) {
    const hit = await checkWriteTargets(event, targets);
    if (hit) {
      appendAuditLog(event, 'block', { sub: null, third: null }, 'worktree-write-target', null,
        { target: hit.target, mainRoot: hit.mainRoot, worktreeRoot: hit.worktreeRoot });
      process.stderr.write(/* names hit.target, hit.mainRoot, and the expected change_root
        prefix hit.worktreeRoot; suggests "write under <W> instead, or use the Edit tool";
        names the emergency bypass */);
      process.exit(2);
    }
  }
} catch { /* whole check fails open */ }
```

Existing tier authorization, classification lists, tokenization, background-Bash
rejection, and audit logging are untouched (spec: behavior-preserving).

**C2 tests** — extend `tests/metta-guard-bash.test.ts` (black-box `spawnSync` against
both HOOK_SOURCES; no in-process unit testing — hooks export nothing and run `main()` on
import; this is the accepted deviation, matching all prior hook changes):

- Fixture: temp dir `main/` (git init) + `main/.metta/worktrees/<name>/`, PATH-shimmed
  `metta` emitting `{"change":"<name>","worktree":"<abs path>"}` (transplant the
  guard-edit shim pattern, `tests/metta-guard-edit.test.ts:219-231`).
- Blocked matrix (exit 2, stderr contains target + worktree prefix): `echo x > <main>/src/f`,
  `cat <<EOF > <main>/f`, `printf x | tee <main>/f`, `tee -a`, `cp a <main>/f`,
  `mv a <main>/f`, `cp -t <main>/d a`.
- Allowed matrix (exit 0): same forms targeting `<worktree>/...`; `<main>/.metta/scratch/...`;
  relative targets; `> /tmp/x`; `$VAR` / `$(...)` targets; non-write commands
  (`git status`, `npm test`); shim reporting no active change; shim reporting a
  main-hosted change (no `worktree` field); `metta` absent from PATH (probe fail-open);
  `2>&1` forms.
- Invariant pin: compound command combining an authorized Tier-2 metta call with a
  blocked write → exit 2 AND the session token file byte-unchanged (D8).
- Regression: the full pre-existing suite passes unmodified.

### C3 — Main-checkout tree-clean baseline (layer 3)

**New module `src/util/git-tree-baseline.ts`** (alongside `git-worktree.ts`; functional
core / imperative shell) + **new schema `src/schemas/tree-baseline.ts`** — signatures in
API Design, shapes in Data Model. Barrel-exported: `export * from './tree-baseline.js'`
in `src/schemas/index.ts`; `export * from './util/git-tree-baseline.js'` in `src/index.ts`.

**Root-resolution helper** `resolveMainCheckoutRoot` in `src/cli/helpers.ts`, next to
`resolveChangeRoot` (line 92). Covers both invocation topologies; returns `null` ⇒
layer 3 disengaged — which automatically covers `git.enabled: false` and
worktree-fallback modes (no worktree ⇒ no injected `metadata.worktree` and no
`detectWorktreeChangeName` match).

**Capture** — `src/cli/commands/instructions.ts`, inside the existing
`preStatus === 'ready' || 'in_progress'` guard (lines 149–150), beside the started-stamp
try/catch (lines 151–189): when `artifactId === 'implementation'` and
`resolveMainCheckoutRoot(...)` returns a root, call `captureMainTreeBaseline(mainRoot,
changeName)` — write-once (no-op if the baseline file exists, so verify-fail →
re-execute retries keep the original snapshot), stderr warning listing pre-existing
dirty paths, whole call in its own try/catch that warns and never blocks (mirrors the
timings-stamp semantics).

**Complete gate** — `src/cli/commands/complete.ts`, inserted immediately before
`markArtifact` (line 230), **outside** the `if (!isWildcard)` block (implementation
generates `**/*`, a wildcard — the gate must not sit inside the file-existence branch):

```ts
if (artifactId === 'implementation') {
  const mainRoot = await resolveMainCheckoutRoot(ctx.projectRoot, changeName, metadata)
  if (mainRoot !== null) {
    const cmp = await compareMainTree(mainRoot, changeName)
    if (!cmp.hasBaseline) { /* stderr warn: no baseline, cannot attribute dirt; pass */ }
    else if (cmp.newDirt.length > 0) throw new MainTreeContaminationError(/* lists ONLY newDirt
      paths + status codes; remediation: "If these are your own edits, commit or stash them
      in the main checkout and re-run metta complete implementation." */, cmp.newDirt)
    else if (cmp.preExisting.length > 0) { /* stderr warning only */ }
  }
}
```

Error boundary (`complete.ts:701-705`): differentiate via `instanceof` —
`type: err instanceof MainTreeContaminationError ? 'main_tree_contamination' : 'complete_error'`;
exit code stays 4. The gate performs only `git status` against main — no
checkout/reset/stash ever (spec: detection never mutates).

**Ship preflight** — `src/ship/merge-safety.ts` + `src/cli/commands/ship.ts` (D7):

- Pipeline constructor gains an additive options param:
  `constructor(cwd, gateRegistry?, options?: { mainCheckout?: MainCheckoutCleanInput })`
  with `MainCheckoutCleanInput = { root: string; baselineEntries: TreeEntry[] | null }`.
  `run()` signature unchanged.
- New step `main-checkout-clean`, emitted **only when `options.mainCheckout` is
  provided**, placed after `finalize-check` (line 112) and before the existing
  `preflight` (line 114): runs `git status --porcelain=v1 -z --untracked-files=no` at
  `mainCheckout.root`, applies pure `diffTreeState` (imported from
  `../util/git-tree-baseline.js` — pure functions only; the pipeline stays
  StateStore-free): `baselineEntries === null` → `skip` ("no baseline recorded — cannot
  attribute dirt"); new dirt → `fail` with detail naming the newly-dirty paths → return
  `{ status: 'failure', steps }`; pre-existing only → `pass` with warning detail.
  Non-worktree ships: no input → no step → step list byte-identical to today.
- `ship.ts` (before constructing the pipeline, line 38): derive the change name from
  `sourceBranch.match(/^metta\/(.+)$/)`; if it matches and
  `ctx.artifactStore.getChange(name)` + `resolveMainCheckoutRoot` yield a main root, read
  the baseline (`StateStore(join(mainRoot, '.metta'))`, `baselineRelPath(name)`) and pass
  `mainCheckout` into the constructor. All resolution best-effort — any failure ⇒ omit
  the input (non-worktree behavior). On non-dry-run `result.status === 'success'`,
  best-effort `deleteIfExists(baselineRelPath(name))` (baseline lifecycle tidy-up; stale
  files are harmless — keyed by change name).

Note (pre-existing behavior, unchanged): the legacy `preflight` step still hard-fails an
operator-dirty main checkout when shipping from main — it must, since `git checkout`/merge
need a clean tree. The warn-never-block requirement binds the **new** step only.

**C3 tests:**

- New `tests/git-tree-baseline.test.ts` (1:1 with the module): pure `parsePorcelain`
  matrix (clean, ` M`, `MM`, renames with `-z` two-field records, paths with spaces);
  pure `diffTreeState` matrix (new path, status transition ` M`→`MM` counts as new dirt,
  pre-existing attribution, clean); shell capture/compare against a real `mkdtemp` git
  repo (merge-safety fixture pattern) including write-once semantics, `main_root`
  mismatch treated as missing baseline, and schema round-trip through StateStore.
- Extend `tests/merge-safety.test.ts`: worktree fixture via `git worktree add`;
  fail (new dirt, detail names paths) / pass+warn (pre-existing only) / skip (no
  baseline) matrix; **non-worktree step-list byte-identity** against pre-change
  expectations.
- Extend the cli-complete harness (`tests/cli-complete.test.ts` pattern): contamination
  fails completion listing only new paths (demonstrably fails against pre-change
  behavior); no-baseline warn-and-pass; pre-existing-dirt-only passes; non-worktree
  change unchanged; JSON error carries `type: 'main_tree_contamination'` and exit 4;
  failure path performs no git mutation of main.
- Instructions capture coverage (extend `tests/complete-stamps-timings.test.ts`'s
  instructions harness or the cli-worktree tests): baseline recorded write-once for
  worktree-hosted implementation, warning on pre-existing dirt, no baseline for
  non-worktree changes, git failure warns and never blocks.

### Complete file-edit list

| # | File | Kind |
|---|------|------|
| 1–2 | `src/templates/agents/metta-executor.md` + `.claude/agents/metta-executor.md` | edit (additive) |
| 3–4 | `src/templates/agents/metta-verifier.md` + `.claude/agents/metta-verifier.md` | edit (append) |
| 5–6 | `src/templates/skills/metta-execute/SKILL.md` + `.claude/skills/metta-execute/SKILL.md` | edit |
| 7–8 | `src/templates/skills/metta-quick/SKILL.md` + `.claude/skills/metta-quick/SKILL.md` | one-liner |
| 9–10 | `src/templates/skills/metta-auto/SKILL.md` + `.claude/skills/metta-auto/SKILL.md` | one-liner |
| 11–12 | `src/templates/skills/metta-fix-issues/SKILL.md` + `.claude/skills/metta-fix-issues/SKILL.md` | one-liner |
| 13–14 | `src/templates/skills/metta-fix-gap/SKILL.md` + `.claude/skills/metta-fix-gap/SKILL.md` | one-liner |
| 15–16 | `src/templates/skills/metta-propose/SKILL.md` + `.claude/skills/metta-propose/SKILL.md` | one-liner |
| 17–18 | `src/templates/skills/metta-verify/SKILL.md` + `.claude/skills/metta-verify/SKILL.md` | one-liner |
| 19–20 | `.claude/hooks/metta-guard-bash.mjs` + `src/templates/hooks/metta-guard-bash.mjs` | edit (byte-identical pair) |
| 21 | `src/util/git-tree-baseline.ts` | new |
| 22 | `src/schemas/tree-baseline.ts` | new |
| 23 | `src/schemas/index.ts` | barrel export |
| 24 | `src/index.ts` | barrel export |
| 25 | `src/cli/helpers.ts` | add `resolveMainCheckoutRoot` |
| 26 | `src/cli/commands/instructions.ts` | capture wiring |
| 27 | `src/cli/commands/complete.ts` | gate + error-boundary `instanceof` |
| 28 | `src/ship/merge-safety.ts` | constructor option + step |
| 29 | `src/cli/commands/ship.ts` | caller-fed input + cleanup |
| 30 | `tests/shell-write-path-discipline.test.ts` | new |
| 31 | `tests/metta-guard-bash.test.ts` | extend |
| 32 | `tests/git-tree-baseline.test.ts` | new |
| 33 | `tests/merge-safety.test.ts` | extend |
| 34 | complete/instructions test harnesses (`tests/cli-complete.test.ts` et al.) | extend |

`dist/` is generated by `copy-templates` — no manual edits. Implementation checklist
item: confirm the install/init gitignore template covers `.metta/scratch/` for consumer
projects (metta's own root `.gitignore` already does; even if untracked-not-ignored,
`-uno` keeps the checks unaffected).

## Data Model

New schema file `src/schemas/tree-baseline.ts` (strict, per the no-unvalidated-writes
convention):

```ts
export const TreeEntrySchema = z.object({
  path: z.string(),                 // repo-relative, as reported by porcelain
  status: z.string().length(2),     // XY porcelain v1 code, e.g. ' M', 'MM', 'R '
  renamed_from: z.string().optional(), // second field of -z rename records
}).strict()

export const MainTreeBaselineSchema = z.object({
  change: z.string(),               // change slug (also the filename key)
  main_root: z.string(),            // absolute main-checkout root at capture time
  recorded_at: z.string().datetime(),
  entries: z.array(TreeEntrySchema),
}).strict()

export type TreeEntry = z.infer<typeof TreeEntrySchema>
export type MainTreeBaseline = z.infer<typeof MainTreeBaselineSchema>
```

Storage: `<mainRoot>/.metta/scratch/tree-baselines/<change>.yaml`, read/written through
`StateStore(join(mainRoot, '.metta'))` (schema-validated on every read and write).
Deliberately **no** change to `ChangeMetadataSchema` — nothing machine-specific enters
the git-tracked `.metta.yaml`. Single writer (write-once capture) + readers ⇒ no
`acquireLock` needed.

**Dirt-attribution semantics:** a current entry is *new dirt* when its path is absent
from the baseline map **or** its XY status differs from the baseline's (spec: "became
dirty (or changed state)"); otherwise it is *pre-existing*. `main_root` mismatch between
the stored baseline and the resolved root ⇒ treated as missing baseline (warn/skip,
never a false comparison).

## API Design

### `src/util/git-tree-baseline.ts`

```ts
// ---- functional core (pure, no I/O) ----
export function parsePorcelain(raw: string): TreeEntry[]
//   input: stdout of `git status --porcelain=v1 -z --untracked-files=no`
export function diffTreeState(
  baseline: TreeEntry[], current: TreeEntry[],
): { newDirt: TreeEntry[]; preExisting: TreeEntry[] }

export const BASELINE_DIR = 'scratch/tree-baselines'
export function baselineRelPath(change: string): string  // `${BASELINE_DIR}/${change}.yaml`

// ---- imperative shell (execFile git + StateStore; pattern: git-worktree.ts) ----
export async function readMainTreeStatus(mainRoot: string): Promise<TreeEntry[]>
export async function captureMainTreeBaseline(
  mainRoot: string, change: string,
): Promise<{ created: boolean; preExisting: TreeEntry[] }>   // write-once: created=false if file exists
export async function compareMainTree(
  mainRoot: string, change: string,
): Promise<{ hasBaseline: boolean; newDirt: TreeEntry[]; preExisting: TreeEntry[] }>
export async function deleteMainTreeBaseline(mainRoot: string, change: string): Promise<void> // best-effort

// ---- typed error (custom-error-class convention) ----
export class MainTreeContaminationError extends Error {
  constructor(message: string, public readonly newDirt: TreeEntry[])
}
```

The error is thrown by the `complete.ts` gate wrapper, never by the pure core.

### `src/cli/helpers.ts`

```ts
export async function resolveMainCheckoutRoot(
  projectRoot: string,
  changeName: string,
  metadata: Pick<ChangeMetadata, 'worktree'>,
): Promise<string | null>
// 1. resolveChangeRoot(projectRoot, metadata) !== projectRoot  -> projectRoot (main-checkout invocation)
// 2. detectWorktreeChangeName(projectRoot) === changeName      -> strip `<worktreeDir>/<name>` suffix
//    (path math, guard-edit precedent); cross-check/fallback:
//    `git rev-parse --path-format=absolute --git-common-dir` -> dirname(.git) = main root
// 3. otherwise null  -> not worktree-hosted; layer 3 disengaged
```

### `src/ship/merge-safety.ts`

```ts
export interface MainCheckoutCleanInput {
  root: string
  baselineEntries: TreeEntry[] | null   // null = no baseline recorded
}

export class MergeSafetyPipeline {
  constructor(
    private cwd: string,
    private gateRegistry?: GateRegistry,
    private options?: { mainCheckout?: MainCheckoutCleanInput },
  ) {}
  // run(sourceBranch, targetBranch, dryRun) — signature and MergeSafetyStep/Result shapes unchanged
}
```

New step id: `'main-checkout-clean'` (`pass` | `fail` | `skip`, `detail` names paths).

### Guard-bash (hook-internal, no exports — hooks are standalone)

`extractWriteTargets(command)`, `toPhysicalPath(p)`, `resolveTargetRoot(target)`,
`deriveProbeRoot(root)`, `probeWorktreeContext(probeRoot)`, `checkWriteTargets(event,
targets)` as specified in C2. Audit reason string: `'worktree-write-target'`.

### CLI-visible contract changes

- `metta complete implementation` (worktree-hosted, contaminated): exit 4, JSON
  `{ error: { code: 4, type: 'main_tree_contamination', message } }`; message lists only
  newly-dirty paths + remediation. All other complete paths unchanged.
- `metta ship` (worktree-hosted): steps output may include `main-checkout-clean`;
  failure exits 1 via existing handling. Non-worktree ships byte-identical.
- Guard-bash: new exit-2 class for main-checkout write targets during worktree-hosted
  changes; stderr names offending path + expected change_root prefix + bypass hint.

## Dependencies

- **No new packages.** Layer 2 uses only Node built-ins already permitted in hooks
  (`node:child_process`/`node:util` added to guard-bash's imports); layer 3 uses
  `execFile` git (existing pattern) + existing `StateStore`/Zod/YAML stack.
- **Internal:** guard-bash newly (and only at check time) shells to `git rev-parse` and
  `metta status --json` — same external contract guard-edit already depends on;
  `merge-safety.ts` newly imports two **pure** functions from
  `util/git-tree-baseline.js`; `complete.ts`/`instructions.ts`/`ship.ts` import the new
  helper + module. No coupling of the pipeline to StateStore/ArtifactStore (D7).
- **Build/test infra:** existing `copy-templates`, `template-deploy-sync` byte-identity
  gate, guard-bash/guard-edit black-box harnesses, merge-safety mkdtemp git fixtures.
- **Ordering within the change:** the C2 tests need the PATH-shim fixture before the
  blocked-matrix tests; C3's complete/ship wiring needs module+schema+helper first.
  Layers are otherwise independent and can be built in parallel.
- **Lock-in:** none — git, Node, filesystem only.

## Risks & Mitigations

- **Guard false positives train users to disable the guard** (top layer-2 risk).
  Mitigated by: confident-plain-absolute-target-only extraction, `<H>/.metta/` allow
  set, worktree-hosted-context gating, probe fail-open, whole-check try/catch, and
  stderr that names the fix ("write under `<W>`, or use the Edit tool"). The
  highest-residual legitimate write — bash-editing `spec/issues/*.md` at H during a
  worktree change — is exactly the banned contamination class; Edit/Write-tool writes
  (guard-edit's own allow-list) remain the sanctioned path.
- **Guard false negatives** (interpreters, `sh -c`, `xargs`, `rsync`, `$VAR`/relative
  targets, `git -C <main>` ops): accepted residual per spec fail-open requirement;
  compensated by layers 1 and 3.
- **Hook latency:** zero added cost for commands with no confident absolute write target
  (pure string ops); candidate commands pay 1 `git rev-parse` + 1 `metta status --json`
  (~200–600 ms) — the same cost guard-edit pays on every Edit/Write, here only on rare
  absolute-path bash writes.
- **Tier-2 keepalive interaction:** placing the check before the offender scan preserves
  the blocked-commands-never-reprime invariant; pinned by the compound-command test.
- **Layer-3 false positives from concurrent operator edits to main** during long
  executions: `-uno` keeps new files from flagging; the diagnostic's remediation
  (commit/stash and re-run — each attempt re-compares fresh) makes recovery one step;
  anything dirty at baseline time only ever warns. Partial staging (` M`→`MM`) flags by
  design (spec: changed state); remediation text covers it.
- **Layer-3 blind spots:** untracked new files (`-uno`), contamination committed
  directly to main, and interpreter writes — covered by layer 2 and layer 1
  respectively; ship's re-compare narrows the post-complete window.
- **Missing/stale baseline** (feature shipped mid-flight, scratch wiped, moved
  checkout): warn-and-pass (complete) / skip (ship), never a hard failure on absence;
  `main_root` mismatch treated as absence.
- **Template drift between copies:** impossible to ship — `template-deploy-sync.test.ts`
  and the guard-bash byte-identity test are hard gates; the six-skill sentence gets its
  own cross-file consistency pin.
- **Pinned verifier strings:** the append-only amendment strategy keeps
  `tests/agents-byte-identity.test.ts:23-27` passing; any accidental reword fails CI.
- **Ported topology code duplication** (~60 lines guard-edit → guard-bash): accepted —
  hooks are standalone by contract (no shared imports; copied individually into consumer
  projects); ports carry "keep in sync" annotations. A shared hooks lib would change the
  install contract for one consumer — not warranted.
- **Instructions-soft-enforcement limitation** (layer 1 alone is bypassable): by design —
  layers 2 and 3 are the hard backstops; this change must ship all three together.
- **More mid-run escalations** if the harness bug recurs: intended
  autonomy-for-correctness trade (intent Impact); the STOP surfaces a harness-level
  fault only the user can resolve.
- **Follow-up (out of scope, log as issue):** reviewer/specifier/uat-runner
  path-anchoring parity — `metta-reviewer.md:23` writes a relative
  `spec/changes/<change>/review.md`, a lower-severity cross-checkout vector.
