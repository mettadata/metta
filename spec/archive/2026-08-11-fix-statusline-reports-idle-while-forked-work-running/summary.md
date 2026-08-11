# Verification: fix-statusline-reports-idle-while-forked-work-running

## Spec Scenarios

Requirement: Context window resolution
- [x] Payload declares the window size — tests/statusline-resolve-context-window.test.ts ("prefers context_window.context_window_size from the stdin payload")
- [x] 1M-family model id resolves to 1M without payload window — ("returns 1_000_000 for current 1M-window model families by prefix")
- [x] Haiku model id resolves to 200k — ("returns 200_000 for haiku model ids")
- [x] Model id contains [1m] substring — ("returns 1_000_000 when model.id contains [1m]")
- [x] Unrecognized model id falls back to 200k — ("returns 200_000 for unrecognized model ids")
- [x] Model field absent / wrong type — three existing scenarios retained and passing

Requirement: Context utilization calculation
- [x] Harness-computed percentage preferred — resolveUsedPercent tests (58.6 -> 59, 0, absent -> null, invalid -> null)
- [x] Percentage above 100 renders the overflow marker — formatPercent tests (101/297 -> ">100%!") and formatStatusLine test ("[metta: idle] >100%!")
- [x] Transcript fallback with summed cache tokens — tests/statusline-transcript-parser.test.ts (14 tests) + computePercent tests

Requirement: Metta artifact resolution
- [x] Single-change shape — tests/statusline-activity.test.ts ("parses the single-change shape")
- [x] Aggregated changes array yields the active change — ("picks the first active change from the multi-change shape")
- [x] Worktree-hosted change detected when root shows none — findWorktreeActivity tests (active found, non-active skipped, unreadable entries skipped)
- [x] No active change and no worktrees -> idle — ("returns null when no worktrees directory exists"; main() defaults to idle)

Requirement: Output format
- [x] Overflow marker permitted in place of <pct>% — formatStatusLine overflow test

## Gate Results

- tests: PASS — 117 files, 2078 tests (full npm test)
- typecheck: PASS — npx tsc --noEmit clean
- lint: PASS — npm run lint clean
- build: PASS — npm run build clean; template copy includes dist/templates/statusline/
- copy parity: PASS — cmp of src/templates/statusline/statusline.mjs and .claude/statusline/statusline.mjs byte-identical, both mode 755

## Live smoke test

Ran from the main checkout root (/home/utx0/Code/metta) while this change was active in its worktree, with stdin
{"model":{"id":"claude-fable-5"},"context_window":{"used_percentage":58.6,"context_window_size":1000000}}:

    [metta:quick:implementation] 59%

Previously the identical situation rendered "[metta: idle] 297%" — both defects (idle-while-forked-work and >100% context) are gone.

## Summary

Fixed three statusline defects in src/templates/statusline/statusline.mjs and its byte-identical installed copy .claude/statusline/statusline.mjs:

1. Context window resolution now prefers context_window.context_window_size from the Claude Code statusline stdin payload (documented at https://code.claude.com/docs/en/statusline), with a prefix-based model-id fallback table (current 1M families; haiku 200k; default 200k) replacing [1m] substring sniffing.
2. Utilization prefers the harness-computed context_window.used_percentage (accurate after compaction) over transcript arithmetic; values above 100% render as a clamped ">100%!" overflow marker.
3. Activity resolution understands all metta status --json shapes (single-change, zero-change, aggregated changes array) and falls back to scanning .metta/worktrees/<slug>/spec/changes/<slug>/.metta.yaml, so fork/worktree-hosted work no longer renders as idle.

Spec spec/specs/claude-statusline/spec.md updated (both duplicated requirement copies kept in sync). Tests: 1 new file (statusline-activity.test.ts, 13 tests) plus rewritten window-resolution and extended percent/format tests.
