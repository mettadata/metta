# Research: Finalize hook placement and CLI surfacing for UAT.md generation

Topic: WHERE and HOW to hook UAT.md generation into `Finalizer.finalize`
(`src/finalize/finalizer.ts`) and surface it in `src/cli/commands/finalize.ts`.

All line references are against current `main` (commit `1ccfed3d7`).

---

## 1. Insertion point: Option A (pre-archive) vs Option B (post-archive)

### Ground truth about `archive()`

`ArtifactStore.archive` (`src/artifacts/artifact-store.ts:108-118`) is a
**directory move, not a copy**: it computes `archiveName = <date>-<name>`
(line 109), `mkdir -p spec/archive` (line 114), then
`rename(spec/changes/<name>, spec/archive/<archiveName>)` (line 115 — `move`
is `rename` aliased at line 1). Every file present in the change directory at
that moment is swept into the archive wholesale.

**Nothing enumerates change-dir files strictly.** Checked:

- The completeness gate (`finalizer.ts:65-79`) checks the `metadata.artifacts`
  status map from `.metta.yaml`, not files on disk. An extra `UAT.md` file is
  invisible to it.
- `SpecMerger.merge` (`src/finalize/spec-merger.ts:60-66`) only probes for
  `changes/<name>/spec.md` by exact path; no `readdir` of the change dir.
- `ArtifactStore.listChanges` (`artifact-store.ts:90-106`) enumerates
  *directories* under `spec/changes/`, never files inside one.
- The only `readdir` in the finalize path is `listChanges` above; grep of
  `src/finalize/` and `src/state/state-store.ts` finds no other enumeration.

So an extra `UAT.md` in `spec/changes/<name>/` is inert to every other
finalize step. No hazard there.

### Option A — write into `spec/changes/<name>/` immediately before `archive()`

Insertion point: **between line 150 (close of the applying-merge conflict
return) and line 152 (`// Step 6: Archive the change`)** — i.e. a new "Step
5b" after the real merge has been written and conflict-checked, before
`artifactStore.archive(changeName)` at line 153.

Pros:

- **Exactly the spec's mandated semantics** (spec.md requirement "UAT Script
  Generation At Finalize": "written to `spec/changes/<name>/UAT.md` so that
  the existing archive move sweeps it in"). The archive-sweep scenario falls
  out for free from the `rename` semantics above.
- **Every failure path is already upstream.** Incomplete artifacts returns at
  lines 68-79, dry-run-merge conflict at 86-96, gate failure at 110-120,
  caller dry-run at 125-135, applying-merge conflict at 138-150. UAT
  generation placed at line 151 is structurally unreachable on all of them —
  the "No Stray UAT On Failed Finalize Paths" requirement needs zero extra
  guards.
- **The assembler can reuse `ArtifactStore` read APIs.**
  `readArtifact`/`artifactExists` (`artifact-store.ts:135-145`) are hardwired
  to `changes/<name>/...`. Pre-archive, `stories.md`, `spec.md`, `intent.md`,
  and `summary.md` are all readable through the store. Writing the output is
  one call: `artifactStore.writeArtifact(changeName, 'UAT.md', content)`.
- **The CLI auto-commit needs no change.** `finalize.ts:177-186` adds
  `spec/archive/${result.archiveName}` wholesale, so the swept-in `UAT.md` is
  committed automatically.
- **Interaction with Step 6b / Step 7: none.** gates.yaml (lines 156-169) is
  written into the archive dir after the move; doc generation (lines 171-188)
  touches `docs/` only. Order is A → archive → gates.yaml → docs; no step
  reads or overwrites `UAT.md`.

Cons / hazards (all manageable):

1. **Reported path vs actual final location.** The file is written to
   `spec/changes/<name>/UAT.md` but one line later lives at
   `spec/archive/<archiveName>/UAT.md`. Reporting the pre-archive path would
   be stale by the time the CLI prints it. Mitigation: track a boolean
   `uatGenerated` at write time, then compute the reported path **after**
   `archive()` returns, from the returned `archiveName`:
   `join(this.specDir, 'archive', archiveName, 'UAT.md')`. This also dodges
   the midnight-rollover hazard — `archive()` computes its own date stamp
   (line 109), so never pre-compute `<date>-<name>` independently.
2. **Non-atomic write on the degraded path.** `StateStore.writeRaw`
   (`src/state/state-store.ts:76-80`) is a plain `writeFile` — no
   temp-and-rename. If the process died mid-write, a truncated `UAT.md`
   would be swept into the archive. Mitigation: assemble and render the
   entire document **in memory** inside the try block and make the
   `writeArtifact` call the last statement; on any throw in the catch,
   optionally `state.deleteIfExists` the partial file
   (`state-store.ts:88-90` provides exactly this). In practice a single
   in-memory string write failing partway is vanishingly rare.
3. **Dry-run:** the dry-run return at lines 125-135 precedes the insertion
   point, so no code path can write UAT.md in dry-run mode. Satisfied by
   construction.

### Option B — write into `spec/archive/<archiveName>/` after `archive()` returns

This would mirror the Step 6b gates.yaml pattern (lines 156-169): after line
153, `writeFile(join(this.specDir, 'archive', archiveName, 'UAT.md'), ...)`.

Pros:

- `archiveName` (and therefore the exact reported path) is known before the
  write — no post-hoc path computation.
- A generation failure trivially leaves nothing behind in a directory that
  no longer exists.

Cons:

- **Directly violates the spec.** Two scenarios pin Option A semantics:
  "a `UAT.md` is written into `spec/changes/<name>/` after the spec merge
  and before `artifactStore.archive` runs" and the archive-sweep scenario.
  Option B fails both as written.
- **Loses the `ArtifactStore` read path.** After the move, `stories.md` /
  `spec.md` / `summary.md` live under `spec/archive/<archiveName>/`, which
  `readArtifact` (`artifact-store.ts:139-141`) cannot address — the
  assembler would need raw `fs` reads with hand-built archive paths,
  duplicating path logic that exists nowhere else.
- Reads-after-move also means the source material is read *after* the
  point of no return, for no benefit — the same data was sitting in the
  change dir moments earlier.
- No failure-path advantage in practice: under Option A the write happens
  after all abort paths anyway, so both options only ever write on runs
  that will archive.

### Verdict

**Option A, firmly.** It is what the spec mandates, and inspection confirms
it holds up: `archive()` is a `rename` so the sweep is guaranteed and free;
nothing enumerates change-dir contents; all five failure/dry-run exits are
upstream of the insertion point. The only real hazards (stale reported path,
non-atomic write) have one-line mitigations described above. Option B's only
advantage (path known at write time) is recovered in Option A by deriving
the reported path from `archive()`'s return value.

---

## 2. `FinalizeResult` field shape and null/absent semantics

Current interface: `finalizer.ts:11-24`. Precedents: `docsGenerated:
string[]` is a **required** field set on every return literal (all six of
them); `incompleteArtifacts?` is **optional**, present only on its abort
path (documented at lines 19-23). The finalizer itself never writes to the
console; all surfacing happens in the CLI from result fields — degradation
info must therefore travel on the result, not via `console.*` in the
finalizer. (The lone prior art for warn-to-stderr is `ConfigLoader.load`'s
env-var warning, `config-loader.ts:155`, which is not a pattern the
finalizer uses.)

Recommended shape:

```ts
export interface FinalizeResult {
  // ...existing fields unchanged...
  /** Path to the generated UAT.md (post-archive location); null when
   *  generation was disabled, skipped (dry-run/abort paths), or degraded. */
  uatPath: string | null
  /** Set only when UAT generation failed and finalize degraded per the
   *  warn-and-continue requirement. */
  uatError?: string
}
```

- **Required `uatPath: string | null`**, not optional: the compiler then
  forces every one of the six return literals (lines 69-78, 87-95, 111-119,
  126-134, 141-149, 193-201) to state a value, eliminating
  forgot-to-set bugs. All abort/dry-run literals get `uatPath: null`. This
  mirrors the `docsGenerated` discipline.
- **Optional `uatError?: string`**, mirroring `incompleteArtifacts?`: absent
  on every path except degraded generation. Use the existing
  `getErrorMessage` (`src/util/errors.js`, already used by ConfigLoader) to
  stringify the caught error.

Semantics matrix:

| Path | `uatPath` | `uatError` |
|---|---|---|
| Success, `uat.enabled: true` | `spec/archive/<archiveName>/UAT.md` (absolute, via `join(this.specDir, 'archive', archiveName, 'UAT.md')`) | absent |
| Success, `uat.enabled: false` | `null` | absent |
| Dry-run | `null` | absent |
| Degraded (assembly/render/write threw) | `null` | error message |
| Any abort path (incomplete/conflict/gates) | `null` | absent |

Sketch of the finalizer change (Step 5b + post-archive path resolution):

```ts
// after line 150, before Step 6:
let uatGenerated = false
let uatError: string | undefined
if (this.projectRoot) {
  try {
    const config = await /* ConfigLoader load, see section 5 */
    if (config.uat.enabled) {
      const content = /* assembler, fed `gates` in-memory (section 4) */
      await this.artifactStore.writeArtifact(changeName, 'UAT.md', content)
      uatGenerated = true
    }
  } catch (err) {
    uatError = getErrorMessage(err)   // warn-and-continue
  }
}

const archiveName = await this.artifactStore.archive(changeName)   // existing line 153
const uatPath = uatGenerated
  ? join(this.specDir, 'archive', archiveName, 'UAT.md')
  : null
// final return (line 193): { ..., uatPath, ...(uatError ? { uatError } : {}) }
```

Note the `this.projectRoot` guard matches Step 7's guard (line 173).
Several `finalizer.test.ts` fixtures construct `Finalizer` without
`projectRoot` (e.g. the basic archive test at lines 43-56); guarding keeps
those tests green and matches the existing "no projectRoot = no
config-dependent steps" contract. The real CLI always passes `projectRoot`
(`finalize.ts:43-51`), so the "generation is never skipped when enabled"
scenario is unaffected in production runs.

---

## 3. CLI output changes (`src/cli/commands/finalize.ts`)

The three error JSON blocks (`incomplete_artifacts` lines 63-69, `conflict`
lines 82-87, `gates_failed` lines 100-106) and the catch-block shapes
(`finalize_locked` line 196, `finalize_error` line 200) are **not touched**.
Only the shared success block changes.

**JSON mode** — the success payload at lines 139-146 currently emits
`{ status, change, archive, gates, merged }` (note: `docsGenerated` is
deliberately *not* surfaced today, so there is no precedent forcing every
result field into JSON — `uatPath` is added because the spec requires it):

```ts
outputJson({
  status: options.dryRun ? 'dry_run' : 'finalized',
  change: name,
  archive: result.archiveName,
  gates: result.gates,
  merged: result.specMerge.merged,
  uatPath: result.uatPath,                                   // string | null
  ...(result.uatError ? { uatWarning: result.uatError } : {}),
})
```

- `uatPath` is always present in the success payload: the path string on
  success, `null` on disabled/degraded — exactly the spec's "UAT Path In
  Finalize Output" contract. Because the block is shared with dry-run,
  `dry_run` payloads also carry `uatPath: null`; this is additive and
  harmless (the spec constrains only the `finalized` payload, and dry-run
  provably never generates).
- `uatWarning` appears **only** on degraded runs ("`uatPath: null`
  accompanied by a warning field" per the degradation requirement). Keeping
  it conditional avoids polluting the happy-path payload with a permanent
  `uatWarning: null`.

**Human mode** — in the non-dry-run success branch (lines 159-171), after
the `Specs merged:` line (line 169):

```ts
if (result.uatPath) {
  console.log(`  UAT script: ${result.uatPath}`)
}
if (result.uatError) {
  console.error(color(`Warning: UAT generation failed: ${result.uatError}`, 33))
}
```

- No line when disabled (`uatPath === null`, no `uatError`) — matches the
  "no UAT line" scenario.
- Warning uses `color(..., 33)` (yellow) via the existing `color` helper
  from `../helpers.js` (already imported, line 5), on stderr, consistent
  with how failures print via `console.error` elsewhere in this file. Exit
  status stays zero because none of the `process.exit(N)` paths are
  involved.
- The dry-run branch (lines 148-158) is untouched: dry-run never generates,
  so there is nothing to print.

Test impact: `tests/cli-finalize.test.ts` (76 lines) currently only asserts
error paths (exit 2/3); new assertions for `uatPath` in the success JSON and
the disabled/degraded variants go there per the intent's test plan.

---

## 4. gates.yaml timing — assembler must take gate results in-memory

Confirmed. The order in `finalizer.ts` is:

1. Step 4 (`lines 100-121`): `gateRegistry.runAll(...)` produces
   `gates: GateResult[]` **in memory** (line 105).
2. Proposed Step 5b (UAT generation) at line ~151.
3. Step 6 (line 153): archive move.
4. Step 6b (lines 156-169): gates.yaml is written **into the archive dir**
   (`spec/archive/<archiveName>/gates.yaml`, line 159) — and only when
   `gates.length > 0` (line 156).

So at UAT-generation time, `gates.yaml` does not exist anywhere on disk
(not in the change dir, and the archive dir hasn't been created). The
assembler **must receive the Step 4 `GateResult[]` as a parameter** for its
machine-verified annotations; it must not attempt to read `gates.yaml`.
This is the same data Step 6b will serialize moments later (gate name,
status, duration — lines 163-167), so the spec's "consult gates.yaml"
intent is satisfied by consuming its in-memory source. The assembler should
treat an empty/absent gate array as "no annotation derivable" (the
best-effort clause), which also covers the `gates.length === 0` case where
no gates.yaml will ever be written. `summary.md` by contrast IS on disk in
the change dir pre-archive and is read via `artifactStore.readArtifact`.

---

## 5. `uat.enabled` config read — mirror the Step 7 `config.docs` pattern

Existing pattern (`finalizer.ts:171-188`): Step 7 lazily
`await import('../config/config-loader.js')`, constructs
`new ConfigLoader(this.projectRoot)`, calls `load()`, reads `config.docs`,
all inside a try/catch whose catch swallows everything ("Doc generation
failure MUST NOT block finalize", line 186). `ConfigLoader` is per-call,
short-lived by design (`config-loader.ts:107-115` doc comment), with an
internal `cachedConfig` per instance (line 119). It is **not injected** into
`Finalizer` — only `projectRoot` is (constructor line 32), and that is the
sole prerequisite.

After the schema work adds `uat: UatConfigSchema.default({})` to
`ProjectConfigSchema` (`src/schemas/project-config.ts:87-106`, mirroring
`docs: DocsConfigSchema.default({})` at line 97), `config.uat.enabled` will
be available on every `load()` with the correct `true` default for configs
that omit the key.

Two wiring options:

- **(a) Duplicate the pattern:** Step 5b gets its own dynamic import +
  `new ConfigLoader(this.projectRoot)` + `load()` in its own try/catch,
  exactly like Step 7. Pro: zero coupling between steps, matches existing
  code verbatim. Con: two config loads per finalize (two separate loader
  instances, so the per-instance cache doesn't help) — cheap (3 small YAML
  file reads) but redundant.
- **(b) Single shared load:** hoist one `ConfigLoader` instance creation
  (still lazy-imported) so Step 5b and Step 7 share one instance and its
  cache, each step keeping its **own** try/catch so a UAT-side failure
  can't change Step 7's behavior or vice versa.

**Recommend (b)** — one `ConfigLoader` instance created after the real
merge succeeds, used by both steps, with independent try/catches. It
preserves each step's independent degradation semantics (UAT failure →
`uatError`; docs failure → silent skip, unchanged) while avoiding the
double read. If the reviewer prefers minimal diff, (a) is fully acceptable
and spec-compliant; the spec only requires reading `uat` "the same way
`config.docs` is read today".

Failure semantics under either option: if `load()` itself throws inside
Step 5b's try, that is a UAT-generation failure → degrade with `uatError`
(warn-and-continue), never abort finalize. If `this.projectRoot` is
undefined (library/test construction), skip generation with
`uatPath: null` — same silent-skip contract Step 7 already has.

---

## Recommendation summary

1. **Option A** — new Step 5b in `Finalizer.finalize` between line 150 and
   line 152: config check → in-memory assembly (fed `gates` from Step 4) →
   single `artifactStore.writeArtifact(changeName, 'UAT.md', content)`, all
   inside one try/catch that degrades to `uatError`. Guarded by
   `this.projectRoot`, exactly like Step 7.
2. Compute the reported path **after** `archive()` returns:
   `join(this.specDir, 'archive', archiveName, 'UAT.md')` when generation
   succeeded, else `null`.
3. `FinalizeResult` gains required `uatPath: string | null` (all six return
   literals updated, compiler-enforced) and optional `uatError?: string`.
4. CLI success JSON gains always-present `uatPath` and
   conditionally-present `uatWarning`; human mode gains one `UAT script:`
   line when `uatPath` is set and a yellow stderr warning line when
   `uatError` is set. Error shapes and exit codes untouched.
5. Assembler API takes `GateResult[]` in-memory; it never reads gates.yaml.
6. Config via one shared lazily-imported `ConfigLoader` instance for Steps
   5b and 7, independent try/catches per step.

## Risks

- **Truncated UAT.md on mid-write crash** (writeRaw is non-atomic,
  `state-store.ts:76-80`). Low likelihood; mitigate by writing last from a
  fully assembled string, optionally `deleteIfExists` in the catch.
- **`uatPath` reports a path the finalizer never verified post-move.** The
  `rename` is atomic-per-POSIX for same-filesystem moves, so if `archive()`
  returned, the file is there; no extra stat needed.
- **Test-fixture ripple:** making `uatPath` required touches all six return
  literals and any test that constructs `FinalizeResult` objects directly
  (none found — tests call `finalize()` and assert fields, so only new
  assertions are needed).
- **Shared ConfigLoader (option b) subtly couples Step 5b and Step 7** if
  implemented with a shared try/catch — the recommendation explicitly keeps
  per-step try/catches to prevent that.
- **Date rollover** between generation and archive is fully avoided by
  deriving the path from `archive()`'s returned `archiveName`; do not
  reintroduce an independent date computation.
