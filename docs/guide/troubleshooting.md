# Troubleshooting & FAQ

You hit a wall mid-workflow. This page is a fast lookup of **Symptom → Cause → Fix** for the problems metta surfaces most often, plus a short FAQ.

> **When in doubt: run `metta doctor`.** It checks your Node version, the `.metta/` and `spec/` directories, the constitution, git, and state-file integrity, then tells you exactly what is wrong. Add `--fix` to repair a broken `.metta/config.yaml` in place.

---

## Guard hooks blocked an action

### "Blocked direct CLI call ... from AI orchestrator session"

**Symptom.** Your AI tool tries to run a metta command and the run is rejected (exit code 2) with something like:

```
metta-guard-bash: Blocked direct CLI call 'metta propose' from AI orchestrator session.
Use the matching /metta-<skill> skill via the Skill tool; see CLAUDE.md for the mapping.
If this is a skill-internal CLI call, prefix with METTA_SKILL=1.
Emergency bypass: disable this hook in .claude/settings.local.json.
```

For skill-enforced subcommands (`issue`, `fix-issue`, `propose`, `quick`, `auto`, `ship`) the message is stricter and names the skill:

```
metta-guard-bash: Blocked skill-enforced subcommand 'metta ship' from AI orchestrator session.
Use the matching skill via the Skill tool: /metta-ship
Inline METTA_SKILL=1 prefix no longer bypasses skill-enforced subcommands — use the Skill tool.
```

**Cause.** The `metta-guard-bash` PreToolUse hook blocks state-mutating CLI calls (`propose`, `quick`, `auto`, `complete`, `finalize`, `ship`, `issue`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init`, plus `backlog add/done/promote` and `changes abandon`) when they are fired directly from an AI orchestrator session rather than through a metta skill. The skills wrap each command with the correct subagent persona; calling the CLI directly bypasses those guarantees.

**Fix.** Invoke the matching skill instead of the raw command:

| Command you tried | Use this skill |
|-------------------|----------------|
| `metta propose` | `/metta-propose` |
| `metta quick` | `/metta-quick` |
| `metta auto` | `/metta-auto` |
| `metta issue` | `/metta-issue` |
| `metta fix-issue` | `/metta-fix-issues` |
| `metta ship` / `metta finalize` | `/metta-ship` |

Read-only commands (`metta status`, `metta progress`, `metta doctor`, `metta instructions`, and `... list` forms) are always allowed and need no skill.

> Running metta yourself in a terminal as a human? The guard does not apply to you — it only scopes to AI-driven sessions. The emergency bypass (disabling the hook in `.claude/settings.local.json`) exists for edge cases; prefer the skill.

### "Blocked unknown metta subcommand"

**Symptom.** `metta-guard-bash: Blocked unknown metta subcommand '<x>' ...`

**Cause.** The subcommand is neither on the allow-list nor the block-list, so the guard fails closed.

**Fix.** If it is a legitimate read-only command, it belongs on the allowlist in `.claude/hooks/metta-guard-bash.mjs`. If it is a skill-internal call, prefix it with `METTA_SKILL=1`. Otherwise, switch to the matching skill.

### "Edit blocked — no active metta change"

**Symptom.** An `Edit`/`Write`/`MultiEdit`/`NotebookEdit` is rejected (exit code 2) with:

```
metta-guard: Edit blocked — no active metta change.
Start one with /metta:quick <description> or metta quick <description>.
Then retry the edit.
Emergency bypass: disable this hook in .claude/settings.local.json.
```

**Cause.** The `metta-guard-edit` hook calls `metta status --json`, sees no active change, and blocks file edits so work always happens inside a tracked change.

**Fix.** Start a change first, then retry the edit:

- Small/scoped fix → `/metta-quick <description>`
- Anything non-trivial → `/metta-propose <description>`

**Exceptions that are allowed without an active change:** edits to `spec/project.md` and `.metta/config.yaml` (so `/metta-init` can bootstrap), and `.md` files under `spec/issues/` (so you can enrich issue bodies the CLI created). If your path is none of these and you genuinely need an out-of-band edit, the emergency bypass is the hook toggle in `.claude/settings.local.json`.

---

## Config problems

### Config parse or schema-validation error

**Symptom.** A command fails with a message like `Schema validation failed for config.yaml: ...`, or `metta doctor` reports `state.yaml failed schema validation`, or the config simply won't load.

**Cause.** `.metta/config.yaml` has duplicate keys, an unrecognized top-level key, or a value with the wrong type/enum. Every state and config read is validated against a Zod schema, so a bad file stops the command rather than silently using garbage.

**Fix.** Run the repair:

```
metta doctor --fix
```

This removes duplicate keys (keeping the last occurrence), drops schema-invalid keys, writes the cleaned file, and auto-commits it (`chore: metta doctor repaired .metta/config.yaml`). It lists exactly what it removed, e.g. `removed duplicate key 'tier' (kept last occurrence)` or `dropped unrecognized key 'foo'`. If the YAML is too malformed to parse, `doctor --fix` leaves it untouched and reports nothing changed — open the file and fix the syntax by hand. Run plain `metta doctor` first if you just want the diagnosis without writing anything.

### "Warning: METTA_* environment variable(s) caused config validation errors (ignored)"

**Symptom.** Commands print a warning naming one or more `METTA_*` environment variables.

**Cause.** A `METTA_*` env override (e.g. `METTA_PROVIDERS__ANTHROPIC__API_KEY_ENV`) didn't match the config schema, so metta ignored it and kept going.

**Fix.** This is benign noise — the command still ran with the on-disk config. If you intended that override to take effect, fix the variable's name or value; otherwise unset it to silence the warning.

### "Rejected: ... (config restored)" from `metta config set`

**Symptom.** `metta config set <key> <value>` exits non-zero with `Rejected: <validation message> (config restored)`.

**Cause.** `config set` writes the value, then reloads the file through the schema. The new value failed validation, so metta restored the original file byte-for-byte — nothing was changed on disk.

**Fix.** Read the validation message to see which constraint you violated (wrong type, bad enum, etc.) and re-run with a valid value. Booleans coerce from `true`/`false`, integers from clean digit strings; everything else stays a string. If you see `No .metta/config.yaml found — run metta install first.`, you don't have a config yet.

---

## Quality gates failed

### A gate failed during verify or finalize

**Symptom.** `metta-ship` / finalize stops before archiving and prints:

```
Quality gates failed:
  ✗ tests: fail (1843ms)
...
Fix failures and retry.
```

In JSON mode the error carries `status: "gates_failed"` and the per-gate results; the process exits with code **1**.

**Cause.** A required gate (tests, lint, typecheck, build) returned a non-zero exit code. Gates run in order, and a gate whose `on_failure` is `stop` halts the rest — later gates show `skip` with `Skipped due to earlier fail of <gate>`. Finalize refuses to archive a change whose gates aren't green.

**Fix.**
1. Read the failure output under the failing gate — metta echoes the command's stdout/stderr so you can see what broke.
2. Fix the underlying problem in your code (failing test, lint error, type error).
3. Re-run verification / ship. Gates re-run from the top.

A gate with `on_failure: retry_once` is retried automatically once; `continue_with_warning` downgrades a failure to a `warn` (which does not block finalize); only `stop` halts.

### The test gate timed out

**Symptom.** A gate result reads `Gate timed out after 300000ms` (status `fail`).

**Cause.** The built-in `tests` gate runs `npm test` with a **5-minute** timeout and `on_failure: stop`. When the timeout fires, metta kills the whole process group (SIGTERM, then SIGKILL after 1s) and records a failure.

**Fix.** If your suite legitimately needs more than 5 minutes, raise the timeout by dropping a project-local override at `.metta/gates/tests.yaml` (a file with the same name as a built-in gate overrides it). Set `timeout` to a larger value in milliseconds. If the suite hung rather than ran slow, fix the hang — a timed-out gate is a real failure, not a false alarm.

---

## Finalize / ship problems

### "A finalize is already running ... (PID ...)"

**Symptom.** Ship/finalize exits with code **5** and:

```
A finalize is already running for "<change>" (PID 12345). Wait for it to finish, or remove the stale lock at .metta/locks/finalize-<change>.lock.
```

**Cause.** A per-change finalize lock at `.metta/locks/finalize-<change>.lock` is held by a live process. metta detected that PID is still alive and refuses to start a second concurrent finalize.

**Fix.** If another finalize really is running, wait for it to finish. If the named PID is dead (a previous run crashed), the lock is stale — delete the lock file at the path shown and retry. metta automatically reclaims a lock whose PID is no longer alive, so a stale lock usually clears itself on the next attempt; manual deletion is the fallback when it doesn't.

### Spec merge conflict at finalize

**Symptom.** Ship/finalize stops with exit code **2** and:

```
Spec merge conflicts detected:
  <capability>/<requirementId>: <reason>
Resolve conflicts and retry.
```

**Cause.** Your change's delta specs were authored against a base version of a capability spec that has since moved on (another change merged first), so metta can't cleanly fold your edits into the living spec. It refuses to archive a change with unresolved conflicts.

**Fix.** Look at the listed `capability/requirementId` pairs and their reasons. Reconcile your change's spec delta against the current spec for that capability so the requirements agree, then re-run ship. Nothing was archived, so it is safe to retry.

### Finalize failed with a generic error

**Symptom.** `Finalize failed: <message>` with exit code **4**.

**Cause.** Something outside the gate/conflict/lock paths went wrong (I/O error, unexpected state). Note that doc generation is intentionally **not** in this path — a doc-generation failure never blocks finalize.

**Fix.** Read the message, run `metta doctor` to rule out a broken config or state file, fix the underlying cause, and retry.

---

## A change is stuck

### Inspecting state

**Symptom.** You're unsure what phase a change is in, or why the workflow won't advance.

**Fix.**
- `metta status` — shows the active change and its current step.
- `metta progress` — project-wide dashboard across all changes.
- `metta next` — routes you to the next logical step.
- The raw truth lives in `.metta/` (the YAML state files) and the change's artifacts under `spec/changes/`. Every state file is schema-validated, so if one is corrupt, `metta doctor` will flag `state.yaml failed schema validation`.

### "Failed to acquire lock ... within <ms>. Another process may be holding it."

**Symptom.** A state operation throws a `StateLockError`.

**Cause.** An advisory lock file (`<state-file>.lock`) is held. metta treats a lock older than 60 seconds as stale and reclaims it automatically, but a fresh lock from a still-running process makes others wait, then fail.

**Fix.** Make sure you don't have a second metta process running against the same project. If nothing else is running and the error persists, the lock is stale — wait past the 60-second staleness window and retry, or remove the orphaned `*.lock` file next to the state file it guards.

### Abandoning a change

**Symptom.** A change is wedged and you want to walk away from it cleanly.

**Fix.** Abandon it:

```
metta changes abandon <name>
```

This marks the change `abandoned` and archives it as `<date>-<name>-abandoned`, leaving your specs untouched. (This is a state-mutating command — from an AI session it must go through the skill flow, not a raw CLI call.)

---

## FAQ

**Quick mode vs. standard (propose)?**
Use `/metta-quick <description>` for small, scoped work — a bug fix, a one-file edit, a tiny refactor. It skips the planning phase. Use `/metta-propose <description>` for anything non-trivial: new features, multi-file changes, or anything that touches the API surface. Propose runs the full discover → plan → execute → verify lifecycle.

**Can I run changes in parallel?**
Each change is tracked independently in `.metta/`, but finalize is serialized per change via the finalize lock, and state writes are guarded by advisory locks — so avoid two metta processes fighting over the same project at once. Run separate changes one at a time, or use git worktree isolation (`metta doctor` warns when no git repo is present, since worktree isolation is then unavailable).

**How do I customize a gate?**
Drop a YAML file in `.metta/gates/`. A file whose name matches a built-in gate (e.g. `.metta/gates/tests.yaml`) overrides the built-in; a new name adds a gate. A gate definition sets `command`, `timeout` (milliseconds), `required`, and `on_failure` (`stop`, `retry_once`, or `continue_with_warning`). Run `metta gate list` to see what's configured.

**Where do the guard hooks live, and how do I bypass one in an emergency?**
`.claude/hooks/metta-guard-bash.mjs` and `.claude/hooks/metta-guard-edit.mjs`. The supported emergency bypass is disabling the relevant hook in `.claude/settings.local.json`. Reach for it only when a skill genuinely can't cover what you need — the guards exist to keep work inside tracked changes and to route mutating commands through their skills.

**What do the finalize/ship exit codes mean?**
`1` = quality gates failed · `2` = spec merge conflict · `4` = other finalize error · `5` = a finalize is already running (lock held).
