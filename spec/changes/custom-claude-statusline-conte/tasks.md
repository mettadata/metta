# Tasks: custom-claude-statusline-conte

## Batch 1: Independent foundations (all touch different files — safe to run in parallel)

### Task 1.1: Create statusline.mjs template script
- **Files:** `src/templates/statusline/statusline.mjs`
- **Action:** Create the directory `src/templates/statusline/` and write the new ESM script with a `#!/usr/bin/env node` shebang. Export all six named helpers: `resolveContextWindow`, `readTranscriptTail`, `findLatestAssistantUsage`, `computePercent`, `pickColorForSlug`, and `formatStatusLine`. Implement `readStdin` (tolerates empty/malformed), the `main` async function per the design pseudocode, and the top-level `main().catch(...)` error boundary that writes `[metta: unknown]\n` and exits 0. Use `execFile` + `promisify` to shell out to `metta status --json` with a 5 000 ms timeout. Color palette: `[31, 32, 33, 34, 35, 36, 91, 92]` (8 entries). Hash function: sum of `charCodeAt(i)` for all characters in the slug, modulo 8. Context window: `1_000_000` when `stdinObj.model?.id` contains `[1m]` substring, else `200_000`. Transcript tail: open file with `fs.open`, stat for size, read last `min(65_536, size)` bytes, drop first partial line when offset > 0, split on `\n`, filter empty. `findLatestAssistantUsage`: reverse-scan parsed lines for `record.message.role === 'assistant'` and `typeof record.message.usage.input_tokens === 'number'`. `formatStatusLine`: apply ANSI wrapping only when `slug` is non-null and `artifact` is neither `'idle'` nor `'unknown'`; append ` ${ctxPct}%` only when `ctxPct !== null`. Always exit 0.
- **Verify:** `node src/templates/statusline/statusline.mjs < /dev/null` exits 0 and prints exactly one line matching `/^\[metta: (idle|unknown)\]\n$/`.
- **Done:** File `src/templates/statusline/statusline.mjs` exists, is non-empty, exports the six named helpers, and `node src/templates/statusline/statusline.mjs < /dev/null` exits with code 0.

### Task 1.2: Update package.json copy-templates script
- **Files:** `package.json`
- **Action:** Append `&& cp -r src/templates/statusline dist/templates/statusline` to the end of the `copy-templates` script value. Also update the leading `rm -rf` segment to include `dist/templates/statusline` so stale builds are cleaned. No other changes to `package.json`.
- **Verify:** `cat package.json | grep copy-templates` shows the updated script ending with `cp -r src/templates/statusline dist/templates/statusline`. Confirm the `rm -rf` segment at the start of `copy-templates` also lists `dist/templates/statusline`.
- **Done:** `package.json` `copy-templates` value ends with `&& cp -r src/templates/statusline dist/templates/statusline` and the `rm -rf` prefix includes `dist/templates/statusline`.

### Task 1.3: Add installMettaStatusline helper to install.ts
- **Files:** `src/cli/commands/install.ts`
- **Action:** Add the `installMettaStatusline(root: string): Promise<void>` function immediately after the closing brace of `installMettaGuardHook` (around line 53). The function must: resolve `templateScript` via `new URL('../../templates/statusline/statusline.mjs', import.meta.url).pathname`; `mkdir` the statusline dir recursively; `copyFile` then `chmod 0o755`; read and JSON-parse existing `settings.json` (throw with a message containing "not valid JSON" on parse failure); check `settings.statusLine` — if absent write `{ type: 'command', command: '.claude/statusline/statusline.mjs', padding: 0 }`; if `statusLine.command` equals `'.claude/statusline/statusline.mjs'` return (no-op); otherwise `process.stderr.write` a warning containing `statusLine` and the existing command value and return. After `installMettaGuardHook` call block (lines 169–175), add a parallel `statuslineInstalled` block: `let statuslineInstalled = false; try { await installMettaStatusline(root); statuslineInstalled = true } catch (err) { console.error(\`Warning: failed to install statusline — ${message}\`) }`. Add `statusline_installed: statuslineInstalled` to the JSON output object. Add `if (statuslineInstalled) console.log('  Installed: statusline (.claude/statusline/statusline.mjs)')` to the human output block after the `guardInstalled` conditional.
- **Verify:** `npx tsc --noEmit` reports zero errors. `grep -n installMettaStatusline src/cli/commands/install.ts` shows both the function definition and the call site. `grep statusline_installed src/cli/commands/install.ts` confirms the JSON output field exists.
- **Done:** `src/cli/commands/install.ts` compiles cleanly (`tsc --noEmit` exits 0) and contains both the `installMettaStatusline` function and its call site with `statuslineInstalled` boolean tracked.

---

## Batch 2: Unit tests (all touch different files — safe to run in parallel; depend on Batch 1)

### Task 2.1: Create resolve-context-window.test.ts
- **Files:** `test/templates/statusline/resolve-context-window.test.ts`
- **Action:** Create the directory `test/templates/statusline/` and write a Vitest test file that imports `resolveContextWindow` from `../../../src/templates/statusline/statusline.mjs`. Cover all six cases from the design test plan: model.id contains `[1m]` → `1_000_000`; `[1m]` as substring with suffix → `1_000_000`; model.id present but no `[1m]` → `200_000`; model absent → `200_000`; model is a string (not object, so `model?.id` is undefined) → `200_000`; model.id is not a string (e.g. number 42) → `200_000`.
- **Verify:** `npx vitest run test/templates/statusline/resolve-context-window.test.ts` exits 0 with 6 tests passing and 0 failures.
- **Done:** File `test/templates/statusline/resolve-context-window.test.ts` exists and `vitest run` on it reports 6 passed, 0 failed.

### Task 2.2: Create read-transcript-tail.test.ts
- **Files:** `test/templates/statusline/read-transcript-tail.test.ts`
- **Action:** Write a Vitest test file importing `readTranscriptTail` and `findLatestAssistantUsage` from `../../../src/templates/statusline/statusline.mjs`. Use `os.tmpdir()` + `crypto.randomUUID()` for temp file paths; clean up in `afterEach`. For `readTranscriptTail`: (1) file smaller than tail size — write 3 JSONL lines, assert all 3 returned; (2) file larger than 65 536 bytes — write enough padding so last few lines are beyond offset, assert first element of result is a complete JSON line not a fragment; (3) non-existent path returns `[]`; (4) empty file returns `[]`; (5) offset > 0 drops partial first line — write a 70 000-byte file, assert result[0] is parseable JSON. For `findLatestAssistantUsage`: (1) valid last assistant record returns its `input_tokens`; (2) two assistant records — returns tokens from the later one; (3) only user-role records → `null`; (4) assistant with no usage block → `null`; (5) `input_tokens` is string "100000" (not number) → `null`; (6) one malformed line + one valid assistant line → returns tokens from valid; (7) empty array → `null`.
- **Verify:** `npx vitest run test/templates/statusline/read-transcript-tail.test.ts` exits 0 with 12 tests passing and 0 failures.
- **Done:** File exists and vitest reports 12 passed, 0 failed.

### Task 2.3: Create compute-percent.test.ts
- **Files:** `test/templates/statusline/compute-percent.test.ts`
- **Action:** Write a Vitest test file importing `computePercent` from `../../../src/templates/statusline/statusline.mjs`. Cover all six cases from the design: `(100_000, 200_000)` → `50`; `(100_001, 200_000)` → `50` (rounds to nearest); `(430_000, 1_000_000)` → `43`; `(0, 200_000)` → `0`; `(200_000, 200_000)` → `100`; `(210_000, 200_000)` → `105` (no clamping).
- **Verify:** `npx vitest run test/templates/statusline/compute-percent.test.ts` exits 0 with 6 tests passing and 0 failures.
- **Done:** File exists and vitest reports 6 passed, 0 failed.

### Task 2.4: Create format-status-line.test.ts
- **Files:** `test/templates/statusline/format-status-line.test.ts`
- **Action:** Write a Vitest test file importing `formatStatusLine` and `pickColorForSlug` from `../../../src/templates/statusline/statusline.mjs`. For `pickColorForSlug`: (1) same slug yields same code on two calls; (2) any slug input yields a code in `{31,32,33,34,35,36,91,92}`; (3) empty string does not throw and returns a code. For `formatStatusLine`: (1) active artifact + slug + ctxPct — result contains `] 43%` and includes `\x1b[`; (2) idle + no slug + no pct — exactly `[metta: idle]` with no `\x1b` and no `%`; (3) active artifact + slug + no pct — contains ANSI open and `\x1b[0m` reset, no trailing space or `%`; (4) unknown artifact is not colored even with a slug — result is `[metta: unknown]` with no `\x1b`; (5) ANSI reset `\x1b[0m` appears immediately after the artifact text in any active non-idle result; (6) ctxPct of 0 is included — result ends with `] 0%`.
- **Verify:** `npx vitest run test/templates/statusline/format-status-line.test.ts` exits 0 with 9 tests passing and 0 failures.
- **Done:** File exists and vitest reports 9 passed, 0 failed.

### Task 2.5: Create install-statusline.test.ts
- **Files:** `test/cli/commands/install-statusline.test.ts`
- **Action:** Write a Vitest test file importing `installMettaStatusline` from `../../../src/cli/commands/install.js`. Use `fs.mkdtemp(join(os.tmpdir(), 'metta-test-'))` to create an isolated temp directory as `root` for each test; clean up in `afterEach` with `fs.rm(root, { recursive: true, force: true })`. Create the `.claude/` directory inside `root` before each test. Because `installMettaStatusline` resolves the template via `import.meta.url`, ensure `dist/templates/statusline/statusline.mjs` exists before running (tests should be run after `npm run build` or the test can stub `copyFile`). Cover: (1) fresh install with no `settings.json` — script copied, mode has `0o111` bits set, `settings.json` created containing `statusLine.command === '.claude/statusline/statusline.mjs'`; (2) fresh install with existing `settings.json` lacking `statusLine` — existing keys (e.g. `mcpServers`) preserved, `statusLine` added; (3) re-run is a no-op — call twice, assert file mtime unchanged on second call (use `stat` before and after second call); (4) foreign `statusLine` command preserved — write `settings.json` with `statusLine: { command: '/usr/local/bin/custom.sh' }`, call helper, assert value unchanged and `process.stderr.write` was called (spy); (5) unparseable `settings.json` throws an `Error` with message containing "not valid JSON"; (6) installed file has executable bits — `(stat.mode & 0o111) !== 0`.
- **Verify:** `npx vitest run test/cli/commands/install-statusline.test.ts` exits 0 with 6 tests passing and 0 failures.
- **Done:** File exists and vitest reports 6 passed, 0 failed.

---

## Batch 3: Integration verification (sequential — each step depends on the previous)

### Task 3.1: Build and confirm dist artifact
- **Files:** `dist/templates/statusline/statusline.mjs` (produced by build; do not create manually)
- **Action:** Run `npm run build` from the project root. Confirm the build exits 0, that `dist/templates/statusline/statusline.mjs` was created by the `copy-templates` step, and that the file is non-empty.
- **Verify:** `npm run build && ls -la dist/templates/statusline/statusline.mjs` exits 0 and shows a file with size > 0.
- **Done:** `dist/templates/statusline/statusline.mjs` exists with size > 0 after `npm run build` exits 0.

### Task 3.2: TypeScript type check
- **Files:** No source changes — verification only.
- **Action:** Run `npx tsc --noEmit` from the project root.
- **Verify:** `npx tsc --noEmit` exits 0 with no output (zero type errors).
- **Done:** `tsc --noEmit` exits with code 0.

### Task 3.3: Full test suite passes
- **Files:** No source changes — verification only.
- **Action:** Run `npm test` from the project root.
- **Verify:** `npm test` exits 0 with all new and pre-existing tests passing and 0 failures reported.
- **Done:** `npm test` exits 0 and the vitest summary shows 0 failed test suites and 0 failed tests.
