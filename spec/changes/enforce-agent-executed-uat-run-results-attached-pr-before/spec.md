# finalize-ship

<!--
Merge-target route: SINGLE H1 (`# finalize-ship`) for every requirement in this delta.
Reason: `parseDeltaSpec` in src/specs/spec-parser.ts keeps exactly one `title` field and
overwrites it on every depth-1 heading (last H1 wins), and `SpecMerger.merge`
(src/finalize/spec-merger.ts) derives the capability for EVERY delta from that single
`deltaSpec.title`. A file with two H1 blocks would silently re-route all deltas —
including those under the first H1 — to the last H1's capability. Multi-capability
delta files are therefore NOT supported. The uat-execution-facing constraints (inline
reuse of the /metta-uat orchestration contract, no second runner path, idempotent
re-run interplay) are phrased here as finalize-ship requirements that reference the
existing uat-execution requirements by name rather than modifying them.
-->

## ADDED: Requirement: UAT Gate Before PR Hand-Back

Every ship-path skill that creates a PR — `metta-ship`, `metta-propose`, `metta-quick`, `metta-auto`, `metta-fix-issues`, and `metta-fix-gap`, in BOTH copies of each pair (template under `src/templates/skills/<name>/SKILL.md` and deployed under `.claude/skills/<name>/SKILL.md`) — MUST, after `metta finalize` completes and before handing the PR back as ready, spawn the `metta-uat-runner` subagent against the archived `UAT.md` reported as `uatPath` in the `metta finalize --json` output. The runner MUST be spawned directly via the Agent tool with `subagent_type: metta-uat-runner`; the skills MUST NOT slash-invoke `/metta-uat` (it is a main-session-only skill and cannot be invoked from forked or session-tier ship paths). The gate MUST sit before `gh pr create`, or execute as an immediate PR update right after creation when the skill's flow creates the PR first. The `metta-ship` skill's frontmatter `allowed-tools` MUST include `Agent` in both copies (it is the only ship-path skill currently lacking it). Template and deployed copies of each pair MUST remain byte-identical per the existing template-deploy sync contract.
Fulfills: US-1, US-7

### Scenario: Ship skill spawns the runner against the archived UAT before hand-back
- GIVEN a change whose `metta finalize --json` output reported a non-null `uatPath`
- WHEN any of the six ship-path skills proceeds toward `gh pr create`
- THEN the skill spawns the `metta-uat-runner` subagent via the Agent tool with `subagent_type: metta-uat-runner` against the `UAT.md` at `uatPath` before presenting the PR as ready
- AND the skill does not slash-invoke `/metta-uat` at any point

### Scenario: Never hand back an unexecuted UAT
- GIVEN an archived `UAT.md` that has never been executed
- WHEN a ship-path skill reaches its hand-back point
- THEN the skill does not present the PR as ready without first spawning the `metta-uat-runner` subagent against that archived `UAT.md`

### Scenario: metta-ship can spawn subagents
- GIVEN both copies of the `metta-ship` skill (`src/templates/skills/metta-ship/SKILL.md` and `.claude/skills/metta-ship/SKILL.md`)
- WHEN their frontmatter `allowed-tools` lists are read
- THEN both include `Agent`
- AND the two copies are byte-identical


## ADDED: Requirement: Inline UAT Orchestration Contract In Ship Skills

Each ship-path skill MUST embed the `/metta-uat` orchestration contract inline rather than inventing a second runner path: the `metta-uat-runner` subagent remains the only mutator of `UAT.md`, and the existing runner agent pair (`src/templates/agents/metta-uat-runner.md` and `.claude/agents/metta-uat-runner.md`) is reused as-is with no contract change. Before spawning the runner, the orchestrating skill MUST snapshot git cleanliness. After the runner returns, the orchestrating skill MUST sanity-check the resulting diff against that snapshot: the only acceptable mutations are checkbox flips located before the first `## UAT run — ` heading plus exactly one appended dated `## UAT run — <date>` section; a diff outside that shape MUST NOT be blindly committed. When the diff shape is valid, the skill MUST commit it as `docs(<change>): UAT run record` on the change branch. The runner subagent MUST NOT run git; commit ownership stays with the orchestrating skill, consistent with the uat-execution requirements "UAT Commit Ownership" and "UAT Run Record".
Fulfills: US-5

### Scenario: Valid run diff is committed on the change branch
- GIVEN the runner has mutated the archived `UAT.md` with checkbox flips before the first `## UAT run — ` heading and exactly one appended dated `## UAT run — <date>` section
- WHEN the orchestrating skill validates the diff against its pre-run cleanliness snapshot
- THEN it commits the record as `docs(<change>): UAT run record` on the change branch
- AND the runner's own execution issued no git commands

### Scenario: Unexpected diff shape is not blindly committed
- GIVEN the post-run diff touches files other than the target `UAT.md`, or alters content other than checkbox flips plus one appended dated run section
- WHEN the orchestrating skill sanity-checks the diff
- THEN it does not commit the unexpected mutations as a UAT run record and reports the anomaly instead

### Scenario: No second runner path exists
- GIVEN the six ship-path skill pairs after this change
- WHEN their UAT instructions are inspected alongside `.claude/agents/metta-uat-runner.md`
- THEN every ship-path UAT execution goes through the existing `metta-uat-runner` agent contract
- AND the runner agent pair is unmodified by this change


## ADDED: Requirement: UAT Run Summary In PR Body Or Comment

The UAT run summary — pass/fail/skip counts, per-failed-step details (expected vs observed), and the reason for each skipped step — MUST be attached to the PR by the orchestrating skill. When the skill has not yet created the PR, the summary MUST be included in the PR body at `gh pr create` time. When the PR already exists at the time the run completes, the summary MUST be posted via `gh pr comment` on that PR. The `docs(<change>): UAT run record` commit MUST ride the change branch so the executed `UAT.md` lands on main with the merge.
Fulfills: US-1, US-5

### Scenario: PR body carries the run summary at creation
- GIVEN a completed UAT run on a change whose PR has not yet been created
- WHEN the ship-path skill runs `gh pr create`
- THEN the PR body includes the run summary with pass/fail/skip counts, details for each failed step, and a reason for each skipped step

### Scenario: Existing PR receives the summary as a comment
- GIVEN a PR for the change already exists when the UAT run completes
- WHEN the ship-path skill attaches the results
- THEN the run summary is posted via `gh pr comment` on that PR rather than being lost

### Scenario: Run record merges to main with the change
- GIVEN a ship-path run whose UAT record commit was made on the change branch
- WHEN the PR is merged
- THEN main contains the archived `UAT.md` with its checkbox state and dated run record


## ADDED: Requirement: UAT Failure Blocks Ready Hand-Back

Any failed UAT step MUST block hand-back-as-ready, mirroring how red CI blocks merge: the ship-path skill MUST report the failures and stop — no merge occurs, the change is not declared ready, and the PR stays open flagged with the failure summary in its body or comment. Steps carrying the generator's machine-verified annotation (`- **Machine-verified** — <evidence>`) pass automatically. Steps requiring human or manual acceptance MUST be reported as skipped with a stated reason and MUST NOT count as failures or block hand-back.
Fulfills: US-2, US-4

### Scenario: Failed step halts the ship path
- GIVEN the agent-executed UAT run records at least one failed step
- WHEN the ship-path skill evaluates readiness
- THEN it reports the failures, leaves the PR open and flagged with the failure summary, and stops without merging or declaring the change ready

### Scenario: All-pass run proceeds to hand-back
- GIVEN all machine-verified UAT steps pass
- WHEN the skill evaluates readiness
- THEN the change proceeds to hand-back (or merge, on run-to-merge paths) with the passing summary attached

### Scenario: Manual-acceptance steps skip without blocking
- GIVEN the archived `UAT.md` contains steps requiring human acceptance, and every machine-verified step passes
- WHEN the skill evaluates readiness
- THEN the manual steps are listed as skipped with reasons in the PR summary
- AND hand-back proceeds — skips do not block


## ADDED: Requirement: UAT Gate Before Merge On Run-To-Merge Paths

On the run-to-merge skills — `metta-quick`, `metta-auto`, `metta-fix-issues`, and `metta-fix-gap` — the UAT gate MUST sit before the skill's `gh pr merge` step, inside the create-to-merge window. A UAT failure on these paths MUST prevent the merge: the PR stays open and unmerged, flagged with the failure summary, and the skill stops.
Fulfills: US-3

### Scenario: Merge waits for UAT results
- GIVEN a quick/auto/fix-issues/fix-gap run has finalized and opened its PR
- WHEN the skill reaches its merge step
- THEN the UAT run has already executed and its results are attached to the PR before any merge command runs

### Scenario: UAT failure leaves the PR open and unmerged
- GIVEN the UAT run on a run-to-merge path reports at least one failed step
- WHEN the skill would otherwise run `gh pr merge`
- THEN the merge is skipped, the PR stays open flagged with the failure summary, and the skill stops


## MODIFIED: Requirement: UAT Configuration Toggle

The project config MUST gain a `uat` section validated by a strict Zod `UatConfigSchema` (mirroring `DocsConfigSchema`) registered on the strict `ProjectConfigSchema` in `src/schemas/project-config.ts`, with two boolean fields, each defaulting to `true`: `enabled` and `enforce_on_ship`. `ConfigLoader` MUST supply the parsed `uat` config to the finalizer the same way `config.docs` is read today. When `uat.enabled` is `false`, finalize MUST skip UAT generation entirely — no `UAT.md` is written and no UAT path is reported — while all other finalize behavior proceeds unchanged. When `uat.enforce_on_ship` is `false`, ship-path skills MUST skip the mandatory pre-hand-back UAT run entirely and proceed exactly as they did before the gate existed. Existing `.metta/config.yaml` files that omit the `uat` key, or either field within it, MUST remain valid with the omitted value defaulting to `true`. Enforcement MUST additionally default to on at scaffold time: the `.metta/config.yaml` scaffold written by `metta install` (the `configContent` written in `src/cli/commands/install.ts`) MUST include a `uat` block carrying `enforce_on_ship: true` explicitly, so opting out is always an explicit consumer action; the scaffold write MUST preserve its existing never-overwrite semantics (flag `'wx'`), so an existing config is never modified or overwritten. The schema MUST reject unknown keys within the `uat` block and non-boolean values for either field with a validation error rather than silently accepting them.
Fulfills: US-6

### Scenario: Disabled toggle skips generation cleanly
- GIVEN `.metta/config.yaml` sets `uat.enabled: false`
- WHEN `metta finalize` runs to completion on a complete change
- THEN finalize succeeds, no `UAT.md` is written to the change directory or archive, and all other finalize behavior is unchanged

### Scenario: Omitted uat key defaults to enabled
- GIVEN `.metta/config.yaml` with no `uat` section
- WHEN config is loaded and `metta finalize` runs to completion
- THEN config validation passes and a `UAT.md` is generated

### Scenario: Disabled enforcement skips the ship-path UAT run
- GIVEN `uat.enforce_on_ship` is explicitly set to `false`
- WHEN a ship-path skill reaches its post-finalize step
- THEN it proceeds to PR creation and hand-back without spawning the `metta-uat-runner` subagent

### Scenario: Omitted enforce_on_ship defaults to enforced
- GIVEN `.metta/config.yaml` whose `uat` block has no `enforce_on_ship` key
- WHEN the strict `UatConfigSchema` validates config
- THEN the effective value is `true` and the ship-path UAT gate is enforced

### Scenario: Fresh install scaffolds explicit enforcement without overwriting existing configs
- GIVEN a fresh project with no `.metta/config.yaml`
- WHEN `metta install` runs
- THEN the scaffolded `.metta/config.yaml` contains a `uat` block with `enforce_on_ship: true` written explicitly
- AND when a `.metta/config.yaml` already exists, the scaffold write leaves it untouched (flag `'wx'` semantics preserved)

### Scenario: Invalid uat config is rejected strictly
- GIVEN a `uat` config block containing an unknown key or a non-boolean value for `enabled` or `enforce_on_ship`
- WHEN config is loaded
- THEN `UatConfigSchema` rejects it with a Zod validation error
- AND the invalid value is not silently coerced or ignored


## ADDED: Requirement: Ship Skill Toggle Readability Without Guard Violation

Ship-path skills MUST be able to determine the effective `uat.enforce_on_ship` value at the post-finalize decision point without violating the orchestration guard — i.e. without invoking any `metta` Bash form the `metta-guard-bash` hook would block for their tier, and without parsing `.metta/config.yaml` by hand in a way that bypasses schema validation. The mechanism is a design-phase decision; acceptable outcomes include a guard-allowlisted read-only `metta config get` form or surfacing the effective value in the `metta finalize --json` output. Whichever mechanism is chosen, every one of the six ship-path skills MUST use it, and the guard hook's enforcement guarantees MUST NOT be weakened for any write-capable command.
Fulfills: US-6

### Scenario: Skills resolve the toggle without a guard block
- GIVEN any ship-path skill running in its normal tier (forked or session-tier)
- WHEN it reaches the post-finalize step and needs the `uat.enforce_on_ship` value
- THEN it obtains the schema-validated effective value without the guard hook blocking the call and without hand-parsing config YAML

### Scenario: Config-read mechanism outcome
- GIVEN the design selects a read-only `metta config get` form allowlisted in both guard hook copies
- WHEN a ship-path skill reads `uat.enforce_on_ship` through it
- THEN the guard permits the read-only call, the returned value reflects the strict-schema default when the key is omitted, and no write-capable `metta` command becomes newly allowlisted

### Scenario: Finalize-output mechanism outcome
- GIVEN the design surfaces the effective toggle in `metta finalize --json` output
- WHEN a ship-path skill parses that output at its post-finalize step
- THEN the skill decides the gate from the surfaced value with no guard hook change required
- AND pre-existing finalize success-payload fields are unchanged


## ADDED: Requirement: Grep-Assert Coverage Of Ship-Path UAT Gate

The test suite MUST gain a grep-assert test file, in the style of `tests/skill-propose-ship-gate.test.ts` (pinned sentence constants, iteration over template and deployed copies), that pins the UAT-before-hand-back step across all six ship-path skill pairs — twelve files. The tests MUST assert ordering: the pinned UAT step text appears before the `gh pr create` instruction in each skill (or before the merge step on the run-to-merge skills, where the gate precedes `gh pr merge`). The tests MUST also assert that both `metta-ship` copies list `Agent` in `allowed-tools`. A failing assertion MUST name the offending skill file.
Fulfills: US-7

### Scenario: Tests pass on compliant skill files
- GIVEN all twelve skill files carry the correctly ordered UAT step and `metta-ship`'s `allowed-tools` includes `Agent`
- WHEN the grep-assert tests run via `npm test`
- THEN the presence and ordering assertions pass for every pair

### Scenario: Dropped or reordered gate fails the suite
- GIVEN any one of the twelve skill files has its UAT step removed, or moved after its `gh pr create` or merge step
- WHEN the grep-assert tests run
- THEN at least one test fails, naming the offending skill file


## ADDED: Requirement: Idempotent UAT Recording Across Propose Stop And Ship

`metta-propose` MUST execute the UAT gate and attach the run summary at its default PR-open stop, so the PR it hands back already carries the run record. When `/metta-ship` (or the ship opt-in) later processes the same branch and the branch head is unchanged since the recorded run, the ship path MUST NOT blindly double-append a second identical dated run record; it MUST either reuse the existing run record as its gate evidence or perform a fresh run under the established re-run semantics. Any re-run MUST follow the uat-execution "UAT Idempotent Re-Runs" contract — reset checkboxes, then append a new dated `## UAT run` section without rewriting prior sections — and this requirement MUST NOT contradict that contract: re-runs remain permitted; only a mechanical duplicate record for an unchanged branch with no fresh execution is forbidden.
Fulfills: US-1, US-5

### Scenario: Propose hands back a PR that already carries the run record
- GIVEN a default `/metta-propose` run reaching its PR-open stop
- WHEN the PR is handed back to the user
- THEN the archived `UAT.md` on the change branch already contains a dated `## UAT run — <date>` section and the PR carries the run summary

### Scenario: Ship of an unchanged branch does not duplicate the record
- GIVEN a branch whose head commit is unchanged since propose recorded its UAT run
- WHEN `/metta-ship` processes that branch
- THEN the resulting `UAT.md` does not contain two identical dated run records produced without a fresh execution — ship either reuses the existing record as gate evidence or performs a genuine re-run

### Scenario: Genuine re-run appends per existing semantics
- GIVEN the branch changed after propose's recorded run and ship performs a fresh UAT run
- WHEN the run completes
- THEN checkboxes reflect only the latest run and a new dated `## UAT run` section is appended after the prior one, which remains byte-for-byte unchanged
