# Design: fix-metta-guard-edit-still-false-positive-blocks-subagent

Requirement labels used below (from `spec.md`, in document order):

- **R1** — Worktree Edits Are Allowed Under the Inverted-Hosting Topology
- **R2** — Canonical Worktree Topology Remains Allowed
- **R3** — Guard Still Blocks When No Change Is Active in Either Root
- **R4** — Probe Failures Continue to Fail Open
- **R5** — Init-Phase and Issues Allow-Lists Are Unchanged
- **R6** — Regression Tests Exercise Real Discovery Semantics for the Inverted Topology

## Approach

Adopt the research recommendation: **Option 1, formulation V1c — host-derived probe root** (`research.md` recommendation; `research-two-root-probe.md` §3/V1c). The recommendation is correct and this design builds on it without deviation.

The hook keeps its exact structure — one `metta status --json` probe, one fail-closed branch, everything else fail-open — and changes only **where the single probe is rooted**. Today the probe cwd is the target file's git toplevel (`projectRoot`). Under V1c, when that toplevel is itself a metta-managed worktree (i.e. its path is `<H>/.metta/worktrees/<name>`), the probe cwd becomes the **hosting checkout `H`** instead. For any other target, the probe root is unchanged.

Why one probe at `H` is sufficient and exact (the load-bearing verified fact, `research-two-root-probe.md` §2): `ArtifactStore.discoverChanges()` at a main root aggregates both its own `spec/changes/` and every `<root>/.metta/worktrees/*/spec/changes/`. Therefore the host root's answer is a **strict superset** of the worktree root's answer, in both directions:

- *Allow direction:* if the change is visible from the worktree's own root (canonical/PR #57 topology, R2) or only from the host's `spec/changes/` (inverted topology, R1), the host probe reports it → allow.
- *Block direction:* if the host probe successfully reports no active changes, the worktree's own probe would also have reported none (host aggregates worktree state), so blocking is exactly the "no change visible from either root" condition R3 requires.

So the single host-rooted probe *implements* R1's either-allows semantics precisely — no second probe, no added latency (~670 ms end-to-end, unchanged), and no dependence on `process.cwd()` (unlike V1b, which silently fails when the session was launched from a subdirectory of the checkout).

Decision path math (outside-root early allow, init-phase allow-list, `spec/issues/` prefix) continues to be computed against `projectRoot` — the target's own checkout root — preserving R5 and the existing "allowlist computed against the worktree root" behavior byte-for-byte.

### Architecture Decision Records

**ADR-1: V1c (host-derived single probe) over V1b (conditional two-probe).**
Context: both formulations were prototyped and validated against the real CLI (`research-two-root-probe.md` §3). Decision: V1c. Rationale: zero added latency on the fixed path (V1b adds ~500 ms to *every* subagent edit in the inverted topology — the very case being fixed), independence from session cwd (V1b's containment check misses when Claude Code is launched from a subdirectory), and one fewer probe → one fewer fail-open edge to reason about (R4 surface shrinks rather than grows). Consequence: the spec's "session's checkout root" wording needs a precision tweak (ADR-4). Fallback recorded: V1b + `git rev-parse` session-root resolution remains the validated literal-spec alternative if review rejects the wording tweak.

**ADR-2: Derive the host from the target's resolved git toplevel, not from a regex over the raw target path.**
Context: the research sketch matches `targetPath` against `^(.*)/\.metta/worktrees/[^/]+/` (innermost occurrence). Decision: instead, apply pure path math to `projectRoot` — the value `git rev-parse --show-toplevel` already produced. A metta-managed worktree's toplevel is *exactly* `<H>/.metta/worktrees/<name>`, so the check is three `basename`/`dirname` calls with no innermost-match ambiguity and no chance of matching path *strings* that are not actually worktree *checkouts* (e.g. a plain directory named `.metta/worktrees/x` inside the main checkout resolves to the main toplevel and is never host-derived). This also makes the containment bound structural: the only checkout that can ever be probed is the one whose `.metta/worktrees/` physically contains the target's checkout — unrelated checkouts elsewhere on disk can never be consulted (pins the V1a rejection; verified block behavior in the prototype, `research-two-root-probe.md` §5).

**ADR-3: Omit the worktree-name/active-change match hardening.**
Context: research §5 notes a residual widening — an edit into a *stale* worktree of an inactive change is allowed while any other change is active at the host — and offers a name-match hardening (compare the `worktrees/<name>` segment against active change names). Decision: omit it from this change. Rationale: the hardening introduces a **new fail-closed path on probe success**, coupling the hook to worktree-naming and envelope details — exactly the class of assumption that produced both prior false positives. This change's purpose is eliminating false positives; the spec does not require the hardening; the residual widening is bounded to metta-created directories under the probed checkout. Recorded as a Risks item and a candidate backlog follow-up alongside Option 3 Part A.

**ADR-4: Amend the R1/R3 spec wording from "session's checkout root" to "hosting checkout root".**
See "Spec wording resolution" below for the exact edits. Rationale: V1c's decision input is the hosting root, which is the strictly more precise formulation (session-cwd-independent); in the reproduced topology the two coincide, so every written scenario still holds.

**ADR-5: Restructure, don't discard, the existing cwd-shim worktree tests.**
The cwd-answering shim stays only for pure path-math assertions; topology truth moves to a real-CLI delegating shim (R6). Details in Components.

### Spec wording resolution (R1/R3)

R1 currently says the hook must allow "whenever an active metta change is visible from either the target file's checkout root or **the session's checkout root**". V1c satisfies every written scenario (in the reproduced topology the hosting root *is* the session's checkout root, and the superset property covers the target-root direction), but its decision input is the hosting root — so the spec text should be tightened, exactly as the research anticipated. The following edits to `spec.md` land with this change:

1. **R1 body, first sentence:** replace "or the session's checkout root" with "or the checkout root hosting that worktree — the checkout whose `.metta/worktrees/` directory contains the target's checkout". Append: "(In the reproduced topology the hosting root and the session's checkout root are the same checkout; the hosting-root formulation is the precise, session-cwd-independent statement of the same guarantee.)"
2. **R1 body, last sentence:** replace "while the session's checkout reports an active change" with "while the hosting checkout reports an active change".
3. **R1, second scenario** ("Empty answer from the target root alone does not block"): reword the WHEN/AND to "WHEN the worktree checkout's own `spec/changes/` carries no state for the change AND an active change is visible from the hosting checkout root", keeping the THEN ("the hook allows the edit rather than blocking on the worktree checkout's answer alone"). Under V1c the target-root probe is subsumed by the host probe, so the scenario asserts the observable outcome, not a probe sequence.
4. **R3 body, first clause:** replace "or from the session's checkout root" with "or, for worktree-hosted targets, from the hosting checkout root". R3's scenario needs no change.

No other requirement text changes. R2, R4, R5, R6 are satisfied as written.

## Components

Two mirrored hook files change (must remain byte-identical — existing test enforces this), plus one test file. **No CLI/core source changes** (`src/cli/helpers.ts`, `src/artifacts/artifact-store.ts` untouched, per the Option 1 selection).

### 1. `src/templates/hooks/metta-guard-edit.mjs` (canonical template) and `.claude/hooks/metta-guard-edit.mjs` (deployed mirror)

One new pure function and a two-line change at the probe site. Everything else — `readStdin`, `toPhysicalPath`, `resolveTargetRoot`, the `hasActiveChange` envelope logic, the allow-lists, the block message — is untouched.

New function, inserted after `resolveTargetRoot`:

```js
// Derive the root for the active-change probe. A metta-managed worktree's
// checkout root is exactly <H>/.metta/worktrees/<name>; in that case probe
// the hosting checkout H instead of the worktree. H's `metta status`
// aggregates worktree-hosted change state (its answer is a strict superset
// of the worktree's own), so one probe at H answers correctly for both the
// canonical topology (state inside the worktree) and the inverted-hosting
// topology (state only in H's spec/changes/). Any other checkout root is
// returned unchanged. Pure string path math — cannot throw.
function deriveProbeRoot(checkoutRoot) {
  const worktreesDir = dirname(checkoutRoot)   // …/<H>/.metta/worktrees
  const mettaDir = dirname(worktreesDir)       // …/<H>/.metta
  const hostRoot = dirname(mettaDir)           // …/<H>
  if (
    basename(worktreesDir) === 'worktrees' &&
    basename(mettaDir) === '.metta' &&
    hostRoot !== mettaDir                      // guard filesystem-root degenerate cases
  ) {
    return hostRoot
  }
  return checkoutRoot
}
```

Probe site change (current lines 94–104): after `const projectRoot = await resolveTargetRoot(targetPath)`, add `const probeRoot = deriveProbeRoot(projectRoot)` and pass `cwd: probeRoot` to the existing `metta status --json` `execFile`. **`projectRoot` remains the input to every path decision below the probe** — the outside-root early allow and both allow-lists (R5) — so the guard still reasons about the target's own checkout for containment, and only the *question asked* moves to the host.

Flow after the change, per target class:

| Target's checkout root | Probe root | Behavior |
|---|---|---|
| Main checkout (not under `.metta/worktrees/`) | itself (unchanged) | identical to today |
| Worktree `<H>/.metta/worktrees/<name>`, canonical topology | `H` | allow via host aggregation (R2; today: allow via worktree's own state — same outcome) |
| Worktree, inverted topology | `H` | **allow** (R1; today: false-positive block — the fix) |
| Worktree, no active change anywhere at `H` | `H` | empty envelope → allow-lists vs `projectRoot` → block (R3) |
| Unrelated checkout elsewhere on disk | itself (derivation never matches) | identical to today — still blocks (containment bound, pins the V1a rejection) |
| `resolveTargetRoot` fallback (git missing / outside any repo) | derivation applied to the session-cwd fallback | benign; probe failure paths all fail open (R4) |

Fail-open preservation (R4), mode by mode: `metta` missing from PATH, non-zero exit, unparseable JSON, and the 5 s timeout all remain inside the **same single try/catch → `process.exit(0)`** — the diff does not touch that block. V1c adds **zero new probes**, so no new failure modes exist; `deriveProbeRoot` is string-only path math with no throw path, so the uncaught-throw-exit-1 invariant also holds. One behavior delta worth naming (policy-consistent, inherited from the existing fail-open rule): for a worktree target, a probe *failure* at the host now fails open where the pre-fix hook might have deterministically blocked after a successful empty answer from the worktree root. This is exactly the fail-open policy the spec freezes, applied to the (single) probe the hook performs.

### 2. `tests/metta-guard-edit.test.ts`

Three changes; no new test files (keeps the ~1:1 test-to-source ratio — the hook's suite grows in place).

**(a) New describe block: `metta-guard-edit hook real-CLI topology` (R6).** Uses a **delegating PATH shim** so the answer derives from real `resolveProjectRoot` + `ArtifactStore` aggregation, not cwd matching:

```sh
#!/bin/sh
exec npx tsx <REPO_ROOT>/src/cli/index.ts "$@"
```

`REPO_ROOT` interpolated from `import.meta.dirname` exactly as `tests/helpers/cli.ts` does for `CLI_PATH` (tsx is a declared devDependency; no build, no global install, CI-safe). Fixture per test: real `git init` + `git worktree add .metta/worktrees/demo -b metta/demo` (reusing the existing suite's `git()` helper and realpath'd temp-dir pattern), then topology-specific state placement — a valid `ChangeMetadata` YAML at `spec/changes/demo/.metta.yaml` using the research-validated field set (`workflow`, `created`, `status`, `current_artifact`, `base_versions`, `artifacts` — confirmed to pass Zod; no `.metta/config.yaml` needed). Cases, each run against **both** `HOOK_SOURCES` entries:

1. **Inverted topology → exit 0** (R1): state in the main root only; Write targets a file inside the worktree; session cwd = main root. *This test demonstrably fails against the pre-fix hook* — the reproduction in `research-two-root-probe.md` §1 showed exit 2 for exactly this setup, satisfying R6's "capable of failing" scenario. Implementation lands the test first and confirms the red run before the hook fix.
2. **Canonical topology → exit 0** (R2): same fixture, state placed only inside the worktree's own `spec/changes/demo/`.
3. **No state anywhere → exit 2** with the `metta-guard` stderr message (R3).
4. **Containment bound → exit 2**: a second, unrelated temp git checkout with an empty `spec/changes/`; the first fixture's main root has an active change and is the session cwd; target inside the unrelated checkout still blocks (pins ADR-2's bound as a test, not prose).
5. **Additionally, one host-probe smoke assertion** folded into case 1: session cwd set to a *subdirectory* of the main root — pinning V1c's cwd-independence (the V1b failure mode).

Budget: tsx startup is ~1–2 s per probe; ≤5 cases × 2 hook copies × 1 probe each fits comfortably — set this describe block's timeout to `120_000`.

**(b) Fail-open probe-failure cases (R4)**, in the same block, using degenerate PATH shims against the worktree fixture (probe root = host): shim exits non-zero → 0; shim emits garbage → 0; shim sleeps past the 5 s probe timeout → 0; `metta` absent from PATH → 0. These replace prose with pinned behavior for "every probe the hook performs" — which under V1c is exactly one.

**(c) Existing worktree-awareness suite (ADR-5).** Under V1c the probe cwd for worktree targets moves to the host root, which the current cwd-answering shim answers with an empty envelope — so the existing case "allows a Write … inside a worktree with an active change (cwd = main root)" **breaks as written**. Resolution: update that shim to model real one-directional aggregation — answer `{"change":"demo"}` when `pwd -P` is the main `repoDir` *or* `demoWorktree`, empty otherwise — with a comment stating that topology truth is owned by the real-CLI block and this shim exists only to keep the fast path-math cases deterministic. The remaining shim cases (`blocks inside a worktree with no active change`, `allowlist computed against the worktree root`, symlinked-root block, main-root block) pass unchanged under the updated shim and V1c probing (verified by tracing each case's probe root above). This satisfies R6's "does not rely solely on a cwd-answering shim" scenario: topology coverage derives from the real CLI; the shim covers only path math.

The byte-identity test and the init-phase allow-list suite are unchanged (R5).

### 3. Build/distribution

No changes. `copy-templates` already ships `src/templates/hooks/` → `dist/templates/hooks/`; consumers pick up the fix on their next hook install/refresh (mechanics out of scope per intent). No CLI republish semantics change — `metta status` output is untouched, so there is no version-skew concern between a consumer's installed CLI and the refreshed hook.

## Data Model

No persistent data model changes. No schema changes.

- **`metta status --json` envelopes (read-only contract, unchanged):** `{change: string, …}` (single active), `{changes: [...]}` (multiple), `{changes: [], message}` (none). The hook's existing `hasActiveChange` logic already handles all three; V1c reuses it verbatim.
- **Test fixture `ChangeMetadata` YAML:** the research-validated minimal instance (fields: `workflow`, `created`, `status`, `current_artifact`, `base_versions`, `artifacts`) written verbatim into fixtures; it must pass the real CLI's Zod validation since the delegating shim exercises real reads. No fixture `.metta/config.yaml` required.

## API Design

No public API changes. Contracts touched:

- **Hook I/O contract (unchanged):** stdin = Claude Code PreToolUse JSON (`tool_name`, `tool_input.file_path` / `notebook_path`); exit 0 = allow, exit 2 + stderr = block, exit 1 impossible by construction. Guarded tool set, block message text, and allow-list contents are all byte-identical to today.
- **New internal function:** `deriveProbeRoot(checkoutRoot: string): string` — pure, total, throw-free; returns the hosting checkout root iff `checkoutRoot` has the shape `<H>/.metta/worktrees/<name>`, else `checkoutRoot`. Lives only in the hook (both mirrors); not exported anywhere — the hook is a self-contained script by design.
- **CLI surface:** zero changes. `metta status`, `metta instructions`, `metta tokens record` behave exactly as before from every cwd (the known worktree-cwd blindness of the latter two is explicitly out of scope; Option 2 stays a backlog candidate per the research synthesis).

## Dependencies

- **Runtime:** Node built-ins only (`node:child_process`, `node:fs`, `node:path`, `node:util`) — the hook gains no imports beyond what it already uses (`basename`, `dirname` are already imported).
- **Test-time:** `tsx` (declared devDependency, already load-bearing for `tests/helpers/cli.ts` — the existing "do NOT remove" warning covers the new shim), `vitest`, real `git` on PATH (already required by the existing worktree suite).
- **No new packages. No vendor lock-in.** The only external coupling is to Claude Code's PreToolUse hook protocol (pre-existing, unchanged) and to metta's own worktree layout convention `<root>/.metta/worktrees/<change>` (metta-owned, stable since worktree mode shipped).

## Risks & Mitigations

1. **Residual allow-surface widening: stale worktrees (ADR-3).** An edit into `.metta/worktrees/<old-abandoned>/` is allowed while any change is active at the host (pre-fix: blocked). *Mitigation:* bounded to metta-created directories under the probed checkout only — unrelated checkouts provably still block (test case 4). Accepted per intent ("intended behavior for the reproduced topology"); name-match hardening logged as a follow-up backlog candidate together with Option 3 Part A (creation-time state commit), not shipped here.
2. **Block path now depends on a host probe that can fail open.** A transient host-probe failure allows an edit that a successful empty answer would have blocked. *Mitigation:* this is the spec-frozen fail-open policy (R4) applied to the hook's single probe; no new probe was added, so the failure surface did not grow. Documented in the hook comment.
3. **Path-shape false negatives in `deriveProbeRoot`** (a repo deliberately created at a path ending `…/.metta/worktrees/<x>` that is *not* a metta worktree): the hook would probe its grandparent's parent; a non-metta host makes the probe fail → fail open. *Mitigation:* only constructible by manually placing a git repo inside a directory literally named `.metta/worktrees/` — a metta-owned namespace; general nested-worktree support is explicitly out of scope per intent. No action.
4. **Existing shim test breakage under V1c.** The current "allows a Write (cwd = main root)" shim case fails once the probe root moves. *Mitigation:* handled by design, not discovered in CI — ADR-5 updates the shim to model aggregation, and the real-CLI block owns topology truth. Implementation order: land the real-CLI suite red, apply the hook fix, update the shim, confirm full green.
5. **Real-CLI test latency/flakiness (tsx startup on cold CI).** *Mitigation:* one probe per case (V1c), ≤10 real-CLI invocations total, 120 s describe timeout; tsx is a declared devDependency so `npm ci` pre-installs it (no registry fetch per invocation).
6. **Byte-identity drift between template and deployed hook.** *Mitigation:* pre-existing byte-identity test remains; both files are edited in the same commit.
7. **Spec/design divergence on "session's checkout root".** *Mitigation:* ADR-4's four exact wording edits to `spec.md` land with this change, so the shipped requirement text matches the shipped behavior; V1b remains the recorded fallback if review insists on the literal two-probe reading.
