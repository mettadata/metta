# fix-gate-runner-process-group-kill-timeout-scope-gates

## ADDED: Requirement: gate-runner-kills-process-group-on-timeout

**Fulfills:** US-1

When a gate command times out, the gate runner MUST send SIGTERM to the full child process group (PGID), not just the direct child. After a grace period of no more than 1 second, SIGKILL MUST be sent to the same PGID. After the kill sequence completes, no descendant processes from that gate's invocation MUST remain running. The runner MUST use `spawn({ detached: true, shell: true })` so the gate command runs as its own process group leader.

### Scenario: timeout reaps grandchild processes
- GIVEN a gate command that spawns a grandchild sleeping process (parent → child → grandchild)
- WHEN the gate timeout fires
- THEN SIGTERM is sent to the full PGID, followed by SIGKILL after the grace period
- AND `ps` shows no surviving descendants of the original PGID one second after the runner returns

### Scenario: clean completion does not fire PGID kill
- GIVEN a gate command that exits within the timeout
- WHEN the gate runner returns a `pass` result
- THEN no SIGTERM or SIGKILL is sent to any process group
- AND the command's stdout/stderr output is captured and returned in `GateResult.output`

## ADDED: Requirement: gate-runner-accepts-plain-string-command

**Fulfills:** US-1

The gate `command` field MUST continue to accept a plain string executed via a shell, so commands such as `npm test` and `tsc && npm run copy-templates` work without modification. The replacement of `execAsync` with `spawn({ detached: true, shell: true })` MUST preserve existing command syntax. No gate YAML file requires edits as a result of this change.

### Scenario: existing gate YAML files run unchanged
- GIVEN the gate YAML files `tests.yaml`, `lint.yaml`, `typecheck.yaml`, `build.yaml`, and `stories-valid.yaml` are loaded without modification
- WHEN each gate is executed by the updated runner
- THEN every gate that previously passed continues to pass
- AND no gate command requires syntax changes

## ADDED: Requirement: retry-once-kills-prior-pgid-before-retry

**Fulfills:** US-4

When a gate's `on_failure: retry_once` policy fires after a timeout, the runner MUST ensure the first run's PGID has been fully reaped before spawning the retry. No process from the first invocation MAY be running at the moment the retry is spawned.

### Scenario: retry-once produces no lingering processes from either run
- GIVEN a gate with `on_failure: retry_once` whose first and second runs both time out
- WHEN the runner returns the final `fail` result
- THEN `ps` shows no surviving descendants of the first run's PGID
- AND `ps` shows no surviving descendants of the second run's PGID

## ADDED: Requirement: finalizer-runs-only-workflow-declared-gates

**Fulfills:** US-2

The finalizer MUST derive the list of gates to run from the active workflow's artifact `gates:` declarations (union and deduplicate across all artifacts in the workflow), NOT from `gateRegistry.list()`. Gates registered in the registry but not declared in any artifact of the active workflow MUST NOT be run during finalize.

### Scenario: quick workflow finalize skips stories-valid
- GIVEN a quick-workflow change with no `stories.md` artifact
- WHEN `metta finalize` runs
- THEN the gate runner is not invoked for `stories-valid`
- AND gates `tests`, `lint`, and `typecheck` are invoked (declared on the `implementation` artifact)

### Scenario: standard workflow finalize includes stories-valid
- GIVEN a standard-workflow change
- WHEN `metta finalize` runs
- THEN the gate runner is invoked for `stories-valid` (declared on the `spec` artifact in `standard.yaml`)
- AND gates `tests`, `lint`, and `typecheck` are also invoked

## ADDED: Requirement: quick-and-auto-archive-change-directory

**Fulfills:** US-3

After `/metta-quick` or `/metta-auto` complete their workflow and the gate suite passes, `metta finalize`'s archive step MUST move `spec/changes/<name>/` to `spec/archive/YYYY-MM-DD-<name>/`, identically to `/metta-propose` behavior. The archive step already exists; fixing the workflow-scoped gate selection unblocks it.

### Scenario: finalize removes the changes directory
- GIVEN a quick-workflow change whose gate suite passes
- WHEN `metta finalize` completes successfully
- THEN `spec/changes/<name>/` does not exist in the working tree

### Scenario: finalize populates the archive directory
- GIVEN a quick-workflow change whose gate suite passes
- WHEN `metta finalize` completes successfully
- THEN `spec/archive/<YYYY-MM-DD>-<name>/` exists
- AND that directory contains `intent.md`, `summary.md`, and `verification.md`
