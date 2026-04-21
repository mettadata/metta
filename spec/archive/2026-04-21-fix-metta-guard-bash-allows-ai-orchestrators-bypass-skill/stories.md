# Stories — fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill

## US-1: Inline METTA_SKILL prefix no longer bypasses skill-enforced subcommands

**As a** metta maintainer responsible for enforcing the CLAUDE.md "Forbidden" rule
**I want to** block any AI orchestrator Bash call of the form `METTA_SKILL=1 metta issue ...` (and the other high-value subcommands) at the PreToolUse layer
**So that** orchestrators cannot silently self-grant a skill bypass by prepending an env var and must route through the matching `/metta-<skill>` dispatcher
**Priority:** P1
**Independent Test Criteria:** A raw Bash tool invocation whose command string begins with `METTA_SKILL=1 metta issue` is rejected by `src/templates/hooks/metta-guard-bash.mjs` with exit code 2 and stderr text that names the required `/metta-issue` skill.

**Acceptance Criteria:**
- **Given** the PreToolUse hook `src/templates/hooks/metta-guard-bash.mjs` is active **When** an orchestrator issues a Bash tool call with command `METTA_SKILL=1 metta issue "repro"` and the payload carries no skill caller-identity evidence **Then** the hook exits with code 2 and writes a stderr message pointing the caller to `/metta-issue`.
- **Given** the same hook is active **When** an orchestrator issues `METTA_SKILL=1 metta propose "foo"`, `METTA_SKILL=1 metta fix-issue bar`, `METTA_SKILL=1 metta quick "baz"`, `METTA_SKILL=1 metta auto "qux"`, `METTA_SKILL=1 metta ship`, `METTA_SKILL=1 metta finalize`, or `METTA_SKILL=1 metta complete` **Then** each one is rejected with exit code 2 and a message naming the matching skill (`/metta-propose`, `/metta-fix-issues`, `/metta-quick`, `/metta-auto`, `/metta-ship`, `/metta-finalize`, `/metta-ship` respectively).
- **Given** the hook rejects a call **When** the rejection occurs **Then** no metta CLI subprocess for that command is spawned.

## US-2: Legitimate skill dispatches still reach the CLI

**As a** skill author invoking the metta CLI as the final step of a skill
**I want to** have `/metta-issue`, `/metta-propose`, `/metta-fix-issues`, `/metta-quick`, `/metta-auto`, `/metta-ship`, `/metta-finalize`, and `/metta-complete` continue to work end-to-end after the guard is tightened
**So that** hardening the bypass does not regress the actual skill-driven workflow that the CLAUDE.md contract depends on
**Priority:** P1
**Independent Test Criteria:** Running `/metta-issue <description>` through its normal skill flow produces a new issue file under `spec/issues/` with the 7-step RCA content, exactly as it does today, with no new rejection from `src/templates/hooks/metta-guard-bash.mjs`.

**Acceptance Criteria:**
- **Given** the updated hook is installed **When** a skill subagent dispatched by `/metta-issue` runs its final `metta issue ...` CLI call under the Claude Code runtime that sets `process.env.METTA_SKILL=1` **Then** the hook allows the call through and the CLI writes the issue file under `spec/issues/`.
- **Given** the updated hook is installed **When** any of `/metta-propose`, `/metta-fix-issues`, `/metta-quick`, `/metta-auto`, `/metta-ship`, `/metta-finalize`, or `/metta-complete` dispatches its corresponding `metta <cmd>` under the Claude Code skill runtime **Then** the call completes successfully and the guard emits no rejection.
- **Given** both `src/templates/skills/*/SKILL.md` and `.claude/skills/*/SKILL.md` have been audited per Deliverable 5 **When** each skill's CLI dispatch step runs **Then** the dispatch mechanism used by every SKILL.md is the one that the hook positively recognizes (no skill is silently broken by the tighter guard).

## US-3: Every blocked attempt is recorded to the audit log

**As a** metta maintainer investigating whether orchestrators are attempting bypasses
**I want to** see a structured, append-only record of every blocked `metta <cmd>` attempt
**So that** I can detect recurring bypass patterns and attribute them to specific sessions even when the research phase cannot deliver caller-identity verification
**Priority:** P2
**Independent Test Criteria:** After a single blocked attempt via `METTA_SKILL=1 metta issue ...`, `.metta/logs/guard-bypass.log` contains exactly one new JSON line with an ISO timestamp, the subcommand name, the full command string, and any session metadata the PreToolUse payload exposed.

**Acceptance Criteria:**
- **Given** `.metta/logs/` does not yet exist **When** the hook rejects `METTA_SKILL=1 metta issue "x"` **Then** the hook creates `.metta/logs/` and appends one JSON line to `.metta/logs/guard-bypass.log` containing `timestamp` (ISO 8601), `subcommand` (`issue`), `command` (the full original string), `bypass_tokens` (the detected `METTA_SKILL=1` token list), and any payload fields available (for example `session_id`, `transcript_path`, `agent_type`) under a `payload` key.
- **Given** `.metta/logs/guard-bypass.log` already contains prior entries **When** a new rejection occurs **Then** the hook appends a new line without truncating or reading existing content.
- **Given** an allowed call proceeds (for example `metta status`) **When** the hook processes the payload **Then** no line is written to `.metta/logs/guard-bypass.log`.

## US-4: The fail-closed subcommand list is explicit and extensible

**As a** metta maintainer adding a new skill-enforced subcommand in the future
**I want to** extend the fail-closed list in `src/templates/hooks/metta-guard-bash.mjs` in one well-labelled place and have the new subcommand participate in the tightened enforcement automatically
**So that** the guard stays easy to maintain and new skill-enforced commands do not silently slip through the inline-env-var bypass
**Priority:** P2
**Independent Test Criteria:** Adding a new entry to `BLOCKED_SUBCOMMANDS` in `src/templates/hooks/metta-guard-bash.mjs` causes the existing unit test suite in `tests/metta-guard-bash.test.ts` to reject a call of the form `METTA_SKILL=1 metta <new-subcommand>` without any additional branch edits.

**Acceptance Criteria:**
- **Given** `src/templates/hooks/metta-guard-bash.mjs` defines `BLOCKED_SUBCOMMANDS` containing `issue`, `fix-issue`, `propose`, `quick`, `auto`, `ship`, `finalize`, and `complete` **When** a test adds a fictional subcommand to that array and invokes the hook with `METTA_SKILL=1 metta <fictional>` **Then** the hook rejects the call via the same code path as for the existing entries.
- **Given** the two-word variants (`backlog add`, `backlog promote`, `backlog done`, `changes abandon`) remain in `BLOCKED_TWO_WORD` **When** any of them is invoked with an inline `METTA_SKILL=1` prefix **Then** the hook rejects them via the same fail-closed path as the single-word subcommands.
- **Given** `tests/metta-guard-bash.test.ts` exercises the BLOCKED lists **When** the test suite runs **Then** there is at least one test per entry in `BLOCKED_SUBCOMMANDS` confirming the inline-prefix rejection, so future removals or reorderings fail loudly.

## US-5: CLAUDE.md, template hook, and installed hook stay in lockstep

**As a** metta maintainer reading the "Forbidden" section of `CLAUDE.md`
**I want to** have the documented rule match the behavior of both `src/templates/hooks/metta-guard-bash.mjs` and the installed `.claude/hooks/metta-guard-bash.mjs` at every commit
**So that** contributors trust the documented rule and the two hook files never drift from one another
**Priority:** P2
**Independent Test Criteria:** A parity test asserts that `src/templates/hooks/metta-guard-bash.mjs` and `.claude/hooks/metta-guard-bash.mjs` are byte-for-byte identical, and a documentation check asserts that the CLAUDE.md "Forbidden" rule names the same subcommands the hook blocks.

**Acceptance Criteria:**
- **Given** the repository is at HEAD **When** the parity test in `tests/metta-guard-bash.test.ts` (or the integration suite) compares `src/templates/hooks/metta-guard-bash.mjs` with `.claude/hooks/metta-guard-bash.mjs` **Then** the test passes only if the two files have identical SHA-256 digests.
- **Given** CLAUDE.md's "Forbidden" section lists the skill-enforced commands **When** a reviewer reads the section **Then** every subcommand listed there appears in `BLOCKED_SUBCOMMANDS` or `BLOCKED_TWO_WORD` in `src/templates/hooks/metta-guard-bash.mjs`, and vice versa.
- **Given** a contributor updates `src/templates/hooks/metta-guard-bash.mjs` without updating `.claude/hooks/metta-guard-bash.mjs` **When** the test suite runs **Then** the parity test fails with a message instructing the contributor to copy the template over the installed hook.

## US-6: Read-only subcommands remain unaffected

**As a** user relying on read-only metta commands for day-to-day workflow
**I want to** have `metta status`, `metta instructions`, `metta progress`, `metta doctor`, `metta install`, `metta issues list`, `metta gate list`, `metta changes list`, `metta backlog list`, and `metta backlog show` continue to run from any context without audit-log entries or rejections
**So that** the tightened guard does not degrade normal inspection and orchestration flows
**Priority:** P3
**Independent Test Criteria:** Running each of `metta status`, `metta instructions`, `metta progress`, `metta doctor`, `metta install`, `metta issues list`, `metta gate list`, `metta changes list`, `metta backlog list`, and `metta backlog show` through the hook produces exit code 0 and appends no line to `.metta/logs/guard-bypass.log`.

**Acceptance Criteria:**
- **Given** the updated hook is installed **When** an orchestrator runs any of `metta status`, `metta instructions`, `metta progress`, `metta doctor`, `metta install`, `metta issues list`, `metta gate list`, `metta changes list`, `metta backlog list`, or `metta backlog show` **Then** the hook exits 0 and the CLI subprocess runs normally.
- **Given** the same calls are made **When** the hook processes each payload **Then** no entry is appended to `.metta/logs/guard-bypass.log`.
- **Given** the read-only subcommand list is documented in `src/templates/hooks/metta-guard-bash.mjs` **When** a contributor reviews the guard source **Then** the read-only subcommands are distinguished from `BLOCKED_SUBCOMMANDS` and `BLOCKED_TWO_WORD` by a named allow-list or explicit non-membership, not by accident.

## US-7: Skill-file updates do not regress end-to-end dispatch

**As a** metta maintainer who has just edited `src/templates/skills/*/SKILL.md` and `.claude/skills/*/SKILL.md` in lockstep per Deliverable 5
**I want to** confirm that every touched skill's CLI dispatch step still completes end-to-end with the updated guard
**So that** the SKILL.md migration does not introduce a silent breakage where a skill's final `metta <cmd>` step is now rejected by the guard
**Priority:** P3
**Independent Test Criteria:** A smoke test runs each skill that dispatches a blocked subcommand (`/metta-issue`, `/metta-propose`, `/metta-fix-issues`, `/metta-quick`, `/metta-auto`, `/metta-ship`, `/metta-finalize`, `/metta-complete`) through a harness that simulates the Claude Code skill runtime, and every skill reaches a successful CLI dispatch under the updated `src/templates/hooks/metta-guard-bash.mjs`.

**Acceptance Criteria:**
- **Given** each SKILL.md that previously used an inline `METTA_SKILL=1 metta <cmd>` dispatch has been updated per Deliverable 5 **When** the smoke test runs the dispatch step for each skill with `process.env.METTA_SKILL=1` set as it would be in the real runtime **Then** the guard allows the call and the CLI subprocess exits 0.
- **Given** the smoke test runs the same dispatch step with `process.env.METTA_SKILL` unset and no other skill-identity evidence in the payload **Then** the guard rejects the call, confirming the positive gate depends on the intended runtime signal and not on the inline token.
- **Given** `src/templates/skills/*/SKILL.md` and `.claude/skills/*/SKILL.md` are compared after the migration **When** the lockstep check runs **Then** every matching skill pair has byte-identical `SKILL.md` content.
