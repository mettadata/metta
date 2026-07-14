# Verification: fix-metta-complete-prints-non-json-output-block-twice

Verified 2026-07-14 on branch `metta/fix-metta-complete-prints-non-json-output-block-twice` against a fresh `npm run build`. All fixes were live-exercised through the built CLI (`dist/cli/index.js`) in a throwaway scaffolded project (`metta install --git-init` + `metta propose`), not just via unit tests.

## Fix 1 — Completion banner printed once per mode

Evidence: `src/cli/commands/complete.ts:526-533` (pending-artifacts branch) and `src/cli/commands/complete.ts:551-555` (all-complete branch) — stderr banner writes are now inside `if (json)`.

Live behavior observed (`metta complete intent --change <name>`, stdout/stderr captured separately):

- **Non-JSON, pending artifacts**: stdout contains exactly one banner block (`[METTA-PROPOSER] intent complete`, `Next: ...`, `Run: ...`); stderr is empty. Combined occurrence count of the banner line: **1** (was 2 before the fix).
- **JSON, pending artifacts (`--json`)**: stdout is pure JSON (validated with `JSON.parse`); the banner and `Next:` line appear on stderr only, once.
- **Non-JSON, all-complete**: stdout prints only `Next: metta finalize --change <name>`; no banner on either stream. This matches the intent verbatim — "the non-JSON branch's existing console.log output (... or the finalize hint) remains the single human-facing copy" — the all-complete non-JSON branch never had a stdout banner, so gating the stderr copy leaves the finalize hint alone. Conforms to spec; noted for awareness since the "All artifacts complete!" line is now JSON-mode-only.
- **JSON, all-complete**: stdout is pure JSON with `"all_complete": true`; `verification complete` banner + `All artifacts complete!` on stderr only.

Result: **PASS**

## Fix 2 — Stories parser accepts `**As an**`

Evidence: `src/specs/stories-parser.ts:47-50` — `FIELD_PREFIXES` gains `{ prefix: '**As an**', key: 'asA' }` ordered before `'**As a**'` so the longer literal wins.

- Unit tests: `npx vitest run tests/stories-parser.test.ts` → 10/10 passed, including the two new tests at `tests/stories-parser.test.ts:182` (`**As an** engineer` binds to `asA`) and `tests/stories-parser.test.ts:210` (both article forms in one document; `**As a** developer` regression-checked alongside `**As an** AI orchestrator`).
- Live check against the built parser: `parseStories` on a fixture containing `**As an** AI orchestrator` returned `kind: stories` with `asA: "AI orchestrator"` — no missing-field error.

Result: **PASS**

## Fix 3 — Version read from package.json (update --check and CLI root)

Evidence: `src/cli/helpers.ts:382-390` (`getPackageVersion()` reads `../../package.json` relative to the module, valid for both `src/cli/` and `dist/cli/` layouts), `src/cli/commands/update.ts:20` (`const current = await getPackageVersion()`), `src/cli/index.ts:50` (`.version(await getPackageVersion())`).

Live behavior (package.json declares `"version": "0.1.0"`):

- `node dist/cli/index.js --version` → `0.1.0`
- `node dist/cli/index.js update --check` → `Current: 0.1.0` (exit 0)
- `node dist/cli/index.js update --check --json` → `{"current": "0.1.0", "latest": "unknown", ...}`

`grep -rn "0\.1\.0" src/` residual hits:

- `src/cli/commands/doctor.ts:96` — `checks.push({ check: 'Framework version', status: 'pass', detail: '0.1.0' })`. This IS a hardcoded version usage, but it is not one of the three bugs scoped by the intent (which names only `update.ts`'s `current`; the CLI-root `.version()` was fixed as a natural companion). Per the intent's Out of Scope clause ("new findings get logged as separate issues"), this should be logged as a follow-up issue rather than folded in here. It does not fail this change.

Result: **PASS** (with follow-up issue recommended for doctor.ts:96)

## Gates

| Gate | Command | Result |
|------|---------|--------|
| Tests | `npx vitest run` | PASS — 80 files, 1044 tests, 0 failures |
| Typecheck | `npx tsc --noEmit` | PASS |
| Lint | `npm run lint` (aliases tsc --noEmit) | PASS |
| Build | `npm run build` | PASS |

## Verdict

**PASS.** All three intended fixes (plus the companion CLI-root version fix) behave as specified when exercised live through the built CLI. One residual hardcoded version string remains at `src/cli/commands/doctor.ts:96`, outside this change's scope — recommend logging it as a separate issue.
