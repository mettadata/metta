# skill-template-consistency-enforcement

## Requirement: BashHookBlocksMutatingCommands

The PreToolUse Bash hook (`metta-guard-bash.mjs`) MUST block any Bash tool event whose `tool_input.command` string matches a state-mutating metta command pattern when the environment variable `METTA_SKILL` is not set to `1`. Blocked patterns are:
On a match the hook MUST exit with code 2 and MUST write a message to stderr that names the correct skill entrypoint to invoke instead (e.g., "Use /metta-issue instead of calling metta issue directly. Set METTA_SKILL=1 to bypass from within a skill.").
Fulfills: US-1

### Scenario: issue command blocked without bypass
- GIVEN the PreToolUse hook is installed in `.claude/settings.json` under the PreToolUse block
- WHEN a Claude Bash tool event fires with `tool_input.command` = `metta issue "my problem"` and `METTA_SKILL` is absent from the environment
- THEN the hook exits with code 2 and stderr contains the string `/metta-issue`

### Scenario: propose command blocked without bypass
- GIVEN the hook installed as above
- WHEN a Bash tool event fires with `tool_input.command` = `metta propose "add feature X"` and `METTA_SKILL` is absent
- THEN the hook exits 2 and stderr contains `/metta-propose`

### Scenario: backlog subcommand blocked
- GIVEN the hook installed as above
- WHEN a Bash tool event fires with `tool_input.command` = `metta backlog add "new item"` and `METTA_SKILL` is absent
- THEN the hook exits 2 and stderr mentions the correct skill or the bypass instruction

### Scenario: changes abandon blocked
- GIVEN the hook installed as above
- WHEN a Bash tool event fires with `tool_input.command` = `metta changes abandon my-change` and `METTA_SKILL` is absent
- THEN the hook exits 2 and stderr contains the bypass or skill pointer


## Requirement: BashHookPassesReadOnlyCommands

The PreToolUse Bash hook MUST exit 0 without printing any warning when the matched metta command is one of the designated read-only commands: `metta status`, `metta instructions`, `metta issues list`, `metta gate list`, `metta progress`, `metta changes list`, `metta doctor`. This pass-through MUST apply regardless of whether `METTA_SKILL=1` is set.
Fulfills: US-4

### Scenario: status passes unconditionally
- GIVEN the hook installed and `METTA_SKILL` absent from the environment
- WHEN a Bash tool event fires with `tool_input.command` = `metta status`
- THEN the hook exits 0 and stderr is empty

### Scenario: all listed read-only commands pass
- GIVEN the hook installed
- WHEN each of `metta instructions`, `metta issues list`, `metta gate list`, `metta progress`, `metta changes list`, `metta doctor` is submitted as a separate Bash tool event without `METTA_SKILL=1`
- THEN every invocation exits 0 with no blocking message

### Scenario: unknown metta subcommand is not silently allowed
- GIVEN the hook installed and `METTA_SKILL` absent
- WHEN a Bash tool event fires with `tool_input.command` = `metta unknowncmd`
- THEN the hook MUST NOT exit 0 as a false pass-through; it MUST either block (exit 2) or treat the command as unknown and block conservatively


## Requirement: BashHookBypassesWithMettaSkillEnv

When the environment variable `METTA_SKILL` equals `1`, the hook MUST exit 0 immediately without inspecting `tool_input.command` or printing any message. Skills MUST set `METTA_SKILL=1` in the Bash invocation environment before calling any metta CLI command so that legitimate skill-driven calls are never blocked.
Fulfills: US-3

### Scenario: skill bypass allows blocked command
- GIVEN the hook installed and `METTA_SKILL=1` set in the environment passed to the Bash tool
- WHEN a Bash tool event fires with `tool_input.command` = `metta issue "x"`
- THEN the hook exits 0 without any stderr output and the CLI runs normally

### Scenario: bypass applies to all mutating commands
- GIVEN `METTA_SKILL=1` set in the environment
- WHEN a Bash tool event fires with `tool_input.command` = `metta complete`
- THEN the hook exits 0 and does not block the command

### Scenario: bypass does not require the command to be on the read-only list
- GIVEN `METTA_SKILL=1` set
- WHEN `metta changes abandon my-change` is submitted via the Bash tool
- THEN the hook exits 0, confirming the bypass is evaluated before pattern matching


## Requirement: BashHookSkipsNonBashEvents

When the Claude hook event JSON contains a `tool_name` field whose value is not `Bash`, the hook MUST exit 0 immediately without reading or inspecting `tool_input`. The hook is scoped exclusively to shell invocations.
Fulfills: US-1

### Scenario: Edit tool event passes through
- GIVEN the PreToolUse hook installed
- WHEN the hook receives a Claude event JSON with `tool_name` = `Edit` (or any value other than `Bash`)
- THEN the hook exits 0 without examining `tool_input.command`

### Scenario: Write tool event passes through
- GIVEN the hook installed
- WHEN the hook receives a Claude event JSON with `tool_name` = `Write`
- THEN the hook exits 0 immediately


## Requirement: BashHookEmergencyBypass

A developer MUST be able to disable `metta-guard-bash.mjs` by adding a disable entry for the hook in `.claude/settings.local.json`. The config key shape and precedence rules MUST be identical to those used by the existing `metta-guard-edit.mjs` bypass convention. When the hook is disabled this way, all Bash tool events pass through as if the hook were not installed.
Fulfills: US-5

### Scenario: settings.local.json disable suppresses the hook
- GIVEN `.claude/settings.local.json` contains a disable entry for `metta-guard-bash` following the same structure used to disable `metta-guard-edit`
- WHEN an AI orchestrator fires a Bash tool event with `tool_input.command` = `metta issue "x"` and no `METTA_SKILL=1`
- THEN the hook exits 0 and the command proceeds without blocking

### Scenario: local bypass does not affect settings.json
- GIVEN the disable entry only in `settings.local.json`
- WHEN `.claude/settings.json` is read
- THEN it still contains the original `metta-guard-bash` PreToolUse hook entry unchanged

### Scenario: removing the local bypass re-enables the hook
- GIVEN the disable entry is removed from `.claude/settings.local.json`
- WHEN a mutating command is submitted via the Bash tool without `METTA_SKILL=1`
- THEN the hook exits 2 and blocks the command again


## Requirement: HumanTerminalUsageUnaffected

`metta-guard-bash.mjs` MUST have no effect when metta commands are invoked directly in a developer shell outside a Claude AI tool session. Because the PreToolUse hook only fires when Claude emits a Bash tool event, terminal invocations MUST reach the CLI unchanged with no exit-code alteration and no hook-generated stderr.
Fulfills: US-2

### Scenario: terminal propose completes normally
- GIVEN a developer shell with no Claude tool harness active (no stdin hook event)
- WHEN the developer runs `metta propose "add feature X"` at the terminal
- THEN the CLI executes normally, produces its standard output, and exits with its natural code (not 2)

### Scenario: all blocklisted commands run normally at the terminal
- GIVEN the same terminal environment
- WHEN the developer runs `metta complete`, `metta ship`, or any other blocklisted command
- THEN each command runs to completion with no hook interference


## Requirement: InstallRegistersHook

`metta install` MUST write a PreToolUse entry for `metta-guard-bash.mjs` into `.claude/settings.json` alongside the existing `metta-guard-edit` entry. The operation MUST be idempotent: running `metta install` a second time on a project that already has the entry MUST NOT produce a duplicate entry. The hook file `metta-guard-bash.mjs` MUST be copied to the project's `.claude/hooks/` directory as part of install.
Fulfills: US-8

### Scenario: fresh install writes both hook entries
- GIVEN a fresh project directory with no `.claude/settings.json`
- WHEN `metta install` is run
- THEN `.claude/settings.json` exists and its PreToolUse block contains entries for both `metta-guard-edit.mjs` and `metta-guard-bash.mjs`

### Scenario: idempotent re-install does not duplicate entries
- GIVEN `.claude/settings.json` already contains the `metta-guard-bash` PreToolUse entry from a prior install
- WHEN `metta install` is run again
- THEN `.claude/settings.json` contains exactly one `metta-guard-bash` entry (not two)

### Scenario: hook file is present after install
- GIVEN `metta install` has been run on a project
- WHEN the filesystem is inspected
- THEN `.claude/hooks/metta-guard-bash.mjs` exists and is non-empty


## Requirement: ReviewFanOutPathsInTree

Step 5 of the `/metta-propose` skill template (`src/templates/skills/metta-propose/SKILL.md`) MUST instruct each of the three parallel reviewer subagents to write its output to a file path within the change directory:
The step prose MUST explicitly forbid writing review artifacts to `/tmp` paths. The orchestrator MUST merge these three files into `review.md` from the change directory after all three reviewers complete.
Fulfills: US-6

### Scenario: review files land in the change directory
- GIVEN a change named `my-change` with a directory at `spec/changes/my-change/`
- WHEN the orchestrator executes step 5 of `/metta-propose`
- THEN `spec/changes/my-change/review/correctness.md`, `spec/changes/my-change/review/security.md`, and `spec/changes/my-change/review/quality.md` all exist and are non-empty

### Scenario: no review artifacts written to /tmp
- GIVEN the same step 5 run
- WHEN `/tmp` is inspected after step 5 completes
- THEN no files matching `/tmp/review-*.md` or `/tmp/review/*.md` exist from this run

### Scenario: SKILL.md prose forbids /tmp for review
- GIVEN the updated `src/templates/skills/metta-propose/SKILL.md`
- WHEN a grep for `/tmp` is run within the step 5 section of that file
- THEN the match is in a prohibiting context (e.g., "MUST NOT write to /tmp") and not as an instruction to write there


## Requirement: VerifyFanOutPathsInTree

Step 6 of the `/metta-propose` skill template (`src/templates/skills/metta-propose/SKILL.md`) MUST instruct each of the three parallel verifier subagents to write its output to a file path within the change directory:
The step prose MUST explicitly forbid writing verify artifacts to `/tmp` paths. The orchestrator MUST merge these three files into `verify.md` from the change directory after all three verifiers complete.
Fulfills: US-7

### Scenario: verify files land in the change directory
- GIVEN a change named `my-change` with a directory at `spec/changes/my-change/`
- WHEN the orchestrator executes step 6 of `/metta-propose`
- THEN `spec/changes/my-change/verify/tests.md`, `spec/changes/my-change/verify/tsc-lint.md`, and `spec/changes/my-change/verify/scenarios.md` all exist and are non-empty

### Scenario: no verify artifacts written to /tmp
- GIVEN the same step 6 run
- WHEN `/tmp` is inspected after step 6 completes
- THEN no files matching `/tmp/verify-*.md` or `/tmp/verify/*.md` exist from this run

### Scenario: SKILL.md prose forbids /tmp for verify
- GIVEN the updated `src/templates/skills/metta-propose/SKILL.md`
- WHEN a grep for `/tmp` is run within the step 6 section of that file
- THEN the match is in a prohibiting context (e.g., "MUST NOT write to /tmp") and not as an instruction to write there


## Requirement: ByteIdenticalSkillMirrors

After all changes in this spec are applied, `src/templates/skills/metta-propose/SKILL.md` and `.claude/skills/metta-propose/SKILL.md` MUST be byte-identical. Likewise `src/templates/hooks/metta-guard-bash.mjs` and `.claude/hooks/metta-guard-bash.mjs` MUST be byte-identical. The existing `tests/skill-discovery-loop.test.ts` byte-identity assertions MUST continue to pass without modification to the test file itself.
Fulfills: US-9

### Scenario: SKILL.md mirror matches template after update
- GIVEN the review and verify fan-out path changes applied to `src/templates/skills/metta-propose/SKILL.md`
- WHEN `diff src/templates/skills/metta-propose/SKILL.md .claude/skills/metta-propose/SKILL.md` is run
- THEN the command exits 0 with no output (files are byte-identical)

### Scenario: hook mirror matches template
- GIVEN `src/templates/hooks/metta-guard-bash.mjs` created
- WHEN `diff src/templates/hooks/metta-guard-bash.mjs .claude/hooks/metta-guard-bash.mjs` is run
- THEN the command exits 0 with no output

### Scenario: skill-discovery-loop test passes
- GIVEN the updated SKILL.md files and new hook files in place
- WHEN `npx vitest run tests/skill-discovery-loop.test.ts` is executed
- THEN all assertions pass and the exit code is 0

### Scenario: drift between mirrors fails CI
- GIVEN `src/templates/skills/metta-propose/SKILL.md` is edited without updating the `.claude` mirror
- WHEN the byte-identity test in `tests/skill-discovery-loop.test.ts` runs
- THEN the test fails, detecting the drift before it can be committed
