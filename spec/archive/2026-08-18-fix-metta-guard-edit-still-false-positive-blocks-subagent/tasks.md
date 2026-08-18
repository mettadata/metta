# Tasks: fix-metta-guard-edit-still-false-positive-blocks-subagent

Design authority: `design.md` (V1c host-derived probe root, ADR-1..5). All paths are relative to the change worktree root (`/home/utx0/Code/metta/.metta/worktrees/fix-metta-guard-edit-still-false-positive-blocks-subagent/`).

Sequencing note: the design's red-then-green discipline (design Risk 4) is realized inside Task 2.1's Verify via a temporary stash of the Batch 1 hook fix — no red commit is ever landed. Known transient: after Batch 1, one existing shim test ("allows a Write ... inside a worktree with an active change (cwd = main root)") fails until Task 2.1 updates the shim (predicted by design ADR-5 / Risk 4); gates are asserted green in Batch 3.

## Batch 1 (no dependencies — tasks touch disjoint files, run in parallel)

- [x] **Task 1.1: Apply ADR-4 spec wording edits (session root -> hosting root)**
  - **Files**: `spec/changes/fix-metta-guard-edit-still-false-positive-blocks-subagent/spec.md`
  - **Action**: Apply exactly the four edits enumerated in design.md "Spec wording resolution (R1/R3)" — no other text changes:
    1. R1 body, first sentence (spec.md line 5): replace "or the session's checkout root" with "or the checkout root hosting that worktree — the checkout whose `.metta/worktrees/` directory contains the target's checkout". Append to the R1 body: "(In the reproduced topology the hosting root and the session's checkout root are the same checkout; the hosting-root formulation is the precise, session-cwd-independent statement of the same guarantee.)"
    2. R1 body, last sentence: replace "while the session's checkout reports an active change" with "while the hosting checkout reports an active change".
    3. R1 second scenario ("Empty answer from the target root alone does not block", lines 16–21): reword the WHEN/AND lines to "WHEN the worktree checkout's own `spec/changes/` carries no state for the change" / "AND an active change is visible from the hosting checkout root"; reword the THEN to "THEN the hook allows the edit rather than blocking on the worktree checkout's answer alone".
    4. R3 body, first clause (line 43): replace "or from the session's checkout root" with "or, for worktree-hosted targets, from the hosting checkout root". R3's scenario is unchanged.
    R2, R4, R5, R6 sections must be byte-identical to before.
  - **Verify**: `grep -n "hosting checkout" spec/changes/fix-metta-guard-edit-still-false-positive-blocks-subagent/spec.md` shows hits in the R1 body (x2 + parenthetical), R1 scenario 2, and R3 body; `grep -n "session's checkout root" ...spec.md` matches only inside the new ADR-4 parenthetical; `git diff --stat` touches only spec.md with edits confined to the R1 and R3 sections.
  - **Done**: All four ADR-4 edits applied verbatim, no other requirement text modified.

- [x] **Task 1.2: Implement `deriveProbeRoot()` in the guard-edit hook (template + deployed mirror, byte-identical)**
  - **Files**: `src/templates/hooks/metta-guard-edit.mjs` (canonical), `.claude/hooks/metta-guard-edit.mjs` (mirror — must remain byte-identical; edit the template, then copy)
  - **Action**: Per design Components §1 (ADR-1, ADR-2, ADR-3):
    1. Insert the `deriveProbeRoot(checkoutRoot)` function immediately after `resolveTargetRoot` (after current line 73), exactly as specified in design.md (including the explanatory comment): three `dirname` steps from `checkoutRoot`; return the host root iff `basename(worktreesDir) === 'worktrees' && basename(mettaDir) === '.metta' && hostRoot !== mettaDir`, else return `checkoutRoot` unchanged. Pure string path math, no throw path, no new imports (`basename`/`dirname` already imported).
    2. At the probe site (current lines 94–104): after `const projectRoot = await resolveTargetRoot(targetPath)`, add `const probeRoot = deriveProbeRoot(projectRoot)` and change the `metta status --json` `execFile` option from `cwd: projectRoot` to `cwd: probeRoot`.
    3. Everything else is untouched: `readStdin`, `toPhysicalPath`, `resolveTargetRoot`, `hasActiveChange`, the single try/catch → `process.exit(0)` fail-open (R4), the outside-root early allow and both allow-lists still computed against `projectRoot` (R5), and the exit-2 block message text.
    4. Do NOT add worktree-name/active-change match hardening (ADR-3 explicitly omits it).
    5. Copy the edited template over `.claude/hooks/metta-guard-edit.mjs` so the two files are byte-identical.
  - **Verify**: `cmp src/templates/hooks/metta-guard-edit.mjs .claude/hooks/metta-guard-edit.mjs` exits 0; `node --check src/templates/hooks/metta-guard-edit.mjs` passes; `node -e "process.exit(0)"`-style smoke: `echo '{"tool_name":"Read","tool_input":{}}' | node .claude/hooks/metta-guard-edit.mjs; echo $?` prints 0. Expected transient: `npx vitest run tests/metta-guard-edit.test.ts` now fails exactly one case ("allows a Write ... (cwd = main root)") — the ADR-5-predicted breakage resolved by Task 2.1.
  - **Done**: Hook probes the hosting checkout for worktree-rooted targets and its own root otherwise; all decision-path math still uses `projectRoot`; the two hook copies are byte-identical; no other behavior delta in the diff.

## Batch 2 (depends on Batch 1 — Task 1.2's hook files; single task, single file)

- [x] **Task 2.1: Real-CLI topology regression suite + fail-open cases + ADR-5 shim update**
  - **Files**: `tests/metta-guard-edit.test.ts` (only file; no new test files, per design §2 — suite grows in place)
  - **Action**: Per design Components §2 (a)–(c), against both `HOOK_SOURCES` entries:
    (a) New describe block `metta-guard-edit hook real-CLI topology` (R6), timeout `120_000`. Delegating PATH shim `#!/bin/sh\nexec npx tsx <REPO_ROOT>/src/cli/index.ts "$@"` with `REPO_ROOT` interpolated from `import.meta.dirname` (same pattern as `CLI_PATH` in `tests/helpers/cli.ts`). Fixture per test: real `git init` + `git worktree add .metta/worktrees/demo -b metta/demo` (reuse the existing suite's `git()` helper and realpath'd temp-dir pattern), plus a valid minimal `ChangeMetadata` YAML at the topology-appropriate `spec/changes/demo/.metta.yaml` using the research-validated field set (`workflow`, `created`, `status`, `current_artifact`, `base_versions`, `artifacts` — must pass the real CLI's Zod validation; no fixture `.metta/config.yaml`). Cases:
      1. Inverted topology → exit 0 (R1): state only in the main root's `spec/changes/demo/`; Write targets a file inside the worktree; fold in the host-probe smoke assertion — also run with session cwd set to a subdirectory of the main root (V1c cwd-independence).
      2. Canonical topology → exit 0 (R2): state only inside the worktree's own `spec/changes/demo/`.
      3. No state anywhere → exit 2 with `metta-guard` in stderr (R3).
      4. Containment bound → exit 2 (ADR-2): second unrelated temp git checkout with empty `spec/changes/`; first fixture's main root has an active change and is the session cwd; target inside the unrelated checkout still blocks.
    (b) Fail-open probe-failure cases (R4) in the same block, worktree-target fixture, degenerate PATH shims: shim exits non-zero → 0; shim emits garbage JSON → 0; shim sleeps past the 5 s probe timeout → 0; `metta` absent from PATH → 0.
    (c) ADR-5: update the existing worktree-awareness cwd shim to model one-directional aggregation — answer `{"change":"demo"}` when `pwd -P` is `repoDir` OR `demoWorktree`, empty envelope otherwise — with a comment stating topology truth is owned by the real-CLI block and the shim exists only to keep fast path-math cases deterministic. Leave the remaining shim cases, the init-phase allow-list suite, and the byte-identity test unchanged (R5).
  - **Verify**: Red-then-green (design Risk 4, R6 "capable of failing"): `git stash push -- src/templates/hooks/metta-guard-edit.mjs .claude/hooks/metta-guard-edit.mjs && npx vitest run tests/metta-guard-edit.test.ts -t "real-CLI" ; git stash pop` — the inverted-topology case must FAIL (exit 2 observed where 0 expected) against the pre-fix hook; then `npx vitest run tests/metta-guard-edit.test.ts` passes fully green, including the previously-broken cwd-shim case.
  - **Done**: Suite covers canonical topology, inverted topology (incl. subdirectory-cwd assertion), no-change block, containment bound, and all four probe-failure fail-open modes via real CLI discovery; cwd shim updated per ADR-5; red run against the pre-fix hook demonstrated and recorded in the task/commit notes.

## Batch 3 (depends on Batches 1–2)

- [x] **Task 3.1: Full gates run and closeout check**
  - **Files**: none expected (read-only verification; only trivial fixes surfaced by gates may be applied, staying within Batch 1–2 file scope)
  - **Action**: Run the project gates from the worktree root: `npm run lint` (tsc --noEmit), `npm test` (full vitest suite — includes the byte-identity test and both hook copies), `npm run build` (tsc + copy-templates — confirms `dist/templates/hooks/metta-guard-edit.mjs` ships the fix; design §3: no build-script changes needed). Confirm no doc files require edits (design: no API/doc surface changed; changelog is handled at ship) and that `git status` shows no stray artifacts (scratch shims, temp fixtures) left in the tree.
  - **Verify**: `npm run lint && npm test && npm run build` all exit 0; `cmp src/templates/hooks/metta-guard-edit.mjs dist/templates/hooks/metta-guard-edit.mjs` exits 0 after build; `git status --porcelain` shows only intended tracked changes.
  - **Done**: All gates green on the complete change; dist copy carries the fixed hook; working tree clean of incidental files.
