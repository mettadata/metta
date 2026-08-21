# Tasks for fix-metta-propose-runs-entire-lifecycle-through-finalize

Change root: `/home/utx0/Code/metta/.metta/worktrees/fix-metta-propose-runs-entire-lifecycle-through-finalize` (all paths below are relative to it; run all commands from it).

Authoritative blueprint: `spec/changes/fix-metta-propose-runs-entire-lifecycle-through-finalize/design.md`. Every string marked *(anchor)* below is load-bearing and shared verbatim between skill text and tests — do NOT paraphrase.

## Batch 1 (no dependencies)

- [x] **Task 1.1: Restructure both propose SKILL.md copies (ship gate, --ship alias, Critical reword)**
  - **Files**: `.claude/skills/metta-propose/SKILL.md`, `src/templates/skills/metta-propose/SKILL.md` (BOTH copies, byte-identical — same edits applied to each; existing sync tests will fail otherwise)
  - **Action**: Read design.md §§1–3 ("Propose SKILL.md — Step 8 restructure", "Critical section reword", "Step 1 `--ship` alias + Step 3 clarifier") in the change root and apply all four edits to BOTH files identically:
    1. **Step 1** — immediately after the existing `--stop-after` parse block (~lines 45–51), insert:
       ```markdown
          **Parse optional `--ship` from `$ARGUMENTS`:**

          - If `$ARGUMENTS` contains the token `--ship`, remove it from `$ARGUMENTS` and set `STOP_AFTER = "ship"`. `--ship` is an alias for `--stop-after ship` — forward it to the CLI as `--stop-after ship` (there is no CLI `--ship` flag). If both `--ship` and `--stop-after <value>` are present, `--ship` takes precedence.
          - The remaining text is the description.
       ```
       Also append one sentence to the existing "**Scope of `STOP_AFTER`:**" bullet: `` The special value `ship` is NOT a planning-phase artifact: it means "run to merge" and is handled by the Step 8 ship opt-in, never by the Step 3 boundary check. `` The command matrix is unchanged.
    2. **Step 3** — add one bullet to the "Stop-after boundary check" list, after the two boundary conditions:
       ```markdown
          - `ship` is not a planning boundary: when `STOP_AFTER = "ship"` (or persisted `stop_after: ship`), this check never fires for any artifact — do not hunt for a `ship` artifact; continue the loop to `all_complete` and apply the Step 8 ship opt-in.
       ```
       Resume-command mapping is unchanged.
    3. **Step 8** — replace the current Step 8 sub-steps a–f in full with the block given in design.md §1 (sub-steps a–c unchanged, new d = default PR-open stop, ship-gate marker paragraph, e–g = relocated checks-watch/merge/cleanup). Load-bearing anchors that must appear exactly:
       - Ship-gate marker line *(anchor, exactly once in the file)*: ``**Ship opt-in — the following sub-steps run ONLY when `STOP_AFTER = "ship"` (or the change record's persisted `stop_after` is `ship`):**``
       - Default phrase *(anchor)*: ``**Default path ends at an open PR. Do NOT merge; report the PR URL and stop.**``
       - Handoff report *(anchor)*: ``PR open for review: <pr-url>. Run `/metta-ship` to land it, or merge the PR on GitHub yourself.``
       - Ship-path commands after the marker: `gh pr checks <pr-number> --watch --fail-fast` and `gh pr merge <pr-number> --merge`.
    4. **Critical section** — replace the section currently titled "Critical: You MUST verify, finalize, and ship" in full with the block in design.md §2, headed *(anchor)* `## Critical: verify, finalize, and open the PR`. Preserve verbatim the three carried-over bullets: the line beginning `Direct local merge of the change branch into main`, the orphaning-recovery bullet, and the silent-write-anomaly bullet.
    Forbidden strings that must NOT survive anywhere in either file: `Critical: You MUST verify, finalize, and ship`, `Do NOT stop after the last artifact`, `finalize + ship must happen`, `unless the user asked to leave it open`. Invariant: `gh pr merge` and `gh pr checks` appear nowhere before the ship-gate marker line; `gh pr create` stays on the default path. Do NOT touch metta-auto or metta-fix-issues skill files.
  - **Verify**: `diff .claude/skills/metta-propose/SKILL.md src/templates/skills/metta-propose/SKILL.md` is empty; `grep -c 'Ship opt-in — the following' .claude/skills/metta-propose/SKILL.md` returns 1; `grep -n 'unless the user asked to leave it open\|Do NOT stop after the last artifact\|finalize + ship must happen\|Critical: You MUST verify, finalize, and ship' .claude/skills/metta-propose/SKILL.md` returns nothing; `npx vitest run tests/skill-discovery-loop.test.ts tests/grounding.test.ts tests/template-deploy-sync.test.ts` passes.
  - **Done**: Both copies byte-identical, all four anchors present exactly as specified, forbidden strings absent, existing sync/grounding tests green.

- [x] **Task 1.2: `propose.ts` — accept `ship` as a stop-after sentinel**
  - **Files**: `src/cli/commands/propose.ts`
  - **Action**: Apply the three localized edits from design.md §4:
    1. Replace the `--stop-after` option help description (~lines 17–20) with: `'Stop after the named planning artifact (e.g. intent, stories, spec, research, design, tasks), or ship to run through merge'`
    2. Ship short-circuit (~line 39): wrap the existing validation so `ship` bypasses all `buildOrder` checks:
       ```ts
       if (stopAfter !== undefined && stopAfter !== 'ship') {
         // existing planningIds / execution-phase / membership checks, unchanged
       }
       ```
    3. Valid-value list (~line 43): `const validList = planningIds.join(', ') + ', ship'` so both error messages (execution-phase rejection and unknown-id rejection) list `ship`.
    No schema changes, no new flags, no persistence changes — `stopAfter === 'ship'` rides the existing `createChange(...)` and JSON-output paths. Exit-code-4 contract and no-state-on-error behavior untouched; absent flag still writes no `stop_after` field.
  - **Verify**: `npx tsc --noEmit` passes; `npx vitest run tests/cli-propose-stop-after.test.ts` passes (existing tests only at this point).
  - **Done**: `--stop-after ship` validates for any workflow and persists `stop_after: ship`; unknown values still exit 4 with `ship` in the valid list; help text names `ship`.

- [x] **Task 1.3: `refresh.ts` + checked-in `CLAUDE.md` propose bullet (atomic pair)**
  - **Files**: `src/cli/commands/refresh.ts`, `CLAUDE.md` (repo root of the change root — both in ONE task; landing one without the other leaves generator and doc out of sync)
  - **Action**: Per design.md §5:
    1. In `refresh.ts` (~line 131, inside `buildWorkflowSection()`), replace the `/metta-propose` lifecycle bullet push with *(anchor, generated verbatim)*:
       ```ts
       lines.push('- `/metta-propose <description>` — start a new change (standard workflow); ends at an open PR — merge via `--ship` or `/metta-ship`')
       ```
    2. In the checked-in `CLAUDE.md`, under `### Lifecycle skills`, replace the matching `/metta-propose` bullet with the identical rendered line:
       ```markdown
       - `/metta-propose <description>` — start a new change (standard workflow); ends at an open PR — merge via `--ship` or `/metta-ship`
       ```
    Do NOT change `src/delivery/workflow-primer.ts` — its propose bullet makes no merge claim and already complies.
  - **Verify**: `npx tsc --noEmit` passes; `grep -F -- 'ends at an open PR — merge via `--ship` or `/metta-ship`' CLAUDE.md src/cli/commands/refresh.ts` matches in both files.
  - **Done**: Generator and checked-in doc carry the identical PR-open-default wording; a future `/metta-refresh` regenerates the same line.

## Batch 2 (depends on Batch 1)

- [x] **Task 2.1: New grep-assert test `tests/skill-propose-ship-gate.test.ts`**
  - **Depends on**: Task 1.1 (anchors must exist in the skill files)
  - **Files**: `tests/skill-propose-ship-gate.test.ts` (new)
  - **Action**: Create the test per design.md §6, modeled on `tests/skill-discovery-loop.test.ts` (readFile + `toContain`/`not.toContain`, same path-constant pattern). Define constants verbatim:
    ```ts
    const SHIP_GATE_MARKER =
      '**Ship opt-in — the following sub-steps run ONLY when `STOP_AFTER = "ship"` (or the change record\'s persisted `stop_after` is `ship`):**'
    const DEFAULT_PHRASE = '**Default path ends at an open PR. Do NOT merge; report the PR URL and stop.**'
    const HANDOFF_PHRASE = 'PR open for review: <pr-url>. Run `/metta-ship` to land it'
    ```
    For EACH of `.claude/skills/metta-propose/SKILL.md` and `src/templates/skills/metta-propose/SKILL.md` (use `describe.each` or a loop so failures name the offending file):
    1. `const parts = contents.split(SHIP_GATE_MARKER)`; `expect(parts).toHaveLength(2)`; `expect(parts[0]).not.toContain('gh pr merge')`; `expect(parts[0]).not.toContain('gh pr checks')`; `expect(parts[1]).toContain('gh pr checks <pr-number> --watch --fail-fast')`; `expect(parts[1]).toContain('gh pr merge <pr-number> --merge')`.
    2. `expect(contents).toContain(DEFAULT_PHRASE)`; `expect(contents).toContain(HANDOFF_PHRASE)`.
    3. Forbidden absences (verbatim): `Critical: You MUST verify, finalize, and ship`, `Do NOT stop after the last artifact`, `finalize + ship must happen`, `unless the user asked to leave it open`.
    4. Survivals: `toContain('Direct local merge of the change branch into main')`, `toContain('gh pr create')`.
    5. Scope guard (do NOT glob over `skills/`): read `src/templates/skills/metta-auto/SKILL.md` and `src/templates/skills/metta-fix-issues/SKILL.md`; assert each still `toContain('gh pr merge')`. Assert nothing else about those two files.
    Do not duplicate byte-identity checks — existing tests cover sync.
  - **Verify**: `npx vitest run tests/skill-propose-ship-gate.test.ts` passes; `npx tsc --noEmit` passes.
  - **Done**: New test file passes against the updated skill files and would fail if unconditional merge text reappears in either propose copy.

- [x] **Task 2.2: Extend `tests/cli-propose-stop-after.test.ts` for `ship`**
  - **Depends on**: Task 1.2 (CLI must accept `ship`)
  - **Files**: `tests/cli-propose-stop-after.test.ts`
  - **Action**: Per design.md §6, using the existing `runCli` harness and fixture setup in the file, add:
    1. Test `persists stop_after: ship`: run `['--json', 'propose', 'demo ship stop', '--stop-after', 'ship']` → expect `code === 0`, JSON `data.stop_after === 'ship'`, and the change's `.metta.yaml` contains `stop_after: ship`.
    2. Extend the existing `rejects unknown --stop-after value` test with `expect(text).toContain('ship')` — the valid-value list now names `ship`.
    3. Test `--help names ship`: `runCli(['propose', '--help'], tempDir)` → stdout contains `ship` on the `--stop-after` option line.
    Do not modify existing assertions except the one extension in item 2.
  - **Verify**: `npx vitest run tests/cli-propose-stop-after.test.ts` passes; `npx tsc --noEmit` passes.
  - **Done**: All three new/extended cases pass; existing cases in the file remain green.

## Batch 3 (depends on Batch 2)

- [x] **Task 3.1: Full verification sweep**
  - **Depends on**: Tasks 2.1, 2.2 (and transitively all of Batch 1)
  - **Files**: none (read-only verification; fix-forward only if a failure traces to this change's edits)
  - **Action**: From the change root run, in order: `npx tsc --noEmit`, then `npm test` (full suite), then explicitly `npx vitest run tests/skill-propose-ship-gate.test.ts tests/cli-propose-stop-after.test.ts tests/skill-discovery-loop.test.ts tests/grounding.test.ts tests/template-deploy-sync.test.ts tests/cli-skills.test.ts`. If any failure is caused by this change (e.g. skill-copy drift, a paraphrased anchor, a missed forbidden string), fix the offending file from Batch 1/2 per its task spec and re-run. Confirm `git -C <change root> status` shows only the intended files modified/added: the two SKILL.md copies, `src/cli/commands/propose.ts`, `src/cli/commands/refresh.ts`, `CLAUDE.md`, `tests/skill-propose-ship-gate.test.ts`, `tests/cli-propose-stop-after.test.ts` (plus change artifacts under `spec/changes/`). Notably: no edits to metta-auto or metta-fix-issues skills, no schema files, no workflow YAMLs, no `src/delivery/workflow-primer.ts`.
  - **Verify**: `npm test` exits 0; `npx tsc --noEmit` exits 0.
  - **Done**: Whole suite green, typecheck clean, change surface matches design.md ("Total surface: 2 SKILL.md copies, propose.ts, refresh.ts + checked-in CLAUDE.md, 1 new test file, additions to 1 existing test file").
