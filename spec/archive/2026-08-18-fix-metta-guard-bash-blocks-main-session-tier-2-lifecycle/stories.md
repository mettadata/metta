# fix-metta-guard-bash-blocks-main-session-tier-2-lifecycle — User Stories

## US-1: Tier-2 lifecycle commands succeed after legitimate skill invocation

**As a** developer driving metta through an AI orchestrator session
**I want to** run Tier-2 lifecycle commands (`metta complete`, `metta finalize`) from the main session after invoking the matching in-context skill
**So that** the state machine advances without false "credential-expired" blocks, and I am not forced to fork every lifecycle step
**Priority:** P1
**Independent Test Criteria:** With a per-slug token minted by a simulated skill warm-up, an in-scope Tier-2 call is authorized by the guard from both the main-session cwd and a worktree cwd.

**Acceptance Criteria:**
- **Given** an in-context skill (e.g. `/metta-next`) has minted its per-slug session token **When** the orchestrator immediately runs an in-scope Tier-2 command (e.g. `metta complete research --change <c>`) from the main session **Then** the guard authorizes the call instead of blocking with "credential-expired"
- **Given** a per-slug token minted at skill warm-up **When** the Tier-2 call is issued from a worktree cwd rather than the main-session cwd **Then** the guard resolves the token and authorizes the in-scope call
- **Given** a valid, in-scope, live credential **When** the guard evaluates the Tier-2 call **Then** the call is never rejected on freshness grounds while the invoking skill session is genuinely active

---

## US-2: Credential survives long subagent delegation windows

**As a** developer whose lifecycle steps delegate artifact work to `metta-*` subagents
**I want to** have the skill-minted credential remain authoritative across a delegation window longer than the raw mint TTL
**So that** the dominant lifecycle pattern (warm-up → long subagent work → `metta complete`) succeeds without TTL-expiry luck
**Priority:** P1
**Independent Test Criteria:** An integration test mints a token, advances the clock past the raw TTL to simulate subagent delegation, and the subsequent in-scope Tier-2 call is still authorized under the new freshness rules.

**Acceptance Criteria:**
- **Given** a token minted at skill warm-up **When** the clock advances past the original 5-minute TTL during subagent-delegated work and the orchestrator then runs an in-scope Tier-2 command **Then** the guard authorizes the call via the deterministic skill-activity check or the lifecycle-aware freshness window
- **Given** an actively-used main session **When** Bash calls fire before 80% of TTL elapses **Then** the sliding refresh behavior is retained and the token stays fresh
- **Given** no active skill invocation and no eligible token (a genuinely dead credential) **When** a Tier-2 command is attempted **Then** the guard still fails closed and blocks the call

---

## US-3: Deterministic authorization independent of parallel hook ordering

**As a** metta maintainer responsible for the two-tier trust model
**I want to** have Tier-2 freshness resolved deterministically inside the guard rather than racing the separate mint hook
**So that** authorization outcomes do not depend on unordered parallel PreToolUse hook scheduling
**Priority:** P1
**Independent Test Criteria:** An integration test evaluates the guard while the token is expired-but-eligible-for-remint (mint hook not yet run) and the call is authorized, not failed closed.

**Acceptance Criteria:**
- **Given** a token that is past raw TTL but eligible for re-prime by an active skill session **When** the guard evaluates the Tier-2 call before any mint-hook refresh lands **Then** the guard re-primes/accepts the matching per-slug token and authorizes the call
- **Given** the documented parallel, unordered PreToolUse hook execution **When** the mint and guard hooks fire on the same Bash event in any order **Then** the authorization outcome is identical regardless of ordering
- **Given** the fix in place **When** Tier-2 freshness is evaluated **Then** no assumption of new hook-ordering guarantees from the Claude Code runtime is required

---

## US-4: Trust model boundary preserved

**As a** metta maintainer
**I want to** keep the fail-closed posture and non-forgeable authorization sources unchanged while fixing the TTL gap
**So that** the fix does not weaken the two-tier trust model or open a bypass via orchestrator command text
**Priority:** P1
**Independent Test Criteria:** All existing guard tests for absent, malformed, and out-of-scope tokens, Tier-1 fork identity, and allow/block classification continue to pass unchanged.

**Acceptance Criteria:**
- **Given** a missing or malformed credential and no active skill **When** a Tier-2 command is attempted **Then** the guard blocks with `missing-credential` exactly as before
- **Given** a token whose scope does not cover the requested subcommand **When** the Tier-2 call is evaluated **Then** the guard blocks with `subcommand-not-in-scope` exactly as before
- **Given** the skill-activity marker used for deterministic re-prime **When** an orchestrator attempts to fabricate authorization from command text or skill-file contents **Then** the marker cannot be derived or forged that way and the call is not authorized
- **Given** the change is complete **When** Tier-1 fork-identity checks, classification lists, tokenization, and `--` operand handling are exercised **Then** their behavior is byte-for-byte unchanged

---

## US-5: Diagnosable audit trail for authorization decisions

**As a** metta maintainer investigating guard incidents
**I want to** see accurate audit-log entries for both blocks and the new acceptance paths
**So that** future false-block or bypass incidents remain diagnosable from `.metta/logs/guard-bypass.log`
**Priority:** P2
**Independent Test Criteria:** Guard evaluations write `credential-expired` only for genuinely dead credentials, and new acceptance paths write an entry recording their authorization reason.

**Acceptance Criteria:**
- **Given** a genuinely dead credential (no active skill, no eligible token) **When** a Tier-2 call is blocked **Then** a `credential-expired` audit entry is written as before
- **Given** a call authorized via a new acceptance path (deterministic re-prime or grace window) **When** the guard allows it **Then** the audit log records the authorization reason for that path
- **Given** a live skill session **When** in-scope Tier-2 calls are made **Then** no false `credential-expired` entries appear in the log

---

## US-6: Documentation reflects the corrected TTL lifecycle

**As a** developer or contributor reading the trust-model documentation
**I want to** find hook header comments and the CLAUDE.md Tier-2 wording in sync with the corrected credential lifecycle
**So that** the documented behavior matches what the hooks actually enforce
**Priority:** P3
**Independent Test Criteria:** The two-tier trust model description in the hook headers (and CLAUDE.md workflow section, if its Tier-2 wording changes) accurately describes the new freshness rules with no reference to the retired racing-refresh behavior as current.

**Acceptance Criteria:**
- **Given** the fix has landed **When** a reader consults the guard and mint hook header comments **Then** they describe the deterministic re-prime/grace freshness model, not the bare `now - mintedAt < ttlMs` race
- **Given** the CLAUDE.md workflow section's Tier-2 wording no longer matches the implementation **When** documentation sync is performed **Then** the section is updated to match the corrected TTL lifecycle
