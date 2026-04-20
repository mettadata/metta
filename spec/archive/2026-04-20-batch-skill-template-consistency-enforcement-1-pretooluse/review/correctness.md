# Correctness Review: batch-skill-template-consistency-enforcement-1-pretooluse (Iteration 2)

## Summary

Re-review after the fix round. Both critical issues from iteration 1 are resolved.
The hook now parses `METTA_SKILL=1` inline env-prefixes directly out of
`tool_input.command` (no dependency on process.env propagation), and the
classifier explicitly handles three verdicts — `allow`, `block`, `unknown` —
with unknown subcommands conservatively blocked (exit 2). Tests now cover both
the inline-prefix bypass and the unknown-subcommand path. Byte-identity holds
for the hook and all 18 SKILL.md pairs. All 59 hook tests pass.

Prior iteration-1 verdict: NEEDS_CHANGES (2 critical). This iteration: PASS.

## Re-check of prior Critical issues

### 1. Inline `METTA_SKILL=1` bypass — FIXED

`src/templates/hooks/metta-guard-bash.mjs:39-65` — `tokenize()` now walks the
command string token-stream explicitly, consuming leading env-prefix tokens
before each `metta` invocation and flagging `skillBypass = true` when one of
those tokens is exactly `METTA_SKILL=1` (line 52). The previously brittle
check on `process.env.METTA_SKILL` is now a secondary belt-and-suspenders
safeguard at line 87 (kept so tests that spawn the hook with an env override
also bypass), and the primary contract is inline env prefix in the command
string itself — which is what the shell will see when Bash runs the command.

Test coverage added (`tests/metta-guard-bash.test.ts`):
- line 150: inline single-prefix `METTA_SKILL=1 metta propose "foo"` → exit 0
- line 155: multiple prefixes `FOO=bar METTA_SKILL=1 metta propose` → exit 0
- line 160: two-word form `METTA_SKILL=1 metta backlog add "foo"` → exit 0
- line 165: per-invocation scope — `METTA_SKILL=1 metta status && metta propose "foo"`
  → exit 2 (the unprefixed `metta propose` in the chain still blocks)
- line 173: non-bypass env prefix `FOO=bar metta propose "foo"` → exit 2

Live run confirmed: `echo '{"tool_name":"Bash","tool_input":{"command":"METTA_SKILL=1 metta propose \"foo\""}}' | node …/metta-guard-bash.mjs` exits 0.

### 2. Unknown subcommand blocking — FIXED

`src/templates/hooks/metta-guard-bash.mjs:68-77` — New `classify()` function
returns `'allow' | 'block' | 'unknown'`. Main (lines 93-109) treats anything
other than `'allow'` as an offender. `'unknown'` emits a distinct stderr
message ("Blocked unknown metta subcommand …") and exits 2.

Test coverage added:
- line 78: `metta unknowncmd` → exit 2, stderr contains "unknown metta subcommand"
- line 85: `metta unknown foo` → exit 2

Live run confirmed: `metta unknowncmd` → exit 2 with the new stderr message.

### 3. `metta install` moved to ALLOW — DONE

`src/templates/hooks/metta-guard-bash.mjs:10-13` — `ALLOWED_SUBCOMMANDS`
includes `'install'` with an inline comment: "intentional pass-through for
human/CI-driven install (no matching skill yet)." It is no longer in
`BLOCKED_SUBCOMMANDS` (lines 24-27). Test at line 127 confirms `metta install`
→ exit 0. Live run confirmed exit 0.

### 4. `metta-propose` review/verify fan-out paths — VERIFIED

`src/templates/skills/metta-propose/SKILL.md`:
- line 147: `mkdir -p spec/changes/<change>/review`
- line 150: output path `spec/changes/<change>/review/<persona>.md`
  (personas: correctness, security, quality)
- line 151: forbids writing to `/tmp/` or any path outside the review dir
- lines 154-156: `test -s` assertions for all three persona files
- line 203: `mkdir -p spec/changes/<change>/verify`
- line 206: output path `spec/changes/<change>/verify/<aspect>.md`
  (aspects: tests, tsc-lint, scenarios)
- line 207: forbids `/tmp/` or outside-verify-dir writes
- lines 210-212: `test -s` assertions for all three aspect files

All four fan-out requirements (mkdir, sub-tree path, forbid `/tmp/`, `test -s`)
are present for both review and verify. Matches spec requirements
`ReviewFanOutPathsInTree` and `VerifyFanOutPathsInTree`.

### 5. 11 sibling skills prefixed with `METTA_SKILL=1` — VERIFIED

Spot-checked state-mutating calls in the three skills called out plus the
rest of the fleet:

- `metta-fix-issues/SKILL.md` (9 occurrences): `metta propose`, `metta complete <artifact>`,
  `metta finalize`, `metta fix-issue --remove-issue`, `metta fix-issue --all` all
  prefixed.
- `metta-ship/SKILL.md` (2 occurrences): both `metta finalize` calls
  (`--dry-run` preview and real run) prefixed at lines 11-12.
- `metta-backlog/SKILL.md` (3 occurrences): `backlog add` at line 16, `backlog promote`
  at line 17, `backlog done` at line 18 — all prefixed on mutating calls.
  Read-only `metta backlog list --json` intentionally not prefixed (hook allows it).
- `metta-quick/SKILL.md` (5): `metta quick`, `metta complete intent`,
  `metta complete implementation`, `metta complete verification`, `metta finalize`.
- `metta-auto/SKILL.md` (8): `metta propose` (both workflow variants) and all
  downstream `metta complete <artifact>` calls.
- `metta-propose/SKILL.md` (8): propose, all complete-artifact calls, finalize,
  fix-issue --remove-issue.
- `metta-fix-gap/SKILL.md` (8): same pattern as propose (gap-resolution workflow).
- `metta-init/SKILL.md` (3): `metta init`, `metta refresh --no-commit`.
- `metta-issue/SKILL.md` (1): `metta issue` call.
- `metta-next/SKILL.md` (2), `metta-verify/SKILL.md` (1),
  `metta-execute/SKILL.md` (1), `metta-plan/SKILL.md` (1),
  `metta-import/SKILL.md` (1) — each has the prefix on the single mutating call
  it makes.

Total: 14 skills contain `METTA_SKILL=1` across 53 occurrences. Read-only
skills (`metta-status`, `metta-progress`, `metta-check-constitution`,
`metta-refresh`) correctly do not need the prefix because they either call no
mutating CLI or their mutating calls are already routed through the skill
fleet.

### 6. Byte-identity — VERIFIED

- `src/templates/hooks/metta-guard-bash.mjs` vs `.claude/hooks/metta-guard-bash.mjs`:
  diff exits 0 (identical).
- All 18 `src/templates/skills/*/SKILL.md` vs `.claude/skills/*/SKILL.md` pairs:
  `diff -q` produces no output (all identical).
- Test at `tests/metta-guard-bash.test.ts:206-209` also asserts byte-identity
  of the hook pair and passes.

## Remaining Non-Blocking Notes (from iteration 1, unchanged)

### Warnings (should fix, not blocking)

- `src/templates/hooks/metta-guard-bash.mjs:21-40` — Tokenizer does not detect
  `metta` inside command substitutions (`$(metta …)`) or inside quoted
  sub-commands (`bash -c "metta …"`). Not asserted by any scenario, but
  represents a realistic evasion path. Suggest either documenting the
  limitation in the hook header or extending the tokenizer to scan across
  subshell boundaries.
- `src/cli/commands/install.ts:55-94` — `installMettaBashGuardHook` remains a
  near-duplicate of `installMettaGuardHook`. Idempotency logic is correct but
  invites drift. Recommend factoring into a single helper parameterized by
  `{ hookFileName, matcher }`. Non-blocking; integration tests cover both.

### Suggestions (nice to have)

- `src/templates/hooks/metta-guard-bash.mjs:38` — After a separator token, the
  `i++` + outer-loop env-prefix skip works for asserted scenarios but
  semantics for malformed back-to-back separators (`&& &&`) is implicit.
  Low-risk; worth a comment.
- Previously-noted "skill name for `metta changes abandon`" stderr message:
  the current implementation emits a generic "Use the matching /metta-<skill>
  skill via the Skill tool; see CLAUDE.md for the mapping" message (lines
  112-117), which is correct and no longer points specifically at
  `/metta-ship`. Resolved.

## Spec Traceability (10 requirements)

| Requirement | Status |
|---|---|
| BashHookBlocksMutatingCommands | PASS (6 test cases) |
| BashHookPassesReadOnlyCommands | PASS (9 test cases incl. unknown-subcommand conservative-block) |
| BashHookBypassesWithMettaSkillEnv | PASS — inline-prefix bypass now parsed from command string, verified live |
| BashHookSkipsNonBashEvents | PASS |
| BashHookEmergencyBypass | PASS (deferred to Claude Code settings.local.json) |
| HumanTerminalUsageUnaffected | PASS (hook only fires inside hook harness) |
| InstallRegistersHook | PASS (`tests/cli-metta-guard-bash-integration.test.ts`) |
| ReviewFanOutPathsInTree | PASS |
| VerifyFanOutPathsInTree | PASS |
| ByteIdenticalSkillMirrors | PASS (hook + 18 SKILL.md pairs) |

## Verdict

PASS

Critical count: 0
Prior critical issues (inline-env bypass, unknown-subcommand block) both
resolved and test-covered. Warnings and suggestions remain as follow-ups but
do not block finalize.
