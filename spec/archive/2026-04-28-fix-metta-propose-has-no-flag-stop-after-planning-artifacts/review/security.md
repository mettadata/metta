# Security Review: fix-metta-propose-has-no-flag-stop-after-planning-artifacts

## Summary

A small, additive change that introduces a `--stop-after <artifact>` flag, an optional `stop_after` string on `ChangeMetadata`, and a skill-side early-exit branch. The attack surface is narrow: the value is whitelisted against `graph.buildOrder` before any state is written, never reaches a shell or filesystem path, and is persisted only as a Zod-validated YAML scalar. No regression in the `assertOnMainBranch` / branch-hygiene posture (propose still uses argv-form `execFile` for git, not shell). Pragmatic verdict: **PASS**.

## Threat Model

Project owner is trusted; the realistic attacker model here is (a) accidental misuse by an AI orchestrator passing an attacker-influenced description/argument string and (b) a poisoned `.metta.yaml` from a hostile branch the user might check out. Both are bounded by the existing repo-trust model.

## Findings

### 1. `--stop-after <artifact>` argument — injection / path traversal

- `src/cli/commands/propose.ts:21–23` declares the option via Commander. The value lands in `options.stopAfter` as a plain string.
- `src/cli/commands/propose.ts:42–57` validates `stopAfter` against `graph.buildOrder` (whitelist) and explicitly rejects `implementation` and `verification`. Validation runs **before** any state is written, so a rejected value cannot create a change directory or `.metta.yaml` (confirmed by `tests/cli-propose-stop-after.test.ts:60–87`).
- The value is then:
  - interpolated into error message strings (`propose.ts:49,54`) — safe; not executed.
  - emitted in `console.log` and `outputJson` (`propose.ts:91, 100`) — safe.
  - passed as a function argument to `artifactStore.createChange` (`propose.ts:68`), which stores it on a strict-validated object.
  - **Never** passed to `execFile`, `exec`, `path.join`, `readFile`, or any FS API. The only `execFile` call (`propose.ts:77`) builds `metta/<slug>` from the slugified description, not from `stopAfter`.
- Verdict: **no command injection, no path traversal surface**.

### 2. Schema field `stop_after: z.string().optional()`

- `src/schemas/change-metadata.ts:62` accepts any string. The schema object is `.strict()`, so unknown keys are rejected (`tests/schemas.test.ts:272–280` confirms non-string is rejected).
- `ArtifactStore.createChange` (`src/artifacts/artifact-store.ts:60–62`) does not re-validate `stopAfter` against `buildOrder`. This is acceptable because (a) the only producer is `propose.ts` which whitelists, and (b) the value is consumed only as a string-equality compare in the skill — the worst-case payload is a value that never matches, causing the skill to never stop early (no privilege escalation, no FS write, no exec).
- The string is persisted via `StateStore.write` → `YAML.stringify` (`state-store.ts:47–58`). YAML serialization does not interpret the value as a path or command. The matching `read` re-validates with the same schema.
- Verdict: **no state-file write surface beyond the existing `.metta.yaml`**. No path traversal because the field is never used as a path.

### 3. Skill exit pattern — guard short-circuit risk

- `.claude/skills/metta-propose/SKILL.md:84–102` describes the boundary check. The comparison is `STOP_AFTER === <artifact id the orchestrator just passed to metta complete>`. Both sides are values the orchestrator itself controls within the planning loop.
- A malicious `stop_after` value in `.metta.yaml` (e.g. from a hostile branch) at worst (a) causes the skill to halt early on a stage that happens to match, or (b) never matches, in which case the workflow runs to completion. It cannot bypass `metta finalize`'s gates, cannot suppress reviewer/verifier subagents that have already run, and cannot redirect file paths — the artifact paths in step 3 are computed from `metta instructions <artifact> --json` output, not from `stop_after`.
- Once the skill exits early it explicitly does not call `metta finalize` or `git merge` (steps 4–8 are skipped). This is by design and matches the spec; a halt is the intended denial-of-service-style outcome of a malformed flag.
- Verdict: **no guard bypass, no path manipulation**.

### 4. `assertOnMainBranch` / `autoCommitFile` interactions

- `propose.ts` does not call `assertOnMainBranch` (it never did — propose creates a feature branch). The change does not regress this. The `metta-guard-bash` PreToolUse hook still gates orchestrator-direct calls to `metta propose` regardless of `--stop-after`.
- The git operation in `propose.ts:77` uses `execFile('git', ['checkout', '-b', branchName])` — argv form, no shell. The branch name is derived from the slugified description (existing path), not from `stopAfter`. No regression.
- `autoCommitFile` is not touched by this change.
- Verdict: **branch-safety posture preserved**.

### 5. Test coverage of malicious inputs

- `tests/cli-propose-stop-after.test.ts:60–98` covers unknown id, `implementation`, and `verification` rejection.
- `tests/schemas.test.ts:272–280` covers non-string rejection at the schema layer.
- Not covered (suggestion only, not blocking): values containing newlines, very long strings, or YAML-special characters (`---`, `:`, leading `&`, `*`). All would be neutralized by `YAML.stringify`'s quoting rules, and would never match a real artifact id, so worst case is harmless.

## Issues Found

### Critical (must fix)

_None._

### Warnings (should fix)

_None._

### Suggestions (nice to have)

- `src/artifacts/artifact-store.ts:60–62` — could tighten by accepting `stopAfter` only when `artifactIds.includes(stopAfter)`. Defense in depth in case a future caller bypasses the CLI validation. Non-blocking; current single producer (`propose.ts`) is correct.
- `src/schemas/change-metadata.ts:62` — could narrow the field to `z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/)` to align with artifact-id conventions. Non-blocking; the field is never used as a path/exec.

## Verdict

**PASS**
