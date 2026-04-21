# fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill

## ADDED: Requirement: Guard hook fails closed on high-value skill-enforced subcommands

`src/templates/hooks/metta-guard-bash.mjs` MUST define a named constant `SKILL_ENFORCED_SUBCOMMANDS` (a `Set`) containing at minimum: `issue`, `fix-issue`, `propose`, `quick`, `auto`, `ship`, `finalize`, `complete`. When the tokenizer resolves `event.tool_input.command` to a `metta` invocation whose subcommand is a member of `SKILL_ENFORCED_SUBCOMMANDS`, the hook MUST exit with code 2 regardless of whether an inline `METTA_SKILL=1` env-var prefix is present on the same command token. The inline `skillBypass` flag produced by the tokenizer MUST NOT suppress the block decision for any subcommand in `SKILL_ENFORCED_SUBCOMMANDS`. The `process.env.METTA_SKILL === '1'` belt-and-suspenders path (line 87 of the current source) MUST NOT be changed and MUST continue to honor the bypass unconditionally for all subcommands. The rejection stderr message for a `SKILL_ENFORCED_SUBCOMMANDS` hit MUST include: (a) the exact subcommand name; (b) the name of the matching skill drawn from a lookup table (e.g. `issue` → `/metta-issue`, `propose` → `/metta-propose`, `fix-issue` → `/metta-fix-issues`, `quick` → `/metta-quick`, `auto` → `/metta-auto`, `ship` → `/metta-ship`, `finalize` → `/metta-ship`, `complete` → `/metta-complete`); (c) the exact sentence "Inline METTA_SKILL=1 prefix no longer bypasses skill-enforced subcommands — use the Skill tool."; (d) the standard emergency-bypass hint "Emergency bypass: disable this hook in .claude/settings.local.json."

### Scenario: Direct `metta issue` call is blocked and names the skill
- GIVEN `src/templates/hooks/metta-guard-bash.mjs` is active with `SKILL_ENFORCED_SUBCOMMANDS` containing `issue`
- WHEN an AI orchestrator issues a Bash tool call with `tool_input.command` equal to `metta issue "repro steps here"` and `process.env.METTA_SKILL` is not set
- THEN the hook exits with code 2 and stderr contains `issue`, `/metta-issue`, "Inline METTA_SKILL=1 prefix no longer bypasses skill-enforced subcommands — use the Skill tool.", and "Emergency bypass: disable this hook in .claude/settings.local.json."

### Scenario: Inline-prefix `METTA_SKILL=1 metta propose` is blocked and names the skill
- GIVEN `src/templates/hooks/metta-guard-bash.mjs` is active with `SKILL_ENFORCED_SUBCOMMANDS` containing `propose`
- WHEN an AI orchestrator issues a Bash tool call with `tool_input.command` equal to `METTA_SKILL=1 metta propose "foo"` and `process.env.METTA_SKILL` is not set on the hook process
- THEN the hook exits with code 2 and stderr contains `propose`, `/metta-propose`, and "Inline METTA_SKILL=1 prefix no longer bypasses skill-enforced subcommands — use the Skill tool."

---

## ADDED: Requirement: Guard hook preserves inline-bypass for non-skill-enforced subcommands

For any subcommand that is in `BLOCKED_SUBCOMMANDS` (the existing set: `propose`, `quick`, `auto`, `complete`, `finalize`, `ship`, `issue`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init`) but is NOT in `SKILL_ENFORCED_SUBCOMMANDS`, the existing inline `METTA_SKILL=1` prefix MUST continue to suppress the guard block, producing exit code 0. The set `SKILL_ENFORCED_SUBCOMMANDS` introduced in this change initially contains exactly: `issue`, `fix-issue`, `propose`, `quick`, `auto`, `ship`, `finalize`, `complete`. Subcommands in `BLOCKED_SUBCOMMANDS` that are not in this initial `SKILL_ENFORCED_SUBCOMMANDS` set — specifically `fix-gap`, `refresh`, `import`, and `init` — MUST continue to honor the inline `METTA_SKILL=1` bypass because no user-facing skill equivalent is currently registered for them. The `process.env.METTA_SKILL === '1'` secondary bypass path MUST continue to honor the bypass for all subcommands without exception, including every member of `SKILL_ENFORCED_SUBCOMMANDS`; this path is set by the Claude Code runtime, not by the orchestrator's Bash command string, and MUST NOT be restricted.

### Scenario: Inline-prefix `METTA_SKILL=1 metta complete` is allowed when `complete` is enforced only via env-var path
- GIVEN `src/templates/hooks/metta-guard-bash.mjs` is active and `process.env.METTA_SKILL` is set to `'1'` on the hook process (the runtime belt-and-suspenders path)
- WHEN an orchestrator running inside a legitimate skill subagent context triggers a Bash tool call with `tool_input.command` equal to `metta complete intent`
- THEN the hook exits with code 0 because `process.env.METTA_SKILL === '1'` triggers the unconditional early-exit before any subcommand inspection

---

## ADDED: Requirement: Guard hook appends every blocked or bypass-detected attempt to `.metta/logs/guard-bypass.log`

Every time the guard either (a) blocks a command whose subcommand is in `SKILL_ENFORCED_SUBCOMMANDS` or `BLOCKED_SUBCOMMANDS` (including cases where an inline `METTA_SKILL=1` prefix was present but is now overridden for enforced subcommands), or (b) observes an inline `METTA_SKILL=1` prefix on a non-enforced subcommand that the bypass allows through, the hook MUST append exactly one JSON line (newline-terminated) to `<project-root>/.metta/logs/guard-bypass.log`. The hook MUST determine the project root by traversing from the location of the hook file itself (`import.meta.url`) upward to the nearest ancestor containing a `.metta/` directory, or by falling back to `process.cwd()` if no such ancestor is found. The hook MUST create `.metta/logs/` (and any parent directories) if they do not already exist before writing. The appended JSON object MUST have the following shape and MUST NOT include additional top-level keys:

```json
{
  "ts": "<ISO8601 timestamp from new Date().toISOString()>",
  "verdict": "block" | "allow_with_bypass",
  "subcommand": "<first metta subcommand token, e.g. 'issue'>",
  "third": "<second metta argument token or null>",
  "skill_hint": "<matched skill name string e.g. '/metta-issue', or null if none>",
  "reason": "<short human-readable string distinguishing the classification>",
  "event_keys": ["<top-level key names present in the parsed PreToolUse event object>"]
}
```

The `event_keys` field MUST enumerate every top-level key present in the parsed event JSON (e.g. `["tool_name", "tool_input"]` for current payloads), serving as forward-looking observability for research into what Claude Code actually supplies. The hook MUST NOT read the log file at any point; the file is append-only. Allowed read-only subcommands (`ALLOWED_SUBCOMMANDS` and `ALLOWED_TWO_WORD`) MUST NOT produce any log entry.

### Scenario: Blocked skill-enforced call appends one JSON line with verdict `block`
- GIVEN `.metta/logs/` does not yet exist in the project root
- WHEN the hook processes a Bash event with `tool_input.command` equal to `METTA_SKILL=1 metta issue "x"` and `process.env.METTA_SKILL` is not set
- THEN the hook creates `.metta/logs/guard-bypass.log`, appends one newline-terminated JSON line to it, and that line deserializes to an object with `verdict` equal to `"block"`, `subcommand` equal to `"issue"`, `skill_hint` equal to `"/metta-issue"`, `ts` matching ISO 8601 format, and `event_keys` containing `"tool_name"` and `"tool_input"`

### Scenario: Non-enforced inline-bypass call appends one JSON line with verdict `allow_with_bypass`
- GIVEN `.metta/logs/guard-bypass.log` already contains two prior entries
- WHEN the hook processes a Bash event with `tool_input.command` equal to `METTA_SKILL=1 metta refresh` (where `refresh` is in `BLOCKED_SUBCOMMANDS` but not in `SKILL_ENFORCED_SUBCOMMANDS`) and `process.env.METTA_SKILL` is not set
- THEN the hook appends exactly one new JSON line (without truncating existing content), that line deserializes to an object with `verdict` equal to `"allow_with_bypass"`, `subcommand` equal to `"refresh"`, and the hook exits with code 0

---

## ADDED: Requirement: Read-only subcommands are unaffected

Subcommands in `ALLOWED_SUBCOMMANDS` — `status`, `instructions`, `progress`, `doctor`, `install` — and two-word forms in `ALLOWED_TWO_WORD` — `issues list`, `gate list`, `changes list`, `backlog list`, `backlog show` — MUST continue to exit 0 without any audit-log write, regardless of whether an inline `METTA_SKILL=1` prefix is present on the command string. The introduction of `SKILL_ENFORCED_SUBCOMMANDS` MUST NOT change the classification path for these subcommands: the `ALLOWED_SUBCOMMANDS` and `ALLOWED_TWO_WORD` checks MUST remain the first classification gates evaluated, before any blocked-set lookup. No log entry MUST be written for any allowed read-only invocation.

### Scenario: `metta status` exits 0 with no audit-log entry
- GIVEN `src/templates/hooks/metta-guard-bash.mjs` is active with the updated enforcement logic
- WHEN an orchestrator issues a Bash tool call with `tool_input.command` equal to `metta status` and `process.env.METTA_SKILL` is not set
- THEN the hook exits with code 0 and no line is appended to `.metta/logs/guard-bypass.log`

### Scenario: `metta issues list` exits 0 with no audit-log entry
- GIVEN `src/templates/hooks/metta-guard-bash.mjs` is active with the updated enforcement logic
- WHEN an orchestrator issues a Bash tool call with `tool_input.command` equal to `metta issues list` and `process.env.METTA_SKILL` is not set
- THEN the hook exits with code 0 and no line is appended to `.metta/logs/guard-bypass.log`

---

## ADDED: Requirement: Templates and deployed hook stay byte-identical

`src/templates/hooks/metta-guard-bash.mjs` is the canonical source of truth for the guard hook. `.claude/hooks/metta-guard-bash.mjs` MUST be byte-for-byte identical to the template source at all times. Every commit that modifies `src/templates/hooks/metta-guard-bash.mjs` MUST also update `.claude/hooks/metta-guard-bash.mjs` in the same commit with identical content. `tests/metta-guard-bash.test.ts` MUST continue to exercise both the `source` describe block (path: `src/templates/hooks/metta-guard-bash.mjs`) and the `deployed` describe block (path: `.claude/hooks/metta-guard-bash.mjs`), and both blocks MUST assert the new fail-closed behavior introduced by this change (i.e. that `METTA_SKILL=1 metta issue` returns exit code 2). The existing parity test that compares file contents via `readFile` MUST remain in the suite and MUST fail with a message instructing the contributor to copy the template over the deployed hook when the files diverge.

### Scenario: `diff -q` reports no difference between source and deployed hook
- GIVEN both `src/templates/hooks/metta-guard-bash.mjs` and `.claude/hooks/metta-guard-bash.mjs` have been updated in the same commit
- WHEN `diff -q src/templates/hooks/metta-guard-bash.mjs .claude/hooks/metta-guard-bash.mjs` is run from the project root
- THEN the command exits 0 and produces no output

### Scenario: Both test describe blocks assert the new fail-closed behavior
- GIVEN `tests/metta-guard-bash.test.ts` contains a `source hook` describe block and a `deployed hook` describe block, each iterating over the respective file path
- WHEN the test suite runs after this change is applied
- THEN both blocks contain a test that invokes the hook with `bashEvent('METTA_SKILL=1 metta issue "x"')` (no `METTA_SKILL` env on the process) and asserts `code === 2` and `stderr` contains `/metta-issue`

---

## ADDED: Requirement: Skills using inline METTA_SKILL=1 for enforced subcommands are updated to use an alternative dispatch

A full audit of all `.claude/skills/*/SKILL.md` and `src/templates/skills/*/SKILL.md` MUST be performed as part of this change. The audit MUST locate every occurrence of the pattern `METTA_SKILL=1 metta <subcommand>` where `<subcommand>` is a member of `SKILL_ENFORCED_SUBCOMMANDS`. For each such occurrence, the skill MUST be rewritten to use a dispatch mechanism that survives the new fail-closed guard. The accepted dispatch mechanisms, in priority order, are: (1) rely on the `process.env.METTA_SKILL === '1'` belt-and-suspenders path by ensuring the Claude Code skill runtime sets that environment variable before invoking the Bash tool (the research deliverable MUST confirm whether this is the case); (2) if the runtime does not set `process.env.METTA_SKILL`, invoke the metta CLI via the Node.js binary directly (e.g. `node dist/cli/index.js <subcommand> ...` with `METTA_SKILL=1` set as a shell-level env assignment `METTA_SKILL=1 node ...`, which the hook does not inspect for `metta` invocations); (3) any other mechanism established and documented during the research phase. Both `.claude/skills/*/SKILL.md` and `src/templates/skills/*/SKILL.md` MUST be updated in lockstep — they MUST be byte-identical per skill after the migration. Any skill pair that diverges MUST be treated as a build error.

### Scenario: `/metta-issue` end-to-end still writes an issue file after skill dispatch is migrated
- GIVEN all `.claude/skills/metta-issue/SKILL.md` and `src/templates/skills/metta-issue/SKILL.md` have been updated to use the replacement dispatch mechanism
- WHEN an operator invokes `/metta-issue "test regression in guard hook"` through the normal Claude Code skill flow
- THEN the skill completes without any rejection from `src/templates/hooks/metta-guard-bash.mjs`, and a new file is written under `spec/issues/` containing root-cause analysis content authored by the skill's guided flow steps
