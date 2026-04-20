# Scenario Verification — Skill Template Consistency Enforcement

**Overall Verdict:** PARTIAL
**Total Requirements:** 10
**Fully Covered:** 9
**Partially Covered:** 1 (BashHookEmergencyBypass — see notes)
**Uncovered Requirements:** 0 (every requirement has at least one scenario with file:line evidence; emergency-bypass requirement has spec-level evidence only via stderr messaging, no executable test)

**Gate status captured by this verification run:**

| Gate | Command | Result |
|------|---------|--------|
| Tests | `npm test` | PASS — 57 files, 815 tests, 0 failures |
| Lint | `npm run lint` (alias for `tsc --noEmit`) | PASS — 0 errors |
| Typecheck | `npx tsc --noEmit` | PASS — 0 errors |

The 78 tests most directly in scope for this change (`metta-guard-bash.test.ts` 59 + `cli-metta-guard-bash-integration.test.ts` 8 + `skill-discovery-loop.test.ts` 11) all pass.

---

## Requirement: BashHookBlocksMutatingCommands — PASS

Hook exits 2 on state-mutating `metta` commands when `METTA_SKILL` is not set; stderr names the matching skill or bypass.

| Scenario | Evidence |
|----------|----------|
| issue command blocked without bypass | `tests/metta-guard-bash.test.ts:57-60` — `blocks metta issue "foo" without env (exit 2)`; stderr/skill messaging also asserted in `tests/cli-metta-guard-bash-integration.test.ts:126-132` (`stderr contains /metta-` and `Use the matching ... skill`) |
| propose command blocked without bypass | `tests/metta-guard-bash.test.ts:45-50` — asserts exit 2 and stderr contains `/metta-` + `metta propose`; reinforced by `tests/cli-metta-guard-bash-integration.test.ts:126-132` |
| backlog subcommand blocked | `tests/metta-guard-bash.test.ts:67-70` — `blocks metta backlog add "foo" two-word (exit 2)`. Stderr content shape verified by shared message at `src/templates/hooks/metta-guard-bash.mjs:112-117` |
| changes abandon blocked | `tests/metta-guard-bash.test.ts:72-75` — `blocks metta changes abandon two-word (exit 2)` |

Additional coverage: `metta quick` (line 52-55), `metta complete` (line 62-65), inline-prefixed detection `FOO=bar metta propose` (line 173-176), chained command detection `cd /foo && metta issue` (line 178-181). Integration tests 84-122 confirm end-to-end behavior across propose/complete/finalize/issue/quick.

---

## Requirement: BashHookPassesReadOnlyCommands — PASS

Read-only commands exit 0 silently; `metta unknowncmd` is blocked conservatively (not silently allowed).

| Scenario | Evidence |
|----------|----------|
| status passes unconditionally | `tests/metta-guard-bash.test.ts:92-95` — `allows metta status (exit 0)` |
| all listed read-only commands pass | `tests/metta-guard-bash.test.ts:97-125` — `metta instructions ...` (97), `metta issues list` (102), `metta gate list` (107), `metta progress` (112), `metta changes list` (117), `metta doctor` (122). All assert exit 0. |
| unknown metta subcommand is not silently allowed | `tests/metta-guard-bash.test.ts:78-83` — `blocks unknown single-word metta unknowncmd conservatively (exit 2)` asserts exit 2 and stderr contains `unknown metta subcommand`. Also `tests/metta-guard-bash.test.ts:85-89` for two-word variant. |

---

## Requirement: BashHookBypassesWithMettaSkillEnv — PASS

`METTA_SKILL=1` causes unconditional exit 0, evaluated before pattern matching.

| Scenario | Evidence |
|----------|----------|
| skill bypass allows blocked command | `tests/metta-guard-bash.test.ts:143-148` — `bypasses with METTA_SKILL=1 env on hook process for metta propose "foo" (exit 0)`; reinforced by `tests/cli-metta-guard-bash-integration.test.ts:84-90` asserting exit 0 AND empty stderr. |
| bypass applies to all mutating commands | `tests/cli-metta-guard-bash-integration.test.ts:92-106` — three separate assertions for `metta complete intent`, `metta finalize`, and `tests/cli-metta-guard-bash-integration.test.ts:108-114` for `metta issue "x"`, `116-122` for `metta quick "tweak"`. Each asserts exit 0 and empty stderr. |
| bypass does not require command to be on read-only list | `tests/metta-guard-bash.test.ts:160-163` — `bypasses inline for two-word METTA_SKILL=1 metta backlog add "foo" (exit 0)` (this is on the BLOCK list, proving bypass runs before the pattern match). Additional: hook process env bypass at line 143-148 runs on `metta propose` (also blocked). |

Supporting implementation: `src/templates/hooks/metta-guard-bash.mjs:86-87` honors `process.env.METTA_SKILL === '1'` before any classification; inline-prefix detection at lines 49-54 captures per-invocation bypass.

---

## Requirement: BashHookSkipsNonBashEvents — PASS

Non-Bash `tool_name` values exit 0 without inspecting `tool_input`.

| Scenario | Evidence |
|----------|----------|
| Edit tool event passes through | `tests/metta-guard-bash.test.ts:184-187` — `passes through non-Bash events (tool_name: Edit) (exit 0)`. Event includes `file_path` (not `command`) to confirm `tool_input.command` is not examined. |
| Write tool event passes through | Covered by the same behavior at `src/templates/hooks/metta-guard-bash.mjs:84` which gates on `event.tool_name !== 'Bash'`. The Edit test exercises the identical branch. No dedicated Write-specific test exists, but the branch logic is literally `!== 'Bash'` so `Write` and `Edit` are equivalent at the code level. |

Additional hardening: malformed-JSON stdin (`tests/metta-guard-bash.test.ts:194-197`) and empty stdin (line 189-192) also exit 0.

**Minor note:** the spec lists Edit and Write as separate scenarios, but the classifier treats every non-`Bash` value identically (line 84 of the hook). The Edit test is sufficient coverage for the code branch under review; this does not weaken the verdict.

---

## Requirement: BashHookEmergencyBypass — PARTIAL

The hook's stderr guidance and documentation reference `.claude/settings.local.json` as the emergency bypass point, matching the `metta-guard-edit` convention. There is no executable test asserting that a disable entry in `settings.local.json` actually suppresses the hook — this is because the mechanism is external to the hook: Claude Code itself consults `settings.local.json` and decides not to invoke the hook. The hook file cannot test its own non-invocation.

| Scenario | Evidence |
|----------|----------|
| settings.local.json disable suppresses the hook | NO executable test. Mechanism is documented by hook stderr at `src/templates/hooks/metta-guard-bash.mjs:106` and `:116` (`Emergency bypass: disable this hook in .claude/settings.local.json.`) and header comment at `:5`. Verified by spec-level reference to the identical convention used by `metta-guard-edit.mjs`. |
| local bypass does not affect settings.json | NO dedicated test. `.claude/settings.json` shape is asserted by `tests/cli.test.ts:188-202` (installed settings.json contains the Bash guard entry); `settings.local.json` is a separate file and is not rewritten by install — evidence: `src/commands/install.ts` only writes to `settings.json`. |
| removing the local bypass re-enables the hook | NO executable test. Follows from the same external-to-hook mechanism noted above. |

**Partial verdict rationale:** the requirement is about parity with an existing convention (`metta-guard-edit`) that is itself not unit-tested for the settings.local.json behavior — the bypass is a Claude Code feature, not a metta-authored mechanism. The stderr guidance makes the bypass discoverable, and no code change in this requirement would be testable inside our harness. A human/manual QA step or a Claude-Code-level integration test would be needed to close this gap. Not counted as uncovered because the spec evidence (messaging parity, consistent convention) is present.

---

## Requirement: HumanTerminalUsageUnaffected — PASS

Terminal invocations never fire the PreToolUse hook; the hook only reads stdin when Claude emits an event.

| Scenario | Evidence |
|----------|----------|
| terminal propose completes normally | `tests/metta-guard-bash.test.ts:189-192` — `passes through empty stdin (exit 0)`. This is exactly the terminal case: no Claude event JSON → empty stdin → hook exits 0 immediately without touching the command. Implementation at `src/templates/hooks/metta-guard-bash.mjs:80-81` (`if (!raw) { process.exit(0); }`). |
| all blocklisted commands run normally at the terminal | Same evidence: hook exits 0 on empty stdin regardless of what command the developer intends to run. The hook never sees the command in terminal-invocation paths because PreToolUse is not in the pipeline. |

---

## Requirement: InstallRegistersHook — PASS

`metta install` writes the Bash PreToolUse entry, is idempotent, and copies the hook file.

| Scenario | Evidence |
|----------|----------|
| fresh install writes both hook entries | `tests/cli.test.ts:188-202` — `registers metta-guard-bash PreToolUse entry alongside the Edit guard entry`; asserts both `hasEditGuard` and `hasBashGuard` are true. Reinforced by `tests/cli-metta-guard-bash-integration.test.ts:146-161`. |
| idempotent re-install does not duplicate entries | `tests/cli.test.ts:204-214` — `is idempotent for metta-guard-bash — second install does not duplicate the Bash PreToolUse entry`; asserts `bashGuardEntries.length === 1` after two installs. Reinforced by `tests/cli-metta-guard-bash-integration.test.ts:163-180`. |
| hook file is present after install | `tests/cli.test.ts:216-224` — `copies metta-guard-bash.mjs byte-identical to the template`; reads the installed file and compares bytes to the template. Presence + byte-identity in one assertion. |

---

## Requirement: ReviewFanOutPathsInTree — PASS

Step 5 of `src/templates/skills/metta-propose/SKILL.md` instructs reviewers to write to `spec/changes/<name>/review/{correctness,security,quality}.md` and explicitly forbids `/tmp`.

| Scenario | Evidence |
|----------|----------|
| review files land in the change directory | `src/templates/skills/metta-propose/SKILL.md:146-156` — `mkdir -p spec/changes/<change>/review`, then three `test -s spec/changes/<change>/review/<persona>.md` assertions for `correctness`, `security`, `quality`. Output path instruction at line 150. |
| no review artifacts written to /tmp | `src/templates/skills/metta-propose/SKILL.md:151` — `**Forbidden**: writing to /tmp/ or any path outside spec/changes/<change>/review/.` |
| SKILL.md prose forbids /tmp for review | grep evidence at `src/templates/skills/metta-propose/SKILL.md:151` — the `/tmp` mention is inside a `**Forbidden**:` clause (prohibiting context), not an instruction to write there. |

Merge instruction present at line 163 (`Merge results into spec/changes/<change>/review.md and commit.`).

---

## Requirement: VerifyFanOutPathsInTree — PASS

Step 6 of `src/templates/skills/metta-propose/SKILL.md` instructs verifiers to write to `spec/changes/<name>/verify/{tests,tsc-lint,scenarios}.md` and forbids `/tmp`.

| Scenario | Evidence |
|----------|----------|
| verify files land in the change directory | `src/templates/skills/metta-propose/SKILL.md:202-212` — `mkdir -p spec/changes/<change>/verify`, then three `test -s spec/changes/<change>/verify/<aspect>.md` assertions for `tests`, `tsc-lint`, `scenarios`. Output path instruction at line 206. |
| no verify artifacts written to /tmp | `src/templates/skills/metta-propose/SKILL.md:207` — `**Forbidden**: writing to /tmp/ or any path outside spec/changes/<change>/verify/.` |
| SKILL.md prose forbids /tmp for verify | Same line 207 — prohibiting context, not instructional. |

Note: line 214 says the orchestrator merges into `summary.md` rather than `verify.md`. The spec text at requirement VerifyFanOutPathsInTree states `verify.md`. This is a minor prose discrepancy between the skill template and the spec; does not invalidate the fan-out path enforcement scenarios. Flagged for author review.

---

## Requirement: ByteIdenticalSkillMirrors — PASS

`src/templates/skills/metta-propose/SKILL.md` and `.claude/skills/metta-propose/SKILL.md` byte-identical; same for `metta-guard-bash.mjs`.

| Scenario | Evidence |
|----------|----------|
| SKILL.md mirror matches template after update | `tests/skill-discovery-loop.test.ts:71-75` — `metta-propose template matches deployed copy byte-for-byte`; reads both files and asserts string equality. |
| hook mirror matches template | `tests/metta-guard-bash.test.ts:206-209` — `source and deployed hook are byte-identical`; also reinforced by `tests/cli.test.ts:216-224` which proves installed copy == template via `Buffer.equals`. |
| skill-discovery-loop test passes | Test run captured 2026-04-20: `tests/skill-discovery-loop.test.ts (11 tests) 22ms` — all 11 assertions pass. |
| drift between mirrors fails CI | Logical corollary of the byte-identity assertion in `tests/skill-discovery-loop.test.ts:71-75`. If the template is edited without updating the deployed mirror, `expect(template).toBe(deployed)` fails; Vitest exits non-zero, CI fails. The test file is in the committed suite, so CI executes it on every run. |

---

## Summary

| # | Requirement | Verdict |
|---|-------------|---------|
| 1 | BashHookBlocksMutatingCommands | PASS |
| 2 | BashHookPassesReadOnlyCommands | PASS |
| 3 | BashHookBypassesWithMettaSkillEnv | PASS |
| 4 | BashHookSkipsNonBashEvents | PASS |
| 5 | BashHookEmergencyBypass | PARTIAL (external-to-hook mechanism; no executable test possible in harness) |
| 6 | HumanTerminalUsageUnaffected | PASS |
| 7 | InstallRegistersHook | PASS |
| 8 | ReviewFanOutPathsInTree | PASS |
| 9 | VerifyFanOutPathsInTree | PASS |
| 10 | ByteIdenticalSkillMirrors | PASS |

**Uncovered requirements:** 0.
**Partial requirements:** 1 (BashHookEmergencyBypass — evidence limited to hook stderr messaging and convention parity with `metta-guard-edit`; Claude-Code-managed mechanism not directly testable).

**Overall verdict: PARTIAL** — 9/10 fully covered by passing tests with file:line evidence; 1/10 covered only by documentation/messaging parity because the mechanism is external to the hook codebase.
