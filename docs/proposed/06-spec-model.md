# 06 — Spec & Artifact Model

## Core Concept

Specs are the source of truth. Code serves specs, not the reverse. Metta's spec model combines OpenSpec's delta evolution with Spec Kit's requirement rigor, while fixing the parallel collision problem that affects both.

---

## Spec Format

```markdown
# Authentication

## Requirement: User Login

The system MUST allow registered users to authenticate with email and password.

### Scenario: Successful login
- GIVEN a registered user with email "user@example.com"
- WHEN they submit valid credentials
- THEN they receive a session token
- AND are redirected to the dashboard

### Scenario: Invalid password
- GIVEN a registered user
- WHEN they submit an incorrect password
- THEN they receive a 401 error
- AND the attempt is logged

## Requirement: Session Management

The system SHOULD expire sessions after 24 hours of inactivity.

### Scenario: Session expiry
- GIVEN a user with an active session
- WHEN 24 hours pass without activity
- THEN the session is invalidated
- AND the user must re-authenticate
```

### Key Properties
- **RFC 2119 keywords**: MUST, SHOULD, MAY for requirement strength
- **Scenario-driven**: Every requirement has concrete Given/When/Then scenarios
- **One capability per file**: `metta/specs/<capability>/spec.md`
- **Human-readable**: Plain markdown, no special syntax beyond conventions

---

## Version Tracking

Every spec file has a companion lock file:

```yaml
# metta/specs/auth/spec.lock
version: 3
hash: "sha256:e3b0c44298..."
updated: "2026-04-04T12:00:00Z"
requirements:
  - id: user-login
    hash: "sha256:a1b2c3..."
    scenarios: [successful-login, invalid-password]
  - id: session-management
    hash: "sha256:d4e5f6..."
    scenarios: [session-expiry]
```

Lock files enable:
- **Conflict detection**: Changes declare their base version; merge checks if base has changed
- **Requirement-level tracking**: Know exactly which requirements changed, not just which files
- **Scenario-level tracking**: Detect when two changes add scenarios to the same requirement

---

## Delta Specs (Changes)

Active changes express modifications as deltas against the current spec:

```markdown
# Authentication (Delta)

## ADDED: Requirement: Multi-Factor Authentication

The system MUST support TOTP-based multi-factor authentication.

### Scenario: MFA setup
- GIVEN a user without MFA configured
- WHEN they navigate to security settings
- THEN they can scan a QR code to set up TOTP

### Scenario: MFA challenge
- GIVEN a user with MFA enabled
- WHEN they log in with valid credentials
- THEN they are prompted for a TOTP code before session creation

## MODIFIED: Requirement: User Login

The system MUST allow registered users to authenticate with email and password,
followed by optional MFA verification.

### Scenario: Successful login (no MFA)
[unchanged — carried forward from base]

### Scenario: Successful login (with MFA)
- GIVEN a registered user with MFA enabled
- WHEN they submit valid credentials AND a valid TOTP code
- THEN they receive a session token

### ADDED Scenario: Login with expired TOTP
- GIVEN a registered user with MFA enabled
- WHEN they submit valid credentials but an expired TOTP code
- THEN they receive a 401 error with message "Invalid or expired code"

## REMOVED: Requirement: Session Management
[Moved to separate session capability]
```

### Delta Operations (6 total)

| Operation | Level | Description |
|-----------|-------|-------------|
| `ADDED` | Requirement | New requirement in this capability |
| `MODIFIED` | Requirement | Changed requirement text or scenarios |
| `REMOVED` | Requirement | Requirement deleted or moved |
| `RENAMED` | Requirement | Requirement name changed |
| `ADDED` | Scenario | New scenario within existing requirement |
| `REMOVED` | Scenario | Scenario deleted from requirement |

This is finer-grained than OpenSpec's 4 operations (which only work at requirement level, causing scenario-level collisions).

---

## Change Metadata

Each active change has metadata:

```yaml
# metta/changes/add-mfa/.metta.yaml
workflow: standard
created: "2026-04-04T12:00:00Z"
status: in_progress
current_artifact: design

base_versions:
  auth/spec.md: "sha256:e3b0c44298..."
  auth/spec.lock: "sha256:f7g8h9..."

artifacts:
  intent: complete
  spec: complete
  design: in_progress
  tasks: pending
  implementation: pending
  verification: pending
```

The `base_versions` field is critical — it records the spec state when the change began. At merge time, the framework compares this against current spec state to detect conflicts.

---

## Merge Algorithm

When a change is archived (`metta ship`):

```
1. For each delta spec in the change:
   a. Read base_version from .metta.yaml
   b. Read current spec.lock
   c. Compare hashes:

   If base == current:
     → Clean merge. Apply deltas directly.

   If base != current:
     → Conflict detected. Check at requirement level:

     For each requirement in delta:
       If requirement hash unchanged in current:
         → Clean. Apply this requirement's delta.
       If requirement changed in both:
         → Conflict. Surface to user.
       If requirement removed in current:
         → Conflict. Surface to user.

2. For conflicts, present interactive resolution:
   a. Show base version, current version, and proposed change
   b. User chooses: accept mine, accept theirs, or manual merge
   c. Record resolution in merge log

3. Apply resolved deltas to specs
4. Update spec.lock with new hashes
5. Move change to archive/
6. Commit with merge metadata
```

### Dry Run

```bash
metta ship --dry-run
```

Shows what would change without modifying anything. Reports conflicts, additions, removals. Always run this first.

---

## Artifact Templates

Templates are external markdown files in `.metta/templates/` (project) or `templates/` (framework defaults). They define the structure an agent should follow when creating an artifact.

### Intent Template
```markdown
# {change_name}

## Problem
What problem does this solve? Who is affected?

## Proposal
What are we changing? Be specific about scope.

## Impact
What existing functionality is affected?

## Out of Scope
What are we explicitly NOT doing?
```

### Spec Template
```markdown
# {capability_name}

## {ADDED|MODIFIED|REMOVED}: Requirement: {requirement_name}

{requirement_text using RFC 2119 keywords}

### Scenario: {scenario_name}
- GIVEN {precondition}
- WHEN {action}
- THEN {expected_outcome}
```

### Tasks Template
```markdown
# Tasks for {change_name}

## Wave 1 (no dependencies)

### Task 1.1: {task_name}
- **Files**: {files to create/modify}
- **Action**: {what to do}
- **Verify**: {how to verify it works}
- **Done**: {acceptance criteria}

## Wave 2 (depends on Wave 1)

### Task 2.1: {task_name}
- **Depends on**: Task 1.1
- **Files**: {files}
- **Action**: {action}
- **Verify**: {verify}
- **Done**: {done}
```

Templates use `{placeholder}` syntax. The framework substitutes values from change metadata and project context. Users override any template by placing a file with the same name in `.metta/templates/`.

---

## Living Specs vs Archived Specs

### Living Specs (`metta/specs/`)
The current truth. Updated when changes are merged. Always reflect the latest agreed-upon behavior.

### Archived Changes (`metta/archive/`)
Historical record of what changed, when, and why. Each archive contains the original intent, delta spec, design, tasks, and summary. Useful for understanding past decisions.

### Spec Discovery
```bash
metta specs list           # List all capabilities
metta specs show auth      # Show current auth spec
metta specs diff auth      # Show pending changes to auth
metta specs history auth   # Show archived changes that touched auth
```

---

## State Schema

All state files are validated on read/write:

```typescript
const ChangeMetadataSchema = z.object({
  workflow: z.string(),
  created: z.string().datetime(),
  status: z.enum(["active", "paused", "complete", "abandoned"]),
  current_artifact: z.string(),
  base_versions: z.record(z.string(), z.string()),
  artifacts: z.record(z.string(), z.enum([
    "pending", "ready", "in_progress", "complete", "failed", "skipped"
  ])),
}).strict()

const SpecLockSchema = z.object({
  version: z.number().int().positive(),
  hash: z.string(),
  updated: z.string().datetime(),
  requirements: z.array(z.object({
    id: z.string(),
    hash: z.string(),
    scenarios: z.array(z.string()),
  })),
}).strict()
```

Schema validation catches corruption immediately rather than letting it propagate through downstream operations.
