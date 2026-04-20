# Tasks for batch-skill-template-consistency-enforcement-1-pretooluse

## Batch 1 (no dependencies)

- [x] **Task 1.1: Implement metta-guard-bash hook + unit tests**
  - **Files**:
    - `src/templates/hooks/metta-guard-bash.mjs` (NEW)
    - `.claude/hooks/metta-guard-bash.mjs` (NEW, byte-identical to above)
    - `tests/metta-guard-bash.test.ts` (NEW)
  - **Action**: Create `metta-guard-bash.mjs` following the exact stdin/stderr/exit-2 pattern of `src/templates/hooks/metta-guard-edit.mjs`. The hook reads a Claude PreToolUse event JSON from stdin. If `process.env.METTA_SKILL === '1'`, exit 0 immediately. If `tool_name` is not `Bash`, exit 0. Otherwise tokenize `tool_input.command` on whitespace, skip leading `KEY=VALUE` env-assignment tokens, assert the first remaining token is `metta` (else exit 0). Classify the second token against `BLOCKED_SIMPLE` (propose, quick, auto, complete, finalize, ship, issue, fix-issue, fix-gap, refresh, import, install, init) and `ALLOWED_SIMPLE` (status, instructions, progress, doctor). For tokens in `BLOCKED_TWO` (backlog: add/done/promote; changes: abandon) or `ALLOWED_TWO` (issues: list; gate: list; changes: list), read the third token for the two-word match. Unknown subcommands: block conservatively (exit 2). Command chains (`&&`, `||`, `;`): scan all segments; block if any segment matches a blocked pattern. On exit 2, write to stderr: `metta-guard: <subcommand> blocked — call the matching skill instead.\nUse /<skill-name> (e.g. /metta-issue, /metta-propose) from an orchestrator session.\nSet METTA_SKILL=1 to bypass from within a skill.\nEmergency bypass: disable this hook in .claude/settings.local.json.` Copy the file byte-for-byte to `.claude/hooks/metta-guard-bash.mjs`. Write `tests/metta-guard-bash.test.ts` covering: (1) blocked simple commands — propose, quick, issue, backlog add, changes abandon each exit 2 with `/metta-<cmd>` in stderr; (2) allowed read-only commands — status, instructions, issues list, gate list, progress, changes list, doctor each exit 0 with empty stderr; (3) `METTA_SKILL=1` env bypass — `metta issue "x"` exits 0; (4) non-Bash `tool_name` (Edit, Write) exits 0; (5) env-prefix command string `FOO=bar metta propose` exits 2; (6) command chain `cd /foo && metta propose` exits 2; (7) unknown subcommand exits 2.
  - **Verify**: `npx vitest run tests/metta-guard-bash.test.ts && npx tsc --noEmit && diff src/templates/hooks/metta-guard-bash.mjs .claude/hooks/metta-guard-bash.mjs`
  - **Done**: All tests pass; `tsc --noEmit` is clean; `diff` exits 0 (byte-identical mirror confirmed).

## Batch 2 (depends on Batch 1)

- [x] **Task 2.1: Wire metta-guard-bash into install.ts + update install tests**
  - **Files**:
    - `src/cli/commands/install.ts` (MODIFIED)
    - `tests/install.test.ts` (MODIFIED)
  - **Action**: In `install.ts`, add a new `installMettaBashGuardHook` function that mirrors `installMettaGuardHook`: copies `src/templates/hooks/metta-guard-bash.mjs` into `.claude/hooks/metta-guard-bash.mjs`, reads and parses `.claude/settings.json`, checks for an existing `metta-guard-bash.mjs` entry under `hooks.PreToolUse[*].hooks[*].command` before pushing to avoid duplicates, and writes the updated `settings.json`. The new PreToolUse entry shape is `{ matcher: "Bash", hooks: [{ type: "command", command: ".claude/hooks/metta-guard-bash.mjs" }] }`. Call `installMettaBashGuardHook` sequentially after `installMettaGuardHook` in the main install action. Update the success message to name both hooks. In `tests/install.test.ts`, add assertions that after `metta install`: (a) `.claude/settings.json` PreToolUse block contains a `metta-guard-bash.mjs` entry; (b) running install a second time does not produce a duplicate `metta-guard-bash.mjs` entry (exactly one entry present).
  - **Verify**: `npx vitest run tests/install.test.ts && npx tsc --noEmit`
  - **Done**: Both new install test assertions pass; idempotency assertion passes; `tsc --noEmit` is clean.

## Batch 3 (depends on Batch 1; tasks 3.1, 3.2, 3.3 are parallel)

- [x] **Task 3.1: Update metta-propose SKILL.md — fan-out paths + METTA_SKILL=1 prefixes**
  - **Files**:
    - `src/templates/skills/metta-propose/SKILL.md` (MODIFIED)
    - `.claude/skills/metta-propose/SKILL.md` (MODIFIED, byte-identical to above)
  - **Action**: Rewrite step 5 (Review fan-out) with the following numbered MUST bullets: (1) `mkdir -p spec/changes/<name>/review` before spawning reviewers; (2) each of the three parallel reviewer subagents is passed its explicit output path — `spec/changes/<name>/review/correctness.md`, `spec/changes/<name>/review/security.md`, `spec/changes/<name>/review/quality.md`; (3) reviewer output MUST NOT be written to any `/tmp` path (add explicit prohibition); (4) post-hoc gate — `test -s spec/changes/<name>/review/correctness.md && test -s spec/changes/<name>/review/security.md && test -s spec/changes/<name>/review/quality.md` MUST pass before the orchestrator proceeds. Rewrite step 6 (Verify fan-out) with the same pattern for `spec/changes/<name>/verify/tests.md`, `spec/changes/<name>/verify/tsc-lint.md`, `spec/changes/<name>/verify/scenarios.md`. Prefix `METTA_SKILL=1 ` on every state-mutating metta CLI call in the skill: step 1 `metta propose`, step 3 `metta complete <artifact>`, step 8 `metta finalize` and any `metta complete` call in step 8. Copy the edited file byte-for-byte to `.claude/skills/metta-propose/SKILL.md`.
  - **Verify**: `diff src/templates/skills/metta-propose/SKILL.md .claude/skills/metta-propose/SKILL.md && grep -n 'METTA_SKILL=1' src/templates/skills/metta-propose/SKILL.md && grep -n 'MUST NOT write to /tmp' src/templates/skills/metta-propose/SKILL.md && npx vitest run tests/skill-discovery-loop.test.ts && npx tsc --noEmit`
  - **Done**: `diff` exits 0 (byte-identical); `grep METTA_SKILL=1` finds entries at step 1, step 3, and step 8 call sites; `/tmp` prohibition appears in step 5 and step 6 prose; `skill-discovery-loop` tests pass; `tsc --noEmit` is clean.

- [x] **Task 3.2: Update metta-issue SKILL.md — METTA_SKILL=1 prefix**
  - **Files**:
    - `src/templates/skills/metta-issue/SKILL.md` (MODIFIED)
    - `.claude/skills/metta-issue/SKILL.md` (MODIFIED, byte-identical to above)
  - **Action**: In the skill's step 3, prefix the `metta issue "<description>"` CLI call with `METTA_SKILL=1 ` so it reads `METTA_SKILL=1 metta issue "<description>"`. Copy the edited file byte-for-byte to `.claude/skills/metta-issue/SKILL.md`.
  - **Verify**: `diff src/templates/skills/metta-issue/SKILL.md .claude/skills/metta-issue/SKILL.md && grep -n 'METTA_SKILL=1' src/templates/skills/metta-issue/SKILL.md && npx vitest run tests/skill-discovery-loop.test.ts && npx tsc --noEmit`
  - **Done**: `diff` exits 0 (byte-identical); `grep METTA_SKILL=1` finds the step 3 call site; `skill-discovery-loop` tests pass; `tsc --noEmit` is clean.

- [x] **Task 3.3: Update metta-quick SKILL.md — METTA_SKILL=1 prefixes**
  - **Files**:
    - `src/templates/skills/metta-quick/SKILL.md` (MODIFIED)
    - `.claude/skills/metta-quick/SKILL.md` (MODIFIED, byte-identical to above)
  - **Action**: In the skill's step 1, prefix the `metta quick` invocation with `METTA_SKILL=1 `. Prefix `METTA_SKILL=1 ` on any `metta complete <artifact>` calls in the artifact loop. Copy the edited file byte-for-byte to `.claude/skills/metta-quick/SKILL.md`.
  - **Verify**: `diff src/templates/skills/metta-quick/SKILL.md .claude/skills/metta-quick/SKILL.md && grep -n 'METTA_SKILL=1' src/templates/skills/metta-quick/SKILL.md && npx vitest run tests/skill-discovery-loop.test.ts && npx tsc --noEmit`
  - **Done**: `diff` exits 0 (byte-identical); `grep METTA_SKILL=1` finds the step 1 and artifact-loop call sites; `skill-discovery-loop` tests pass; `tsc --noEmit` is clean.

## Batch 4 (depends on Batch 2 + Batch 3)

- [x] **Task 4.1: Integration tests for hook + install wiring end-to-end**
  - **Files**:
    - `tests/cli-metta-guard-bash-integration.test.ts` (NEW)
  - **Action**: Create integration tests that: (a) for each skill's canonical state-mutating CLI call pattern (prefixed with `METTA_SKILL=1`), spawn a real hook invocation (pipe a synthetic hook event JSON to `node src/templates/hooks/metta-guard-bash.mjs`) with `METTA_SKILL=1` in the child process env and assert exit code 0 (bypass works end-to-end for metta-propose step 1/3/8, metta-issue step 3, metta-quick step 1 patterns); (b) spawn a direct `metta propose` hook event without `METTA_SKILL=1` in env and assert exit code 2 and stderr contains `/metta-propose`; (c) simulate running `metta install` twice against a temp project directory and assert the resulting `.claude/settings.json` PreToolUse block contains exactly one `metta-guard-bash.mjs` entry (idempotency end-to-end).
  - **Verify**: `npx vitest run tests/cli-metta-guard-bash-integration.test.ts && npx tsc --noEmit`
  - **Done**: All integration assertions pass; idempotency assertion confirms exactly one PreToolUse entry for `metta-guard-bash.mjs` after two installs; `tsc --noEmit` is clean.
