# UAT: fix-metta-propose-runs-entire-lifecycle-through-finalize

- **Change**: fix-metta-propose-runs-entire-lifecycle-through-finalize
- **Generated**: 2026-08-21
- **Source**: user stories (stories.md)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

### US-1: Propose stops at an open PR by default

*Independent test:* A default `/metta-propose` run (no stop-after flag) ends with `gh pr create` and a reported PR URL, and no `gh pr merge` is executed.

#### Step 1.1
- **Setup**: `/metta-propose <description>` is invoked with no stop-after flag
- **Do**: the change completes verification and finalize (Run: `gh pr merge`)
- **Observe**: the skill pushes the branch, creates the PR, reports the PR URL, and stops without running `gh pr merge`
- [ ] Pass

#### Step 1.2
- **Setup**: a completed default propose run
- **Do**: the user inspects the repository
- **Observe**: the change branch's PR is open and main does not contain the merge
- [ ] Pass

#### Step 1.3
- **Setup**: a default propose run has stopped at PR-open
- **Do**: the user wants to land it
- **Observe**: `/metta-ship` (or an explicit merge) completes the change without rework
- [ ] Pass

### US-2: Explicit ship opt-in restores run-to-merge

*Independent test:* A propose run with the ship opt-in proceeds past PR creation to CI watch and merge, using the existing propose-stop-after machinery.

#### Step 2.1
- **Setup**: `/metta-propose` is invoked with the ship opt-in
- **Do**: the PR is created (Run: `gh pr checks --watch`, `gh pr merge`)
- **Observe**: the skill continues through `gh pr checks --watch` and `gh pr merge` as before
- [ ] Pass

#### Step 2.2
- **Setup**: the ship opt-in is recorded via the propose-stop-after machinery
- **Do**: `.metta.yaml` is inspected
- **Observe**: the recorded stop-after value validates against the existing schema and drives the boundary check
- [ ] Pass

### US-3: Existing stop-after values keep their semantics

*Independent test:* Each previously accepted stop-after value still validates and stops the propose pipeline at the same boundary as before the change.

#### Step 3.1
- **Setup**: `/metta-propose` is invoked with an existing stop-after value such as `tasks`
- **Do**: that artifact completes
- **Observe**: the pipeline stops at the same boundary it did before this change
- [ ] Pass

#### Step 3.2
- **Setup**: the `propose-stop-after` spec delta is applied
- **Do**: the value set is reviewed
- **Observe**: no existing value is removed or renamed, and only the absent-flag default semantics change
- [ ] Pass

#### Step 3.3
- **Setup**: `/metta-auto` or `/metta-fix-issues` is invoked
- **Do**: their lifecycles complete
- **Observe**: they still run to merge exactly as before
- [ ] Pass

### US-4: Instructions and docs cannot silently restore auto-merge

*Independent test:* Grep-assert tests over both SKILL.md copies fail if an unconditional merge instruction is present, and pass on the updated files.

#### Step 4.1
- **Setup**: the installed skill (`.claude/skills/metta-propose/SKILL.md`) and the template (`src/templates/skills/metta-propose/SKILL.md`)
- **Do**: their default-path instructions are read (Run: `gh pr create`)
- **Observe**: the terminal action is `gh pr create` + report, with merge conditional on the explicit ship opt-in and no "must ship" mandate on the default path
- [ ] Pass

#### Step 4.2
- **Setup**: the grep-assert regression tests
- **Do**: an unconditional `gh pr merge` instruction is added back to either SKILL.md copy (Run: `gh pr merge`)
- **Observe**: the test suite fails
- [ ] Pass

#### Step 4.3
- **Setup**: the CLAUDE.md workflow section
- **Do**: a reader checks `/metta-propose`'s described behavior
- **Observe**: it states the run ends at an open PR unless ship is explicitly requested
- [ ] Pass

## Additional scenarios

#### Step 5.1: option appears in CLI help
- **Setup**: the metta CLI is built
- **Do**: the user runs `metta propose --help` (Run: `metta propose --help`)
- **Observe**: the help output MUST include a line documenting `--stop-after <artifact>` with a one-line description naming planning-phase artifact ids AND `ship` as the valid values
- [ ] Pass

#### Step 5.2: option is accepted with a valid value
- **Setup**: a clean repository on `main`
- **Do**: the user runs `metta propose "<desc>" --stop-after tasks --json`
- **Observe**: the command MUST exit with code 0 AND the JSON output MUST include `"stop_after": "tasks"` AND a change directory at `spec/changes/<name>/` MUST exist with `.metta.yaml` containing `stop_after: tasks`
- [ ] Pass

#### Step 5.3: option is accepted with the `ship` value and persisted
- **Setup**: a clean repository on `main`
- **Do**: the user runs `metta propose "<desc>" --stop-after ship --json`
- **Observe**: the command MUST exit with code 0 AND the JSON output MUST include `"stop_after": "ship"` AND `.metta.yaml` MUST contain `stop_after: ship` validating against the existing `ChangeMetadataSchema` without schema changes
- [ ] Pass

#### Step 5.4: option is omitted, no `stop_after` field is persisted
- **Setup**: a clean repository on `main`
- **Do**: the user runs `metta propose "<desc>" --json` with no `--stop-after` flag
- **Observe**: the JSON output MUST NOT include a `stop_after` field (or MUST set it to `null`) AND `.metta.yaml` MUST NOT include a `stop_after` field — the PR-open default is applied by the skill, not by persisted state
- [ ] Pass

#### Step 5.5: `ship` is accepted for any workflow
- **Setup**: any resolved workflow (e.g. `standard` or `full`) whose `buildOrder` does not contain a `ship` artifact
- **Do**: the user runs `metta propose "<desc>" --stop-after ship --json`
- **Observe**: the CLI MUST exit with code 0 AND persist `stop_after: ship` on the change record
- [ ] Pass

#### Step 5.6: unknown artifact id is still rejected and the valid list names `ship`
- **Setup**: the resolved workflow `standard` whose `buildOrder` does not contain `spex`
- **Do**: the user runs `metta propose "<desc>" --stop-after spex`
- **Observe**: the CLI MUST exit with code 4 AND the error message MUST cite `spex` as unknown AND MUST list the valid values (`intent, stories, spec, research, design, tasks, ship`) AND `spec/changes/` MUST NOT contain a directory for this change
- [ ] Pass

#### Step 5.7: execution-phase artifact id is still rejected
- **Setup**: any resolved workflow whose `buildOrder` includes `implementation`
- **Do**: the user runs `metta propose "<desc>" --stop-after implementation`
- **Observe**: the CLI MUST exit with code 4 AND the error message MUST explain that execution-phase ids are not valid stop points AND `spec/changes/` MUST NOT contain a directory for this change
- [ ] Pass

#### Step 5.8: existing planning-phase values keep their semantics
- **Setup**: the user passes any previously accepted stop-after value (`intent`, `stories`, `spec`, `research`, `design`, `tasks`, or a non-default-workflow planning id such as `domain-research`)
- **Do**: `metta propose` runs with that value (Run: `metta propose`)
- **Observe**: the value MUST validate and persist exactly as it did before this change, with no change in boundary semantics
- [ ] Pass

#### Step 5.9: skill parses and forwards `--ship` from `$ARGUMENTS`
- **Setup**: a propose skill invocation whose `$ARGUMENTS` is `add cool feature --ship`
- **Do**: the orchestrator runs Step 1 (CLI invocation) (Run: `add cool feature --ship`)
- **Observe**: it MUST execute `METTA_SKILL=1 metta propose "add cool feature" --stop-after ship --json` AND the description MUST NOT contain the `--ship` token
- [ ] Pass

#### Step 5.10: `stop_after: ship` restores run-to-merge
- **Setup**: a change record with `stop_after: ship` and the orchestrator has reached `all_complete: true`, run `metta finalize`, pushed the branch, and created the PR
- **Do**: the orchestrator continues past PR creation (Run: `metta finalize`)
- **Observe**: it MUST run `gh pr checks <pr-number> --watch --fail-fast` AND, when all checks pass, `gh pr merge <pr-number> --merge` AND perform post-merge cleanup exactly as the pre-change step 8 did
- [ ] Pass

#### Step 5.11: planning-phase boundary for `tasks` is unchanged
- **Setup**: a change record with `stop_after: tasks` and the orchestrator has just received `all_complete: false` with `next: ["implementation"]` from `metta complete tasks`
- **Do**: the orchestrator inspects the change record (Run: `metta complete tasks`, `Stopped after`)
- **Observe**: it MUST stop the workflow AND print `Stopped after `tasks`. Run `/metta-execute` to begin implementation.` AND MUST NOT spawn any metta-executor, metta-reviewer, or metta-verifier agent
- [ ] Pass

#### Step 5.12: default propose run ends at an open PR
- **Setup**: `/metta-propose <description>` is invoked with no stop-after flag and no `--ship`
- **Do**: the change completes verification and `metta finalize` succeeds (Run: `metta finalize`, `gh pr create`)
- **Observe**: the orchestrator MUST push the branch, run `gh pr create`, report the PR URL, and stop AND the captured session MUST NOT contain a `gh pr merge` invocation
- [ ] Pass

#### Step 5.13: main does not contain the change after a default run
- **Setup**: a completed default propose run that reported a PR URL
- **Do**: the user inspects the repository
- **Observe**: the change branch's PR MUST be open AND `main` MUST NOT contain the change's merge commit
- [ ] Pass

#### Step 5.14: the user can land the PR without rework
- **Setup**: a default propose run has stopped at PR-open
- **Do**: the user runs `/metta-ship` (or merges the PR explicitly)
- **Observe**: the change MUST complete — merge, archive, and cleanup — without re-running planning, implementation, or verification
- [ ] Pass

#### Step 5.15: default-path instructions end at PR creation in both copies
- **Setup**: the updated `.claude/skills/metta-propose/SKILL.md` and `src/templates/skills/metta-propose/SKILL.md`
- **Do**: their default-path (no `stop_after`) instructions are read (Run: `gh pr create`, `gh pr merge`)
- **Observe**: the terminal actions MUST be `gh pr create` and reporting the PR URL AND every `gh pr merge` mention MUST be inside a condition requiring `stop_after = ship` AND no section commands an unconditional ship on the default path
- [ ] Pass

#### Step 5.16: the two copies agree
- **Setup**: both SKILL.md copies after this change
- **Do**: their step-8 / ship-path content is compared
- **Observe**: both MUST describe the same default (stop at PR-open) and the same ship opt-in behavior
- [ ] Pass

#### Step 5.17: tests pass on the updated skill files
- **Setup**: the updated SKILL.md copies with merge conditioned on the ship opt-in
- **Do**: the grep-assert tests run via `npm test` (Run: `npm test`)
- **Observe**: they MUST pass
- [ ] Pass

#### Step 5.18: tests fail when unconditional merge is reintroduced
- **Setup**: either SKILL.md copy is edited to add an unconditioned default-path `gh pr merge <pr-number> --merge` instruction
- **Do**: the grep-assert tests run
- **Observe**: at least one test MUST fail, naming the offending file
- [ ] Pass

#### Step 5.19: `/metta-auto` still runs to merge
- **Setup**: `/metta-auto <description>` is invoked and the change passes verification and finalize
- **Do**: the lifecycle completes
- **Observe**: the auto skill MUST still push, create the PR, watch CI, and merge exactly as it did before this change
- [ ] Pass

#### Step 5.20: `/metta-fix-issues` still runs to merge
- **Setup**: `/metta-fix-issues <slug>` is invoked and the fix passes verification and finalize
- **Do**: the lifecycle completes
- **Observe**: the fix-issues skill MUST still push, create the PR, watch CI, and merge exactly as it did before this change
- [ ] Pass

#### Step 5.21: workflow section describes the PR-open default
- **Setup**: the updated `CLAUDE.md`
- **Do**: a reader checks the `/metta-propose` entries in the Metta Workflow section
- **Observe**: the text MUST state that a default propose run ends at an open PR AND that merging requires the explicit ship opt-in or `/metta-ship`
- [ ] Pass
