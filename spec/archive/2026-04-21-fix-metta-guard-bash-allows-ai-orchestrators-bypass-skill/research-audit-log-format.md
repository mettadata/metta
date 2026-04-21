# Research: Audit Log Format for Guard Bypass Log

Change: `fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill`
Author: research phase
Date: 2026-04-20

---

## 1. Log Location

`.metta/logs/` is already established as the canonical runtime output directory for metta. Three separate code sites confirm this:

- `src/cli/commands/install.ts` (line 297) writes `.metta/logs/` into `.metta/.gitignore` via the `wx` flag on first install.
- `.metta/.gitignore` in the current project contains `.metta/logs/` as entry three.
- `docs/workflows/state.md` (lines 139–141) documents `.metta/logs/` as "per-command diagnostic output, git-ignored, rotated according to `config.cleanup.log_retention_days` (default 30)."

The `logs/` subdirectory is not created by `metta install` — it is only listed in `.gitignore`. It does not exist in the current project (confirmed: `ls .metta/` returns only `config.yaml`). No source file creates it proactively.

**Decision**: The hook must create `.metta/logs/` with `{ recursive: true }` semantics (Node.js `fs.mkdirSync` or `fs.promises.mkdir`) before writing. This is consistent with every other lazy-mkdir pattern in the codebase (`src/state/state-store.ts`, `src/artifacts/artifact-store.ts`, `src/gaps/gaps-store.ts`, all use `mkdir(..., { recursive: true })` inline before writes). Since the hook is an `.mjs` file with no TS build step, it must use either synchronous `mkdirSync` (already imported pattern: line 7 of the current hook uses `readFileSync`) or top-level await with `fs/promises`. Synchronous is simpler and consistent with the hook's existing synchronous stdin read.

The hook determines project root by walking upward from `import.meta.url` to find the nearest ancestor containing `.metta/`, falling back to `process.cwd()`. This matches the spec requirement (spec.md line 32).

---

## 2. Log Format

**Decision: JSON Lines (NDJSON).**

The spec mandates it. Existing codebase evidence supports it: `src/cli/helpers.ts` uses `JSON.stringify` for structured output; all state files are either YAML or JSON. There is no existing `.log` file written anywhere in the source — this is the first runtime log file metta will produce. JSON Lines is the correct choice because:

- Parseable with `jq` without loading the whole file.
- Append-only: no closing bracket to maintain.
- Each line is self-contained for streaming audit tools.
- Matches `new Date().toISOString()` + `JSON.stringify(obj) + '\n'` — a two-line write in the hook.

Plain text and CSV are ruled out: plain text has no structured schema for tooling; CSV would require escaping the `command` field and breaks on commas in subcommand arguments.

---

## 3. Log Rotation / Retention

The `docs/workflows/state.md` documentation states `.metta/logs/` is "rotated according to `config.cleanup.log_retention_days` (default 30)." However, no sweep implementation exists yet in the codebase — `grep -r "log_retention" src/` returns nothing. The rotation policy is aspirational docs, not live code.

**Decision: unbounded growth for this change; no rotation logic added.**

Rationale: bypass events are rare (one line per blocked or observed-bypass call). At 200 bytes per line, 10,000 events = 2 MB. That volume implies a serious misconfiguration, not normal usage. Capping or rotating inside the hook would add read-then-write complexity that conflicts with the spec's "hook MUST NOT read the log file at any point" requirement. If rotation is needed, it belongs in a future `metta cleanup` command that already has a hook in `config.cleanup.log_retention_days`. Document as a follow-on, not in scope here.

---

## 4. Schema

The spec defines this shape (spec.md lines 34–44):

```json
{
  "ts": "<ISO8601>",
  "verdict": "block" | "allow_with_bypass",
  "subcommand": "<string>",
  "third": "<string | null>",
  "skill_hint": "<string | null>",
  "reason": "<string>",
  "event_keys": ["<string>"]
}
```

### 4a. `ts` — ISO 8601 vs Unix epoch ms

The spec says `new Date().toISOString()` explicitly. ISO 8601 is the right choice: it is human-readable in `cat` output, sortable lexicographically, and consistent with how timestamps appear in all existing metta YAML state files (e.g. `created: 2026-04-21T07:43:52.804Z` in `.metta.yaml`).

**Decision: `new Date().toISOString()` — ISO 8601 with millisecond precision and `Z` suffix.**

### 4b. `event_keys` — array of strings

The spec is explicit: "enumerate every top-level key present in the parsed event JSON (e.g. `['tool_name', 'tool_input']` for current payloads)." This is `Object.keys(event)`. The purpose is forward-looking observability — if Claude Code adds new top-level fields (e.g. `session_id`, `agent_type`, `transcript_path`) to PreToolUse payloads, the log captures their names without the hook needing to know about them in advance.

**Decision: `Object.keys(event)` — array of strings, top-level keys only.** Deeper introspection (e.g. keys of `tool_input`) is not needed; the subcommand and command string are already captured via `subcommand` and could be inferred from `reason`.

### 4c. `cwd` / `session_id`

The spec schema has no `cwd` or `session_id` field. The spec says "MUST NOT include additional top-level keys." If `session_id` or `cwd` appear as top-level keys in a future PreToolUse payload, they will surface via `event_keys`. Capturing their values would require expanding the schema, which the spec prohibits. No action needed: `event_keys` provides the observability without violating the schema constraint.

### 4d. PII: should we log the raw command string?

The `command` field (the full `tool_input.command` string) is NOT in the spec schema. The spec schema only has `subcommand` (first token after `metta`) and `third` (second argument token). This is a deliberate design choice.

**Arguments for logging the full command:**
- Debuggability: knowing `metta issue "repro steps here"` vs `metta issue "x"` helps distinguish real orchestrator mistakes from test noise.
- The stories.md (line 35) says "full command string" — but stories describe an earlier draft; the spec.md schema (authoritative) omits it.

**Arguments against:**
- Users could run `metta issue "contains private API key or internal info"` — the argument string becomes a credential or confidential-project detail in a plaintext log file.
- `.metta/logs/` is git-ignored, but it sits on-disk unencrypted. CI systems that archive `.metta/` would expose it.
- The spec schema is clear: the seven named fields are the exhaustive set. The `reason` field (a short human-readable string) can encode classification context without repeating the full command.

**Decision: do NOT log the raw command string.** Log only `subcommand` and `third` as specified. The `reason` field carries the classification context (e.g. `"skill-enforced block"`, `"inline bypass observed on non-enforced subcommand"`). This matches the authoritative spec.md schema and avoids PII leakage.

---

## 5. Concurrency

PreToolUse hooks can be invoked concurrently when Claude Code issues parallel Bash tool calls. The hook appends to a shared file.

POSIX guarantees that `write()` to a file opened with `O_APPEND` atomically seeks to EOF and writes without a race between processes — the offset update and write are a single atomic operation at the kernel level. [^1] However, POSIX does not guarantee that multi-process O_APPEND writes will not interleave bytes for writes larger than PIPE_BUF (4096 bytes on Linux). [^2]

Each log line is a single `JSON.stringify(obj) + '\n'` call. For the schema above with typical field values, the line is well under 512 bytes. The Linux kernel ext4 and tmpfs filesystems do not split sub-page writes for O_APPEND; in practice a single `write()` syscall under 4096 bytes is atomic on Linux local filesystems. [^3]

**Decision: naive `fs.appendFileSync` (which opens with O_APPEND under the hood) is safe for this use case.** The write is a single syscall, the payload is always under 512 bytes, and `.metta/` is a local filesystem. No locking or temp-file-rename pattern is required.

[^1]: POSIX write() spec: https://pubs.opengroup.org/onlinepubs/9699919799/functions/write.html accessed 2026-04-20
[^2]: "Appending to a File from Multiple Processes": https://nullprogram.com/blog/2016/08/03/ accessed 2026-04-20
[^3]: "Are Files Appends Really Atomic?": https://www.notthewizard.com/2014/06/17/are-files-appends-really-atomic/ accessed 2026-04-20

---

## 6. Test Strategy

The existing test harness (`tests/metta-guard-bash.test.ts`) uses `spawnSync('node', [hookPath], { input, env })` and asserts on `exit code` and `stderr`. It does not currently verify filesystem side-effects because the hook does not write to disk.

Adding audit-log verification requires a temporary directory for the project root so the hook's log write goes to a scratch location, not the live `.metta/`.

### Minimal addition pattern

```typescript
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Create a temp dir with a .metta/ subdirectory to act as project root.
function makeProjectRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'metta-guard-test-'))
  mkdirSync(join(dir, '.metta'), { recursive: true })
  return dir
}

function runHookWithRoot(
  hookPath: string,
  payload: unknown,
  projectRoot: string,
  opts: { env?: NodeJS.ProcessEnv } = {},
): { code: number; stderr: string } {
  // Pass project root via env so the hook can locate it without filesystem traversal.
  // (Alternatively the hook detects it from import.meta.url — in tests, cwd override works.)
  const env = { ...process.env, ...(opts.env ?? {}), METTA_PROJECT_ROOT: projectRoot }
  delete env.METTA_SKILL
  const result = spawnSync('node', [hookPath], {
    input: JSON.stringify(payload),
    env,
    encoding: 'utf8',
    timeout: 10_000,
  })
  return { code: result.status ?? -1, stderr: result.stderr ?? '' }
}
```

The hook uses `METTA_PROJECT_ROOT` env override (if set) instead of traversal — a single `process.env.METTA_PROJECT_ROOT` check at the top of the log-write helper is a clean seam. If the hook uses only `process.cwd()` fallback, the test can pass `cwd: projectRoot` as a `spawnSync` option instead, which is simpler and requires no hook-side env check.

### Required new test cases (sketch)

1. **Blocked call creates log directory and writes one line** — given no `.metta/logs/` in temp root, `metta issue "x"` blocked, assert `.metta/logs/guard-bypass.log` exists, contains exactly one line, parses to valid JSON with `verdict: "block"`, `subcommand: "issue"`, `skill_hint: "/metta-issue"`, `ts` matching ISO 8601 regex, `event_keys` containing `"tool_name"` and `"tool_input"`.

2. **Second blocked call appends without truncation** — given log already has one line, second block appends, file has exactly two lines.

3. **Inline bypass on non-enforced subcommand writes `allow_with_bypass`** — `METTA_SKILL=1 metta refresh` exits 0, log has one line with `verdict: "allow_with_bypass"`, `subcommand: "refresh"`.

4. **Allowed read-only call writes nothing** — `metta status` exits 0, log file does not exist (or, if pre-seeded, has unchanged line count).

Cleanup: each test that creates a temp root must call `rmSync(dir, { recursive: true })` in `afterEach`.

---

## Summary of Decisions

| Question | Decision |
|---|---|
| Log location | `.metta/logs/guard-bypass.log`; create `logs/` with `mkdirSync(..., { recursive: true })` on demand |
| Log format | JSON Lines (NDJSON); one `JSON.stringify(obj) + '\n'` per event |
| `ts` format | ISO 8601 via `new Date().toISOString()` |
| `event_keys` | `Object.keys(event)` — top-level keys only |
| Log raw command | No — log only `subcommand` and `third`; reason field for context |
| Extra fields (`cwd`, `session_id`) | No extra top-level fields; they surface via `event_keys` if added to payload |
| Retention / rotation | Unbounded for this change; defer to future `metta cleanup` command |
| Concurrency safety | `fs.appendFileSync` (O_APPEND); safe for sub-512-byte single-syscall writes on local Linux FS |
| Test seam | `spawnSync` with `cwd: projectRoot` option pointing to a `mkdtemp` scratch dir with `.metta/` |
