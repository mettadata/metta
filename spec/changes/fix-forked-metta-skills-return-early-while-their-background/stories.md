# fix-forked-metta-skills-return-early-while-their-background — User Stories

## US-1: Fork summaries report only completed work

**As a** AI orchestrator driving metta through `context: fork` skills
**I want to** every forked skill (`metta-issue`, `metta-fix-issues`, `metta-propose`, `metta-quick`, `metta-auto`, `metta-ship`) and its host (`metta-skill-host`) to be bound by an explicit synchronous-completion contract — no `run_in_background` Bash, no ending the turn with a dispatched agent still pending, no "in progress" / "running in the background" language in the final message
**So that** I can trust a returned fork summary as a report of completed, verified outcomes and never spawn duplicate workers or hand-clean orphaned processes because a fork exited while its children were still running
**Priority:** P1
**Independent Test Criteria:** Grep confirms `.claude/agents/metta-skill-host.md` and all six `context: fork` `SKILL.md` files contain the synchronous-completion rule, and none contain "I'll wait for it to complete" or background-narration phrasing for launched work.

**Acceptance Criteria:**
- **Given** the `metta-skill-host` agent definition **When** it is inspected **Then** it contains a hard rule forbidding `Bash` with `run_in_background: true`, forbidding ending the turn before a dispatched Agent returns, and forbidding a final message that describes work as still in progress or running in the background
- **Given** each of the six `context: fork` skills (`metta-issue`, `metta-fix-issues`, `metta-propose`, `metta-quick`, `metta-auto`, `metta-ship`) **When** its `SKILL.md` is inspected **Then** it states the same synchronous-completion rule and contains no "I'll wait for it to complete" or equivalent background-narration language
- **Given** a skill step that previously read as backgroundable (e.g. `/metta-ship`'s finalize dry-run) **When** the skill text is read **Then** the step explicitly blocks until the CLI call returns before the fork emits its final message

---

## US-2: Background Bash from forked skills is mechanically blocked

**As a** metta framework maintainer relying on hooks rather than advisory prose
**I want to** the `metta-guard-bash.mjs` PreToolUse hook to reject any `Bash` call with `run_in_background: true` when the calling `agent_type` starts with `metta-`, emitting a clear stderr message that points back to the synchronous-completion rule
**So that** the fork contract is enforced by machinery instead of trust, and the exact Bash-background failure mode observed twice on 2026-07-13/14 can never silently recur
**Priority:** P1
**Independent Test Criteria:** Invoking the hook with a synthetic PreToolUse event (`agent_type: metta-skill-host`, `Bash`, `run_in_background: true`) exits with the blocking exit code and a stderr message referencing the synchronous-completion rule, while the same event with `run_in_background` absent (or from a non-`metta-` agent type) passes.

**Acceptance Criteria:**
- **Given** a PreToolUse event where `agent_type` starts with `metta-` **When** the Bash tool input includes `run_in_background: true` **Then** the hook rejects the call and its stderr message names the synchronous-completion rule the caller violated
- **Given** a PreToolUse event where `agent_type` does not start with `metta-` **When** the Bash tool input includes `run_in_background: true` **Then** the hook does not reject the call on background-dispatch grounds
- **Given** a `metta-` agent making a foreground Bash call **When** the hook evaluates it **Then** existing `SKILL_ENFORCED_SUBCOMMANDS` classification and audit-log behavior apply unchanged

---

## US-3: Lock error message directs to a safe retry, not manual deletion

**As a** AI orchestrator (or developer) hitting a `FinalizeLockError` after a fork died mid-finalize
**I want to** the error message to recommend re-running `metta finalize` — which already reclaims a dead-pid lock via the existing `isPidAlive` check — instead of instructing me to manually delete the lock file
**So that** recovery is a clean retry through the supported path rather than risky hand surgery on `.metta/locks/` that could delete a lock held by a live process
**Priority:** P2
**Independent Test Criteria:** A test asserting the thrown `FinalizeLockError` message recommends re-running `metta finalize` and does not instruct manual deletion of the lock file passes.

**Acceptance Criteria:**
- **Given** a finalize lock held by another live process **When** `acquireFinalizeLock` throws `FinalizeLockError` **Then** the message recommends re-running `metta finalize` and does not tell the caller to delete the lock file manually
- **Given** a finalize lock whose owner pid is dead **When** `metta finalize` is re-run **Then** the existing dead-pid reclaim path acquires the lock and finalize proceeds without any manual lock cleanup

---

## US-4: Stale finalize locks are reclaimed via mtime fallback

**As a** metta user whose finalize lock's dead owner pid was recycled by an unrelated process (or whose pid probe fails with `EPERM`)
**I want to** the finalize lock to also honor an mtime-based staleness fallback, consistent with the 60s stale-lock convention already used by the state store
**So that** a lock abandoned by a crashed or orphaned finalize is reclaimed automatically even when `isPidAlive` alone cannot distinguish a live unrelated process from a dead owner
**Priority:** P2
**Independent Test Criteria:** A unit test creating a lock file with an mtime older than 60s and a pid that appears alive (recycled) verifies `acquireFinalizeLock` reclaims the lock, while a fresh lock with a live pid still throws.

**Acceptance Criteria:**
- **Given** a lock file whose mtime is older than the 60s staleness threshold **When** `acquireFinalizeLock` runs and the pid check cannot rule out the owner being dead (recycled pid or `EPERM`) **Then** the lock is treated as stale and reclaimed
- **Given** a lock file with a recent mtime and a live owner pid **When** `acquireFinalizeLock` runs **Then** the lock is respected and `FinalizeLockError` is thrown
- **Given** a lock with a dead owner pid **When** `acquireFinalizeLock` runs **Then** the existing `isPidAlive` reclaim path still applies, preserved rather than replaced by the mtime fallback

---

## US-5: Status and next surface stale-lock detection proactively

**As a** AI orchestrator running `metta status` or `metta next` to decide the next workflow step
**I want to** routine status output to report a detected dead-pid or stale finalize lock with a "stale finalize lock detected, safe to retry" indication
**So that** I learn about a recoverable lock condition during normal routing instead of only discovering it as a thrown error mid-finalize, and can retry immediately without pid inspection
**Priority:** P3
**Independent Test Criteria:** With a stale finalize lock file present for the active change, running `metta status` and `metta next` produces output containing the stale-lock detection message; with no lock present, the existing output is unchanged.

**Acceptance Criteria:**
- **Given** a stale (dead-pid or mtime-expired) finalize lock for the active change **When** `metta status` runs **Then** its output includes a stale-lock detection line indicating it is safe to retry finalize
- **Given** the same stale lock **When** `metta next` runs **Then** its routing output surfaces the stale-lock detection rather than routing blindly into a failing finalize
- **Given** no finalize lock (or a fresh lock held by a live process) **When** `metta status` or `metta next` runs **Then** existing output is preserved additively, with no false stale-lock warnings
