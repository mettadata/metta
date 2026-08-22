# Design: fix-metta-propose-runs-entire-lifecycle-through-finalize

## Approach

Implements the recorded research decision (research.md, 2026-08-22): **skill-level PR-open default + `ship` sentinel**. Do not re-litigate; the persisted-default alternative was rejected in `research-persisted-default.md`.

The default `/metta-propose` path becomes: full pipeline → `metta finalize` → push → `gh pr create` → report PR URL → **stop**. Merging (`gh pr checks --watch` + `gh pr merge` + cleanup) moves behind an explicit ship gate that fires only when `STOP_AFTER = "ship"` (skill-parsed `--ship` alias or `--stop-after ship`). No schema change, no workflow YAML change, no boundary-logic change: `ship` never matches a planning artifact id, so the existing Step 3 boundary check never fires and the loop naturally runs to `all_complete` (verified in `research-skill-level-default.md` §4).

Everything load-bearing is anchored on **exact literal strings** chosen in this document. The skill text and the grep-assert tests use the same literals, authored in the same commit — this is the whole mitigation for grep-assert brittleness. Do not paraphrase any string marked *(anchor)* below.

Total surface: 2 SKILL.md copies (byte-identical), `propose.ts`, `refresh.ts` + checked-in `CLAUDE.md`, 1 new test file, additions to 1 existing test file.

## Components

### 1. Propose SKILL.md — Step 8 restructure (both copies)

Files: `.claude/skills/metta-propose/SKILL.md` and `src/templates/skills/metta-propose/SKILL.md` — byte-identical (enforced by `tests/skill-discovery-loop.test.ts:71`, `tests/grounding.test.ts:35-36`, `tests/template-deploy-sync.test.ts`).

Replace current lines 272–279 (Step 8, sub-steps a–f) with this structure. Sub-steps a–c are unchanged from today; d is new; the marker paragraph and e–g are the relocated ship path:

```markdown
8. When `all_complete: true`:
   a. `metta finalize --json --change <name>` → runs gates, archives, merges specs
   b. `git -C "{change_root}" push -u origin metta/<change-name>` → push the feature branch to the remote
   c. `gh pr create --title "<conventional-commit-style title from the change>" --body "<summary from summary.md or intent.md highlights>"` → open a PR. The body MUST end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
   d. **Default path ends at an open PR. Do NOT merge; report the PR URL and stop.**
      When `STOP_AFTER` is empty (and the change record has no persisted `stop_after`), report exactly:
      ``PR open for review: <pr-url>. Run `/metta-ship` to land it, or merge the PR on GitHub yourself.``
      then proceed to Step 9 and return control to the user. On this default path you MUST NOT watch CI checks as a precursor to merging, MUST NOT merge the PR, and MUST NOT perform post-merge cleanup (main pull, branch/worktree removal).

   **Ship opt-in — the following sub-steps run ONLY when `STOP_AFTER = "ship"` (or the change record's persisted `stop_after` is `ship`):**

   e. `gh pr checks <pr-number> --watch --fail-fast` → wait for all CI checks on the PR to complete before merging. If any check fails or is cancelled, do NOT merge — report the failing check(s) and the PR URL to the user and stop. If gh reports that no checks are reported yet (checks can lag PR creation by a few seconds), wait ~10s and retry the command
   f. `gh pr merge <pr-number> --merge` → land the PR
   g. Back on `main`: `git pull --ff-only`, then clean up the change branch and worktree
```

**Load-bearing anchors (verbatim, shared with tests):**

- Ship-gate marker line *(anchor — the tests split file content on this exact string; it must appear exactly once)*:

  `**Ship opt-in — the following sub-steps run ONLY when `` `STOP_AFTER = "ship"` `` (or the change record's persisted `` `stop_after` `` is `` `ship` ``):**`

  i.e. the literal line: ``**Ship opt-in — the following sub-steps run ONLY when `STOP_AFTER = "ship"` (or the change record's persisted `stop_after` is `ship`):**``

- Canonical default phrase *(anchor)*: ``**Default path ends at an open PR. Do NOT merge; report the PR URL and stop.**``
- Default handoff report *(anchor)*: ``PR open for review: <pr-url>. Run `/metta-ship` to land it, or merge the PR on GitHub yourself.``

**Removed text:** the old 8e clause "unless the user asked to leave it open for review — in that case stop here and report the PR URL instead of merging" MUST NOT survive anywhere in the file (research risk: stale clause reads as merge-by-default). On the ship path the user has explicitly opted into merge; no leave-open escape hatch is needed there.

Invariants: `gh pr merge` and `gh pr checks` appear **nowhere** in the file before the ship-gate marker line. `gh pr create` stays on the default path (keeps `tests/cli-skills.test.ts` "PR-based shipping" green).

### 2. Propose SKILL.md — "Critical" section reword (both copies)

Replace current lines 281–288 in full with:

```markdown
## Critical: verify, finalize, and open the PR

- Do NOT skip verification — a metta-verifier agent MUST run gates and confirm spec compliance
- Do NOT stop before the PR exists — when no planning-phase `stop_after` boundary fired in Step 3, finalize, push, and `gh pr create` are mandatory on every completed run
- Merging is NOT part of the default path. Watching CI checks, merging the PR, and post-merge cleanup happen only under the Step 8 ship opt-in (`stop_after = ship`); otherwise stop at the open PR and hand off to `/metta-ship`
- If metta finalize fails gates, spawn a metta-executor to fix, then retry
- Direct local merge of the change branch into main (`git merge`) is forbidden — every change ships through a pushed branch and a GitHub PR
- If a dispatched step appears orphaned, follow the residual orphaning recovery protocol in metta-skill-host.md.
- If an executor or verifier STOP-reports a silent-write anomaly (Edit/Write success with no on-disk effect), escalate to the user with the report; never work around it via bash writes or orchestrator-performed writes.
```

New heading *(anchor)*: `## Critical: verify, finalize, and open the PR`.

Forbidden strings that MUST NOT appear anywhere in either copy after this change (tests assert absence, verbatim):
- `Critical: You MUST verify, finalize, and ship`
- `Do NOT stop after the last artifact`
- `finalize + ship must happen`
- `unless the user asked to leave it open`

Preserved rules (tests assert presence): the PR-only shipping prohibition line beginning `Direct local merge of the change branch into main`, the orphaning-recovery bullet, and the silent-write-anomaly bullet — all three carry over verbatim except as shown above.

### 3. Propose SKILL.md — Step 1 `--ship` alias + Step 3 clarifier (both copies)

**Step 1.** Immediately after the existing `--stop-after` parse block (current lines 45–51), add:

```markdown
   **Parse optional `--ship` from `$ARGUMENTS`:**

   - If `$ARGUMENTS` contains the token `--ship`, remove it from `$ARGUMENTS` and set `STOP_AFTER = "ship"`. `--ship` is an alias for `--stop-after ship` — forward it to the CLI as `--stop-after ship` (there is no CLI `--ship` flag). If both `--ship` and `--stop-after <value>` are present, `--ship` takes precedence.
   - The remaining text is the description.
```

Also extend the existing "**Scope of `STOP_AFTER`:**" bullet (current line 51) — append one sentence: `` The special value `ship` is NOT a planning-phase artifact: it means "run to merge" and is handled by the Step 8 ship opt-in, never by the Step 3 boundary check. ``

The command matrix (current lines 53–58) needs no structural change — `ship` rides the existing `--stop-after <value>` invocations.

**Step 3.** Add one bullet to the "Stop-after boundary check" list (after the two boundary conditions, current line 106):

```markdown
   - `ship` is not a planning boundary: when `STOP_AFTER = "ship"` (or persisted `stop_after: ship`), this check never fires for any artifact — do not hunt for a `ship` artifact; continue the loop to `all_complete` and apply the Step 8 ship opt-in.
```

Resume-command mapping (current lines 113–116) is unchanged.

### 4. `src/cli/commands/propose.ts`

Three localized edits (~6 lines), no persistence changes — `stopAfter === 'ship'` rides the existing `createChange(...)` and JSON-output paths untouched:

1. **Help text** (lines 17–20): replace the option description with
   `'Stop after the named planning artifact (e.g. intent, stories, spec, research, design, tasks), or ship to run through merge'`
2. **Ship short-circuit** (line 39): change the validation guard so `ship` bypasses `buildOrder` checks entirely:
   ```ts
   if (stopAfter !== undefined && stopAfter !== 'ship') {
     // existing planningIds / execution-phase / membership checks, unchanged
   }
   ```
3. **Valid-value lists** (line 43): `const validList = planningIds.join(', ') + ', ship'` — this single change puts `ship` in both error messages (execution-phase rejection and unknown-id rejection), matching the spec scenario that lists `intent, stories, spec, research, design, tasks, ship`.

Exit-code-4 contract, no-state-on-error behavior, and the "no `stop_after` field when flag absent" persistence behavior are all untouched. No CLI `--ship` boolean flag is added (constraint; the skill owns the alias — single source of truth).

### 5. `src/cli/commands/refresh.ts` + checked-in `CLAUDE.md` (must land together)

`refresh.ts` line 131 — replace the lifecycle bullet with *(anchor, generated verbatim into CLAUDE.md)*:

```ts
lines.push('- `/metta-propose <description>` — start a new change (standard workflow); ends at an open PR — merge via `--ship` or `/metta-ship`')
```

Checked-in `CLAUDE.md` — edit the matching `### Lifecycle skills` bullet to the identical rendered string:

```markdown
- `/metta-propose <description>` — start a new change (standard workflow); ends at an open PR — merge via `--ship` or `/metta-ship`
```

Both edits are one atomic pair: editing only CLAUDE.md is reverted by the next `/metta-refresh`; editing only refresh.ts leaves the checked-in doc stale until then. **`src/delivery/workflow-primer.ts` is NOT changed** — per research, its `/metta-propose` entry-point bullet makes no merge claim, so it already satisfies the "MUST NOT imply merge by default" requirement.

### 6. Tests

**New file `tests/skill-propose-ship-gate.test.ts`** — modeled on `tests/skill-discovery-loop.test.ts` (readFile + `toContain`/`not.toContain`; same path constants pattern). Test constants (verbatim from the anchors above):

```ts
const SHIP_GATE_MARKER =
  '**Ship opt-in — the following sub-steps run ONLY when `STOP_AFTER = "ship"` (or the change record\'s persisted `stop_after` is `ship`):**'
const DEFAULT_PHRASE = '**Default path ends at an open PR. Do NOT merge; report the PR URL and stop.**'
const HANDOFF_PHRASE = 'PR open for review: <pr-url>. Run `/metta-ship` to land it'
```

For **each** of the two propose SKILL.md paths (template + deployed; a `describe.each` or loop so a failure names the offending file, per spec scenario):

1. **Split-on-heading strategy:** `const parts = contents.split(SHIP_GATE_MARKER)` → `expect(parts).toHaveLength(2)` (marker present exactly once). Then:
   - `expect(parts[0]).not.toContain('gh pr merge')` and `expect(parts[0]).not.toContain('gh pr checks')` — no merge machinery anywhere before the gate.
   - `expect(parts[1]).toContain('gh pr checks <pr-number> --watch --fail-fast')` and `expect(parts[1]).toContain('gh pr merge <pr-number> --merge')` — ship path intact.
2. `expect(contents).toContain(DEFAULT_PHRASE)` and `toContain(HANDOFF_PHRASE)`.
3. Forbidden-string absences (verbatim): `Critical: You MUST verify, finalize, and ship`, `Do NOT stop after the last artifact`, `finalize + ship must happen`, `unless the user asked to leave it open`.
4. Survivals: `toContain('Direct local merge of the change branch into main')`, `toContain('gh pr create')`.
5. **Scope guard (never glob over `skills/`):** read `src/templates/skills/metta-auto/SKILL.md` and `src/templates/skills/metta-fix-issues/SKILL.md`; assert each still `toContain('gh pr merge')` — proves this change did not touch their run-to-merge behavior. These two files legitimately keep unconditional merge text; asserting anything else over them is out of scope.

Byte-identity between the two propose copies is already enforced by existing tests — do not duplicate.

**Additions to `tests/cli-propose-stop-after.test.ts`** (same `runCli` harness, same fixture setup):

1. `persists stop_after: ship` — `['--json', 'propose', 'demo ship stop', '--stop-after', 'ship']` → `code === 0`, `data.stop_after === 'ship'`, `.metta.yaml` contains `stop_after: ship`.
2. Extend the existing `rejects unknown --stop-after value` test with `expect(text).toContain('ship')` — the valid-value list now names `ship`.
3. `--help names ship` — `runCli(['propose', '--help'], tempDir)` → stdout contains `ship` on the `--stop-after` option line (satisfies the help scenario in spec.md).

## Data Model

**No changes.** `src/schemas/change-metadata.ts:116` (`stop_after: z.string().optional()`) already validates `ship`; the value persists through the existing `createChange` path. Absent-flag behavior is byte-identical to today: no `stop_after` field in `.metta.yaml`, `stop_after: null` in JSON output. The PR-open default is deliberately **not** represented in persisted state (research decision — the rejected alternative's fatal flaw was persisting it). Do not "harden" the field to a `z.enum`: the valid set is workflow-dependent (`domain-research` etc.), so a free string is correct.

## API Design

**CLI surface** (`metta propose`):
- `--stop-after <artifact>` gains one accepted value, `ship` — a lifecycle sentinel valid for every workflow, never checked against `buildOrder`. All previously accepted values keep identical validation, persistence, and semantics. Error messages' valid-value lists append `, ship`. No new flags.

**Skill contract** (`/metta-propose`):
- `$ARGUMENTS` token `--ship` → skill sets `STOP_AFTER = "ship"` and invokes the CLI with `--stop-after ship`; the description never contains the `--ship` token.
- Default path terminal behavior: `gh pr create` + the exact handoff report naming `/metta-ship`.
- Ship path (`STOP_AFTER = "ship"` or persisted `stop_after: ship`): checks-watch → merge → cleanup, exactly the pre-change 8d–8f behavior.
- Planning-phase `stop_after` boundary behavior in Step 3: unchanged, including the exact handoff-line format and resume-command mapping.

**Generated docs contract:** `buildWorkflowSection()` in refresh.ts emits the new propose bullet; the checked-in CLAUDE.md carries the identical rendered line.

## Dependencies

- No new packages, no version bumps.
- `gh` CLI: pre-existing dependency of the ship path — this change narrows its default use (drops `checks`/`merge` from the default path), adding nothing. Pre-existing GitHub coupling noted (PR-based shipping is a project-level rule); this change does not deepen it — no new vendor lock-in introduced.
- Internal ordering: skill-text anchors (§1–§3) and the test literals (§6) must be authored against this document in the same change; refresh.ts and CLAUDE.md (§5) must land in the same commit set.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Grep-assert brittleness — prose edits break literal anchors | All anchors are exact strings fixed in this design; skill text and tests share them verbatim and ship together. The split-on-marker strategy tests structure (position relative to the gate), not prose. |
| One SKILL.md copy edited, the other missed | Three existing byte-identity/sync tests fail immediately; no new mechanism needed. |
| CLAUDE.md regeneration clobbers the wording | refresh.ts:131 and CLAUDE.md edited as an atomic pair (§5); the generator is the durable source. |
| Orchestrator drift — skill-level default is instruction-following, not runtime-enforced | Inherent to the chosen approach (accepted in research). Tests guard the instructions; the UAT scenario "captured session contains no `gh pr merge`" covers runtime behavior. |
| Stale "leave it open" clause survives and reads as merge-by-default | Explicit forbidden string; test asserts absence (§6 item 3). |
| Over-broad test scope re-flags metta-auto / metta-fix-issues | Tests target only the two propose files; scope guard positively asserts auto/fix-issues retain `gh pr merge`. |
| `ship` value confuses the Step 3 boundary check ("unknown artifact") | One-line Step 3 clarifier (§3); the check compares against completed artifact ids, which never equal `ship`. |
| Failure mode of any wording miss | Stops too early (recoverable via `/metta-ship`) — never merges without consent. The change strictly narrows autonomous authority. |
