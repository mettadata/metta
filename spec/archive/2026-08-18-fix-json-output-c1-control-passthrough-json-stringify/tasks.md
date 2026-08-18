# Tasks — fix-json-output-c1-control-passthrough-json-stringify

Two sequential batches. Batch 2 depends on Batch 1 (the helper module must exist before the edges can import it).

Notation: "backslash-u009b" below means the six-character JSON escape sequence — a literal backslash, `u`, then four lowercase hex digits (`\` + `u009b`).

## Batch 1

### Task 1.1: Create the pure escape helper and its unit test

**Files:**
- `src/util/escape-json-controls.ts` (new)
- `tests/escape-json-controls.test.ts` (new)

**Action:**
Create `src/util/escape-json-controls.ts` exporting a single pure function:

```ts
export function escapeJsonControls(jsonText: string): string
```

Per design ADR-1/ADR-2:
- Single global regex replace over `[\x7f-\x9f]` (no `u` flag — must match lone C1 code units, mirroring the `src/util/sanitize-text.ts` precedent), replacing each matched code unit with a literal backslash + `u` + 4-digit **lowercase** hex of `charCodeAt(0)` (e.g. U+009B becomes backslash-u009b).
- Pure, total, idempotent. Empty string returns empty string. All code units at or below U+007E and at or above U+00A0 (including multi-byte UTF-8, U+2028/U+2029) pass through untouched.
- Sibling of `sanitize-text.ts` in placement, doc-comment style, and export discipline. **No barrel change** — do not touch the root `index.ts` (sanitize-text precedent).
- No string-literal templates; kebab-case filename; `.js` extensions on any import paths.

Create `tests/escape-json-controls.test.ts` (Vitest, mirroring `tests/sanitize-text.test.ts` conventions) covering:
- **Range boundaries:** U+007E passes through unchanged; U+007F becomes backslash-u007f; U+009F becomes backslash-u009f; U+00A0 passes through unchanged; U+009B (single-byte CSI) becomes backslash-u009b.
- **Non-targets intact:** ordinary ASCII, multi-byte UTF-8 (emoji, CJK), pre-existing backslash-uXXXX escape text, structural JSON characters.
- **Idempotence:** `escapeJsonControls(escapeJsonControls(s)) === escapeJsonControls(s)` on a hostile mixed input.
- **Empty string:** returned unchanged.
- **Structure safety:** applying the helper to `JSON.stringify(v, null, 2)` output for an object with C1-laced string values (and keys) yields text that `JSON.parse`s to values deep-equal/byte-identical to the originals.
- **Large payload smoke:** ~100–200KB JSON text laced with the full U+007F–U+009F range escapes correctly (output matches `/[\x7f-\x9f]/` nowhere) and round-trips through `JSON.parse` to the original values.

**Verify:**
```bash
npx vitest run tests/escape-json-controls.test.ts
npx tsc --noEmit
```

**Done:**
- `escapeJsonControls` exists, is pure, escapes exactly U+007F–U+009F as lowercase six-char backslash-u00xx sequences, and leaves everything else intact.
- All new unit tests pass; typecheck clean; root `index.ts` unmodified.

## Batch 2

### Task 2.1: Apply the helper at the three stdout JSON edges + CLI round-trip test

Depends on: Task 1.1 (`src/util/escape-json-controls.ts` must exist).

**Files:**
- `src/cli/helpers.ts`
- `src/cli/commands/config.ts`
- `src/cli/commands/tasks-renderer.ts`
- `tests/cli-issue-backlog.test.ts`

**Action:**
Wire exactly the three audited stdout edges through the helper (import with `.js` extension, relative path from each file):

1. `src/cli/helpers.ts` — `outputJson` (~line 234): change the emit to `console.log(escapeJsonControls(JSON.stringify(data, null, 2)))`. This covers all `--json` command output and both `handleError` JSON error-envelope branches (they already route through `outputJson` — no separate wiring).
2. `src/cli/commands/config.ts:58` — `config get`: wrap **only** the `typeof value === 'object'` branch's `JSON.stringify(value, null, 2)` in `escapeJsonControls(...)`. Do NOT touch the scalar `String(value ?? 'undefined')` branch (ADR-4 — it emits plain text, not JSON).
3. `src/cli/commands/tasks-renderer.ts:82` — `renderJsonPlan`: `return escapeJsonControls(JSON.stringify(plan, null, 2))`.

Do NOT apply the helper to any other `JSON.stringify` site (file writes such as `install.ts` settings, hashing inputs, hook logs, YAML state writes — non-edges per the 29-site audit in research-edge-inventory).

Add one new `it` to the render-edge suite in `tests/cli-issue-backlog.test.ts` with a **fresh hostile fixture** (do not mutate the existing `HOSTILE_ISSUE` — other suites depend on it): seed an issue whose title contains raw U+009B and U+007F, run `metta --json issues show <slug>` via the suite's existing CLI harness, then assert:
- (a) stdout matches `/[\x7f-\x9f]/` nowhere, and the U+009B code point appears in the raw stdout text as the six-character backslash-u009b escape;
- (b) `JSON.parse(stdout)` yields the exact stored title, byte-identical;
- (c) the stored issue file on disk is byte-identical after emission.

Do not modify any existing test or assertion in the four byte-faithful suites.

**Verify:**
```bash
npx vitest run tests/cli-issue-backlog.test.ts
npx vitest run tests/cli-gaps.test.ts tests/cli-roadmap.test.ts tests/cli-status.test.ts
npx vitest run
npx tsc --noEmit
```

**Done:**
- All three edges (and only those three) route through `escapeJsonControls`; `config get` scalar branch untouched.
- New round-trip `it` passes; the four existing byte-faithful suites (`tests/cli-issue-backlog.test.ts`, `tests/cli-gaps.test.ts`, `tests/cli-roadmap.test.ts`, `tests/cli-status.test.ts`) pass with zero modification; full suite green; typecheck clean.
- No `.metta/` or `spec/` stored data is written or mutated by the change.
