# Verification: fix-metta-check-constitution-requires-direct-anthropic-api

Verified 2026-07-16 against `spec/changes/fix-metta-check-constitution-requires-direct-anthropic-api/spec.md` (7 requirements, `constitution-check` capability). All live CLI checks ran against the freshly built `dist/cli/index.js` from a temp fixture project (copy of `spec/project.md` + a `testfix` change with a `spec.md`), every invocation under `env -u ANTHROPIC_API_KEY`.

## Overall verdict: PASS

All 7 requirements verified with live evidence. All gates green (1050/1050 tests, tsc clean, build clean).

## Per-requirement verdicts

### R1: Contract Emission Without API Credentials — PASS

- **Contract emitted with no credential present**: `env -u ANTHROPIC_API_KEY metta check-constitution --change testfix` → exit 0, printed article counts (16: 10 conventions, 6 off-limits), spec path, and the `--record` hint — no auth error, no spec-content dump in human mode. Implementation: `src/cli/commands/check-constitution.ts:100-129`.
- **Machine-readable contract via --json**: `--json check-constitution --change testfix` → exit 0, single JSON object with keys `articles, spec_path, spec_content, verdict_schema, instructions, output_path`. `spec_content` carried the fixture spec verbatim; `verdict_schema` = `expected shape: {"violations": [{article, severity: critical|major|minor, evidence, suggestion}]}`; `output_path` = `.metta/scratch/testfix/verdict.json`.
- **Nonexistent change fails clearly, not auth**: `--change no-such-change` → exit 4, `check-constitution failed: ENOENT ... spec/changes/no-such-change/spec.md` — names the missing change path, no SDK/auth wording.
- Tests: `tests/cli-check-constitution.test.ts` (emission suite).

### R2: No Direct AI Provider Invocation — PASS

- `src/providers/` does not exist; `src/index.ts` barrel has no provider exports; `grep -n anthropic package.json` empty; `npm ls @anthropic-ai/sdk` → `(empty)`.
- `grep -rin anthropic src/` yields exactly the two expected benign hits: `src/config/config-loader.ts:84` (env-var mapping example comment) and `src/delivery/workflow-primer.ts:54` (research-discipline prose example).
- Both emission and recording paths (`src/constitution/checker.ts`, `src/cli/commands/check-constitution.ts`) import only fs/path/child_process(git)/schemas — no provider client construction anywhere.
- **Full end-to-end with no credential**: every scenario below ran under `env -u ANTHROPIC_API_KEY` and succeeded/failed strictly on its own merits (missing change → 4, invalid verdict → 4, blocking → 4, clean/justified → 0). No credential error at any point.
- Hygiene note (non-blocking): a stale `dist/providers/` remains from a pre-change build because `npm run build` only cleans `dist/templates/*`. It is gitignored, and nothing in `dist/` references it (verified by grep). A `rm -rf dist && npm run build` clears it; flagged in case `dist` is ever packed as-is.

### R3: Verdict Schema Validation — PASS

- **Unparseable verdict**: `--record malformed.json` (`not json at all {{{`) → exit 4, `--json` error object `{"error": {"code": 4, "type": "verdict_validation_error", "message": "invalid verdict JSON in ..."}}`, and `violations.md` was NOT created (verified absent after having deleted it first).
- **Schema-invalid verdict**: `severity: "huge"` → exit 4, `verdict_validation_error` with Zod `invalid_enum_value` detail listing `critical|major|minor`; `violations.md` still absent.
- **Well-formed empty verdict**: `{"violations": []}` → passed validation and proceeded to persistence (see R5).
- Validation happens before any write: parse/`ViolationListSchema.safeParse` at `src/cli/commands/check-constitution.ts:132-147` precedes the `writeFile` at line 161.

### R4: Verdict Recording and Blocking-Violation Exit Semantics — PASS

- **Critical always blocking**: critical verdict → exit 4, `[critical] No CommonJS [BLOCKING]` in stdout.
- **Unjustified major blocking**: major "No singletons" with no Complexity Tracking entry → exit 4, `[BLOCKING]`.
- **Justified major not blocking**: after appending `## Complexity Tracking` with `- No singletons: The registry must be a process-wide singleton...` to the fixture spec.md, the same major verdict → exit 0, output shows `justified: The registry must be a process-wide singleton...`, no BLOCKING tag.
- **No blocking → exit 0**: clean verdict → exit 0.
- Predicate is single-sourced in `isBlockingViolation` (`src/constitution/checker.ts:146-148`): critical always, major unless justified, minor never; classification in `recordVerdict` (`checker.ts:95-140`) reads Complexity Tracking via `parseComplexityTracking` with exact article-key match.

### R5: Violations Report Format and Location Preserved — PASS

- **Clean verdict report**: wrote `spec/changes/testfix/violations.md` containing frontmatter (`checked: 2026-07-16T05:10:06.611Z`, `spec_version: aa039952` — git hash-object of working-tree spec.md) followed by `No violations found.`
- **Violations render with fields**: critical verdict produced `# Constitution Violations`, heading `## testfix — 1 violation`, and the line `- **[critical] No CommonJS** — evidence: "uses require()" — suggestion: use ESM imports **BLOCKING.**`. Justified major rendered `... Justified in Complexity Tracking: "..."` with no BLOCKING marker.
- Path preserved: `spec/changes/<name>/violations.md` (`src/cli/commands/check-constitution.ts:156-161`); renderer at lines 20-53.

### R6: Skill-Driven Two-Step Check Flow — PASS

- `src/templates/skills/metta-check-constitution/SKILL.md` drives, in order: emit (`metta check-constitution --change <slug> --json`, step 2), spawn `metta-constitution-checker` with Read-only tools and the emitted `<CONSTITUTION>`/`<SPEC>` content + `instructions` (step 3), record (`--record <output_path> --json`, step 4). Step 6 mandates surfacing exit 4 (including `verdict_validation_error`) and forbids reporting success; step 7 forbids the skill writing `violations.md`.
- **Byte-identical copies**: `diff` of template vs `.claude/skills/metta-check-constitution/SKILL.md` → identical. `metta-plan` template vs deployed → identical. `metta-constitution-checker` agent template vs `.claude/agents/` copy → identical.
- `metta-plan` step 4 (lines 20-25) uses the same emit → spawn → record flow and keys all halt/proceed behavior on the `--record` invocation's exit code, closing the always-exit-0 regression noted in the summary.
- Instructions template exists at both `src/templates/artifacts/constitution-check-instructions.md` and `dist/templates/artifacts/constitution-check-instructions.md` (post-build), and the emitted contract's `instructions` field compared strictly equal (`===`) to the src template content (1101 chars).
- Full agentic execution of the skill (subagent spawn) is not exercisable from a verifier session; the contract → verdict-file → record round trip the skill scripts was exercised live end-to-end.

### R7: Idempotent Re-Check Replaces the Prior Verdict — PASS

- **Different verdict overwrites**: after a clean report, recording the critical verdict left exactly 1 `checked:` frontmatter line and 0 `No violations found` lines — no carry-over.
- **Unchanged clean verdict still overwrites**: two consecutive clean recordings 1.1s apart → timestamps `05:11:39.780Z` then `05:11:41.369Z`, file stayed 6 lines with exactly one frontmatter block and one `No violations found.` line — rewritten, not appended. Mechanism: `writeFile(..., { flag: 'w' })` at `src/cli/commands/check-constitution.ts:161`.

## Gates

| Gate | Result |
|------|--------|
| `npx vitest run` | PASS — 1050/1050 tests, 79/79 files (238s) |
| `npx tsc --noEmit` | PASS — clean |
| `npm run lint` (alias of `tsc --noEmit`) | PASS — clean |
| `npm run build` | PASS — compiles + copies templates cleanly |

## Notes

- Fixture project and verdict files were created in the session scratchpad and deleted after verification; the repo working tree was untouched apart from this artifact.
- Non-blocking follow-up: consider extending the build's clean step beyond `dist/templates/*` so deleted source trees (e.g. the removed `src/providers/`) cannot linger in `dist/`.
