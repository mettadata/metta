# Research: Option 1 — Hook-Level Two-Root Probe with Either-Allows Semantics

Change: `fix-metta-guard-edit-still-false-positive-blocks-subagent`
Researcher scope: evaluate the hook-only fix — after a successful empty envelope from the target's checkout root, re-probe `metta status --json` from the session root and allow if either root reports an active change. No CLI changes (`resolveProjectRoot`, `ArtifactStore` untouched).

All claims below marked **[verified]** were reproduced empirically on 2026-08-18 against the real installed CLI (`metta` 0.5.0 on PATH) and a consumer-shaped fixture (temp scratchpad, inverted-hosting topology: `spec/changes/demo-change/.metta.yaml` in the main checkout, worktree at `.metta/worktrees/demo-change/` with no own change state).

## 1. Reproduction confirmed (pre-fix behavior)

- `metta status --json` with cwd = worktree checkout → `{"changes":[],"message":"No active changes"}`; same command with cwd = main root → active `demo-change`. **[verified]** One-directional discovery exactly as the intent describes.
- Current hook (`.claude/hooks/metta-guard-edit.mjs`) run with session cwd = main root, target = file inside the worktree → **exit 2, "no active metta change"**. **[verified]** This is the zeus false positive.
- Critical structural fact: the successful-empty-envelope branch (`hasActiveChange === false` after a *successful* probe, hook lines 109–116) is the **only** fail-closed path; every probe failure already exits 0. The fix slots in precisely at that branch.

## 2. A load-bearing discovery about aggregation

`ArtifactStore.discoverChanges()` at a main root aggregates both local changes **and** worktree-hosted changes (`<root>/.metta/worktrees/*/spec/changes/`, worktree copy wins on collision — `src/artifacts/artifact-store.ts:202+`). Empirically confirmed: with change state present *only inside the worktree* (canonical PR #57 topology), `metta status --json` from the **main root** still reports the change (with a `worktree:` field). **[verified]**

Consequence: **the hosting root's answer is a strict superset of the worktree root's answer.** For any target under `<H>/.metta/worktrees/<name>/`, a single probe at `H` covers both the canonical and the inverted topology. This enables a zero-added-latency variant (V1c below) that the intent's literal description of Option 1 doesn't mention but that stays fully inside the hook-level family.

## 3. Implementation sketch

Three formulations of Option 1, in increasing refinement. All confine edits to `src/templates/hooks/metta-guard-edit.mjs` + the byte-identical `.claude/hooks/metta-guard-edit.mjs` mirror.

### V1a — literal: unconditional second probe at `process.cwd()`

After the empty-envelope branch, re-probe with `cwd: toPhysicalPath(process.cwd())`; allow if active. Simplest, but **rejected**: it widens the allow surface to *any* checkout on disk (§5) and pays the second probe on every would-block evaluation, not just worktree targets.

### V1b — conditional two-root probe, containment-bounded (prototyped and validated)

Insert after the existing `hasActiveChange` early-allow (hook line ~116), before the allow-list section:

```js
// Two-root probe (inverted-hosting topology): the target's checkout answered
// "no active changes", but a metta-managed worktree may host its change state
// in the MAIN checkout's spec/changes/ (one-directional discovery). Re-probe
// from the session root and allow if it reports an active change — but ONLY
// when the target lives under the session root's .metta/worktrees/ area, so
// edits into unrelated checkouts are not newly allowed.
const sessionRoot = toPhysicalPath(process.cwd())
if (sessionRoot !== projectRoot) {
  const worktreesArea = join(sessionRoot, '.metta', 'worktrees')
  const relToArea = relative(worktreesArea, targetPath || '')
  const targetInSessionWorktrees =
    targetPath !== '' && relToArea !== '' &&
    !relToArea.startsWith('..') && !isAbsolute(relToArea)
  if (targetInSessionWorktrees) {
    try {
      const { stdout } = await execAsync('metta', ['status', '--json'], {
        cwd: sessionRoot, timeout: 5000,
      })
      const s = JSON.parse(stdout)
      const active = typeof s?.change === 'string' ||
        (Array.isArray(s?.changes) && s.changes.length > 0)
      if (active) process.exit(0)
    } catch {
      process.exit(0) // probe failure fails open, matching policy
    }
  }
}
```

Prototype results against the fixture **[all verified]**:

| Scenario | Expected | Got |
|---|---|---|
| Inverted topology: worktree target, session = main root with active change | allow (0) | 0 |
| Main-root target, active change (first probe unchanged) | allow (0) | 0 |
| Target in an *unrelated* metta-shaped checkout, session has active change | block (2) | 2 |
| No active change anywhere, worktree target | block (2) | 2 |
| Canonical topology (state in worktree) | allow via first probe, no second probe | verified via CLI probes |

Envelope-shape handling reuses the existing `hasActiveChange` logic; all three shapes of `metta status --json` (`{change}` single, `{changes:[…]}` multiple, `{changes:[], message}` none) confirmed in `src/cli/commands/status.ts:64–115`.

### V1c — host-derived single probe (recommended refinement)

Instead of a *second* probe: when `targetPath` matches `^(.*)/\.metta/worktrees/[^/]+/` (use the innermost/last occurrence), set the **first and only** probe cwd to the captured host root `H` rather than the worktree toplevel. Because of the aggregation superset (§2), one probe at `H` answers correctly for both topologies. Fallbacks: no match → current behavior (probe target root); probe failure → fail open, unchanged. Path math for the outside-root check and allow-lists keeps using the target's checkout root (`projectRoot`), preserving the existing "allowlist computed against the worktree root" test.

Advantages over V1b:
- **No added latency** — one subprocess, same as today (§4).
- **Independent of session cwd** — V1a/V1b silently fail to fix the topology when Claude Code was launched from a *subdirectory* of the checkout (then `process.cwd()` ≠ checkout root and the containment check never matches). V1c derives the host from the target path, which is always available. (V1b can patch this with a cheap `git rev-parse --show-toplevel` at cwd, ~5ms, at the cost of one more failure mode to reason about.)
- Same bounded widening as V1b (§5).

Spec-fit note: the ADDED requirement says "visible from either the target file's checkout root or the session's checkout root." V1c satisfies every written scenario (in the reproduced topology, host root == session checkout root), but its decision input is the *hosting* root, not literally the session root. If V1c is chosen, the requirement wording should be adjusted to "the target's checkout root or the checkout root hosting the worktree" — a strictly more precise formulation. If the spec text is treated as frozen, ship V1b (optionally with the `git rev-parse` cwd-root fix); it is the literal match and is fully validated.

## 4. Latency

Measured on this machine (Node 22, warm cache) **[verified]**:

- `metta status --json` (global dist install): **~500ms** per invocation (Node CLI startup dominates).
- Current hook, single-probe allow path: **~670ms** end-to-end.
- V1b two-probe path (inverted-topology allow, and the no-change block): **~1.2–1.35s**.

Cost profile of V1b: the second probe is **conditional** — it runs only when (a) the first probe succeeded with an empty envelope, (b) the target is inside the session root's `.metta/worktrees/` area, and (c) sessionRoot ≠ target root. So canonical-topology edits, main-root edits, and non-worktree targets pay nothing extra. **But in the inverted topology — the very case being fixed — every subagent Write/Edit takes the two-probe path**, adding ~500ms per edit for the life of the change (dozens to hundreds of edits per execution phase). V1c eliminates this entirely (~670ms, unchanged from today).

Worst case for V1b is ~10s (two 5s probe timeouts) — well under Claude Code's 60s default hook timeout, and a PreToolUse hook timeout does not block the tool call anyway (platform-level fail-open)[^1].

## 5. Security: bounding the widened allow surface

Pre-fix, a target `T` with checkout root `R(T)` is allowed iff: probe at `R(T)` fails (fail-open), or `R(T)` reports active, or outside-root / allow-list. The widening per variant:

- **V1a (unbounded either-allows):** newly allows any `T` whose own root successfully reports empty while the session root has an active change — **including a completely unrelated metta project elsewhere on disk** (session on project A with active change; write to `~/code/projectB/src/x.ts` where B is a metta project with no active change: today exit 2, V1a exit 0). This exceeds the intent's scope ("only the metta-managed `.metta/worktrees/<change>/` topology") and is the reason to reject the literal formulation. Note the surface was never airtight — a *non*-metta unrelated checkout already fails open today — but V1a would newly open *metta-managed* checkouts, the one class the guard demonstrably protects.
- **V1b/V1c (containment-bounded):** newly allowed set is precisely: *targets inside the session/host project's own `.metta/worktrees/` area, when that project has ≥1 active change, and the worktree's own checkout reports none.* Verified that an unrelated checkout target still blocks (exit 2) under V1b. **[verified]** Residual widening within that bound: an edit into a **stale worktree of a different (inactive) change** — e.g. `.metta/worktrees/old-abandoned/` left on disk while `new-change` is active — is allowed. Optional hardening: name-match the worktree directory segment against the active change name(s) from the probe JSON (`status.change` / `status.changes[].change`). This closes the stale-worktree case at the cost of coupling the hook to worktree-naming and envelope details; given worktrees are metta-created as `.metta/worktrees/<change-name>/`, the hardening is cheap and recommended but not required by the spec.
- The symlink discipline is preserved: `sessionRoot` goes through `toPhysicalPath`, matching the existing physical-vs-physical comparison rules, so the symlinked-root fail-open fixed previously cannot re-open.

## 6. Failure modes

- **Second probe fails** (non-zero exit, bad JSON, timeout; metta-missing is impossible here since the first probe succeeded on the same PATH): exit 0, fail open — mandated by the ADDED requirement "for every probe the hook performs." One consequence worth stating in review: a worktree-target edit that today blocks *deterministically* (first probe empty → exit 2) can under V1b become an allow via transient second-probe failure. That is policy-consistent (all probe failures fail open) but is a behavior delta on the block path.
- **`process.cwd()` not the checkout root** (session launched in a subdir): V1a/V1b containment check misses → the false positive persists. Not a safety failure (fails toward blocking) but an effectiveness gap. V1c is immune; V1b needs the `git rev-parse` cwd-root addition.
- **Hook crash:** the new code introduces no new throw paths outside the try/catch (path math on strings only); uncaught-throw exit 1 remains impossible from this block.

## 7. Test strategy — real-CLI inverted-topology fixture

The reproduction fixture (scratchpad `consumer/`: real git repo + real `git worktree add` + main-root-only `.metta.yaml`, `.metta/` containing only `worktrees/`) translates directly into the test suite, and importantly `metta status` needs **no** `.metta/config.yaml` to answer **[verified]** — the fixture stays minimal.

Recommended shape, extending `tests/metta-guard-edit.test.ts`:

1. **Real-CLI delegating shim** (satisfies the "not a cwd-answering shim" requirement): the hook execs `metta` from PATH, so tests prepend a bin dir whose `metta` script is `#!/bin/sh\nexec npx tsx <REPO_ROOT>/src/cli/index.ts "$@"` — the exact pattern already blessed by `tests/helpers/cli.ts` (`CLI_PATH`, tsx as declared devDependency; no build required, no global install required, CI-safe). The answer then derives from real `resolveProjectRoot` + `ArtifactStore` aggregation semantics — the shim only bridges PATH to the source CLI.
2. **Fixture per test group:** temp repo, `git worktree add .metta/worktrees/demo -b metta/demo`, then per-topology state: inverted = valid `ChangeMetadata` YAML at `<main>/spec/changes/demo/.metta.yaml` only (copy the field set from the reproduction fixture: workflow/created/status/current_artifact/base_versions/artifacts — it passes Zod **[verified]**); canonical = same YAML inside the worktree only.
3. **Cases:** (a) inverted topology worktree Write → exit 0 [this test fails against the pre-fix hook — demonstrated in §1, satisfying the "demonstrably capable of failing" scenario]; (b) canonical topology → exit 0 (no regression); (c) no state anywhere → exit 2; (d) unrelated second temp checkout with empty `spec/changes/`, session cwd in fixture main root → exit 2 (containment bound pinned as a test, not just prose); (e) fail-open per probe: shim variants that exit non-zero / emit garbage / sleep past timeout → exit 0. Keep both `HOOK_SOURCES` entries and the byte-identity assertion.
4. **Budget:** tsx startup is ~1–2s per probe; with up to 2 probes × 2 hook copies × ~6 cases, keep the existing 60s suite timeout or raise to 120s. (Under V1c it's one probe per case — another small point in its favor.)
5. The existing cwd-answering shim cases can remain for the pure path-math assertions (allowlist-vs-worktree-root, symlink), but topology answers must come from the delegating real-CLI shim.

## 8. Consumer rollout

- Edit both copies: `src/templates/hooks/metta-guard-edit.mjs` (canonical template) and `.claude/hooks/metta-guard-edit.mjs` (deployed mirror); the suite's byte-identity test enforces sync.
- `npm run build` → `copy-templates` already copies `src/templates/hooks` → `dist/templates/hooks`; no build-script changes needed.
- Consumers (zeus) pick it up on the next `metta install`/hook refresh from the new dist — distribution mechanics are explicitly out of scope and unchanged. No consumer-side state migration needed: the fix reads existing state where it already lives, which is exactly why Option 1 (unlike Option 3) protects in-flight inverted-state changes immediately.
- No CLI republish semantics change: `metta status` output is untouched, so no version-drift or schema concerns.

## 9. Effort estimate

- Hook change: ~25–35 lines × 2 mirrored files (prototype already written and validated).
- Tests: ~150–200 lines (fixture builders + 6–8 cases), reusing established patterns.
- Spec deltas: already authored in `spec.md` (minor wording adjustment if V1c chosen).
- Total: **0.5–1 day** including CI validation. Low regression risk: the only touched decision branch is the empty-envelope block path; all early-allow paths are unreachable-from-diff.

## 10. Assessment

**Pros**
- Smallest possible blast radius: one hook file (mirrored), zero CLI/core changes; `metta status`/`instructions`/`tokens record` semantics untouched for every other consumer.
- Fully validated end-to-end against the real CLI and the exact reproduced topology before any code lands.
- Immediately fixes in-flight inverted-state changes in consumer projects (Option 3 cannot).
- Fail-open policy preserved mechanically (same try/catch pattern).
- The V1c refinement makes the fix latency-free and session-cwd-independent while staying hook-level.

**Cons**
- Treats the symptom at the guard, not the discovery asymmetry: `metta instructions` / `metta tokens record` invoked from a worktree cwd remain blind to main-hosted state (explicitly out of scope, but Option 2 would fix them too).
- V1b (the literal spec-matching form) adds ~500ms to *every* edit in the inverted topology and depends on `process.cwd()` being the checkout root.
- Either-allows, however bounded, is a real (small) widening: stale-worktree edits become allowed while any change is active, unless the name-match hardening is added.
- Two more probe-failure paths that fail open (policy-consistent, but more open edges to reason about).

## Recommendation

**Score: 8/10.**

Option 1 is the right fix for this change: minimal, hook-local, empirically validated against the reproduced defect, protective bounds intact (unrelated checkouts still block — proven by prototype test), and it repairs consumer projects' in-flight changes the moment hooks are refreshed. The deductions: it leaves the underlying CLI discovery asymmetry in place (Option 2's territory), and the literal V1a formulation is not shippable as described — the either-allows must be containment-bounded to the hosting project's `.metta/worktrees/` area to avoid newly allowing edits into unrelated metta checkouts.

Concrete recommendation within the option: ship **V1c** (host-derived probe root — single subprocess, both topologies, cwd-independent) with the worktree-name/active-change match as cheap hardening, and adjust the new spec requirement's wording from "session's checkout root" to "the checkout root hosting the worktree." If the design phase prefers zero spec-wording drift, **V1b + `git rev-parse` session-root resolution** is the validated fallback at the cost of ~500ms per edit in the fixed topology.

[^1]: https://code.claude.com/docs/en/hooks accessed 2026-08-18 — 60s default hook timeout; a timed-out PreToolUse hook does not block the tool call.
