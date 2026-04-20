# Research: stdin-read API for `metta issue` stdin auto-detection

**Date:** 2026-04-20
**Scope:** `src/cli/commands/issue.ts` — read piped stdin bytes before running the command; use payload as issue body; treat whitespace-only as absent; never hang on a TTY.

---

## Existing code grounding

- `src/cli/helpers.ts` already contains `askYesNo`, which guards interactive prompts with `if (!process.stdin.isTTY)`. This is the established pattern in this codebase for TTY detection.
- `issue.ts` today calls `ctx.issuesStore.create(description, description, ...)` — both title and body are the CLI argument. The new behaviour must route piped text as the body while keeping the positional argument as the title.
- `package.json` has zero stdin-specific dependencies. Current runtime deps: `commander`, `zod`, `remark-parse`, `unified`, `yaml`, `@anthropic-ai/sdk`.

---

## Approach 1 — Manual async iterator

```typescript
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}
```

**TTY safety.** When `process.stdin.isTTY` is `true`, calling `for await...of` on it does NOT automatically resolve — it waits for EOF, which never comes from a live terminal.[^1] The guard `if (process.stdin.isTTY) return ''` **must** precede the call; the iterator itself offers no built-in escape.

**Encoding.** `Buffer.concat(...).toString('utf8')` decodes all bytes at the end. Multi-byte sequences split across chunk boundaries are handled correctly by decoding after concat — not chunk by chunk.

**Error modes.** SIGPIPE on the write end (writer exits early) closes the readable side cleanly; the `for await` loop terminates. No special handling needed. Large payloads: Node streams back-pressure naturally; for <8 KB this is irrelevant.

**Test ergonomics.** Vitest tests spawn the binary via `child_process.spawn` and write to the child's `stdin` pipe then call `stdin.end()`. The spawned process has a non-TTY stdin by construction, so the guard passes correctly with no mocking needed.

**Dependencies.** None.

**Code size.** ~6 lines. Readable but requires the caller to remember the guard.

[^1]: https://github.com/nodejs/node/issues/22044 accessed 2026-04-20

---

## Approach 2 — `readFileSync(0, 'utf8')`

```typescript
import { readFileSync } from 'node:fs'

function readStdin(): string {
  return readFileSync(0, 'utf8')   // fd 0 = stdin
}
```

**TTY safety.** On a live terminal `readFileSync(0)` blocks the calling thread synchronously until EOF (Ctrl-D on Unix). Since this is the main thread of a CLI tool — not a worker — it freezes the entire process with no way for the user to interrupt cleanly. The guard `if (process.stdin.isTTY) return ''` is still required, but a mistake there is more catastrophic than with the async approach.

**Encoding.** Passing `'utf8'` returns a string directly. The FS layer handles multi-byte sequences.

**Error modes.** On Windows, when stdin is a pipe that is already closed, `readFileSync(0)` throws `Error: EOF` rather than returning an empty string — a documented Node bug.[^2] This makes the function less portable.

**Test ergonomics.** Same spawn-and-pipe pattern as approach 1. Synchronous reads work inside a spawned child with piped stdin.

**Dependencies.** None.

**Code size.** 1 line for the read, but the synchronous block on TTY is a correctness landmine. Blocks the event loop; incompatible with anything that needs to run before reading (e.g., an async `configLoader.load()`). This is an imperative-shell concern: the event loop must remain free until the read completes, which is not guaranteed if other async work is queued.

[^2]: https://github.com/nodejs/node/issues/35997 accessed 2026-04-20

---

## Approach 3 — `node:stream/consumers` (built-in, no npm)

```typescript
import { text } from 'node:stream/consumers'

async function readStdin(): Promise<string> {
  return text(process.stdin)
}
```

`node:stream/consumers` ships with Node >= 16 and is fully available in Node 22.[^3] `text()` consumes an entire readable stream and returns a UTF-8 decoded string. It is semantically identical to approach 1 but without the manual chunk-concat loop.

**TTY safety.** Same risk as approach 1 — `text(process.stdin)` awaits EOF. The guard `if (process.stdin.isTTY) return ''` is still required before calling it.

**Encoding.** Handled by the built-in; correctly decodes UTF-8 including multi-byte sequences.

**Error modes.** Clean EOF from closed pipe resolves normally. SIGPIPE closes the stream; `text()` rejects with a stream error. For a CLI that exits after reading this is acceptable — wrap in try/catch and treat as empty. Large payloads: identical back-pressure story to approach 1.

**Test ergonomics.** Identical spawn-and-pipe pattern.

**Dependencies.** None — this is a Node built-in.

**Code size.** ~1 line. Cleaner than approach 1. No manual Buffer concat.

[^3]: Verified locally: `node -e "import('node:stream/consumers').then(m => console.log(Object.keys(m)))"` on Node 22.22.0 outputs `['arrayBuffer', 'blob', 'buffer', 'default', 'json', 'text']` — accessed 2026-04-20

---

## Approach 4 — `get-stdin` (npm package)

Version 10.0.0 (released Feb 2026) is pure ESM and ships TypeScript definitions. It has built-in TTY detection: "in a TTY context the promise resolves with an empty string by default."[^4] Usage:

```typescript
import getStdin from 'get-stdin'
const payload = await getStdin()   // '' when TTY
```

**TTY safety.** Built-in — no guard required by the caller.

**Encoding.** Returns a UTF-8 string.

**Error modes.** Pipe close handled internally. Same story as approaches 1/3 for SIGPIPE.

**Test ergonomics.** Same spawn-and-pipe pattern.

**Dependencies.** Adds one new `dependency` entry to `package.json`. The library is ~50 lines of source and has no transitive deps, but it is an external dep for functionality that is expressible in ~4 lines of Node built-ins.

**Code size.** 1 import, 1 call — but the cost is a new dependency in a project with a stated minimal-dep posture.

[^4]: https://github.com/sindresorhus/get-stdin accessed 2026-04-20

---

## Cross-cutting concerns

### Empty-payload fallback: trimmed vs. raw

The spec requires treating whitespace-only stdin as "no pipe." Compare:

```typescript
// raw comparison — misses "\n", "\r\n", "   \n" from echo
if (payload === '') { ... }

// trimmed comparison — correct
if (payload.trim() === '') { ... }
```

Use `payload.trim() === ''`. A bare `echo ""` on Unix writes `"\n"` to the pipe (a single newline), which would appear as non-empty on a raw comparison. POSIX `printf` and Windows `echo` both pad output with at least a newline, so trimming is the only safe check.

### Windows CRLF

When stdin is a text pipe on Windows, Node does NOT automatically strip `\r` from CRLF line endings — that is a shell/terminal emulator convention. The issue body will contain `\r\n`. This is acceptable for markdown (rendered identically) but callers that do line-by-line parsing should normalise with `.replace(/\r\n/g, '\n')`. For a markdown issue body, no normalisation is needed.

### Closed pipe before process start (SIGPIPE / early writer exit)

All three async approaches (1, 3, 4) resolve or reject gracefully. Treat a rejection from `text()` as empty payload.

---

## Comparison table

| Criterion | Async iterator (1) | `readFileSync(0)` (2) | `stream/consumers` (3) | `get-stdin` (4) |
|---|---|---|---|---|
| TTY safety (built-in) | No — needs guard | No — needs guard | No — needs guard | Yes — built-in |
| TTY hang risk if guard omitted | High (blocks forever) | Catastrophic (sync freeze) | High (blocks forever) | None |
| Encoding correctness | Manual decode-after-concat | FS layer | Built-in | Built-in |
| Windows pipe EOF | OK | Throws `Error: EOF` | OK | OK |
| Blocks event loop | No | Yes | No | No |
| New npm dependency | No | No | No | Yes |
| Code size | ~6 lines | 1 line | ~1 line | 1 line |
| Test ergonomics | Standard spawn | Standard spawn | Standard spawn | Standard spawn |

---

## Recommendation

**Use `node:stream/consumers` `text()` (approach 3)** with an explicit `isTTY` guard, extracted into `src/cli/helpers.ts` as `readPipedStdin(): Promise<string>`.

**Rationale:**

1. It is the semantically clearest Node built-in for this job — no manual Buffer concat, no dependency.
2. It is non-blocking and fully async, consistent with the rest of the codebase (all I/O is async).
3. The isTTY guard is already the established pattern in `helpers.ts` (`askYesNo` line 260). Centralising the guard in a helper mirrors that precedent and eliminates the risk of a future caller forgetting it.
4. `readFileSync(0)` is eliminated by its synchronous event-loop block and Windows pipe-close bug. `get-stdin` is eliminated by the unnecessary npm dependency.
5. The helper is 4 lines and trivially testable via the spawn-and-pipe pattern that Vitest already uses elsewhere.

### Minimal diff to `src/cli/helpers.ts`

Add at the end of the file:

```typescript
/**
 * Read all piped stdin bytes and return a UTF-8 string.
 * Returns '' immediately when stdin is a TTY so the CLI never hangs.
 * Callers should treat `result.trim() === ''` as "no pipe input".
 */
export async function readPipedStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  const { text } = await import('node:stream/consumers')
  try {
    return await text(process.stdin)
  } catch {
    return ''
  }
}
```

### Minimal diff to `src/cli/commands/issue.ts`

In the `.action` handler, before the `if (!description)` guard:

```typescript
// Read piped stdin before any other work
const stdinPayload = await readPipedStdin()
const body = stdinPayload.trim() !== '' ? stdinPayload : description
```

Then replace the `issuesStore.create` call:

```typescript
// Before:
const slug = await ctx.issuesStore.create(description, description, options.severity as Severity)

// After:
const slug = await ctx.issuesStore.create(description, body, options.severity as Severity)
```

The `if (!description)` guard stays in place — a missing description is still an error even when stdin provides a body, because the title (positional arg) is always required.
