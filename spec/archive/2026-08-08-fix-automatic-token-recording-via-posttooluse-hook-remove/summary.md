# Implementation Summary — fix-automatic-token-recording-via-posttooluse-hook-remove

Resolves issue `automatic-token-recording-via-posttooluse-hook-remove-the`: token recording is
now automatic framework behavior instead of a prose contract dependent on orchestrator compliance.

## Research-driven pivot

Research against Claude Code 2.1.226 proved the issue's assumed mechanism (PostToolUse on the
Agent tool) never carries token usage in this environment — all 408 observed dispatches are
async launch receipts. Exact harness-measured counts are instead reachable via the
**SubagentStop** hook event, whose payload includes `agent_transcript_path`; the subagent
transcript JSONL carries per-request `message.usage`. The spec delta was amended accordingly
before design (commit 3d52d4379).

## What was built (by task)

- **Task 1.1** (6c1d1fb1f): `TokenUsageRecordSchema` gains optional `source: 'hook' | 'prose'`;
  legacy records (no `source`) validate unchanged. + schema tests.
- **Task 1.2** (f6e8c6373): pure `detectWorktreeChangeName(cwd)` in `src/util/git-worktree.ts`
  (path-segment math, last-occurrence-wins, no I/O). + tests.
- **Task 2.1** (4b67168fd): `metta tokens record` four-rule resolution — explicit `--change` >
  worktree-cwd hard bind (no fall-through, typed error on inactive candidate) > single-active
  auto-select > typed exit-4 with nothing written; new validated `--source hook|prose` option;
  effective source in outputs. + tests.
- **Task 2.2** (15a9c76f9): report-time dedupe in `tokens-report-generator.ts` — hook records
  always kept, prose records dropped only when shadowed by a same-`(task, agent)` hook record;
  Provenance column; GAPS reworded as hook-coverage-miss (hook-health indicator); template
  header distinguishes hook=exact vs prose=estimate. + tests.
- **Task 3.1** (6bfae4307): new SubagentStop hook `metta-tokens-record.mjs` (template +
  deployed, byte-identical, `node --check` clean): filters `metta-*` agent types, sums
  `input_tokens + output_tokens` from the subagent transcript, maps agent to task via static
  map, model via alias substring match (else `inherit`), invokes
  `metta tokens record ... --source hook` with the payload cwd; always exits 0, empty stdout,
  never writes `.metta/`. Registered under `SubagentStop` in `.claude/settings.json`; existing
  PreToolUse guards untouched. + 20 hook tests via a PATH-shimmed child-process harness.
- **Task 3.2** (7faa4768e): per-subagent recording mandate demoted in the four skill pairs
  (metta-plan, metta-execute, metta-verify, metta-next; template + deployed, byte-identical) to
  one verbatim fallback sentence teaching `--source prose`; guard-bash allowlist comment
  refreshed (entry retained); `tests/skill-tokens-record.test.ts` inverted.
- **Task 4.1** (53f217533): full gate — fixed two stale GAPS wording expectations in
  `finalizer.test.ts` and replaced a raw NUL dedupe-key separator with its escaped form
  (git-binary-detection fix, runtime-identical).

## Gate status

`npm run build` (dist ships the hook template byte-identical), `npx tsc --noEmit`, and
`npx vitest run` — 103 files, 1859/1859 tests passing.

## Risks / notes

- Vendor coupling: SubagentStop payload and transcript shape are binary-verified on Claude Code
  2.1.226 but publicly under-documented — re-verify on harness upgrades; the prose CLI fallback
  (`--source prose`) is the tool-agnostic escape hatch.
- Main-root sessions with multiple active changes deliberately skip recording (never
  misattribute); such runs surface in TOKENS.md GAPS as hook coverage misses.
- Totals definition: `input_tokens + output_tokens` only — cache components parsed and logged to
  stderr but excluded to avoid multi-counting re-served cached context.

## Verification results (3 parallel verifiers, all PASS)

- **Test suite**: `npm test` (vitest) — 103 files, 1859/1859 tests passed, 0 failures.
- **Typecheck / lint / build**: `npx tsc --noEmit` PASS; `npm run lint` (tsc-based, no eslint configured) PASS; `npm run build` PASS.
- **Spec coverage**: all 24 scenarios across the 8 spec-delta requirements have passing test
  coverage or direct command verification (settings.json diff limited to the SubagentStop block;
  hook pairs byte-identical and `node --check` clean; skill diffs limited to the one demoted
  sentence per file). R1-S1 covered compositionally: hook test asserts exact CLI argv via PATH
  shim; CLI persistence asserted in tokens-command tests.

## Review results (3 parallel reviewers)

Correctness PASS, Security PASS_WITH_WARNINGS (4 minor), Quality PASS_WITH_WARNINGS.
No critical findings; review loop closed in 1 iteration. Actioned: tokens.ts doc comment
(SubagentStop), redundant source coalesce. Deferred to follow-up: installer does not
settings-register the recording hook in consumer projects (install.ts:355-358).
