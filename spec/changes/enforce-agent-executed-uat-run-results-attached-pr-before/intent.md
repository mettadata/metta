# enforce-agent-executed-uat-run-results-attached-pr-before

## Problem

The ship path hands a PR back for review with zero evidence that the change's acceptance script was ever executed. Finalize generates a UAT.md (src/finalize/finalizer.ts Step 5b, via src/finalize/uat-generator.ts) and archives it under `spec/archive/<YYYY-MM-DD>-<slug>/UAT.md`, but nothing in any PR-creating skill runs it. Executing UAT is a separate, entirely optional manual step (`/metta-uat`), so in practice PRs are opened — and on the quick/auto/fix-issues/fix-gap paths, *merged* — with the UAT document sitting untouched in the archive: every checkbox unchecked, no run record, no failure signal.

This affects:

- **Reviewers and the project owner**, who receive "ready" PRs that may fail their own generated acceptance criteria. Red CI blocks merge today; a red UAT step blocks nothing.
- **Consumers of the run-to-merge skills** (`metta-quick`, `metta-auto`, `metta-fix-issues`, `metta-fix-gap`), where the window between PR creation and merge is a single skill run — if UAT isn't forced into that window, it never happens before the change lands on main.
- **The audit trail.** The UAT contract (runner flips checkboxes honestly and appends a dated `## UAT run — <date>` record) only has value if the record exists at review time and rides the change branch into the merge. Today the archived UAT.md is write-once dead weight.

## Proposal

Make an agent-executed UAT run a mandatory pre-hand-back step on every ship-path skill that creates a PR, with results attached to the PR and failures blocking readiness.

**Sequencing.** After `metta finalize` completes (which archives the change and reports the UAT document location as `uatPath` in `metta finalize --json` output — FinalizeResult.uatPath, src/finalize/finalizer.ts:29), and before `gh pr create` (or as an immediate PR update right after creation), the orchestrating skill spawns the `metta-uat-runner` subagent against the archived UAT.md.

**Reuse the existing contract, inlined.** Ship-path skills run forked (`metta-skill-host`) or session-tier, and `/metta-uat` is a main-session-only skill that cannot be slash-invoked from a subagent. So each ship skill embeds the `/metta-uat` orchestration contract inline rather than invoking the skill: spawn `subagent_type: metta-uat-runner` directly via the Agent tool; the runner remains the only mutator of UAT.md (checkbox flips before the first `## UAT run — ` heading plus exactly one appended dated run section); the orchestrating skill snapshots git cleanliness, sanity-checks the diff shape, and commits `docs(<change>): UAT run record` on the change branch so the record lands with the merge. No second runner path is invented; the runner agent pair (src/templates/agents/metta-uat-runner.md ↔ .claude/agents/metta-uat-runner.md) is reused as-is.

**PR integration.** The run summary — pass/fail/skip counts, per-failed-step details, and skip reasons — is posted into the PR body at `gh pr create` time, or as a PR comment (`gh pr comment`) when the PR already exists and is being updated. The run-record commit rides the change branch.

**Enforcement.** A failing UAT step blocks hand-back-as-ready, mirroring red CI: the skill reports the failures and stops. No merge; the PR stays open, flagged with the failures in its body/comment. Machine-verified steps (generator-emitted `- **Machine-verified** — <evidence>` annotation, src/finalize/uat-generator.ts:441) pass automatically. Steps requiring human/manual acceptance are reported as skipped and never block — skips are "needs manual acceptance," not failures, per the existing contract.

**Scope of skill edits.** All six ship-path skill pairs (template ↔ deployed, byte-identity enforced by tests/template-deploy-sync.test.ts):

| Skill | PR-creation point |
|---|---|
| metta-ship | `gh pr create` at SKILL.md line 19 |
| metta-propose | line 283 (its stop-at-open-PR default) |
| metta-quick | line 200 |
| metta-auto | line 76 |
| metta-fix-issues | line 88 |
| metta-fix-gap | line 88 (session-tier, not forked) |

For the run-to-merge paths (quick, auto, fix-issues, fix-gap) the UAT gate MUST sit before their merge step, not just before PR creation. metta-ship's `allowed-tools` must gain `Agent` (it is the only ship skill currently lacking it).

**Config toggle.** New `uat.enforce_on_ship` boolean (default `true`) added to `UatConfigSchema` in src/schemas/project-config.ts (currently `{ enabled: z.boolean().default(true) }`, strict, lines 45–49), following the precedent of the "UAT Configuration Toggle" requirement at spec/specs/finalize-ship/spec.md:390. Consumers can opt out. Constraint for design phase: skills cannot currently read it via `metta config get` because the guard hook (src/templates/hooks/metta-guard-bash.mjs) does not allowlist `config`; either add `config get` as an allowed read-only two-word form in both hook copies, or surface the toggle in `metta finalize --json` output. The intent does not pick — design phase decides.

**Spec deltas and tests.** Delta spec.md updates to spec/specs/finalize-ship/spec.md and spec/specs/uat-execution/spec.md (ADDED/MODIFIED requirement sections in the established delta format), plus grep-assert tests in the style of tests/skill-propose-ship-gate.test.ts (pinned sentence constants, `describe.each` over template + deployed copies, ordering assertions) proving each ship-path skill contains the UAT-before-handback step, in the correct position relative to `gh pr create` and any merge step.

## Impact

- **Six skill pairs (twelve files).** metta-ship, metta-propose, metta-quick, metta-auto, metta-fix-issues, metta-fix-gap — each template under src/templates/skills/ and its deployed copy under .claude/skills/ gain the inline UAT orchestration block (spawn runner → sanity-check diff → commit run record → attach summary to PR → gate on failures). Byte-identity between pairs must hold (tests/template-deploy-sync.test.ts).
- **metta-ship allowed-tools.** Gains `Agent`; today it cannot spawn subagents. All five other ship skills already list it.
- **Run-to-merge behavior change.** metta-quick, metta-auto, metta-fix-issues, and metta-fix-gap currently proceed from PR creation to merge in one run. The UAT gate inserts before their merge step: a failed step now halts these skills mid-flight with an open, flagged PR instead of a merged change. This is the intended behavior change and the largest workflow-visible impact.
- **Interaction with propose's PR-open stop.** metta-propose stops at open-PR by default with a ship opt-in marker (line 283). The UAT run and summary attach at that stop, so the PR propose hands back already carries the run record; when ship is later invoked (opt-in or via /metta-ship), it must not naively re-run or double-append — design phase defines re-run vs. reuse semantics for an existing dated run record.
- **Config schema addition.** `uat.enforce_on_ship: z.boolean().default(true)` in src/schemas/project-config.ts. Strict schema means existing configs without the key still validate via the default; configs that hand-wrote unknown keys are unaffected.
- **Guard-hook allowlist consideration.** If the toggle is read via `metta config get uat.enforce_on_ship`, both guard hook copies (src/templates/hooks/metta-guard-bash.mjs and its deployed pair) need `config get` added as a read-only allowed two-word form. If the toggle is surfaced through `metta finalize --json` instead, no hook change. Flagged as a design decision; either branch touches enforcement-sensitive files.
- **New gh surface.** `gh pr comment` (and possibly `gh pr edit`) appears in skills for the update-existing-PR path; no such usage exists anywhere today.
- **Capability spec deltas.** spec/specs/finalize-ship/spec.md (43 requirements) gains requirements for the UAT-before-handback gate, PR summary attachment, failure blocking, and the config toggle; spec/specs/uat-execution/spec.md (11 requirements) gains requirements for the inline-contract reuse from ship-path skills and the no-second-runner-path constraint. Both via delta `## ADDED|MODIFIED: Requirement:` sections.
- **New grep-assert tests.** A new test file pinning the UAT-before-handback sentence(s) across all six skill pairs with ordering assertions (before `gh pr create` / before merge), following tests/skill-propose-ship-gate.test.ts and the byte-identical-sentence pattern from tests/shell-write-path-discipline.test.ts.
- **Unchanged.** The metta-uat-runner agent contract, the UAT generator and its tier logic, the finalize pipeline itself (UAT.md generation timing and archival are already correct), and the standalone /metta-uat skill's own flow.

## Out of Scope

- **UAT generator changes.** No changes to src/finalize/uat-generator.ts, its tier selection, step content, or the machine-verified annotation format. We consume the generated document as-is.
- **The standalone /metta-uat skill's own flow.** Its main-session orchestration (including its per-failed-step /metta-issue logging) stays as-is, beyond any minimal wording alignment needed so the inline copies and the skill describe the same contract.
- **The metta-uat-runner agent contract.** The runner's tool set (Read/Bash/Edit, no git, no metta except `metta status --json`), its exclusive-mutator role, and its document-mutation rules are not modified unless a hard blocker surfaces during design — none is anticipated.
- **Automating human acceptance.** Manual-acceptance steps stay manual; they skip and never block. No attempt to machine-execute steps the generator marked as needing a human.
- **CI-side enforcement.** No GitHub Actions workflow, branch-protection rule, or server-side check that validates UAT records. Enforcement lives entirely in the skill layer, like the rest of the ship-path discipline.
- **Per-failed-step issue logging from ship skills.** The standalone /metta-uat flow logs one issue per failed step from the main session; forked ship skills cannot slash-invoke /metta-issue. Ship-path failure handling is report-and-stop; whether issues get logged afterward is left to the operator (or a future change).
- **Retroactive UAT runs.** Already-archived changes with unexecuted UAT.md files are not backfilled.
