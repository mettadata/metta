# Shared control-character sanitizer util consolidation with guard-bash residuals (heredoc hex/base terminators, C1 in audit JSONL)

**Captured**: 2026-08-18
**Status**: logged
**Severity**: minor

## Symptom
PR #97 review flagged that control-character sanitization logic now exists in three independent copies: `src/util/sanitize-text.ts` (render-edge `stripControlSequences` plus the newline-preserving `stripControlSequencesMultiline`, from PR #88), `src/util/escapeJsonControls` at the JSON emission edge (PR #91), and ad-hoc character-strip logic inside the guard-bash hook's parsing/audit path. Because the copies evolved separately, new call sites can import a stale or wrong variant, and the guard-bash hook carries two known residuals: heredoc terminators written in hex/ANSI-C escape forms are not recognized by the write-target scanner, and C1 control code units pass unescaped into the audit JSONL log lines.

## Root Cause Analysis
The sanitizers were added incrementally at different edges by different PRs, and each edge has a genuinely different contract — render-edge strip (drop everything), multiline strip (preserve LF), JSON-edge escape (preserve value, rewrite code units) — so no one consolidated them into a single module with the three variants documented side by side. The guard-bash hook compounds this because it is a standalone `.mjs` file under `.claude/hooks/` that cannot import the TypeScript utils, so it grew its own ad-hoc `replace()`-based stripping (`stripQuoteChars`, backslash removal for heredoc terminators) that is weaker than the shared utils: terminator comparison only strips quote characters and backslashes, so a terminator spelled in hex/ANSI-C form (e.g. `$'\x45\x4f\x46'`) never matches its literal body occurrence, and the audit logger serializes entries with bare `JSON.stringify`, which escapes C0 but passes DEL/C1 (U+007F–U+009F, including raw 8-bit CSI `\x9b`) into the JSONL byte stream verbatim — exactly the gap `escapeJsonControls` was written to close, but the hook does not use it.

### Evidence
- `src/util/sanitize-text.ts:41` — `stripControlSequences` / `stripControlSequencesMultiline` are one of the three parallel sanitizer implementations, with its own C0/C1 regex.
- `src/util/escape-json-controls.ts:26` — `escapeJsonControls` duplicates the C1/DEL range knowledge at the JSON edge and is not consumed by the guard-bash audit logger.
- `.claude/hooks/metta-guard-bash.mjs:776` — `appendFileSync(logPath, JSON.stringify(entry) + '\n')` emits audit JSONL without any C1/DEL escape; the heredoc terminator normalization at line 354 (`stripQuoteChars(word).replace(/\\/g, '')`) does not decode hex/ANSI-C escape forms.

## Candidate Solutions
1. **Single shared util module, hook imports from dist** — Consolidate the three variants into one `src/util/sanitize.ts` (render-edge strip, newline-preserving strip, JSON-edge escape) with the shared control-range constants defined once; have `metta-guard-bash.mjs` import the compiled copy from `dist/` and fix both residuals (route audit lines through the JSON-edge escape, add hex/ANSI-C terminator decoding) while touching it. Tradeoff: the hook gains a build-freshness dependency on `dist/` — the known stale-dist-in-hooks issue means a stale checkout could run an old sanitizer or fail to resolve the import.
2. **Shared plain `.mjs` sanitizer that both sides consume** — Put the canonical implementation in a dependency-free `.mjs` module the hook can import directly, and have the TypeScript utils re-export/wrap it so `src/` call sites keep typed imports. Tradeoff: the canonical sanitizer source lives outside `src/`, weakening the project's TS-strict/Zod/test conventions and making the 1:1 test-to-source ratio awkward for that file.
3. **Keep copies, add a drift-detection parity test** — Leave the three implementations in place but add a Vitest suite that runs a shared adversarial corpus (ANSI/OSC/DCS, C1, hex/ANSI-C heredoc forms) through all copies and asserts equivalent behavior, fixing the two guard-bash residuals directly in the hook. Tradeoff: duplication persists and every future variant change must be made in multiple places; the test only catches drift the corpus happens to exercise.

