# Finalize and Ship

## Requirement: Spec Delta Merge

The system MUST merge a change's `spec.md` delta file into the corresponding canonical capability spec when `SpecMerger.merge` is called.
The capability name MUST be derived from the delta's explicit merge-target selection (an existing capability slug, or an explicit new-capability confirmation) rather than solely by stripping the trailing ` (Delta)` suffix from the H1, lower-casing, and replacing whitespace runs with hyphens; the title-derived slug remains available as the capability name once a target has been confirmed by that selection.
The merger MUST evaluate the full conflict-detection set for every delta in both dry-run and applying mode:

### Scenario: New capability created from a confirmed ADDED delta
- GIVEN a change with a delta adding requirement "Multi-Factor Authentication" and an explicit new-capability confirmation for capability "auth"
- AND no existing spec for "auth"
- WHEN `merge` is called
- THEN `result.status` equals "clean", `result.merged` contains an entry, and the "auth" capability spec is created containing the requirement

### Scenario: Re-applying an ADDED delta does not duplicate an existing requirement
- GIVEN a capability "auth" whose spec already contains "## Requirement: Session Management"
- AND a delta that re-applies an ADDED operation for "Session Management"
- WHEN `merge` is called against that delta a second time
- THEN the "auth" capability spec contains exactly one "## Requirement: Session Management" section
- AND the second application is reported as a no-op or an explicit conflict, never a second append

### Scenario: ADDED idempotency holds without a base_versions entry
- GIVEN a capability that was created by this same change's own earlier ADDED delta, so no `base_versions` entry exists for it
- AND the change's finalize is retried
- WHEN the ADDED delta is re-applied via `merge`
- THEN the already-present requirement section is not duplicated despite the absence of a base_versions comparison

### Scenario: Dry-run reports requirement not found for a MODIFIED delta against an absent requirement
- GIVEN a capability spec that does not contain requirement "Ghost Requirement"
- AND a change delta with a MODIFIED operation targeting "Ghost Requirement"
- WHEN `merge` is called with `dryRun: true`
- THEN `result.status` equals "conflict"
- AND `result.conflicts` contains an entry for that requirement with reason "requirement not found"
- AND the entry does not appear in `result.merged`

### Scenario: Dry-run classifies an ADDED duplicate as a noop, matching apply
- GIVEN a capability spec that already contains the requirement named by an ADDED delta
- WHEN `merge` is called once with `dryRun: true` and once with `dryRun: false` against the same spec-store state
- THEN both results list `${capability}/${requirementId}` under `noops`
- AND neither result lists it under `merged`

## Requirement: Finalizer Orchestration

The system MUST orchestrate the finalize lifecycle in this order when `Finalizer.finalize` is called:
Gate statuses of `"pass"`, `"skip"`, and `"warn"` MUST all be treated as non-blocking; only `"fail"` blocks finalization. When no `GateRegistry` is provided, or the registry has no registered gates, gate checking MUST be skipped and `gatesPassed` MUST be `true`. In dry-run mode the system MUST skip archiving, gate result writing, and actual file mutations; the returned `archiveName` MUST be `"(dry-run)"` and the change MUST remain in the active changes list.
A run that fails at the artifact-completeness check, the conflict-detection step, or the gate-execution step MUST leave the target capability's spec files unchanged on disk: no content from this change's delta is written before all three checks have passed. A retried `finalize` after such a failure MUST NOT compound or duplicate already-merged content.
Fulfills: US-3, US-6

### Scenario: Incomplete artifact blocks finalize before gates or merge run
- GIVEN an active change whose metadata marks a workflow-required artifact (for example, "verification") as not `complete`
- WHEN `finalize` is called for that change
- THEN the result reports an incomplete-artifacts failure listing that artifact by name
- AND no gates run, no spec-merge content is written, and the change is not archived

### Scenario: Gate failure leaves the target capability spec untouched
- GIVEN an active change with all required artifacts `complete`, a clean (non-conflicting) delta, and at least one configured gate that will fail
- WHEN `finalize` is called
- THEN the result reports the gate failure with a non-zero CLI exit
- AND a diff of the target capability's spec file taken before and after the run shows no changes

### Scenario: Retry after a fixed gate applies the merge exactly once
- GIVEN a prior `finalize` attempt failed at the gate-execution step for a change with an ADDED delta
- AND the gate issue has since been fixed
- WHEN `finalize` is called again for the same change
- THEN gates pass, the spec merge is written to disk, and the target capability's spec file contains exactly one section for the delta's requirement

## Requirement: Merge Safety Pipeline

The system MUST execute a 7-step safety pipeline when `MergeSafetyPipeline.run(sourceBranch, targetBranch)` is called. Each step MUST be recorded as a `MergeSafetyStep` with fields `step`, `status` (`"pass"` | `"fail"` | `"skip"`), and optional `detail`.

The steps MUST execute in this order:

1. **base-drift-check** — resolve `targetBranch` rev; fail and return immediately on git error
2. **dry-run-merge** — attempt `git merge --no-commit --no-ff <sourceBranch>` then abort; if conflicts are detected return `status: "conflict"` immediately
3. **scope-check** — count files changed between branches via `git diff --name-only`; skip on error
4. **gate-verification** — assert that gates passed on the source branch (currently always passes)
5. **snapshot** — create or force-update tag `metta/pre-merge/<sourceBranch>` on `targetBranch`; skip in dry-run
6. **merge** — execute `git merge --no-ff <sourceBranch> -m "chore: merge <sourceBranch>"`; on failure reset hard to snapshot tag; skip in dry-run
7. **post-merge-gates** — verify system integrity after merge; skip in dry-run

In dry-run mode steps 5, 6, and 7 MUST be recorded with status `"skip"` and the pipeline MUST return `status: "success"` without modifying any git state.

On merge failure (step 6), the system MUST attempt `git reset --hard <snapshotTag>` to roll back. The returned status MUST be `"failure"`.

On conflict (step 2), the system MUST call `git merge --abort` before returning.

Successful completion MUST return `status: "success"` with `mergeCommit` (full SHA) and `snapshotTag` set to `metta/pre-merge/<sourceBranch>`.

### Scenario: Successful merge
- GIVEN a feature branch with one commit ahead of main
- WHEN `run("feature", "main")` is called
- THEN `result.status` equals "success"
- AND all steps have status "pass"
- AND `result.mergeCommit` is defined
- AND `result.snapshotTag` equals "metta/pre-merge/feature"

### Scenario: Dry-run skips git writes
- GIVEN a feature branch ahead of main
- WHEN `run("dry-feature", "main", true)` is called
- THEN `result.status` equals "success"
- AND the step named "merge" has status "skip"
- AND no merge commit is created

### Scenario: Conflict detected
- GIVEN the same file has been modified on both source and target with conflicting content
- WHEN `run("conflict-feature", "main")` is called
- THEN `result.status` equals "conflict"
- AND the "dry-run-merge" step has status "fail"

### Scenario: Base drift does not block merge
- GIVEN the target branch has advanced since the source branch diverged
- WHEN `run("drift-feature", "main")` is called without file conflicts
- THEN `result.status` equals "success"
- AND the "base-drift-check" step has status "pass"


## Requirement: Finalize Lock Contention Error Message

When `acquireFinalizeLock` fails to acquire a finalize lock currently held by another live
process, the system MUST throw a `FinalizeLockError` whose message recommends re-running
`metta finalize` to reclaim the lock, and the message MUST NOT instruct the caller to manually
delete the lock file. The existing dead-pid reclaim path (checking process liveness at
acquisition time) MUST remain intact and MUST be exercised automatically the next time
`metta finalize` runs against a lock whose recorded owner pid is dead.

### Scenario: Lock held by a live process recommends a retry, not manual deletion
- GIVEN a finalize lock file for a change, held by a process pid that is confirmed live
- WHEN `acquireFinalizeLock` is called for the same change by a second process
- THEN a `FinalizeLockError` is thrown
- AND its message recommends re-running `metta finalize`
- AND its message does not instruct manual deletion of the lock file

### Scenario: Re-running finalize reclaims a dead-pid lock without manual cleanup
- GIVEN a finalize lock file for a change whose recorded owner pid is dead
- WHEN `metta finalize` is re-run for that change
- THEN `acquireFinalizeLock` reclaims the lock via the existing dead-pid check
- AND finalize proceeds without any manual lock file deletion


## Requirement: Finalize Lock Staleness Fallback Via Mtime

When `acquireFinalizeLock` cannot determine liveness of a lock's recorded owner pid from the
pid-liveness check alone — because the pid has been recycled by an unrelated live process, or
the liveness probe fails with `EPERM` — the system MUST additionally check the lock file's mtime
against a 60-second staleness threshold, consistent with the state store's existing stale-lock
convention, and MUST reclaim the lock when the mtime exceeds that threshold. This mtime-based
fallback MUST NOT alter or replace the existing direct dead-pid reclaim path; it applies only
when pid liveness is ambiguous.

### Scenario: Ambiguous pid liveness with an expired mtime is reclaimed
- GIVEN a finalize lock file whose mtime is older than 60 seconds
- AND the recorded owner pid currently belongs to an unrelated live process (recycled), or the
liveness probe raises `EPERM` when checking it
- WHEN `acquireFinalizeLock` runs for that change
- THEN the lock is treated as stale
- AND the lock is reclaimed without throwing `FinalizeLockError`

### Scenario: Fresh lock with a confirmed live owner is respected
- GIVEN a finalize lock file whose mtime is within the 60-second staleness threshold
- AND the recorded owner pid is confirmed live and matches the original owner
- WHEN `acquireFinalizeLock` runs for that change
- THEN the lock is respected
- AND `FinalizeLockError` is thrown

### Scenario: Dead-pid reclaim path is preserved alongside the mtime fallback
- GIVEN a finalize lock file with a dead owner pid, regardless of the lock file's mtime age
- WHEN `acquireFinalizeLock` runs for that change
- THEN the existing dead-pid reclaim path acquires the lock
- AND the mtime fallback is not required to determine reclaim eligibility


## Requirement: Stale Finalize Lock Surfaced In Status

When a finalize lock exists for the active change and is stale (its recorded owner pid is dead,
or it is mtime-expired under the Finalize Lock Staleness Fallback Via Mtime requirement),
`metta status` MUST include a line in its output indicating that a stale finalize lock was
detected and that it is safe to retry finalize. `metta status` output for a change with no
finalize lock, or with a fresh lock held by a live process, MUST be unchanged by this behavior.

### Scenario: Status reports a detected stale lock
- GIVEN the active change has a finalize lock that is stale (dead-pid or mtime-expired)
- WHEN `metta status` is run
- THEN the output includes a line indicating a stale finalize lock was detected
- AND the line indicates it is safe to retry finalize

### Scenario: Status is unchanged when no stale lock is present
- GIVEN the active change has no finalize lock, or has a fresh lock held by a live process
- WHEN `metta status` is run
- THEN the output contains no stale-lock detection line
- AND all other existing status output is unaffected


## Requirement: Stale Finalize Lock Surfaced In Next Routing

When a finalize lock exists for the active change and is stale (its recorded owner pid is dead,
or it is mtime-expired under the Finalize Lock Staleness Fallback Via Mtime requirement),
`metta next` MUST surface the stale-lock detection in its routing output instead of routing the
orchestrator directly into a finalize invocation that would fail with `FinalizeLockError`.
`metta next` output for a change with no finalize lock, or with a fresh lock held by a live
process, MUST be unchanged by this behavior.

### Scenario: Next surfaces the stale lock instead of routing into a failing finalize
- GIVEN the active change has a finalize lock that is stale (dead-pid or mtime-expired)
- AND the next logical routing step would otherwise be to run finalize
- WHEN `metta next` is run
- THEN the output surfaces the stale-lock detection with a safe-to-retry indication
- AND the output does not route the orchestrator into a finalize call that would throw
`FinalizeLockError`

### Scenario: Next routing is unchanged when no stale lock is present
- GIVEN the active change has no finalize lock, or has a fresh lock held by a live process
- WHEN `metta next` is run
- THEN routing output is unchanged from existing behavior
- AND no stale-lock warning appears


## Requirement: Explicit Capability Target Selection In Spec Authoring

When generating spec-authoring instructions for an active change, the system MUST enumerate the existing capability slugs present in the spec store and present that list to the author as candidate merge targets before the spec delta artifact is authored. The generated spec artifact scaffold MUST require the author to record an explicit merge-target decision — either the slug of one of the listed existing capabilities, or an explicit new-capability confirmation marker (`<!-- new-capability -->` placed immediately under the H1) declaring intent to create a capability that does not yet exist. The scaffold's H1 title text alone MUST NOT be treated as an implicit merge-target default equal to the change's own slug.
Fulfills: US-1

### Scenario: Instructions surface existing capabilities before authoring
- GIVEN a project with existing capabilities in the spec store
- WHEN the author runs the spec-authoring instructions flow for an active change
- THEN the generated instructions list the existing capability slugs and direct the author to select one, or add the new-capability marker, before writing delta content

### Scenario: Generated scaffold carries an explicit target field, not an implicit slug default
- GIVEN the spec artifact scaffold is rendered for a change named "my-change-slug"
- WHEN the author inspects the generated scaffold
- THEN it contains an explicit merge-target selection point (an existing capability slug or the new-capability marker) rather than the H1 silently defaulting to "my-change-slug" as the merge target


## Requirement: Merge Target Confirmation At Completion

`metta complete spec` MUST resolve the delta's merge-target capability from the explicit selection recorded per the Explicit Capability Target Selection In Spec Authoring requirement, not from the H1 text alone. When the resolved target equals the change's own slug, no capability of that slug currently exists in the spec store, and the delta does not carry the new-capability confirmation marker, `metta complete spec` MUST refuse to complete the artifact: it MUST exit non-zero, name the unrecognized/unconfirmed target capability, and MUST NOT create any file or folder under the spec store. When the new-capability marker is present, completion MUST succeed and the confirmed capability MUST be recorded as the merge target. This validation MUST NOT change the existing hard-fail behavior for MODIFIED, REMOVED, or RENAMED delta operations that target a capability with no existing spec: those continue to fail non-zero with no writes.
Fulfills: US-2

### Scenario: Unconfirmed self-slug target is refused
- GIVEN an ADDED-only delta whose resolved capability slug equals the change's own slug, no capability folder of that slug exists, and no new-capability marker is present
- WHEN `metta complete spec` runs
- THEN it exits non-zero, names the unrecognized/unconfirmed target capability, and no folder is created under the spec store

### Scenario: Explicit new-capability marker allows completion
- GIVEN the same delta but with the new-capability confirmation marker present
- WHEN `metta complete spec` runs
- THEN completion succeeds and the confirmed capability is recorded as the merge target

### Scenario: Non-ADDED operations against a nonexistent capability still hard-fail
- GIVEN a delta containing MODIFIED, REMOVED, or RENAMED operations that target a capability with no existing spec
- WHEN `metta complete spec` runs
- THEN it exits non-zero and no writes occur, unchanged from prior behavior


## Requirement: Trivial Workflow Verification Artifact Contract Agreement

The trivial workflow's verification stage `generates` declaration and the instructions actually presented to whichever agent performs trivial-tier verification MUST agree on the artifact filename produced. Following the trivial-tier verification instructions exactly as authored MUST result in a file being written at the path the `generates` declaration names, so that `metta complete verification` can succeed without any file having been produced through an undocumented, out-of-band convention.
Fulfills: US-4

### Scenario: Declared contract and instructed behavior agree
- GIVEN the trivial workflow template as shipped
- WHEN the verification stage's `generates` declaration is compared against what the trivial-tier verification instructions direct an agent to write
- THEN the two agree exactly: the file the instructions direct the agent to produce is the same file the `generates` declaration names

### Scenario: Following instructions lets completion succeed
- GIVEN a trivial-tier change whose verification stage was executed exactly per the instructions
- WHEN the author runs `metta complete verification`
- THEN the command exits zero and the verification artifact transitions to `complete`

### Scenario: Finalize completeness gate passes without manual patching
- GIVEN a fully-executed trivial-tier change whose verification artifact is `complete` per the corrected contract
- WHEN `metta finalize` runs
- THEN the artifact-completeness check passes without any manual creation or renaming of files by the author


## Requirement: UAT Script Generation At Finalize

`Finalizer.finalize` MUST generate a `UAT.md` acceptance script for the change being finalized, positioned in the finalize order after the gate-execution step has passed and after the real (non-dry-run) spec merge has been written, and immediately before the archive step moves the change directory. The file MUST be written to `spec/changes/<name>/UAT.md` so that the existing archive move sweeps it into `spec/archive/<date>-<name>/` alongside `intent.md`, `stories.md`, `spec.md`, `summary.md`, and `gates.yaml`. Generation MUST be deterministic assembly from the change's on-disk artifacts: the generator MUST NOT invoke any AI provider, and two runs over identical artifact inputs (holding the generation date fixed) MUST produce byte-identical output. The `FinalizeResult` returned by `Finalizer.finalize` MUST gain a field reporting the path where `UAT.md` was written.
Fulfills: US-1, US-6

### Scenario: Successful finalize writes UAT.md into the change directory before archive
- GIVEN a standard-tier change with all required artifacts complete, a clean delta, and passing gates
- WHEN `metta finalize` runs to completion
- THEN a `UAT.md` is written into `spec/changes/<name>/` after the spec merge and before `artifactStore.archive` runs
- AND the returned `FinalizeResult` carries the generated UAT path

### Scenario: Archive sweep carries UAT.md into the archive directory
- GIVEN a finalize run that generated `UAT.md` in `spec/changes/<name>/`
- WHEN the archive step moves the change directory
- THEN `spec/archive/<date>-<name>/UAT.md` exists next to `intent.md`, `stories.md`, `spec.md`, and `summary.md`

### Scenario: Generation is deterministic with no AI call
- GIVEN a fixed set of change artifacts and a fixed generation date
- WHEN the UAT generator is invoked twice over the same inputs
- THEN both runs produce byte-identical `UAT.md` content
- AND no AI provider client is constructed or called during generation


## Requirement: No Stray UAT On Failed Finalize Paths

A finalize run that exits on any failure or non-writing path — incomplete artifacts, spec-merge conflict, gate failure, or dry-run mode — MUST NOT create a `UAT.md` in the change directory. UAT generation MUST be unreachable before the artifact-completeness check, conflict detection, and gate execution have all passed, and MUST be skipped entirely in dry-run mode, so no failed or simulated finalize ever leaves a stray acceptance script behind.
Fulfills: US-1

### Scenario: Incomplete artifacts abort before UAT generation
- GIVEN an active change with a workflow-required artifact not marked `complete`
- WHEN `metta finalize` runs and fails the artifact-completeness check
- THEN no `UAT.md` exists in `spec/changes/<name>/` after the run

### Scenario: Merge conflict aborts before UAT generation
- GIVEN a change whose delta conflicts with the current capability spec lock
- WHEN `metta finalize` runs and returns a conflict result
- THEN no `UAT.md` exists in `spec/changes/<name>/` after the run

### Scenario: Gate failure aborts before UAT generation
- GIVEN a change with a configured gate that will fail
- WHEN `metta finalize` runs and reports the gate failure
- THEN no `UAT.md` exists in `spec/changes/<name>/` after the run

### Scenario: Dry-run finalize writes no UAT.md
- GIVEN a fully complete change that would finalize cleanly
- WHEN `metta finalize` runs in dry-run mode
- THEN no `UAT.md` is written to `spec/changes/<name>/`
- AND the change remains in the active changes list unchanged


## Requirement: UAT Source Material Assembly

The UAT generator MUST assemble step content from the change's structured artifacts using the existing parsers, consumed read-only: user-story acceptance criteria (Given/When/Then) and Independent Test Criteria MUST be read from `stories.md` via the existing stories parser (`parseStories`), and additional scenario coverage MUST be read from `spec.md` via the existing spec parser (`parseSpec` / `parseDeltaSpec`). The generator MUST consult `summary.md` and `gates.yaml` as the record of machine verification in order to annotate steps whose scenarios are already machine-covered; this cross-referencing is best-effort — when an annotation is not derivable from those sources for a given step, the annotation MUST simply be absent, and its absence MUST NOT fail or degrade generation. The generator MUST NOT modify the behavior of `parseStories`, `parseSpec`, `parseDeltaSpec`, or any source artifact.
Fulfills: US-1, US-2

### Scenario: Stories and spec scenarios feed the generated steps
- GIVEN a change whose `stories.md` parses to kind `stories` with acceptance criteria and Independent Test Criteria, and whose `spec.md` contains scenarios
- WHEN `UAT.md` is generated
- THEN each generated step's what-to-do text derives from Independent Test Criteria (including named CLI invocations where present) and its what-to-observe text derives from the THEN clauses of the corresponding acceptance criteria or spec scenarios

### Scenario: Machine-verified annotation applied when derivable
- GIVEN a step whose scenario is covered by evidence recorded in `gates.yaml` or `summary.md`, cross-referenced by requirement or story id
- WHEN the assembler builds that step
- THEN the step carries a machine-verified annotation referencing the covering evidence

### Scenario: Annotation absent when not derivable, without error
- GIVEN a step whose scenario has no matching coverage derivable from `gates.yaml` or `summary.md` (including when either file is missing)
- WHEN the assembler builds that step
- THEN the step carries no machine-verified annotation
- AND generation completes without error


## Requirement: UAT Document Format

The generated `UAT.md` MUST open with a header recording the change name, the generation date, and failure-reporting instructions directing the reader to log a metta issue for any failed step. The body MUST consist of numbered steps grouped under headings for the user stories they derive from (identified by story id, e.g. `US-1`), so every step is traceable to its originating story. Each step MUST contain: what to do, what the reader should observe (derived from THEN clauses), and a markdown checkbox (`- [ ]`) for recording the result. Steps whose scenarios are machine-verified per the UAT Source Material Assembly requirement MUST additionally carry the machine-verified annotation.
Fulfills: US-1, US-2, US-6

### Scenario: Header is self-describing for later audit
- GIVEN a generated `UAT.md`, read either from the live change directory or months later from `spec/archive/<date>-<name>/`
- WHEN the reader opens the header
- THEN it states the change name, the generation date, and instructions to report failures by logging a metta issue, with no dependency on live change context

### Scenario: Steps are numbered, story-grouped, and checkable
- GIVEN a change with multiple user stories
- WHEN `UAT.md` is generated
- THEN steps appear numbered under per-story group headings identified by US-N
- AND every step contains what-to-do text, what-to-observe text, and a markdown checkbox `- [ ]`


## Requirement: UAT Tier Fallback Chain

When UAT generation is enabled, the generator MUST select its source tier by this fallback chain and MUST NOT skip generation entirely for any tier: (1) when `stories.md` exists and parses to kind `stories`, the full story-grouped script MUST be produced; (2) when `stories.md` is absent or is a sentinel document (does not parse to kind `stories`) and `spec.md` contains scenarios, a reduced script MUST be assembled from the `spec.md` scenarios; (3) when neither parsed stories nor spec scenarios are available, a reduced script MUST be assembled from the `intent.md` Proposal bullets plus `summary.md` highlights. In every enabled case a `UAT.md` MUST exist after a successful finalize.
Fulfills: US-3

### Scenario: Parsed stories produce the full story-grouped script
- GIVEN a change whose `stories.md` parses to kind `stories`
- WHEN finalize generates `UAT.md`
- THEN the full script is produced with steps grouped by user story

### Scenario: Sentinel stories fall back to spec scenarios
- GIVEN a quick-tier change whose `stories.md` is a sentinel document that does not parse to kind `stories`, and whose `spec.md` contains scenarios
- WHEN finalize generates `UAT.md`
- THEN the reduced script is assembled from the `spec.md` scenarios

### Scenario: No stories and no spec scenarios fall back to intent plus summary
- GIVEN a trivial change with no parseable stories and no `spec.md` scenarios
- WHEN finalize generates `UAT.md`
- THEN the reduced script is assembled from the `intent.md` Proposal bullets and `summary.md` highlights

### Scenario: Generation is never skipped by tier when enabled
- GIVEN any change of any tier with UAT generation enabled
- WHEN `metta finalize` completes successfully
- THEN a `UAT.md` exists in the archived change directory


## Requirement: UAT Configuration Toggle

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

## Requirement: UAT Path In Finalize Output

The finalize success output in `src/cli/commands/finalize.ts` MUST surface the generated UAT path in both output modes. In `--json` mode the success payload MUST gain an additive `uatPath` field: a string containing the generated `UAT.md` path when generation succeeded, and `null` when generation was disabled via `uat.enabled: false` or degraded per the UAT Generation Failure Degradation requirement. All pre-existing success-payload fields MUST be unchanged, and the error JSON shapes (`incomplete_artifacts`, `conflict`, `gates_failed`, `finalize_locked`, `finalize_error`) MUST NOT be modified. In human-readable mode, a successful finalize with generation enabled MUST print a line reporting the path where `UAT.md` was written; when generation is disabled no UAT line is printed.
Fulfills: US-5

### Scenario: JSON success payload carries the UAT path
- GIVEN a successful finalize with UAT generation enabled
- WHEN `metta finalize --json` output is rendered
- THEN the success JSON includes `uatPath` set to the generated `UAT.md` path
- AND all previously existing success fields are present and unchanged

### Scenario: Human output reports the UAT path
- GIVEN a successful finalize with UAT generation enabled
- WHEN output is rendered in human-readable mode
- THEN a line reports the path where `UAT.md` was written

### Scenario: Disabled generation yields null path and no human line
- GIVEN a successful finalize with `uat.enabled: false`
- WHEN output is rendered in `--json` mode and in human mode
- THEN the JSON `uatPath` field is `null` and the human output contains no UAT path line

### Scenario: Error JSON shapes are unchanged
- GIVEN finalize runs that fail with incomplete artifacts, a merge conflict, failed gates, a held lock, or a finalize error
- WHEN `--json` output is rendered for each failure
- THEN each error payload matches its pre-existing shape with no `uatPath` field added


## Requirement: UAT Template Externality

The `UAT.md` document MUST be rendered through the existing `TemplateEngine` (`src/templates/template-engine.ts`, single-brace `{key}` substitution) from a new external template file at `src/templates/artifacts/uat.md`, modeled on the existing `verify.md` artifact template. The template content MUST NOT appear as a string literal in TypeScript source. The template MUST be delivered to `dist/templates/artifacts/uat.md` by the existing `copy-templates` build step with no build-script changes, so the generator loads it from the same resolved templates directory as the other artifact templates at runtime.
Fulfills: US-1

### Scenario: Rendering goes through the external template
- GIVEN the UAT generator assembling a document
- WHEN rendering occurs
- THEN the content is produced by `TemplateEngine` substitution over `src/templates/artifacts/uat.md`
- AND no TypeScript source file contains the template body as a string literal

### Scenario: Template ships to dist via the existing copy step
- GIVEN a build of the project
- WHEN the existing `copy-templates` script runs unmodified
- THEN `dist/templates/artifacts/uat.md` exists and matches the source template


## Requirement: UAT Generation Failure Degradation

A failure inside UAT assembly or rendering (for example an unreadable source artifact, a parser error, or a missing template file) MUST NOT abort an otherwise-successful finalize: the spec merge, gate results, and archive MUST complete exactly as they would have without the failure. On such a failure the finalizer MUST degrade by continuing without a `UAT.md`, MUST record the failure in the finalize output — a warning line in human-readable mode and, in `--json` mode, `uatPath: null` accompanied by a warning field or message describing the UAT generation failure — and MUST NOT convert the run's exit status to failure. The UAT generation error MUST NOT surface as any of the existing error JSON shapes.
Fulfills: US-1, US-5

### Scenario: Assembly error degrades to a warning, finalize still succeeds
- GIVEN a change that finalizes cleanly except that UAT assembly throws (for example the template file is missing from the resolved templates directory)
- WHEN `metta finalize` runs
- THEN the spec merge is written, gates results are recorded, the change is archived, and the command exits zero
- AND no `UAT.md` is present in the archive

### Scenario: Degraded run reports the failure in output
- GIVEN a finalize run whose UAT generation failed and degraded
- WHEN output is rendered
- THEN human mode prints a warning that UAT generation failed with the reason
- AND `--json` mode reports `uatPath: null` alongside a warning describing the UAT generation failure, while the payload remains the success shape rather than any error shape


## Requirement: Token Tracking Delta Scope Note

This delta specifies the end-to-end token-usage observability feature (record, report, aggregate) under the `finalize-ship` capability as its single merge target, because the change's center of gravity is the finalize-time `TOKENS.md` report. Because a spec delta targets exactly one capability, the adjacent surfaces this change touches — the `token_usage` record schema (schemas), the `metta tokens record` CLI registration (CLI surface), the guard-hook allowlist entries (orchestration-guard), the lifecycle-skill recording instruction (instruction-contracts), the tokens config toggle (config-loader/schemas), and the `metta progress` aggregate — are specified here under finalize-ship, following the established single-target limitation pattern. Requirements in this delta that name those surfaces MUST be read as binding on those surfaces' implementations even though they merge into the finalize-ship spec. A future reconciliation MAY relocate individual requirements to their home capabilities; until then this spec is the authoritative source for them.

### Scenario: Delta merges into finalize-ship despite spanning adjacent surfaces
- GIVEN this delta's H1 names the existing capability `finalize-ship`
- WHEN `metta finalize` merges the delta
- THEN all requirements in this delta, including those governing schemas, CLI, guard hooks, skills, config, and progress, land in the finalize-ship capability spec
- AND no new capability is created for the adjacent surfaces


## Requirement: Token Usage Record Schema

`ChangeMetadataSchema` in `src/schemas/change-metadata.ts` MUST gain an optional `token_usage` array field. Each entry MUST validate against a strict Zod object schema (`TokenUsageRecordSchema`) with exactly these fields: `task` (non-empty string — the artifact or task id the usage applies to), `agent` (non-empty string — the subagent role spawned), `model` (`ModelAliasEnum` — the alias the subagent ran at, `inherit` when no explicit model was passed), `tokens` (positive integer), `timestamp` (ISO 8601 datetime string), and an optional `source` provenance field constrained to the enum `hook | prose` — `hook` marking a harness-measured count recorded by the SubagentStop recording hook, `prose` marking an orchestrator-reported estimate. A record with `source` absent MUST validate and MUST be treated by consumers as prose-sourced, so all pre-delta historical records remain valid without migration. The schema MUST reject unknown keys, non-integer or non-positive `tokens` values, model values outside `ModelAliasEnum`, and `source` values outside the enum. The field MUST remain additive: existing `.metta.yaml` files without `token_usage` MUST remain valid. `token_usage` stays distinct from the existing `artifact_tokens` record (context-engine context/budget figures); this delta MUST NOT change `artifact_tokens` in any way.
Fulfills: US-2, US-4

### Scenario: Hook-sourced record passes strict validation
- GIVEN a candidate record `{ task: "impl", agent: "executor", model: "haiku", tokens: 41250, timestamp: "2026-08-08T12:00:00.000Z", source: "hook" }`
- WHEN `TokenUsageRecordSchema.parse` is called on it
- THEN parsing succeeds and the record round-trips through `ChangeMetadataSchema` inside a `token_usage` array

### Scenario: Invalid source values are rejected strictly
- GIVEN candidate records with, respectively, `source: "manual"`, `source: 1`, and an extra unknown key alongside a valid `source`
- WHEN each is parsed against `TokenUsageRecordSchema`
- THEN every one fails with a Zod validation error rather than being coerced or silently accepted

### Scenario: Legacy record without source remains valid and reads as prose-sourced
- GIVEN a pre-delta record `{ task: "plan", agent: "planner", model: "inherit", tokens: 9000, timestamp: "2026-08-01T09:00:00.000Z" }`
- WHEN it is parsed with the updated schema and consumed by the report generator
- THEN parsing succeeds with `source` absent
- AND the report generator classifies it as prose-sourced for deduplication and provenance display

## Requirement: Tokens Record CLI Command

The CLI MUST provide a `metta tokens record` subcommand, registered alongside `iteration` and `model-escalation`, using `createCliContext`, accepting required options `--task <artifact-or-task-id>`, `--agent <role>`, `--model <alias>`, `--tokens <n>`, plus optional `--change <name>` and optional `--source <hook|prose>`. When `--source` is omitted the record MUST be persisted as prose-sourced, so every pre-delta invocation shape remains valid and behaves compatibly. Change targeting MUST follow the Worktree-Aware Change Resolution For Token Recording requirement: explicit `--change` wins; otherwise a cwd inside `.metta/worktrees/<change>/` resolves to that change; otherwise auto-select when exactly one active change exists; otherwise fail typed with exit 4 naming the candidates and write nothing. The command MUST construct the record with a current ISO timestamp, validate it via `TokenUsageRecordSchema.parse` before any write, append it to the change's `token_usage` array, and persist via `ctx.artifactStore.updateChange` so the full metadata is re-validated on write. On success with `--json` it MUST emit a JSON payload containing the change name and the recorded fields including the effective source; without `--json` it MUST print a human confirmation line. On any failure it MUST emit a typed error payload (`error: { code: 4, type, message }`) under `--json` or a human error line otherwise, exit via `process.exit(4)`, and MUST NOT leave partial state written.
Fulfills: US-1, US-2, US-3

### Scenario: Source flag persists provenance
- GIVEN an active change resolvable from the cwd
- WHEN `metta tokens record --task impl --agent executor --model haiku --tokens 41250 --source hook` runs
- THEN the appended `token_usage` entry carries `source: hook`
- AND the `--json` success payload includes the source

### Scenario: Legacy invocation without source stays backward compatible
- GIVEN exactly one active change and a repo-root cwd
- WHEN `metta tokens record --task spec-writer-spec.md --agent spec-writer --model haiku --tokens 42000` runs exactly as prose callers invoked it before this delta
- THEN the command succeeds, exits zero, and the appended record validates with no `source` field or an explicit prose source, classified as prose-sourced by the report

### Scenario: Invalid source value writes nothing
- GIVEN an active change
- WHEN `metta tokens record --task impl --agent executor --model haiku --tokens 1000 --source guessed` runs
- THEN validation fails before any write, the command exits 4, and the change's `token_usage` array is unchanged

## Requirement: Tokens Guard Hook Allowlist Entry

The `metta-guard-bash` hook MUST classify `tokens` as an allowed instrumentation subcommand by adding `'tokens'` to `ALLOWED_SUBCOMMANDS`, exactly as `iteration` and `model-escalation` are classified, with an inline comment describing it as append-only usage instrumentation. The entry MUST be added to both copies — `.claude/hooks/metta-guard-bash.mjs` and `src/templates/hooks/metta-guard-bash.mjs` — and after the edit the two files MUST be byte-identical and each MUST pass `node --check`. No other tier classification in the hook may change.
Fulfills: US-1

### Scenario: Skill-issued tokens record passes the guard
- GIVEN the guard hook is active in an AI session
- WHEN an authorized skill flow issues `metta tokens record --task impl --agent executor --model haiku --tokens 1000`
- THEN the hook resolves the subcommand `tokens` from `ALLOWED_SUBCOMMANDS` and returns `allow`

### Scenario: Hook copies stay byte-identical and syntactically valid
- GIVEN the allowlist edit has been applied
- WHEN `.claude/hooks/metta-guard-bash.mjs` and `src/templates/hooks/metta-guard-bash.mjs` are compared and each is run through `node --check`
- THEN the two files are byte-identical and both checks pass

### Scenario: Other guard classifications are unchanged
- GIVEN the edited hook
- WHEN a session-tier command such as `metta finalize` is issued without a valid session credential, or a fork-tier command is issued outside a fork
- THEN the guard's decision for those commands is identical to its decision before this delta


## Requirement: Lifecycle Skill Token Recording Instruction

With hook-driven recording in place, the subagent pass-through sections of the four lifecycle skills that spawn subagents — metta-plan, metta-execute, metta-verify, and metta-next — MUST NOT mandate that the orchestrator run `metta tokens record` after each returning subagent. The mandatory per-subagent recording instruction MUST be removed from all four skills; each skill MAY retain at most a single short fallback note stating that token recording is automatic via the SubagentStop recording hook and that `metta tokens record --source prose` exists as a manual fallback if the hook is unavailable. Every edit MUST land in both the template copy (`src/templates/skills/**`) and the deployed copy (`.claude/skills/**`), and each template/deployed pair MUST remain byte-identical. The skills MUST NOT change model routing, agent selection, or any other behavior — the only diff versus the pre-delta skills is the removal or demotion of the recording instruction. The `tokens` entry in the `metta-guard-bash` `ALLOWED_SUBCOMMANDS` allowlist MUST be retained so the fallback path still passes the guard.
Fulfills: US-6

### Scenario: No skill mandates per-subagent recording
- GIVEN the four lifecycle skills metta-plan, metta-execute, metta-verify, and metta-next
- WHEN each skill file (installed and template copy) is searched for the per-subagent recording mandate
- THEN none instructs the orchestrator to run `metta tokens record` after every returning subagent
- AND any remaining mention of `metta tokens record` is a fallback note describing hook-driven recording as the default

### Scenario: Template and deployed skill pairs are byte-identical
- GIVEN the skill edits are complete
- WHEN each edited file under `src/templates/skills/**` is compared to its counterpart under `.claude/skills/**`
- THEN every pair is byte-identical

### Scenario: Demotion changes nothing about routing or the guard allowlist
- GIVEN the edited skills and the guard hook
- WHEN the skills' model-resolution and agent-spawning wording is diffed against the pre-delta versions and `metta tokens record` is issued through an authorized flow
- THEN the only skill difference is the removed/demoted recording instruction
- AND the guard still resolves `tokens` from `ALLOWED_SUBCOMMANDS` and allows the command

## Requirement: Tokens Report Generation At Finalize

`Finalizer.finalize` MUST assemble a `TOKENS.md` report for the change being finalized, positioned identically to the `UAT.md` step: after the gate-execution step has passed and the real (non-dry-run) spec merge has been written, and immediately before the archive step moves the change directory. The file MUST be written to `spec/changes/<name>/TOKENS.md` so the existing archive move sweeps it into `spec/archive/<date>-<name>/`. Assembly MUST be deterministic: rendered from a new external template file (delivered to `dist/` by the existing copy-templates step, never inlined as a TypeScript string literal), reading only the change's persisted `token_usage` and `artifact_timings` data, with no AI provider invocation; two runs over identical inputs (holding the generation date fixed) MUST produce byte-identical output. A change with no `token_usage` entries MUST still produce a report (with empty rollups and a fully-populated GAPS section) rather than skipping generation while enabled.
Fulfills: US-3

### Scenario: Successful finalize writes TOKENS.md before archive
- GIVEN a change with recorded `token_usage` entries, all artifacts complete, a clean delta, and passing gates
- WHEN `metta finalize` runs to completion
- THEN `TOKENS.md` is written into `spec/changes/<name>/` after the spec merge and before `artifactStore.archive` runs
- AND the archived directory `spec/archive/<date>-<name>/` contains `TOKENS.md` alongside `UAT.md` and the other artifacts

### Scenario: Assembly is deterministic, template-driven, and AI-free
- GIVEN a fixed set of `token_usage` and `artifact_timings` inputs and a fixed generation date
- WHEN the tokens assembler runs twice
- THEN both runs produce byte-identical `TOKENS.md` content rendered from the external template file
- AND no AI provider is called and no TypeScript source contains the template body as a string literal

### Scenario: No token records still yields a report
- GIVEN a change with subagent run evidence but an empty or absent `token_usage` array, and tokens reporting enabled
- WHEN finalize completes
- THEN a `TOKENS.md` exists with zero-entry rollups and every expected-run artifact listed in the GAPS section


## Requirement: Tokens Report Content

The generated `TOKENS.md` MUST contain, in order: (1) a header stating the change name, the generation date, and that hook-sourced figures are harness-measured while prose-sourced figures are approximate orchestrator-reported estimates; (2) a total token count across all deduplicated `token_usage` entries; (3) a per-artifact table with columns for artifact/task, agent role, model, tokens, and provenance, so hook-sourced (exact) and prose-sourced (estimated) records are distinguishable per row; (4) a per-role rollup summing deduplicated tokens by `agent`; (5) a per-model rollup summing deduplicated tokens by `model` alias; (6) a cheap/pinned (non-inherit) vs inherit split over the deduplicated records; and (7) a GAPS section that is a hook-health indicator: it MUST list every artifact with run evidence — an entry in the change's `artifact_timings` keys — but no matching `token_usage` record for that task, and its wording MUST describe each gap as a run the recording hook missed (hook coverage miss), not as orchestrator non-compliance. When every expected-run artifact has a matching record the GAPS section MUST state explicitly that no gaps were found. Apart from the provenance column, the header wording, the GAPS wording, and dedupe-aware totals, the report's section structure MUST be unchanged from the pre-delta format.
Fulfills: US-2, US-4, US-6

### Scenario: Provenance is distinguishable per record
- GIVEN a change with one `source: hook` record and one legacy record without `source`
- WHEN `TOKENS.md` is generated
- THEN the per-artifact table marks the first row as hook-sourced/exact and the second as prose-sourced/estimated
- AND the header explains the exact-versus-estimate distinction

### Scenario: A gap reads as a hook coverage miss
- GIVEN `artifact_timings` contains keys `plan` and `implementation` but `token_usage` only contains a record with `task: "plan"`
- WHEN the report is assembled
- THEN the GAPS section lists `implementation` with wording that attributes the missing record to the recording hook missing the run
- AND the GAPS wording contains no attribution to orchestrator or model non-compliance

### Scenario: Report structure is otherwise unchanged
- GIVEN a change with complete, duplicate-free token records
- WHEN the pre-delta and post-delta reports for it are compared section by section
- THEN both contain the same seven sections in the same order, with differences confined to the provenance column, header wording, GAPS wording, and dedupe-aware totals

### Scenario: Complete coverage reports no gaps
- GIVEN every `artifact_timings` key has at least one matching `token_usage` record
- WHEN the report is assembled
- THEN the GAPS section states that no gaps were found rather than being omitted

## Requirement: Tokens Report Configuration Toggle

The project config MUST gain a `tokens` section validated by a strict Zod `TokensConfigSchema`, added in `src/schemas/project-config.ts` as a sibling of `UatConfigSchema` and mirroring its shape: a single field `enabled` of type boolean defaulting to `true`, with unknown keys within the block and non-boolean `enabled` values rejected with a validation error. `ConfigLoader` MUST supply the parsed `tokens` config to the finalizer the same way `config.uat` is supplied. When `tokens.enabled` is `false`, finalize MUST skip tokens-report generation entirely — no `TOKENS.md` is written and no tokens path is reported — while all other finalize behavior, including UAT generation, proceeds unchanged. Existing `.metta/config.yaml` files that omit the `tokens` key MUST remain valid with generation defaulting to enabled.
Fulfills: US-3

### Scenario: Disabled toggle skips the report cleanly
- GIVEN `.metta/config.yaml` sets `tokens.enabled: false`
- WHEN `metta finalize` runs to completion on a complete change with recorded `token_usage`
- THEN finalize succeeds, no `TOKENS.md` is written to the change directory or archive, and UAT generation and all other finalize behavior are unchanged

### Scenario: Omitted tokens key defaults to enabled
- GIVEN `.metta/config.yaml` with no `tokens` section
- WHEN config is loaded and `metta finalize` runs to completion
- THEN config validation passes and a `TOKENS.md` is generated

### Scenario: Invalid tokens config is rejected strictly
- GIVEN a `tokens` config block containing an unknown key or a non-boolean `enabled` value
- WHEN config is loaded
- THEN `TokensConfigSchema` rejects it with a Zod validation error rather than coercing or ignoring the value


## Requirement: No Stray Tokens Report On Failed Finalize Paths

A finalize run that exits on any failure or non-writing path — incomplete artifacts, spec-merge conflict, gate failure, or dry-run mode — MUST NOT create a `TOKENS.md` in the change directory. Tokens-report generation MUST be unreachable before the artifact-completeness check, conflict detection, and gate execution have all passed, and MUST be skipped entirely in dry-run mode, matching the No Stray UAT On Failed Finalize Paths requirement exactly.
Fulfills: US-3

### Scenario: Gate failure leaves no TOKENS.md behind
- GIVEN a change with recorded `token_usage` and a configured gate that will fail
- WHEN `metta finalize` runs and reports the gate failure
- THEN no `TOKENS.md` exists in `spec/changes/<name>/` after the run

### Scenario: Dry-run finalize writes no TOKENS.md
- GIVEN a fully complete change with `token_usage` data that would finalize cleanly
- WHEN `metta finalize` runs in dry-run mode
- THEN no `TOKENS.md` is written and the change remains in the active changes list unchanged

### Scenario: Incomplete artifacts and merge conflicts abort before report generation
- GIVEN, in turn, a change with a workflow-required artifact not `complete`, and a change whose delta conflicts with the current capability spec lock
- WHEN `metta finalize` runs against each
- THEN each run exits on its failure path and no `TOKENS.md` exists in either change directory afterward


## Requirement: Tokens Report Failure Degradation

A failure inside tokens-report assembly or rendering (for example unreadable metadata, a rollup computation error, or a missing template file) MUST NOT abort an otherwise-successful finalize: the spec merge, gate results, UAT generation, and archive MUST complete exactly as they would have without the failure. On such a failure the finalizer MUST degrade by continuing without a `TOKENS.md`, MUST record the failure as a warning — a warning line in human-readable mode and, in `--json` mode, `tokensPath: null` accompanied by a warning field describing the tokens-report failure — and MUST NOT convert the run's exit status to failure or surface the error as any of the existing error JSON shapes.
Fulfills: US-3

### Scenario: Assembly error degrades to a warning, finalize still succeeds
- GIVEN a change that finalizes cleanly except that tokens-report assembly throws (for example the tokens template file is missing from the resolved templates directory)
- WHEN `metta finalize` runs
- THEN the spec merge is written, `UAT.md` is generated, the change is archived, and the command exits zero
- AND no `TOKENS.md` is present in the archive

### Scenario: Degraded run reports the failure in both output modes
- GIVEN a finalize run whose tokens-report generation failed and degraded
- WHEN output is rendered
- THEN human mode prints a warning that the tokens report failed with the reason
- AND `--json` mode reports `tokensPath: null` alongside a warning describing the failure, while the payload remains the success shape


## Requirement: Tokens Path In Finalize Output

The finalize success output MUST surface the generated tokens-report path in both output modes, additively and exactly parallel to `uatPath`. In `--json` mode the success payload MUST gain an additive `tokensPath` field: the generated `TOKENS.md` path when generation succeeded, and `null` when generation was disabled via `tokens.enabled: false` or degraded per the Tokens Report Failure Degradation requirement. All pre-existing success-payload fields, including `uatPath`, MUST be unchanged, and the error JSON shapes (`incomplete_artifacts`, `conflict`, `gates_failed`, `finalize_locked`, `finalize_error`) MUST NOT be modified. In human-readable mode, a successful finalize with generation enabled MUST print a line reporting the path where `TOKENS.md` was written; when generation is disabled no tokens line is printed. `FinalizeResult` MUST gain the corresponding additive field carrying the path.
Fulfills: US-3

### Scenario: JSON success payload carries the tokens path additively
- GIVEN a successful finalize with tokens reporting enabled
- WHEN `metta finalize --json` output is rendered
- THEN the success JSON includes `tokensPath` set to the generated `TOKENS.md` path
- AND `uatPath` and all previously existing success fields are present and unchanged

### Scenario: Human output reports the tokens path
- GIVEN a successful finalize with tokens reporting enabled
- WHEN output is rendered in human-readable mode
- THEN a line reports the path where `TOKENS.md` was written

### Scenario: Disabled generation yields null path, no human line, and untouched error shapes
- GIVEN a successful finalize with `tokens.enabled: false`, and separately a finalize that fails with gates_failed
- WHEN `--json` and human output are rendered for each
- THEN the success JSON `tokensPath` is `null` with no tokens line in human output
- AND the `gates_failed` error payload matches its pre-existing shape with no `tokensPath` field added


## Requirement: Progress Average Tokens Per Change By Tier

`metta progress` MUST report average tokens per change grouped by workflow tier, computed by summing each change's `token_usage` entries to a per-change total and averaging those totals within each tier, across both active changes and archived changes. Changes with no `token_usage` field (including archives recorded before this feature) MUST be excluded from the average — not counted as zero — and processed without error or retrofitting. Following the existing ceremony-metric conventions: a tier with no contributing data MUST be presented as explicit no-data in human output (never rendered as `0`), and in `--json` mode the metric for such a tier MUST be `null`, passed through verbatim and never coerced to `0`. All pre-existing progress metrics MUST be unchanged.
Fulfills: US-4

### Scenario: Tier-grouped averages render from recorded data
- GIVEN two quick-tier changes with per-change token totals of 10000 and 30000, and one standard-tier change with 50000, spread across active and archived changes
- WHEN `metta progress` runs
- THEN the dashboard shows average tokens per change of 20000 for the quick tier and 50000 for the standard tier

### Scenario: No-data tier is distinct from zero and null in JSON
- GIVEN no change of the full tier has any `token_usage` data
- WHEN `metta progress` runs in human mode and in `--json` mode
- THEN human output presents the full tier as explicit no-data rather than `0`
- AND the `--json` payload carries `null` for that tier, not `0`

### Scenario: Pre-feature archives aggregate gracefully
- GIVEN archived changes whose metadata predates this feature and has no `token_usage` field
- WHEN the aggregate is computed
- THEN those changes are skipped without error, are not counted as zero-token changes, and are not modified


## Requirement: Token Recording SubagentStop Hook

A new standalone hook at `.claude/hooks/metta-tokens-record.mjs`, with a template source at `src/templates/hooks/metta-tokens-record.mjs` (delivered by the existing template copy step, never inlined as a TypeScript string literal), MUST be registered in `.claude/settings.json` under the `SubagentStop` event. `SubagentStop` registrations take no tool matcher, so scoping MUST be performed inside the hook by filtering on the payload's `agent_type` field. On each firing the hook MUST read the hook payload JSON from stdin, locate the subagent's transcript via the payload's `agent_transcript_path` field, and sum the token components of the assistant records' `message.usage` entries (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) in that transcript to an exact total — the totals definition (which components count toward the recorded total) is delegated to design, but the recorded count MUST derive solely from harness-written transcript usage values and the hook MUST NOT estimate, derive from prose, or fabricate a count. The hook MUST then invoke `metta tokens record` as a child process with `--tokens` set to that exact total, `--agent` derived from the payload's `agent_type`, `--model` derived from the transcript's `message.model` mapped to a model alias (`inherit` when the model is unmapped or absent), `--task` derived from transcript attribution/context (e.g. `attributionSkill`/`attributionAgent` fields) toward the artifact-or-task-id vocabulary, and `--source hook`. When the transcript is missing, unreadable, or contains no usage records, the hook MUST NOT invoke `metta tokens record` at all. The installed copy and the template copy MUST be byte-identical and each MUST pass `node --check`. Existing `PreToolUse` registrations for `metta-guard-edit.mjs` and `metta-guard-bash.mjs` in `.claude/settings.json` MUST be unchanged by the new registration.
Fulfills: US-1, US-2

### Scenario: Subagent stop is recorded automatically with the exact transcript-summed count
- GIVEN the hook is registered and an active change exists, and a SubagentStop payload for a `metta-executor` subagent whose `agent_transcript_path` points at a transcript whose assistant records' `message.usage` components sum to exactly 42000 tokens under the designed totals definition
- WHEN the hook is executed with that payload on stdin
- THEN it invokes `metta tokens record` with `--tokens 42000`, `--source hook`, `--agent` derived from `agent_type`, `--model` derived from the transcript's `message.model`, and `--task` derived from transcript attribution/context, with no orchestrator action involved
- AND the change's `.metta.yaml` gains one validated `token_usage` entry whose `tokens` value is exactly 42000

### Scenario: Missing or usage-free transcript records nothing rather than fabricating a count
- GIVEN a SubagentStop payload whose `agent_transcript_path` names a file that is missing, unreadable, or contains no assistant records with `message.usage`
- WHEN the hook is executed with that payload on stdin
- THEN it exits 0 without invoking `metta tokens record`
- AND no `token_usage` entry is written anywhere

### Scenario: Registration targets the SubagentStop event and leaves existing hooks untouched
- GIVEN the updated `.claude/settings.json`
- WHEN its `hooks` block is inspected
- THEN `SubagentStop` contains an entry (with no tool matcher) wired to `.claude/hooks/metta-tokens-record.mjs`, and the hook itself performs any agent scoping by filtering on the payload's `agent_type`
- AND the pre-existing `PreToolUse` entries for `metta-guard-edit.mjs` and `metta-guard-bash.mjs` are byte-for-byte unchanged

### Scenario: Hook copies stay byte-identical and syntactically valid
- GIVEN the hook has been added
- WHEN `.claude/hooks/metta-tokens-record.mjs` and `src/templates/hooks/metta-tokens-record.mjs` are compared and each is run through `node --check`
- THEN the two files are byte-identical and both checks pass


## Requirement: Worktree-Aware Change Resolution For Token Recording

The token-recording path MUST resolve the target change from the invocation cwd before falling back to active-change counting. When the cwd is at or below `.metta/worktrees/<change>/` (relative to the repository root), the recording MUST be attributed to `<change>`, taking precedence over the how-many-active-changes rule — a worktree cwd resolves unambiguously even when multiple changes are active. When the cwd is not inside a worktree, resolution MUST behave as before: an explicit `--change` wins, otherwise auto-select when exactly one active change exists. When no change can be resolved (cwd not in a worktree, no `--change`, and zero or multiple active changes), the recording MUST fail with the existing typed error and MUST NOT write a record to any change — records are never misattributed as a fallback. This resolution MUST apply both when the SubagentStop recording hook invokes `metta tokens record` (the hook runs with, or passes through, the session cwd) and when the command is invoked directly.
Fulfills: US-3

### Scenario: Recording from inside a change worktree attributes to that change
- GIVEN active changes `alpha` and `beta`, with a worktree at `.metta/worktrees/beta/`
- WHEN `metta tokens record --task impl --agent executor --model haiku --tokens 1000 --source hook` runs with cwd `.metta/worktrees/beta/`
- THEN the record is appended to `beta`'s `token_usage`
- AND `alpha`'s metadata is unchanged

### Scenario: Repo-root recording keeps the existing single-active-change behavior
- GIVEN exactly one active change and a cwd at the repository root
- WHEN `metta tokens record --task impl --agent executor --model haiku --tokens 1000` runs without `--change`
- THEN the record is appended to that single active change, exactly as before this delta

### Scenario: Unresolvable change fails safely without misattribution
- GIVEN two active changes, a cwd at the repository root, and no `--change` option
- WHEN `metta tokens record --json` runs with otherwise valid options
- THEN the output is `error: { code: 4, ... }` naming the candidate changes, the process exits 4, and no change's `token_usage` array is modified


## Requirement: Non-Blocking Token Recording Hook Failure

The `metta-tokens-record.mjs` hook MUST be non-blocking: it MUST exit 0 and MUST NOT emit a blocking decision (`decision: "block"`) in its output regardless of internal failure — on the `SubagentStop` event a blocking decision would force the subagent to continue, so the hook MUST never emit one. Swallowed failure modes include an unparseable payload, a missing, unreadable, or usage-free subagent transcript at `agent_transcript_path`, a missing or unbuilt `metta` CLI, a non-zero `metta tokens record` exit (such as unresolvable change), and a filesystem error. A recording failure MUST never fail, retry, or alter the outcome of the subagent run it observed. Failure detail MAY be written to stderr for diagnostics, but the hook MUST NOT write error state into `.metta/` or any change metadata. The hook MUST NOT change the behavior of any other registered hook: guard and mint hook decisions on their events remain identical with the recording hook installed.
Fulfills: US-5

### Scenario: CLI unavailable leaves the subagent run unaffected
- GIVEN a valid SubagentStop payload with a readable transcript and an environment where the `metta` CLI is not on PATH
- WHEN the hook is executed with that payload on stdin
- THEN it exits 0 with no blocking decision in its output
- AND no change metadata is modified

### Scenario: Recording command failure is swallowed
- GIVEN a valid SubagentStop payload and a cwd from which no change can be resolved
- WHEN the hook runs and its `metta tokens record` child process exits non-zero
- THEN the hook still exits 0 with no blocking decision, optionally noting the failure on stderr only

### Scenario: Missing transcript is swallowed without blocking the subagent
- GIVEN a SubagentStop payload whose `agent_transcript_path` does not exist or cannot be read
- WHEN the hook is executed with that payload on stdin
- THEN it exits 0 with no blocking decision in its output, so the subagent stop proceeds normally
- AND no change metadata is modified

### Scenario: Guard hook behavior is unchanged with the recording hook installed
- GIVEN the recording hook is registered alongside the existing guard hooks
- WHEN `metta-guard-bash.mjs` and `metta-guard-edit.mjs` are exercised on their PreToolUse events with inputs from their existing test suites
- THEN every guard decision is identical to its decision before this delta


## Requirement: Token Record Provenance Deduplication In Tokens Report

The tokens report generator (`src/finalize/tokens-report-generator.ts`) MUST deduplicate `token_usage` records before computing the total, the per-artifact table, and the per-role, per-model, and inherit-split rollups. Two records are duplicates of the same run when they share the same `task` and `agent` and differ in provenance (`source: hook` versus prose-sourced, where a record with no `source` field counts as prose-sourced). For each such duplicate set the report MUST count the run exactly once, using the hook-sourced record's exact token value and excluding the prose-sourced duplicates from every total and rollup. Records with no hook-sourced counterpart — prose-only records, including all pre-delta historical records — MUST be retained and counted as before, never discarded. Deduplication is a report-time concern only: the persisted `token_usage` array MUST NOT be rewritten or pruned.
Fulfills: US-4

### Scenario: Duplicate hook and prose records count once, preferring the hook value
- GIVEN a change whose `token_usage` contains `{ task: "impl", agent: "executor", tokens: 41250, source: "hook", ... }` and `{ task: "impl", agent: "executor", tokens: 40000, ... }` with no `source` field
- WHEN `TOKENS.md` is generated
- THEN the `impl`/`executor` run appears once with 41250 tokens
- AND the report total and every rollup include 41250 and exclude the 40000 estimate

### Scenario: Prose-only records are retained
- GIVEN a change whose `token_usage` contains a single record for `task: "plan"` with no `source` field and no hook-sourced record for that task and agent
- WHEN `TOKENS.md` is generated
- THEN the `plan` record appears in the per-artifact table and is included in all totals

### Scenario: Dedupe never mutates persisted state
- GIVEN a change with duplicate hook- and prose-sourced records
- WHEN finalize generates `TOKENS.md`
- THEN the change's persisted `token_usage` array still contains every original record, byte-for-byte unchanged


## Requirement: Dry-Run And Apply Merge Result Parity

For identical inputs — the same change delta spec, the same `baseVersions` map, and the same spec-store state on disk — `SpecMerger.merge` in dry-run mode MUST return the same `status` and the same `merged`, `conflicts`, and `noops` classifications as an applying merge. No conflict class MAY be reachable only in applying mode: every check that can produce a `MergeConflict` during apply MUST also run during dry-run. This guarantee exists so the finalizer's preflight dry-run gate structurally catches every conflict the later applying merge would catch; an applying-merge conflict after a clean dry-run within the same finalize can only indicate spec-store drift between the two calls, not a known dry-run blind spot. Traces to the intent problem statement: dry-run previously validated only capability existence and base-version hashes, so MODIFIED/RENAMED/REMOVED deltas against absent requirements passed dry-run as clean and then conflicted at apply time.

### Scenario: Dry-run and apply return identical results for the same fixture set
- GIVEN a change delta spec containing a mix of ADDED, MODIFIED, RENAMED, and REMOVED deltas, including at least one that conflicts and at least one ADDED duplicate
- WHEN `merge` is called with `dryRun: true`, and then `merge` is called with `dryRun: false` against an identical pre-merge spec-store state
- THEN both calls return the same `status`
- AND the `merged`, `conflicts`, and `noops` arrays of both results contain the same entries

### Scenario: Preflight dry-run catches an apply-time-only conflict class
- GIVEN a change whose delta spec contains a REMOVED operation targeting a requirement absent from the capability spec
- WHEN the finalizer runs its conflict-detection step using a dry-run merge
- THEN the finalize aborts at the conflict-detection step with that conflict reported
- AND the applying merge step is never reached


## Requirement: All-Or-Nothing Spec Merge Apply

An applying `SpecMerger.merge` MUST be all-or-nothing at the delta-reconciliation level: it MUST first reconcile every delta against in-memory content (the compute phase) and MUST perform disk writes (the commit phase) only when the compute phase produced zero conflicts. If any delta in the run produces a `MergeConflict`, the merger MUST return `status: "conflict"` having written zero capability spec files and zero spec-lock entries — the spec store MUST be byte-identical to its pre-merge state, regardless of how many earlier deltas in the run reconciled cleanly. Traces to the intent problem statement: the per-delta write loop previously committed deltas 1..N−1 before delta N's conflict was detected, leaving the living spec store half-merged with no rollback.

### Scenario: Conflicting delta N leaves the spec store byte-identical
- GIVEN a change delta spec where the first two deltas reconcile cleanly and the third produces a "requirement not found" conflict
- WHEN `merge` is called with `dryRun: false`
- THEN `result.status` equals "conflict"
- AND every file under `spec/specs/` and every spec-lock entry is byte-identical to its pre-merge state
- AND the two clean deltas were not written

### Scenario: Zero-conflict multi-delta merge commits every staged result
- GIVEN a change delta spec with multiple deltas across one or more capabilities, none of which conflict
- WHEN `merge` is called with `dryRun: false`
- THEN `result.status` equals "clean"
- AND each affected capability spec file on disk contains the merged content for all of its deltas
- AND each affected capability's spec lock is updated to match the written content


## Requirement: Staged Composition Of Same-Capability Deltas

When multiple deltas in a single merge target the same capability, the compute phase MUST thread staged content forward: each subsequent delta MUST reconcile against the in-memory content produced by the prior deltas in the same run, not against the stale on-disk file, and the committed file (in applying mode) MUST reflect the composition of all of that capability's deltas applied in order. Staged composition MUST hold identically for dry-run classification, so a later delta that depends on an earlier delta in the same change (for example, MODIFIED of a requirement the same change ADDED) is classified as clean in both modes. Traces to the intent proposal: capability content is loaded once per capability and staged results carry final merged file content plus a pending lock update.

### Scenario: A later delta composes with an earlier delta against the same capability
- GIVEN a change delta spec that first ADDs requirement "Rate Limiting" to capability "auth" and then MODIFIEDs "Rate Limiting" in a subsequent delta
- WHEN `merge` is called with `dryRun: false`
- THEN `result.status` equals "clean"
- AND the "auth" spec file contains exactly one "## Requirement: Rate Limiting" section carrying the MODIFIED text
- AND no "requirement not found" conflict is reported for the MODIFIED delta

### Scenario: Dry-run classifies composed same-capability deltas identically
- GIVEN the same ADDED-then-MODIFIED delta pair targeting one capability
- WHEN `merge` is called with `dryRun: true`
- THEN `result.status` equals "clean"
- AND both deltas appear under `merged`, matching the applying-mode classification


## Requirement: UAT Gate Before PR Hand-Back

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


## Requirement: Inline UAT Orchestration Contract In Ship Skills

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


## Requirement: UAT Run Summary In PR Body Or Comment

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


## Requirement: UAT Failure Blocks Ready Hand-Back

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


## Requirement: UAT Gate Before Merge On Run-To-Merge Paths

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


## Requirement: Ship Skill Toggle Readability Without Guard Violation

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


## Requirement: Grep-Assert Coverage Of Ship-Path UAT Gate

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


## Requirement: Idempotent UAT Recording Across Propose Stop And Ship

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
