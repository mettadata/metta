# Design: custom-claude-statusline-conte

## Overview

Add a Claude Code statusline script at `src/templates/statusline/statusline.mjs` that surfaces two live signals after every turn: the current metta workflow artifact (from `metta status --json`) and the context window utilization percentage (derived from the session's JSONL transcript). The script is installed to `.claude/statusline/statusline.mjs` by a new `installMettaStatusline(root)` helper in `src/cli/commands/install.ts`, which mirrors the existing `installMettaGuardHook` pattern — idempotent settings.json merge, warn-and-skip on foreign values, failure isolation so a statusline error cannot abort the broader install. A one-line addition to `copy-templates` in `package.json` makes the template available under `dist/` at build time.

---

## Components

| File | Role |
|------|------|
| `src/templates/statusline/statusline.mjs` | New. Executable Node.js script; reads stdin, resolves artifact and context %, prints one formatted line, exits 0. |
| `src/cli/commands/install.ts` | Modified. Add `installMettaStatusline(root)` helper; call it from the install action; update human-readable output to mention statusline. |
| `package.json` | Modified. Append `&& cp -r src/templates/statusline dist/templates/statusline` to the `copy-templates` script. |
| `test/templates/statusline/resolve-context-window.test.ts` | New. Unit tests for `resolveContextWindow`. |
| `test/templates/statusline/read-transcript-tail.test.ts` | New. Unit tests for `readTranscriptTail` and `findLatestAssistantUsage`. |
| `test/templates/statusline/compute-percent.test.ts` | New. Unit tests for `computePercent`. |
| `test/templates/statusline/format-status-line.test.ts` | New. Unit tests for `formatStatusLine` and `pickColorForSlug`. |
| `test/cli/commands/install-statusline.test.ts` | New. Unit tests for `installMettaStatusline`. |

---

## Module: `src/templates/statusline/statusline.mjs`

### Responsibilities

- Read and tolerate all stdin shapes (empty, malformed JSON, wrong-typed fields).
- Resolve the active context window size from `model.id`.
- Tail-read the JSONL transcript and reverse-scan for the most recent assistant usage record.
- Shell out to `metta status --json` (5 000 ms timeout) and extract `current_artifact` and `change` slug.
- Apply a deterministic ANSI color to the artifact label when a change slug is present and artifact is neither `idle` nor `unknown`.
- Print exactly one newline-terminated line to stdout. Always exit 0.

### Pure helpers (exported for tests)

All six helpers below are exported named exports so test files can import them directly.

```
resolveContextWindow(stdinObj)
  -> number  (1_000_000 if stdinObj.model?.id contains '[1m]', else 200_000)

readTranscriptTail(path, bytes = 65_536)
  -> Promise<string[]>  (array of non-empty lines from tail of file; [] on any fs error)

findLatestAssistantUsage(lines)
  -> number | null  (input_tokens from last assistant turn with numeric usage; null if none found)

computePercent(used, window)
  -> number  (Math.round(used / window * 100))

pickColorForSlug(slug)
  -> number  (ANSI color code from palette; same slug always yields same code)

formatStatusLine({ artifact, slug, ctxPct })
  -> string  (formatted output line, no trailing newline)
```

**Color palette** — eight codes in declaration order; index = `hash(slug) % 8`:

| Index | ANSI code | Color |
|-------|-----------|-------|
| 0 | 31 | Red |
| 1 | 32 | Green |
| 2 | 33 | Yellow |
| 3 | 34 | Blue |
| 4 | 35 | Magenta |
| 5 | 36 | Cyan |
| 6 | 91 | Bright Red |
| 7 | 92 | Bright Green |

Hash function: sum of `charCodeAt(i)` for all characters in the slug, modulo 8. Simple, dependency-free, deterministic across Node versions.

### Entry point (main) pseudocode

```
async function main():
  stdinObj  = await readStdin()          // tolerant: {} on empty / malformed
  model_id  = stdinObj.model?.id         // object shape per research
  window    = resolveContextWindow({ model: { id: model_id } })

  // Signal 1: context %
  ctxPct = null
  if typeof stdinObj.transcript_path === 'string':
    lines  = await readTranscriptTail(stdinObj.transcript_path)
    tokens = findLatestAssistantUsage(lines)
    if tokens !== null:
      ctxPct = computePercent(tokens, window)

  // Signal 2: artifact + slug
  artifact = 'idle'
  slug     = null
  try:
    { stdout } = await execAsync('metta', ['status', '--json'], { timeout: 5000 })
    parsed = JSON.parse(stdout)
    if typeof parsed.current_artifact === 'string' && parsed.current_artifact.length > 0:
      artifact = parsed.current_artifact
    if typeof parsed.change === 'string' && parsed.change.length > 0:
      slug = parsed.change
  catch:
    artifact = 'idle'   // any failure -> idle, not unknown

  line = formatStatusLine({ artifact, slug, ctxPct })
  process.stdout.write(line + '\n')
  process.exit(0)

main().catch(() => {
  process.stdout.write('[metta: unknown]\n')
  process.exit(0)
})
```

### `formatStatusLine` pseudocode

```
function formatStatusLine({ artifact, slug, ctxPct }):
  label = artifact
  if slug && artifact !== 'idle' && artifact !== 'unknown':
    code  = pickColorForSlug(slug)
    label = `\x1b[${code}m${artifact}\x1b[0m`
  base = `[metta: ${label}]`
  if ctxPct !== null:
    return `${base} ${ctxPct}%`
  return base
```

### `readTranscriptTail` pseudocode

```
async function readTranscriptTail(path, bytes = 65_536):
  try:
    fd   = await fs.open(path, 'r')
    stat = await fd.stat()
    size = stat.size
    if size === 0: return []
    readSize   = Math.min(bytes, size)
    offset     = size - readSize
    buf        = Buffer.alloc(readSize)
    await fd.read(buf, 0, readSize, offset)
    await fd.close()
    lines = buf.toString('utf8').split('\n').filter(l => l.trim())
    // drop first line if we started mid-line (offset > 0)
    if offset > 0: lines.shift()
    return lines
  catch:
    return []
```

### `findLatestAssistantUsage` pseudocode

```
function findLatestAssistantUsage(lines):
  for i = lines.length - 1 downto 0:
    try:
      record = JSON.parse(lines[i])
      if record.message?.role === 'assistant'
         && typeof record.message?.usage?.input_tokens === 'number':
        return record.message.usage.input_tokens
    catch:
      continue   // skip malformed lines silently
  return null
```

### Error boundary

The top-level `main().catch(...)` catches any unhandled rejection (e.g. a bug in a helper that wasn't anticipated). It writes `[metta: unknown]\n` to stdout and calls `process.exit(0)`. No `process.exit(1)` or unhandled exception may escape.

---

## Module: `src/cli/commands/install.ts` — `installMettaStatusline(root)`

### Responsibilities

- Copy `dist/templates/statusline/statusline.mjs` to `<root>/.claude/statusline/statusline.mjs`.
- Set file mode `0o755`.
- Idempotently merge a top-level `statusLine` key into `<root>/.claude/settings.json`.
- Warn to stderr (never throw) when the settings.json `statusLine` key already points at a foreign path.
- Let all errors propagate as thrown `Error` values so the caller can catch them and emit a warning without aborting the install.

### Pseudocode

```
async function installMettaStatusline(root: string): Promise<void>:
  statuslineDir  = join(root, '.claude', 'statusline')
  statuslinePath = join(statuslineDir, 'statusline.mjs')
  settingsPath   = join(root, '.claude', 'settings.json')
  installedCmd   = '.claude/statusline/statusline.mjs'   // relative, portable

  templateScript = new URL('../../templates/statusline/statusline.mjs', import.meta.url).pathname
  await mkdir(statuslineDir, { recursive: true })
  await copyFile(templateScript, statuslinePath)
  await chmod(statuslinePath, 0o755)

  let settings: Record<string, unknown> = {}
  if existsSync(settingsPath):
    raw = await readFile(settingsPath, 'utf8')
    try:
      settings = JSON.parse(raw)
    catch err:
      throw new Error(`settings.json is not valid JSON — refusing to overwrite. Fix it and re-run. Cause: ${err.message}`)

  existing = settings.statusLine
  if existing !== undefined:
    // Check if it's already ours
    existingCmd = (existing as any)?.command
    if existingCmd === installedCmd:
      return   // no-op: already registered
    // Foreign value — warn and skip
    process.stderr.write(
      `Warning: statusLine already set in .claude/settings.json (${JSON.stringify(existingCmd ?? existing)}) — skipping. Remove it manually to let metta manage it.\n`
    )
    return

  settings.statusLine = { type: 'command', command: installedCmd, padding: 0 }
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n')
```

### Idempotency rules

| Existing `statusLine` value | Action |
|---|---|
| Absent | Write `{ type: "command", command: ".claude/statusline/statusline.mjs", padding: 0 }` |
| Present, `command` equals `.claude/statusline/statusline.mjs` | No-op (no file write) |
| Present, `command` is any other value | Emit warning to stderr; leave file unchanged |

### Failure isolation

`installMettaStatusline` throws on hard failures (unparseable settings.json, fs write errors). The call site in the install action wraps it in `try/catch` and emits a `console.error` warning rather than rethrowing. This mirrors the existing `installMettaGuardHook` call pattern at lines 169-175 of `install.ts`. The broader install action continues after the catch block.

Concrete call-site addition (after the existing guard hook block):

```typescript
let statuslineInstalled = false
try {
  await installMettaStatusline(root)
  statuslineInstalled = true
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`Warning: failed to install statusline — ${message}`)
}
```

The JSON output object gains a `statusline_installed: boolean` field. The human output gains a conditional `console.log` line:

```
  Installed: statusline (.claude/statusline/statusline.mjs)
```

---

## Build pipeline change

### `package.json` `copy-templates`

Append one segment to the existing `copy-templates` value. Current last segment ends with `cp -r src/templates/hooks dist/templates/hooks`. Add:

```
&& cp -r src/templates/statusline dist/templates/statusline
```

The full `copy-templates` value then ends with:

```
... && cp -r src/templates/hooks dist/templates/hooks && cp -r src/templates/statusline dist/templates/statusline
```

No other packaging changes are needed; `"files"` already includes `"src/templates"` and `"dist"`.

---

## Test plan

### Unit tests (Vitest)

All test files live under `test/templates/statusline/` and `test/cli/commands/`. Because `statusline.mjs` is a plain ESM module (not TypeScript), tests import the exported helpers directly.

---

**`test/templates/statusline/resolve-context-window.test.ts`**

Tests for `resolveContextWindow(stdinObj)`:

| Case | Input | Expected |
|---|---|---|
| model.id contains `[1m]` | `{ model: { id: 'claude-opus-4-6[1m]' } }` | `1_000_000` |
| model.id contains `[1m]` as substring with suffix | `{ model: { id: 'claude-opus-4-6[1m]-custom' } }` | `1_000_000` |
| model.id present but no `[1m]` | `{ model: { id: 'claude-sonnet-4-6' } }` | `200_000` |
| model is absent | `{}` | `200_000` |
| model is a string (legacy, wrong type per research) | `{ model: 'claude-sonnet-4-6' }` | `200_000` (model?.id is undefined) |
| model.id is not a string | `{ model: { id: 42 } }` | `200_000` |

---

**`test/templates/statusline/read-transcript-tail.test.ts`**

Tests for `readTranscriptTail(path, bytes)` and `findLatestAssistantUsage(lines)`:

`readTranscriptTail`:

| Case | Setup | Expected |
|---|---|---|
| happy path — file smaller than tail size | Write 3 JSONL lines to a temp file | Returns all 3 lines as strings |
| happy path — file larger than tail size | Write content > 65 536 bytes; last N lines contain the target records | Returns only lines from the tail window; first partial line dropped |
| file does not exist | Non-existent path | Returns `[]` without throwing |
| file is empty | Zero-byte file | Returns `[]` |
| offset > 0 drops first line | 70 000-byte file | First element of result array is a complete JSON line, not a fragment |

`findLatestAssistantUsage`:

| Case | Input | Expected |
|---|---|---|
| last assistant turn with usage | Array ending with valid assistant record | `input_tokens` value from that record |
| most recent is used over earlier | Two assistant records with different token counts | Returns tokens from the latter record |
| no assistant turns | Only user-role records | `null` |
| assistant turn present but no usage block | `message.role === 'assistant'` but `message.usage` absent | `null` |
| assistant turn has usage but `input_tokens` is not a number | `input_tokens: "100000"` (string) | `null` (not a number type) |
| malformed JSONL lines silently skipped | Array with one `{not json}` and one valid assistant record | Returns tokens from the valid record |
| empty array | `[]` | `null` |

---

**`test/templates/statusline/compute-percent.test.ts`**

Tests for `computePercent(used, window)`:

| Case | Input | Expected |
|---|---|---|
| exactly half | `(100_000, 200_000)` | `50` |
| rounds up | `(100_001, 200_000)` | `50` (rounds to nearest) |
| 1M window | `(430_000, 1_000_000)` | `43` |
| 0 tokens used | `(0, 200_000)` | `0` |
| 100% full | `(200_000, 200_000)` | `100` |
| over 100% | `(210_000, 200_000)` | `105` (no clamping; spec does not require it) |

---

**`test/templates/statusline/format-status-line.test.ts`**

Tests for `formatStatusLine({ artifact, slug, ctxPct })` and `pickColorForSlug(slug)`:

`pickColorForSlug`:

| Case | Notes |
|---|---|
| same slug yields same code on repeated calls | deterministic |
| all slug inputs yield a code in the palette `{31,32,33,34,35,36,91,92}` | bounds check |
| empty string does not throw | edge: slug = `""` yields a code |

`formatStatusLine`:

| Case | Input | Expected |
|---|---|---|
| artifact + slug + ctxPct | `{ artifact: 'spec', slug: 'my-slug', ctxPct: 43 }` | Contains `] 43%`; artifact text is ANSI-wrapped (`\x1b[` present) |
| idle + no slug + no pct | `{ artifact: 'idle', slug: null, ctxPct: null }` | `[metta: idle]` with no `\x1b` and no `%` |
| active artifact + no pct | `{ artifact: 'design', slug: 'my-slug', ctxPct: null }` | `[metta: <ansi>design<reset>]` with no trailing space or `%` |
| unknown artifact is not colored | `{ artifact: 'unknown', slug: 'any', ctxPct: null }` | `[metta: unknown]` with no `\x1b` |
| ANSI reset follows label | Any active, non-idle artifact | `\x1b[0m` present immediately after the artifact text |
| pct = 0 is included | `{ artifact: 'tasks', slug: 'x', ctxPct: 0 }` | Ends with `] 0%` |

---

**`test/cli/commands/install-statusline.test.ts`**

Tests for `installMettaStatusline(root)` in isolation, using a temporary directory as `root`:

| Case | Notes |
|---|---|
| fresh install — no settings.json | Script copied, mode 0o755, settings.json created with `statusLine` key |
| fresh install — settings.json exists with no `statusLine` key | Existing keys preserved; `statusLine` key added |
| re-run is a no-op | After first install, second call does not rewrite settings.json; file mtime unchanged |
| foreign `statusLine` command preserved | Settings.json contains `statusLine.command` with different path; after call, value unchanged; warning emitted to stderr |
| settings.json is unparseable | Throws an `Error` containing text about invalid JSON |
| other keys in settings.json are preserved | `mcpServers` key survives the merge |
| installed file is executable | `stat(statuslinePath).mode & 0o111` is non-zero |

---

## Data shapes

### Claude Code stdin payload

Based on research (docs + live transcript inspection, 2026-04-16):

```json
{
  "transcript_path": "/abs/path/to/session.jsonl",
  "model": {
    "id": "claude-opus-4-6[1m]",
    "display_name": "Claude Opus 4.6"
  }
}
```

Implementation accesses `stdinObj.model?.id` (not `stdinObj.model`). The spec's `[1m]` substring test targets `model.id`.

### Transcript JSONL record

Relevant assistant turn shape (fields used by this feature only):

```json
{
  "message": {
    "role": "assistant",
    "usage": {
      "input_tokens": 83412,
      "cache_read_input_tokens": 0,
      "cache_creation_input_tokens": 0
    }
  }
}
```

Only `message.role` and `message.usage.input_tokens` are read. Cache token fields are intentionally ignored per spec (acknowledged undercount; deferred to follow-up).

### `metta status --json` relevant fields

```json
{
  "current_artifact": "implementation",
  "change": "custom-claude-statusline-conte"
}
```

`current_artifact` absent or empty string → artifact resolves to `idle`. `change` absent or empty string → no coloring applied.

### `.claude/settings.json` `statusLine` entry

```json
{
  "statusLine": {
    "type": "command",
    "command": ".claude/statusline/statusline.mjs",
    "padding": 0
  }
}
```

Idempotency check: compare `settings.statusLine?.command === '.claude/statusline/statusline.mjs'`. If match, skip write. If mismatch (foreign), warn and skip. The relative path is portable and matches the `metta-guard-edit.mjs` hook registration convention.

---

## ADR-1: Relative path in `settings.json` command field

**Decision:** Store `.claude/statusline/statusline.mjs` as a relative path, not an absolute path.

**Rationale:** The guard hook uses the same relative convention (`.claude/hooks/metta-guard-edit.mjs`). Relative paths survive `git clone` into a different user's home directory. Claude Code resolves relative paths from the project root.

**Risk:** If Claude Code resolves relative paths from a different base in some execution contexts (e.g. a sub-agent spawned from a different cwd), the script may not be found. Mitigation: this is the same risk the guard hook accepts today with no reported breakage.

---

## ADR-2: `input_tokens` only for context utilization (not cache tokens)

**Decision:** Use `message.usage.input_tokens` exclusively; do not add `cache_read_input_tokens` or `cache_creation_input_tokens`.

**Rationale:** Per spec. Cache tokens physically occupy context quota but the formula stays transparent and testable. The displayed percentage will undercount true fill on sessions with large caches.

**Risk:** Percentage appears lower than actual context consumption when the cache is warm. Documented as a known limitation; a follow-up change can widen the formula.

---

## ADR-3: `installMettaStatusline` throws rather than warn-internally

**Decision:** `installMettaStatusline` throws on hard failures; the call site in the install action catches and emits the warning.

**Rationale:** Matches the existing `installMettaGuardHook` contract (it also throws on unparseable settings.json). Keeping the same pattern means the install action's single outer `try/catch` handles both helpers uniformly with consistent warning messages.

**Note:** The warn-and-skip behavior for a foreign `statusLine` path is handled inside `installMettaStatusline` via `process.stderr.write` (not a throw) because it is not an error — it is an intentional no-op.

---

## Open questions / follow-ups

1. **Cache-inclusive utilization.** Should a follow-on change sum `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` to represent true context fill? The current undercount may be confusing on long sessions. Deferred; `computePercent` signature is already factored to make this a one-line change in `findLatestAssistantUsage`.

2. **`padding` field value.** Research confirmed `padding: 0` from the docs example. If Claude Code's default is already 0, the field is redundant. Harmless to include but worth verifying in a live test.

3. **Uninstall / removal.** `metta install` has no inverse for the `statusLine` key. A follow-on `metta uninstall` or `metta install --remove-statusline` could handle this. Out of scope per spec.

4. **`metta status --json` output shape stability.** The `current_artifact` and `change` fields are read from the live `metta status` command. If the state-store schema changes, this script would silently fall back to `idle`. Consider a contract test or a version field in the JSON output as a guard.

5. **Statusline refresh cadence.** Controlled by Claude Code, not this script. If Claude Code invokes the statusline only at turn boundaries (not on a timer), the context % will lag behind streaming token consumption. Noted; no action required here.
