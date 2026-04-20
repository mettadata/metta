<!--
User stories for this change.
Format: one `## US-N:` block per story with six bold-label fields.
Story IDs MUST be monotonic starting at US-1.
-->

# batch-skill-template-consistency-enforcement-1-pretooluse — User Stories

## US-1: Block state-mutating metta CLI calls from AI orchestrator Bash tool

**As a** framework maintainer
**I want to** have a PreToolUse Bash hook block state-mutating `metta` CLI invocations (propose, quick, auto, complete, finalize, ship, issue, backlog add/done/promote, fix-issue, fix-gap, refresh, import, install, init, changes abandon) when issued through the Claude Bash tool
**So that** AI orchestrators cannot bypass the skill layer and write broken artifacts directly via the CLI
**Priority:** P1
**Independent Test Criteria:** Invoking `metta issue "x"` through a Claude Bash tool event without `METTA_SKILL=1` exits with code 2 and prints a stderr message pointing to the correct skill.

**Acceptance Criteria:**
- **Given** an AI orchestrator session with the PreToolUse Bash hook installed **When** the orchestrator runs `metta issue "foo"` via the Bash tool without `METTA_SKILL=1` **Then** the hook exits 2 and stderr names the `/metta-issue` skill as the required entrypoint
- **Given** the same hook **When** any of the state-mutating commands in the blocklist (propose, quick, complete, finalize, ship, backlog add, fix-issue, refresh, import, install, init, changes abandon) is invoked **Then** each invocation is blocked with exit 2 and a skill pointer

---

## US-2: Human developer running metta CLI in a terminal is unaffected

**As a** human developer
**I want to** run `metta propose`, `metta issue`, and other state-mutating CLI commands directly from my shell
**So that** the hook enforcement scopes only to AI orchestrator sessions and does not break local developer workflows
**Priority:** P1
**Independent Test Criteria:** Running `metta propose "x"` in a plain interactive terminal completes normally because no Claude PreToolUse event fires.

**Acceptance Criteria:**
- **Given** a developer shell with no Claude tool harness active **When** the developer invokes `metta propose "foo"` **Then** the CLI executes without the hook firing and produces its normal output
- **Given** the same shell **When** the developer invokes any blocklisted command **Then** the command runs to completion without exit 2

---

## US-3: Skill-initiated Bash calls pass through via METTA_SKILL bypass

**As a** metta skill author
**I want to** set `METTA_SKILL=1` in my skill's Bash invocations so the guard recognizes the caller as trusted
**So that** skills can legitimately drive state-mutating CLI commands without being blocked by their own guard
**Priority:** P1
**Independent Test Criteria:** A Bash tool event with `METTA_SKILL=1` in the command's env invoking `metta issue` passes the hook with exit 0 and the CLI runs.

**Acceptance Criteria:**
- **Given** the PreToolUse hook installed **When** a Bash tool event runs `METTA_SKILL=1 metta issue "x"` **Then** the hook exits 0 and the CLI proceeds
- **Given** the same hook **When** `METTA_SKILL=1` is set in the environment passed to the Bash tool **Then** the hook treats the invocation as skill-sourced and allows it

---

## US-4: Read-only metta commands pass through without warning

**As an** AI orchestrator
**I want to** run read-only metta commands (status, instructions, issues list, gate list, progress, changes list, doctor) via the Bash tool
**So that** I can inspect project state without being blocked or forced through a skill round-trip
**Priority:** P2
**Independent Test Criteria:** Invoking each read-only command through the Bash tool without `METTA_SKILL=1` returns exit 0 from the hook and produces the CLI's normal output.

**Acceptance Criteria:**
- **Given** the hook installed **When** the orchestrator runs `metta status` via the Bash tool **Then** the hook exits 0 with no stderr warning and the CLI output is returned
- **Given** the same hook **When** `metta issues list`, `metta gate list`, `metta progress`, `metta changes list`, `metta instructions`, or `metta doctor` are invoked **Then** each one passes through without blocking

---

## US-5: Emergency bypass via .claude/settings.local.json

**As a** developer facing an urgent incident where the guard misfires
**I want to** disable the metta-guard-bash hook in `.claude/settings.local.json`
**So that** I can unblock work without editing or uninstalling the hook, mirroring the existing metta-guard-edit bypass pattern
**Priority:** P2
**Independent Test Criteria:** Adding the documented disable entry to `.claude/settings.local.json` suppresses the hook such that a blocklisted command passes with exit 0.

**Acceptance Criteria:**
- **Given** `.claude/settings.local.json` contains the documented disable entry for metta-guard-bash **When** an AI orchestrator invokes `metta issue "x"` via the Bash tool **Then** the command passes through with exit 0
- **Given** the bypass mechanism **When** compared to the metta-guard-edit bypass **Then** the config key shape and precedence rules are identical

---

## US-6: Propose review phase writes to spec/changes/<name>/review/

**As an** AI orchestrator running /metta-propose
**I want to** dispatch the three review personas (correctness, security, quality) to write their reports to `spec/changes/<name>/review/<persona>.md`
**So that** review artifacts live inside the change directory, are committed with the change, and are never orphaned in `/tmp`
**Priority:** P1
**Independent Test Criteria:** After step 5 of `/metta-propose` completes, the three files `review/correctness.md`, `review/security.md`, and `review/quality.md` exist under `spec/changes/<name>/` and no review artifacts exist under `/tmp`.

**Acceptance Criteria:**
- **Given** a change directory `spec/changes/<name>/` **When** the propose skill runs step 5 review fan-out **Then** all three persona reports are written to `spec/changes/<name>/review/<persona>.md` paths
- **Given** the same run **When** the filesystem is inspected **Then** no review artifacts are written under `/tmp`

---

## US-7: Propose verify phase writes to spec/changes/<name>/verify/

**As an** AI orchestrator running /metta-propose
**I want to** dispatch the three verify aspects (tests, tsc-lint, scenarios) to write their reports to `spec/changes/<name>/verify/<aspect>.md`
**So that** verification artifacts live inside the change directory and are preserved through ship
**Priority:** P1
**Independent Test Criteria:** After step 6 of `/metta-propose` completes, the three files `verify/tests.md`, `verify/tsc-lint.md`, and `verify/scenarios.md` exist under `spec/changes/<name>/` and no verify artifacts exist under `/tmp`.

**Acceptance Criteria:**
- **Given** a change directory `spec/changes/<name>/` **When** the propose skill runs step 6 verify fan-out **Then** all three aspect reports are written to `spec/changes/<name>/verify/<aspect>.md` paths
- **Given** the same run **When** the filesystem is inspected **Then** no verify artifacts are written under `/tmp`

---

## US-8: metta install registers the new hook in settings.json

**As a** framework maintainer setting up metta on a new project
**I want to** have `metta install` register the metta-guard-bash PreToolUse hook in `.claude/settings.json` alongside the existing metta-guard-edit hook
**So that** the guard is active from the first AI session without manual configuration
**Priority:** P2
**Independent Test Criteria:** Running `metta install` on a fresh project writes a `.claude/settings.json` whose hooks array contains both `metta-guard-bash` and `metta-guard-edit` entries.

**Acceptance Criteria:**
- **Given** a fresh project directory **When** `metta install` runs **Then** `.claude/settings.json` contains a PreToolUse Bash hook entry pointing to `metta-guard-bash.mjs`
- **Given** the same install **When** the hook file on disk is inspected **Then** `metta-guard-bash.mjs` exists both in the project's hooks directory and the `.claude` mirror with byte-identical contents

---

## US-9: SKILL.md prohibits /tmp paths in review and verify prose

**As a** skill template maintainer
**I want to** have the `/tmp` prohibition called out explicitly in the propose SKILL.md prose for both review and verify steps
**So that** future edits cannot silently regress the output-path contract, and the byte-identity test between the template and `.claude` mirror catches drift
**Priority:** P3
**Independent Test Criteria:** Grepping the updated `metta-propose/SKILL.md` shows explicit prose prohibiting `/tmp` output paths in steps 5 and 6, and the byte-identity test between `src/templates/skills/metta-propose/SKILL.md` and the `.claude` mirror passes.

**Acceptance Criteria:**
- **Given** the updated SKILL.md **When** step 5 and step 6 sections are read **Then** each section explicitly forbids writing artifacts to `/tmp` and names the required `spec/changes/<name>/<phase>/` path
- **Given** both the template source and the `.claude` mirror **When** the skill-discovery-loop byte-identity test runs **Then** the two files are byte-identical and the test passes

---
