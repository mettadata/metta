# Implementation Summary — fix-json-output-c1-control-passthrough-json-stringify

## What changed

CLI stdout JSON now escapes DEL/C1 controls (U+007F-U+009F) as six-character JSON escapes (backslash-u00xx, lowercase) at the emission edge; stored data is never mutated and parsed-value fidelity is preserved (JSON.parse yields byte-identical strings).

- Commit 99d49ac — feat(util): add escapeJsonControls C1/DEL JSON-edge escape helper: new pure escapeJsonControls(jsonText) in src/util/escape-json-controls.ts (global [x7f-x9f] replace with lowercase four-hex escapes; idempotent; no barrel change) + tests/escape-json-controls.test.ts (15 tests: range boundaries U+007E/U+007F/U+009F/U+00A0, non-targets, idempotence, empty, structure safety incl. keys, ~135KB payload smoke).
- Commit ac67dd902 — fix(cli): escape DEL/C1 controls at stdout JSON emission edges: wired at exactly the three audited edges — outputJson in src/cli/helpers.ts (covers all --json output and handleError envelopes), config get object branch in src/cli/commands/config.ts (scalar branch untouched per ADR-4), renderJsonPlan in src/cli/commands/tasks-renderer.ts — plus one new render-edge CLI test with a fresh hostile-c1 fixture (raw U+009B/U+007F title appears as the backslash-u009b escape in stdout, JSON.parse round-trip byte-identical, disk file byte-identical). No other JSON.stringify site touched (file writes/hashing/hook logs are non-edges per the 29-site research audit).

## Gate results (implementation phase)

| Gate | Result |
|------|--------|
| tests/escape-json-controls.test.ts | 15/15 pass |
| tests/cli-issue-backlog.test.ts | 59/59 pass |
| Byte-faithful suites (cli-gaps, cli-roadmap, cli-status) unmodified | 66/66 pass |
| Full suite (npx vitest run) | 2421/2421 pass, 129 files |
| npx tsc --noEmit | clean |
