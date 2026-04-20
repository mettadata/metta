# Design: batch-skill-template-consistency-enforcement-1-pretooluse

## Approach

Two mechanical enforcements land as one change. First, a new `src/templates/hooks/metta-guard-bash.mjs` (plus its byte-identical `.claude/` mirror) implements a minimal whitespace tokenizer on `tool_input.command`: the first non-env-assignment token is checked to equal `metta`, then the second token is classified against a static `BLOCKED` set; two-token subcommands (`backlog add/done/promote`, `changes abandon`) are handled by a second token plus third token check. When the environment variable `METTA_SKILL=1` is present the hook exits 0 immediately without inspecting the command — this is the skill-layer bypass. Any blocked command without the bypass exits 2 and writes a skill-pointer message to stderr. Second, `src/templates/skills/metta-propose/SKILL.md` steps 5 and 6 are rewritten: the review fan-out now mandates `spec/changes/<name>/review/<persona>.md` paths with an explicit `/tmp` prohibition and a post-hoc `test -s` gate; the verify fan-out mirrors that pattern with `spec/changes/<name>/verify/<aspect>.md`. Three skill templates (`metta-propose`, `metta-issue`, `metta-quick`) have `METTA_SKILL=1` prefixed on every state-mutating CLI call so the hook does not block their own legitimate invocations on day one.

## Components

- `src/templates/hooks/metta-guard-bash.mjs` (NEW) — reads Claude hook event JSON from stdin; exits 0 on `METTA_SKILL=1`; exits 0 for non-Bash `tool_name`; tokenizes `tool_input.command` to detect and classify the metta subcommand; exits 2 with skill-pointer stderr on a BLOCKED match; exits 0 on ALLOWED or unknown (fail-open for unrecognized subcommands not in the blocklist). Mirrors the stdin/stderr/exit-2 pattern of `metta-guard-edit.mjs`.
- `.claude/hooks/metta-guard-bash.mjs` (NEW) — byte-identical mirror of the template; maintained in lock-step by the byte-identity test.
- `src/cli/commands/install.ts` (MODIFIED) — a new `installMettaBashGuardHook` function mirrors the existing `installMettaGuardHook` pattern: copies the template to `.claude/hooks/metta-guard-bash.mjs`, reads/parses `settings.json`, checks for an existing `metta-guard-bash.mjs` entry in `PreToolUse` before pushing to avoid duplicates, writes the file. Both hook install functions are called sequentially in the `install` action. The `guardInstalled` success message is updated to name both hooks.
- `src/templates/skills/metta-propose/SKILL.md` (MODIFIED) — step 5 review fan-out rewritten: `mkdir -p` pre-step, numbered MUST bullets naming `spec/changes/<name>/review/correctness.md`, `review/security.md`, `review/quality.md`, explicit `/tmp` prohibition, post-hoc `test -s` check on all three paths before proceeding; `METTA_SKILL=1` prefix on the `metta complete implementation` call in step 5d and `metta finalize` / `metta complete` calls in steps 8 and 3. Step 6 verify fan-out rewritten with the same pattern for `verify/tests.md`, `verify/tsc-lint.md`, `verify/scenarios.md`.
- `.claude/skills/metta-propose/SKILL.md` (MODIFIED) — byte-identical mirror of the template.
- `src/templates/skills/metta-issue/SKILL.md` (MODIFIED) — step 3 CLI call prefixed with `METTA_SKILL=1 ` before `metta issue`.
- `.claude/skills/metta-issue/SKILL.md` (MODIFIED) — byte-identical mirror.
- `src/templates/skills/metta-quick/SKILL.md` (MODIFIED) — step 1 CLI call prefixed with `METTA_SKILL=1 ` before `metta quick`.
- `.claude/skills/metta-quick/SKILL.md` (MODIFIED) — byte-identical mirror.
- `tests/metta-guard-bash.test.ts` (NEW) — unit tests: blocked commands (`propose`, `quick`, `auto`, `complete`, `finalize`, `ship`, `issue`, `fix-issue`, `fix-gap`, `refresh`, `import`, `install`, `init`) each exit 2 and write `/metta-<cmd>` to stderr; `metta backlog add` and `metta changes abandon` exit 2; read-only commands (`status`, `instructions`, `progress`, `doctor`) exit 0; `METTA_SKILL=1 metta issue` exits 0; non-Bash `tool_name` (e.g. `Edit`) exits 0; env-prefix command string `FOO=bar metta propose` exits 2; chain `cd /foo && metta propose` exits 2.
- `tests/install.test.ts` (MODIFIED) — assert `settings.json` PreToolUse block contains a `metta-guard-bash.mjs` entry after install; re-running install does not produce a duplicate entry.
- `tests/skill-discovery-loop.test.ts` (MODIFIED if needed) — byte-identity assertions for all updated SKILL.md mirrors and the new hook mirror must pass.

## Data Model

```
// Claude Code PreToolUse hook event (stdin JSON):
{
  tool_name: 'Bash' | 'Edit' | 'Write' | string,
  tool_input: {
    command: string,        // full shell command string
    description?: string,
    timeout?: number
  },
  hook_event: 'PreToolUse'
}

// In-hook classification tables:
const BLOCKED_SIMPLE = new Set([
  'propose', 'quick', 'auto', 'complete', 'finalize', 'ship',
  'issue', 'fix-issue', 'fix-gap', 'refresh', 'import', 'install', 'init'
]);
const ALLOWED_SIMPLE = new Set([
  'status', 'instructions', 'progress', 'doctor'
]);
// Two-token subcommands resolved as: second token + third token
const BLOCKED_TWO: Map<string, Set<string>> = new Map([
  ['backlog', new Set(['add', 'done', 'promote'])],
  ['changes', new Set(['abandon'])],
  ['issues',  new Set()],   // 'issues list' is read-only — falls to ALLOWED_TWO
]);
const ALLOWED_TWO: Map<string, Set<string>> = new Map([
  ['issues',  new Set(['list'])],
  ['gate',    new Set(['list'])],
  ['changes', new Set(['list'])],
]);
// Unknown subcommands not in either table: block conservatively (exit 2).

// settings.json shape after install (PreToolUse block, new entry):
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|NotebookEdit|MultiEdit",
        "hooks": [{ "type": "command", "command": ".claude/hooks/metta-guard-edit.mjs" }]
      },
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": ".claude/hooks/metta-guard-bash.mjs" }]
      }
    ]
  }
}

// Fan-out artifact path contract (review):
spec/changes/<change-name>/review/correctness.md
spec/changes/<change-name>/review/security.md
spec/changes/<change-name>/review/quality.md

// Fan-out artifact path contract (verify):
spec/changes/<change-name>/verify/tests.md
spec/changes/<change-name>/verify/tsc-lint.md
spec/changes/<change-name>/verify/scenarios.md
```

## API Design

**Hook exit protocol:**
- Exit 0: pass-through (tool invocation proceeds normally)
- Exit 2: block (Claude Code suppresses the tool call; stderr is shown to the orchestrator)

**Hook bypass:**
- `METTA_SKILL=1` present in the process environment at hook invocation time causes immediate exit 0 before any command inspection.
- Skills set this as an inline env assignment: `METTA_SKILL=1 metta <cmd> [args]`.
- Emergency bypass: disable the hook entry in `.claude/settings.local.json` using the same key shape as `metta-guard-edit.mjs`; the exit-2 message names this option.

**Tokenizer contract:**
- Split `tool_input.command` on whitespace.
- Skip leading tokens that are `KEY=VALUE` env assignments (match `/^[A-Z_][A-Z0-9_]*=/i`).
- First remaining token must be `metta`; if not, exit 0 (not a metta command).
- Second token is the subcommand; classify against `BLOCKED_SIMPLE` / `ALLOWED_SIMPLE`.
- If second token is in `BLOCKED_TWO` or `ALLOWED_TWO`, read the third token for the two-word match.
- Unknown subcommand (not in any table): block conservatively (exit 2) to prevent novel state-mutating commands from passing silently.
- Command chains (`&&`, `||`, `;`): scan all semicolon/`&&`/`||`-delimited segments; if any segment matches a blocked pattern, block the whole command.

**Stderr message shape (exit 2):**
```
metta-guard: <subcommand> blocked — call the matching skill instead.
Use /<skill-name> (e.g. /metta-issue, /metta-propose) from an orchestrator session.
Set METTA_SKILL=1 to bypass from within a skill.
Emergency bypass: disable this hook in .claude/settings.local.json.
```

**Install idempotency:**
- `installMettaBashGuardHook` checks for an existing entry by scanning `PreToolUse[*].hooks[*].command` for the string `metta-guard-bash.mjs` before pushing a new entry — same guard used by `installMettaGuardHook` for the edit hook.

**Fan-out path mandate (SKILL.md prose):**
- `mkdir -p spec/changes/<name>/review` is the first MUST bullet in step 5 (orchestrator runs before spawning reviewers).
- Each reviewer is passed its output path explicitly in the subagent prompt.
- Post-hoc check: `test -s spec/changes/<name>/review/correctness.md && test -s spec/changes/<name>/review/security.md && test -s spec/changes/<name>/review/quality.md` must pass before the orchestrator calls `metta complete`.
- Same structure for step 6 with `verify/` paths.

## Dependencies

- `node:fs/promises` — file read/write in install.ts (already used)
- `node:child_process`, `node:util` — already used in install.ts
- `node:path` — already used in install.ts
- `process.env`, `process.stdin`, `process.stderr`, `process.exit` — used by the hook; all built-in to Node.js
- No new external npm packages introduced.
- No new template directories beyond `src/templates/hooks/` (already exists for `metta-guard-edit.mjs`).

## Risks & Mitigations

**R1: Tokenizer mis-classifies complex shell constructs (backticks, subshells, `$(...)`, heredocs).**
The tokenizer operates on the raw command string without a full shell AST. Exotic constructs that embed `metta propose` inside a subshell or heredoc could fool the segment scanner. Mitigation: the hook fails open for genuinely ambiguous strings — it errs toward passing rather than false-blocking. A `metta propose` hidden inside a heredoc represents deliberate bypass effort; the guardrail targets accidental drift, not adversarial circumvention. If false positives emerge, the command-segment scan can be tightened without changing the API surface.

**R2: Missing `METTA_SKILL=1` prefix at a skill call site leaves that skill broken after install.**
If any of the three skills has a call site that was overlooked during the edit, the skill will be blocked by the hook it triggered. Mitigation: the install test asserts that a simulated Bash tool event for each skill's canonical CLI invocation (prefixed with `METTA_SKILL=1`) passes the hook with exit 0. The task list explicitly enumerates every call site per skill to prevent omission.

**R3: `METTA_SKILL=1` leaks into unrelated subprocesses spawned by the metta CLI itself.**
If the metta CLI spawns child processes that themselves invoke `metta`, the bypass env var would be inherited and suppress the guard for those nested calls. Mitigation: the metta CLI does not spawn nested `metta` subprocesses today. If that pattern is introduced in a future change, the bypass behavior should be re-examined at that time and a scoped child-process env strip considered.

**R4: A developer edits one mirror without updating the other, creating byte-identity drift.**
The two-file mirror invariant (`src/templates/` vs `.claude/`) is fragile under manual edits. Mitigation: `tests/skill-discovery-loop.test.ts` byte-identity assertions catch this before commit. The task list for this change lists both files side-by-side for every edit operation, making omission visible during authoring.

**R5: Post-hoc `test -s` check in SKILL.md prose is advisory only — the orchestrator AI may still skip it.**
The check is written into the skill prose as a numbered MUST bullet but cannot be mechanically enforced at the framework level without a dedicated gate. Mitigation: the numbered MUST bullet pattern (matching the implementation batch self-check style already in the skill) has proven effective at raising signal when the orchestrator omits it; the check produces a loud, actionable failure message that the orchestrator can re-spawn on. A future gate integration could enforce this mechanically.

**R6: Unknown metta subcommands are blocked conservatively — a newly added read-only command would be blocked until the blocklist is updated.**
The fail-closed policy for unknown subcommands protects against novel state-mutating commands passing silently, but it also means that adding a new read-only command requires a corresponding `ALLOWED_SIMPLE` entry in the hook. Mitigation: documented in the hook source as an explicit maintenance note; the allowed-list is short and its intended semantics are clear. The alternative (fail-open for unknowns) would silently allow new mutating commands, which is worse.
