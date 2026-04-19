# Security Review: fix-metta-framework-parallelism-strengthen-skill-templates

## Verdict
PASS_WITH_WARNINGS

Critical count: 0
Warning count: 3
Suggestion count: 2

## Scope-checked

Files read and audited:
- `/home/utx0/Code/metta/src/cli/commands/tasks.ts`
- `/home/utx0/Code/metta/src/planning/tasks-md-parser.ts`
- `/home/utx0/Code/metta/src/planning/parallel-wave-computer.ts` (pulled in as a dependency of `tasks.ts`)
- `/home/utx0/Code/metta/src/cli/commands/tasks-renderer.ts` (pulled in as a dependency of `tasks.ts`)
- `/home/utx0/Code/metta/src/cli/helpers.ts` (for `createCliContext` / `outputJson`)
- `/home/utx0/Code/metta/tests/cli-tasks-plan.test.ts` (integration-test safety review)

Focus areas covered: path-traversal via `--change`; remark parser DoS / malformed-input behavior; `--json` error-envelope leakage; `execFile` usage in integration tests.

## Findings

### Critical (must fix)

None.

### Warnings (should fix)

- `src/cli/commands/tasks.ts:36-42` — **Unconstrained path construction from `--change`.** `options.change` is pasted directly into `join(ctx.projectRoot, 'spec', 'changes', options.change, 'tasks.md')` with no validation. `path.join` happily normalizes `..` segments, so `--change ../../../etc` resolves to `/etc/tasks.md` (or any sibling directory of `spec/changes`). Because the command only performs a read and returns the path in error messages, the blast radius is limited to read-side information disclosure (see next item) and parse attempts on attacker-chosen files — but it is still a straightforward path-traversal primitive that should be closed. Recommend rejecting change names that contain path separators, `..`, or leading `.`/`/`, e.g. validate against `^[a-z0-9][a-z0-9._-]*$` (matches the slug convention produced by `slugify`) before building the path, and/or confirm the resolved path is still rooted under `${projectRoot}/spec/changes` via `path.resolve` + `startsWith`.

- `src/cli/commands/tasks.ts:49,52` — **Absolute filesystem path leaked in the error envelope and on stderr.** When `readFile` fails the message is `` `tasks.md not found: ${tasksMdPath}` `` where `tasksMdPath` is the full absolute path. In local CLI use this is fine, but the `--json` envelope is designed to be consumed by other tools/CI, and echoing absolute home-directory paths (`/home/<user>/...`) leaks usernames and project layout. The leak is worse when combined with the traversal warning above, because an attacker can confirm existence of arbitrary files by probing error text. Recommend reporting only the project-relative path (e.g. `spec/changes/<change>/tasks.md`) in both human and JSON outputs; keep the absolute path for debug logs only.

- `src/cli/commands/tasks.ts:51-52, 59-60, 67-69` — **Underlying error messages are forwarded verbatim into the JSON envelope.** `err.message` from `fs.readFile`, `remark-parse`, and `computeWaves` is passed straight through to `outputJson`. For `readFile` this can include OS-level strings such as `EACCES: permission denied, open '/etc/shadow'` which a caller shouldn't need to see; for parser errors it may leak stack-frame-ish details depending on remark's wording. Prefer a small sanitizer that maps known `NodeJS.ErrnoException` codes (`ENOENT`, `EACCES`, `EISDIR`, `ENOTDIR`) to fixed messages and only forwards `err.message` for the catch-all case, or strips any absolute path tokens before emission.

### Suggestions (nice to have)

- `src/planning/tasks-md-parser.ts:269-324` — **No explicit input-size bound before remark-parse.** `remark-parse` builds a full mdast for the whole document, which is O(n) in memory but can be abused by an attacker who can drop a multi-megabyte `tasks.md` into a change directory (e.g. via a malicious PR). The current inputs are trusted (project-local markdown), so impact is low, but a defensive `if (markdown.length > MAX_BYTES) throw` at the top of `parseTasksMd` (e.g. 1 MiB cap) would prevent accidental DoS and match the soft-parse posture already advertised in the header comment. Also note that the parser walks only top-level `children`, so the classic "deep nesting" attack against unified parsers does not apply here — `parseTaskItem` recurses at most two levels.

- `tests/cli-tasks-plan.test.ts:25-41, 58-66` — **`execFile` usage in the integration harness is safe.** Arguments are passed as an array (no shell), `cwd` is a freshly created `mkdtemp` directory, `timeout: 15000` bounds each invocation, `env` is an explicit spread with `NO_COLOR`, and the one-shot `npm run build` is guarded by `existsSync(CLI_PATH)`. No shell-metacharacter or command-injection risk. Minor suggestion: pin `shell: false` explicitly and consider `maxBuffer` (default 1 MiB is fine but worth being explicit) so the harness cannot silently truncate a regression-diagnostic `stdout` payload.

## Area-by-area assessment

1. **Path traversal via `--change`** — Exploitable but low impact as described in Warning #1. No sanitization, no allowlist, no post-resolve containment check. Fix recommended.
2. **Remark parser DoS / malformed markdown** — Parser is defensive (soft-parse, `return null` on shape mismatches, no unbounded recursion beyond two levels). Regexes in `parseBatchHeading`, `parseTaskHeading`, `parseDependsOn`, and `splitLeadingBold` are all linear (no catastrophic backtracking — the `.+` inside `\((.+)\)` is anchored and non-nested, `matchAll` on `Task\s+(\d+\.\d+)` is linear). No stack-overflow surface observed. Only gap is the lack of an explicit input-size cap (Suggestion #1).
3. **`--json` error envelope** — Shape `{ error: { code, type, message } }` is well-structured and non-leaky by design, but the concrete `message` values currently echo absolute paths and raw `err.message` strings (Warnings #2 and #3).
4. **`execFile` usage in integration tests** — Safe. Array-form args, fixed timeouts, sandboxed cwd, no shell expansion. Non-production code regardless.
