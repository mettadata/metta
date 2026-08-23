# UAT: enforce-agent-executed-uat-run-results-attached-pr-before

- **Change**: enforce-agent-executed-uat-run-results-attached-pr-before
- **Generated**: 2026-08-23
- **Source**: user stories (stories.md)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

### US-1: Reviewer receives PRs with UAT evidence attached

*Independent test:* A PR created by any ship-path skill contains a UAT run summary (counts plus failed-step details and skip reasons) in its body or as a comment, generated from an actual agent-executed run of the archived UAT.md.

#### Step 1.1
- **Setup**: a change reaches the ship step and `metta finalize` has archived its UAT.md
- **Do**: the ship-path skill runs `gh pr create` (Run: `metta finalize`, `gh pr create`)
- **Observe**: the PR body includes the UAT run summary with pass/fail/skip counts, details for each failed step, and reasons for each skipped step
- [ ] Pass

#### Step 1.2
- **Setup**: a PR for the change already exists
- **Do**: the ship-path skill completes the UAT run (Run: `gh pr comment`)
- **Observe**: the run summary is attached as a `gh pr comment` on the existing PR instead of being lost
- [ ] Pass

#### Step 1.3
- **Setup**: the archived UAT.md has never been executed
- **Do**: the skill reaches the hand-back point
- **Observe**: it does not present the PR as ready without first spawning the metta-uat-runner subagent against the archived UAT.md
- [ ] Pass

### US-2: Failing UAT blocks hand-back as ready

*Independent test:* When at least one machine-verified UAT step fails, the ship-path skill reports the failures and stops — the PR remains open and flagged, no merge occurs, and the change is not declared ready.

#### Step 2.1
- **Setup**: the agent-executed UAT run records at least one failed step
- **Do**: the ship-path skill evaluates readiness
- **Observe**: it reports the failures, leaves the PR open and flagged, and stops without merging or declaring the change ready
- [ ] Pass

#### Step 2.2
- **Setup**: all machine-verified UAT steps pass
- **Do**: the skill evaluates readiness
- **Observe**: the change proceeds to hand-back (or merge, on run-to-merge paths) with the passing summary attached
- [ ] Pass

### US-3: Run-to-merge paths gated before merge

*Independent test:* On each run-to-merge skill, the UAT execution step is ordered after `metta finalize` and before the merge step, and a UAT failure on these paths prevents the merge from happening.

#### Step 3.1
- **Setup**: a quick/auto/fix-issues/fix-gap run has finalized and opened its PR
- **Do**: the skill reaches its merge step (Run: `metta finalize`)
- **Observe**: the UAT run has already executed and its results are attached to the PR before any merge command runs
- [ ] Pass

#### Step 3.2
- **Setup**: the UAT run on a run-to-merge path reports a failure
- **Do**: the skill would otherwise merge
- **Observe**: the merge is skipped, the PR stays open flagged with the failure summary, and the skill stops
- [ ] Pass

### US-4: Manual acceptance steps skip without blocking

*Independent test:* A UAT.md containing only manual-acceptance steps (or a mix where all machine-verified steps pass) results in a non-blocking run whose summary lists each manual step as skipped with a stated reason.

#### Step 4.1
- **Setup**: the archived UAT.md contains manual-acceptance steps
- **Do**: the metta-uat-runner executes the script
- **Observe**: those steps are marked skipped with reasons in the run summary and do not count as failures
- [ ] Pass

#### Step 4.2
- **Setup**: all machine-verified steps pass and one or more manual steps are skipped
- **Do**: the skill evaluates readiness
- **Observe**: hand-back proceeds and the skip reasons are visible in the PR summary
- [ ] Pass

### US-5: Audit trail rides the change branch into the merge

*Independent test:* After a ship-path run, the change branch contains a commit updating `spec/archive/<date>-<slug>/UAT.md` with checked results, authored via the reuse of the /metta-uat orchestration contract (runner as sole mutator, orchestrator snapshotting cleanliness and sanity-checking the diff shape).

#### Step 5.1
- **Setup**: the metta-uat-runner has mutated the archived UAT.md
- **Do**: the orchestrating skill validates the diff shape against its pre-run cleanliness snapshot
- **Observe**: it commits the record as `docs(<change>): UAT run record` on the change branch so the record merges to main with the change
- [ ] Pass

#### Step 5.2
- **Setup**: the runner's diff touches files outside the expected UAT.md shape
- **Do**: the orchestrator sanity-checks the diff
- **Observe**: it does not blindly commit unexpected mutations
- [ ] Pass

### US-6: Consumers can opt out via configuration

*Independent test:* With `uat.enforce_on_ship` set to false in the validated UatConfigSchema, ship-path skills skip the mandatory UAT run and hand back without it; with the setting absent, enforcement defaults to on.

#### Step 6.1
- **Setup**: `uat.enforce_on_ship` is explicitly set to false
- **Do**: a ship-path skill reaches the post-finalize step
- **Observe**: it proceeds to PR creation and hand-back without spawning the UAT runner
- [ ] Pass

#### Step 6.2
- **Setup**: no `uat.enforce_on_ship` value is configured
- **Do**: the strict UatConfigSchema validates config
- **Observe**: the effective value is true and the UAT gate is enforced
- [ ] Pass

### US-7: All six ship-path skill pairs stay compliant

*Independent test:* The test suite fails if any of the six skill pairs (metta-ship, metta-propose, metta-quick, metta-auto, metta-fix-issues, metta-fix-gap) is missing the UAT step or has it ordered after `gh pr create`/merge where the intent requires it before.

#### Step 7.1
- **Setup**: the grep-assert tests are in place
- **Do**: a skill file's UAT step is removed or moved after its `gh pr create` or merge step (Run: `gh pr create`)
- **Observe**: the test suite fails and names the offending skill pair
- [ ] Pass

#### Step 7.2
- **Setup**: all twelve skill files (six pairs, template plus deployed) carry the correctly ordered UAT step and metta-ship's allowed-tools includes Agent
- **Do**: the test suite runs
- **Observe**: the ordering assertions pass
- [ ] Pass

## Additional scenarios

#### Step 8.1: Ship skill spawns the runner against the archived UAT before hand-back
- **Setup**: a change whose `metta finalize --json` output reported a non-null `uatPath`
- **Do**: any of the six ship-path skills proceeds toward `gh pr create` (Run: `metta finalize --json`, `gh pr create`)
- **Observe**: the skill spawns the `metta-uat-runner` subagent via the Agent tool with `subagent_type: metta-uat-runner` against the `UAT.md` at `uatPath` before presenting the PR as ready; the skill does not slash-invoke `/metta-uat` at any point
- [ ] Pass

#### Step 8.2: Never hand back an unexecuted UAT
- **Setup**: an archived `UAT.md` that has never been executed
- **Do**: a ship-path skill reaches its hand-back point
- **Observe**: the skill does not present the PR as ready without first spawning the `metta-uat-runner` subagent against that archived `UAT.md`
- [ ] Pass

#### Step 8.3: metta-ship can spawn subagents
- **Setup**: both copies of the `metta-ship` skill (`src/templates/skills/metta-ship/SKILL.md` and `.claude/skills/metta-ship/SKILL.md`)
- **Do**: their frontmatter `allowed-tools` lists are read
- **Observe**: both include `Agent`; the two copies are byte-identical
- [ ] Pass

#### Step 8.4: Valid run diff is committed on the change branch
- **Setup**: the runner has mutated the archived `UAT.md` with checkbox flips before the first `## UAT run — ` heading and exactly one appended dated `## UAT run — <date>` section
- **Do**: the orchestrating skill validates the diff against its pre-run cleanliness snapshot
- **Observe**: it commits the record as `docs(<change>): UAT run record` on the change branch; the runner's own execution issued no git commands
- [ ] Pass

#### Step 8.5: Unexpected diff shape is not blindly committed
- **Setup**: the post-run diff touches files other than the target `UAT.md`, or alters content other than checkbox flips plus one appended dated run section
- **Do**: the orchestrating skill sanity-checks the diff
- **Observe**: it does not commit the unexpected mutations as a UAT run record and reports the anomaly instead
- [ ] Pass

#### Step 8.6: No second runner path exists
- **Setup**: the six ship-path skill pairs after this change
- **Do**: their UAT instructions are inspected alongside `.claude/agents/metta-uat-runner.md`
- **Observe**: every ship-path UAT execution goes through the existing `metta-uat-runner` agent contract; the runner agent pair is unmodified by this change
- [ ] Pass

#### Step 8.7: PR body carries the run summary at creation
- **Setup**: a completed UAT run on a change whose PR has not yet been created
- **Do**: the ship-path skill runs `gh pr create` (Run: `gh pr create`)
- **Observe**: the PR body includes the run summary with pass/fail/skip counts, details for each failed step, and a reason for each skipped step
- [ ] Pass

#### Step 8.8: Existing PR receives the summary as a comment
- **Setup**: a PR for the change already exists when the UAT run completes
- **Do**: the ship-path skill attaches the results (Run: `gh pr comment`)
- **Observe**: the run summary is posted via `gh pr comment` on that PR rather than being lost
- [ ] Pass

#### Step 8.9: Run record merges to main with the change
- **Setup**: a ship-path run whose UAT record commit was made on the change branch
- **Do**: the PR is merged
- **Observe**: main contains the archived `UAT.md` with its checkbox state and dated run record
- [ ] Pass

#### Step 8.10: Failed step halts the ship path
- **Setup**: the agent-executed UAT run records at least one failed step
- **Do**: the ship-path skill evaluates readiness
- **Observe**: it reports the failures, leaves the PR open and flagged with the failure summary, and stops without merging or declaring the change ready
- [ ] Pass

#### Step 8.11: All-pass run proceeds to hand-back
- **Setup**: all machine-verified UAT steps pass
- **Do**: the skill evaluates readiness
- **Observe**: the change proceeds to hand-back (or merge, on run-to-merge paths) with the passing summary attached
- [ ] Pass

#### Step 8.12: Manual-acceptance steps skip without blocking
- **Setup**: the archived `UAT.md` contains steps requiring human acceptance, and every machine-verified step passes
- **Do**: the skill evaluates readiness
- **Observe**: the manual steps are listed as skipped with reasons in the PR summary; hand-back proceeds — skips do not block
- [ ] Pass

#### Step 8.13: Merge waits for UAT results
- **Setup**: a quick/auto/fix-issues/fix-gap run has finalized and opened its PR
- **Do**: the skill reaches its merge step
- **Observe**: the UAT run has already executed and its results are attached to the PR before any merge command runs
- [ ] Pass

#### Step 8.14: UAT failure leaves the PR open and unmerged
- **Setup**: the UAT run on a run-to-merge path reports at least one failed step
- **Do**: the skill would otherwise run `gh pr merge` (Run: `gh pr merge`)
- **Observe**: the merge is skipped, the PR stays open flagged with the failure summary, and the skill stops
- [ ] Pass

#### Step 8.15: Disabled toggle skips generation cleanly
- **Setup**: `.metta/config.yaml` sets `uat.enabled: false`
- **Do**: `metta finalize` runs to completion on a complete change (Run: `metta finalize`)
- **Observe**: finalize succeeds, no `UAT.md` is written to the change directory or archive, and all other finalize behavior is unchanged
- [ ] Pass

#### Step 8.16: Omitted uat key defaults to enabled
- **Setup**: `.metta/config.yaml` with no `uat` section
- **Do**: config is loaded and `metta finalize` runs to completion (Run: `metta finalize`)
- **Observe**: config validation passes and a `UAT.md` is generated
- [ ] Pass

#### Step 8.17: Disabled enforcement skips the ship-path UAT run
- **Setup**: `uat.enforce_on_ship` is explicitly set to `false`
- **Do**: a ship-path skill reaches its post-finalize step
- **Observe**: it proceeds to PR creation and hand-back without spawning the `metta-uat-runner` subagent
- [ ] Pass

#### Step 8.18: Omitted enforce_on_ship defaults to enforced
- **Setup**: `.metta/config.yaml` whose `uat` block has no `enforce_on_ship` key
- **Do**: the strict `UatConfigSchema` validates config
- **Observe**: the effective value is `true` and the ship-path UAT gate is enforced
- [ ] Pass

#### Step 8.19: Fresh install scaffolds explicit enforcement without overwriting existing configs
- **Setup**: a fresh project with no `.metta/config.yaml`
- **Do**: `metta install` runs (Run: `metta install`)
- **Observe**: the scaffolded `.metta/config.yaml` contains a `uat` block with `enforce_on_ship: true` written explicitly; when a `.metta/config.yaml` already exists, the scaffold write leaves it untouched (flag `'wx'` semantics preserved)
- [ ] Pass

#### Step 8.20: Invalid uat config is rejected strictly
- **Setup**: a `uat` config block containing an unknown key or a non-boolean value for `enabled` or `enforce_on_ship`
- **Do**: config is loaded
- **Observe**: `UatConfigSchema` rejects it with a Zod validation error; the invalid value is not silently coerced or ignored
- [ ] Pass

#### Step 8.21: Skills resolve the toggle without a guard block
- **Setup**: any ship-path skill running in its normal tier (forked or session-tier)
- **Do**: it reaches the post-finalize step and needs the `uat.enforce_on_ship` value
- **Observe**: it obtains the schema-validated effective value without the guard hook blocking the call and without hand-parsing config YAML
- [ ] Pass

#### Step 8.22: Config-read mechanism outcome
- **Setup**: the design selects a read-only `metta config get` form allowlisted in both guard hook copies
- **Do**: a ship-path skill reads `uat.enforce_on_ship` through it (Run: `metta config get`)
- **Observe**: the guard permits the read-only call, the returned value reflects the strict-schema default when the key is omitted, and no write-capable `metta` command becomes newly allowlisted
- [ ] Pass

#### Step 8.23: Finalize-output mechanism outcome
- **Setup**: the design surfaces the effective toggle in `metta finalize --json` output
- **Do**: a ship-path skill parses that output at its post-finalize step (Run: `metta finalize --json`)
- **Observe**: the skill decides the gate from the surfaced value with no guard hook change required; pre-existing finalize success-payload fields are unchanged
- [ ] Pass

#### Step 8.24: Tests pass on compliant skill files
- **Setup**: all twelve skill files carry the correctly ordered UAT step and `metta-ship`'s `allowed-tools` includes `Agent`
- **Do**: the grep-assert tests run via `npm test` (Run: `npm test`)
- **Observe**: the presence and ordering assertions pass for every pair
- [ ] Pass

#### Step 8.25: Dropped or reordered gate fails the suite
- **Setup**: any one of the twelve skill files has its UAT step removed, or moved after its `gh pr create` or merge step
- **Do**: the grep-assert tests run (Run: `gh pr create`)
- **Observe**: at least one test fails, naming the offending skill file
- [ ] Pass

#### Step 8.26: Propose hands back a PR that already carries the run record
- **Setup**: a default `/metta-propose` run reaching its PR-open stop
- **Do**: the PR is handed back to the user
- **Observe**: the archived `UAT.md` on the change branch already contains a dated `## UAT run — <date>` section and the PR carries the run summary
- [ ] Pass

#### Step 8.27: Ship of an unchanged branch does not duplicate the record
- **Setup**: a branch whose head commit is unchanged since propose recorded its UAT run
- **Do**: `/metta-ship` processes that branch
- **Observe**: the resulting `UAT.md` does not contain two identical dated run records produced without a fresh execution — ship either reuses the existing record as gate evidence or performs a genuine re-run
- [ ] Pass

#### Step 8.28: Genuine re-run appends per existing semantics
- **Setup**: the branch changed after propose's recorded run and ship performs a fresh UAT run
- **Do**: the run completes
- **Observe**: checkboxes reflect only the latest run and a new dated `## UAT run` section is appended after the prior one, which remains byte-for-byte unchanged
- [ ] Pass
