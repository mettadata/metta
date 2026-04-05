# 11 — Brownfield Adoption

## Core Problem

Most projects aren't greenfield. They have existing code, existing conventions, existing tests, existing debt. Metta must onboard into a living codebase without requiring a rewrite, a process overhaul, or a week of manual spec-writing.

The goal: **start using Metta for new work today, without touching what already exists.**

---

## Brownfield Init

`metta init` detects whether it's initializing into an empty directory or an existing codebase and adjusts accordingly.

### Greenfield (no existing code)

Discovery asks questions from scratch — stack, conventions, constraints, standards. The user provides all context.

### Brownfield (existing code detected)

Discovery **reads the codebase first, then asks**. The agent infers what it can and only asks about what it can't determine from code.

```bash
cd existing-project
metta init
```

```
Detected existing project (brownfield mode):

Scanning codebase...
  Language:    TypeScript (strict mode)
  Framework:   Next.js 15 (App Router)
  ORM:         Prisma (47 models, 12 migrations)
  Testing:     Vitest (347 tests, 82% coverage)
  Linting:     ESLint + Prettier
  Git:         1,247 commits, 3 contributors
  CI:          GitHub Actions (test + deploy)

Analyzing conventions...
  ✓ Server components dominant in src/app/ (89%)
  ✓ API routes exclusively in src/app/api/
  ✓ Prisma for all DB access (no raw SQL found)
  ✓ Named exports preferred (94% of files)
  ✓ Barrel exports in src/lib/
  ✓ Zod for validation at API boundaries
  ✓ No default exports except page/layout files

Generating constitution draft...
```

Metta presents a **draft constitution** built from codebase analysis:

```
Here's what I found. Please review and correct:

## Stack
Next.js 15 (App Router), Prisma, PostgreSQL, Tailwind CSS, Vitest

## Conventions (inferred from code)
- Server components by default (89% of components)
- All API routes in src/app/api/
- Prisma for all database access — no raw SQL
- Named exports only (except page.tsx/layout.tsx)
- Barrel exports in src/lib/ for shared utilities
- Zod schemas at API boundaries for validation

## Quality Standards (inferred from CI + tests)
- Vitest test suite must pass (82% current coverage)
- ESLint + Prettier enforced
- TypeScript strict mode

? Anything to add or correct?
> We also require all new API routes to have integration tests.
  And we're migrating away from barrel exports — don't create new ones.

? Any architectural constraints not visible in the code?
> No new client-side state management. We tried Redux, removed it.
  Keep bundle under 200KB per route.

? What's off-limits?
> No eval(), no dynamic imports except for code splitting,
  no console.log in production
```

The constitution is generated with the corrections applied. The user reviews the final `docs/project.md` and approves.

### What Brownfield Init Does NOT Do

- **Does not modify existing code** — zero changes to your codebase
- **Does not require existing specs** — you can adopt Metta with no specs and add them incrementally
- **Does not require full codebase import** — `metta import` is optional and can be scoped (`metta import src/app/api/` for just the API layer)
- **Does not assume you'll spec everything** — use Metta for new work only, leave existing code as-is

---

## Spec Extraction — `metta import`

For brownfield projects, writing specs from scratch is wasteful — the behavior already exists in code. `metta import` analyzes existing code and generates spec drafts that capture current behavior.

### Usage

```bash
metta import auth                  # Scan src/auth/ or similar → generate spec draft
metta import --all                 # Scan entire codebase → generate spec drafts per capability
metta import src/app/api/payments  # Scan a specific directory
metta import --dry-run             # Preview what specs would be generated
```

### How It Works

Specs first, then code. Existing specs are the claim. Code is the evidence.

```
metta import auth

1. Find existing specs (claims)
   → Detect framework artifacts (GSD, OpenSpec, Spec Kit, BMAD, Taskmaster)
   → Detect standalone spec files (PRD, requirements docs, markdown specs)
   → Detect test descriptions (Given/When/Then in test files)
   → Build initial requirement list from all spec sources

2. Analyze code (evidence)
   → Find auth-related files (routes, middleware, models, types)
   → Map the dependency graph within the capability
   → Read route handlers → extract endpoints, methods, request/response shapes
   → Read middleware → extract auth flow, session management, error handling
   → Read types → extract data models and constraints
   → Read Prisma schema → extract DB models and relations

3. Reconcile (claims vs evidence)
   → For each requirement from specs: is it implemented in code?
   → For each behavior in code: is it documented in a spec?
   → Flag spec requirements with no code (claimed but not built)
   → Flag code behaviors with no spec (built but not documented)
   → Flag divergences (spec says X, code does Y)

4. Generate spec draft
   → Merge spec claims + code evidence into unified requirements
   → Mark each requirement with reconciliation status
   → Flag behaviors with no test coverage
   → Flag dead code (defined but unreachable)

5. Output
   → docs/specs/auth/spec.md (draft — marked for review)
   → docs/specs/auth/spec.lock (content hashes + reconciliation status)
   → docs/gaps.md (project-wide gaps report)
```

### Gaps Report

After import, Metta writes `docs/gaps.md` — a project-wide report of everything that doesn't line up. This is the honest picture of where the project actually stands.

```markdown
<!-- Generated by metta import — 2026-04-05 -->

# Gaps Report

## Summary
- 8 capabilities scanned
- 24 requirements found (16 from specs, 8 from code only)
- 18 verified (code matches spec)
- 3 partial (some scenarios missing)
- 2 claimed but not built
- 1 built but not documented

## Claimed But Not Built
Spec says these exist. Code says they don't.

### payments/refund-processing
- **Source**: GSD REQUIREMENTS.md, Phase 3 marked "complete"
- **Claim**: "The system MUST support full and partial refunds"
- **Evidence**: Only full refunds implemented (src/app/api/refunds/route.ts)
- **Missing**: Partial refund endpoint, amount validation, partial refund tests
- **Impact**: Users cannot request partial refunds despite spec claiming support

### notifications/push-notifications
- **Source**: GSD REQUIREMENTS.md, Phase 4 marked "complete"
- **Claim**: "The system MUST send push notifications for order updates"
- **Evidence**: No push notification code found. Email notifications exist only.
- **Missing**: Entire push notification implementation
- **Impact**: Feature was never built despite being marked done

## Partially Implemented
Spec and code overlap, but gaps exist.

### auth/password-reset
- **Claim**: "Email + SMS password reset"
- **Evidence**: Email reset works (src/app/api/auth/reset/). No SMS code found.
- **Missing**: SMS reset endpoint, SMS provider integration
- **Test coverage**: Email reset tested (3 tests), SMS reset untested

### payments/subscription-billing
- **Claim**: "Monthly and annual billing cycles"
- **Evidence**: Monthly billing works. Annual billing endpoint exists but returns 501.
- **Missing**: Annual billing calculation, proration logic
- **Test coverage**: Monthly tested (4 tests), annual untested

## Built But Not Documented
Code exists with no corresponding spec from any source.

### auth/rate-limiting
- **Found in**: src/middleware/rate-limit.ts
- **Behavior**: 100 requests/minute per IP, 429 response with Retry-After header
- **Test coverage**: 2 tests in tests/rate-limit.test.ts
- **Action needed**: Add requirement to auth spec or create separate spec

## Divergences
Spec says one thing. Code does another.

### auth/session-management
- **Spec says**: "Sessions expire after 24 hours of inactivity"
- **Code does**: Sessions expire after 12 hours (SESSION_TTL = 43200 in src/lib/auth/config.ts)
- **Action needed**: Update spec to match code, or fix code to match spec
```

The gaps report is regenerated on every `metta import` run. It's also available as a standalone check:

```bash
metta verify --gaps              # Re-run reconciliation and update gaps report
```

This ensures that `metta verify` doesn't just check new work — it can verify the entire project's spec-to-code alignment at any time.

### Example Output

```markdown
<!-- Generated by metta import — review before approving -->
<!-- Source: src/app/api/auth/, src/middleware.ts, src/lib/auth/ -->

# Authentication

## Requirement: User Login

The system MUST allow registered users to authenticate with email and password.

### Scenario: Successful login
- GIVEN a registered user with email "user@example.com"
- WHEN they POST /api/auth/login with valid credentials
- THEN they receive a 200 with a session cookie
- AND the session is stored in the database

### Scenario: Invalid password
- GIVEN a registered user
- WHEN they POST /api/auth/login with an incorrect password
- THEN they receive a 401 with message "Invalid credentials"
- AND the failed attempt is logged

### Scenario: Unregistered email
- GIVEN no user with email "unknown@example.com"
- WHEN they POST /api/auth/login
- THEN they receive a 401 with message "Invalid credentials"
- AND the response is indistinguishable from invalid password (timing-safe)

## Requirement: Session Management

The system MUST expire sessions after 24 hours of inactivity.

### Scenario: Active session
- GIVEN a user with a valid session cookie
- WHEN they make any authenticated request
- THEN the session expiry is extended by 24 hours

### Scenario: Expired session
- GIVEN a user whose session has been inactive for 24+ hours
- WHEN they make an authenticated request
- THEN they receive a 401
- AND are redirected to /login

<!-- WARNING: The following behavior has no test coverage -->
## Requirement: Password Reset

The system SHOULD allow users to reset their password via email.

### Scenario: Request reset (inferred from code, no test found)
- GIVEN a registered user
- WHEN they POST /api/auth/reset-password with their email
- THEN a reset token is generated and emailed
- AND the token expires after 1 hour
```

### Spec Draft States

Scanned specs are marked as drafts until reviewed:

```yaml
# docs/specs/auth/spec.lock
version: 1
hash: "sha256:..."
status: draft          # draft | reviewed | approved
source: scan           # scan | manual | change
scanned_from:
  - src/app/api/auth/
  - src/middleware.ts
  - src/lib/auth/
uncovered_behaviors: 1  # Behaviors with no test coverage
```

Drafts are usable immediately — Metta treats them as the current truth for that capability. But they're flagged so you know they need human review. `metta specs list` shows draft status:

```
Capability     Requirements  Scenarios  Status    Coverage
auth           4             11         draft     82% (1 uncovered)
payments       6             18         approved  100%
profiles       3             7          draft     71% (2 uncovered)
```

### Incremental Scanning

You don't have to scan everything at once. Scan the capabilities you plan to change:

```bash
# Starting a payment refactor? Scan payments first.
metta import payments
metta propose "add refund processing"

# The spec draft gives the agent context about existing payment behavior.
# New work is expressed as deltas against the scanned spec.
```

This is the key brownfield workflow: **scan what you're about to touch, then build on top of it.**

---

## Incremental Adoption

Metta doesn't require full codebase coverage. You can adopt it gradually:

### Level 0: Constitution Only

```bash
metta init
```

Just the constitution + tool context files. No specs, no workflows. Your AI tools get better context immediately through the generated CLAUDE.md / .cursorrules.

### Level 1: Specs for What You Touch

```bash
metta import payments
metta propose "add refund processing"
```

Scan a capability before changing it. New work is spec'd. Old code is untouched.

### Level 2: Full Spec Coverage

```bash
metta import --all
```

Generate spec drafts for the entire codebase. Review and approve over time. Now every change — new or modified — has a spec to build against.

### Level 3: Full Ceremony

```bash
metta auto --workflow full "rebuild notification system"
```

Full workflow with research, architecture, and UX specs. Reserved for major changes where the investment in ceremony pays off.

You move up levels as trust in the system grows. Each level is useful on its own.

---

## Brownfield-Specific Discovery

When discovery runs on a brownfield project, it has access to existing code as evidence. This changes the questions it asks:

### Greenfield Discovery
```
? How should authentication work?
```
Open-ended — no existing behavior to reference.

### Brownfield Discovery
```
Current auth uses JWT with 24h session expiry (from src/lib/auth/session.ts).
Password reset exists but has no test coverage.

? Should the new MFA feature extend the existing JWT session,
  or replace it with a new token type?

? The existing password reset has no tests. Should we add coverage
  as part of this change, or leave it for later?
```

The agent has context. Questions are specific. Discovery is faster and more precise.

---

## Handling Existing Conventions

### Convention Conflicts

When scanned conventions conflict with what the user wants:

```
Inferred: barrel exports in src/lib/ (found in 12 files)
User:     "We're migrating away from barrel exports"

→ Constitution records: "No new barrel exports. Existing ones will be
  removed incrementally. Do not add re-exports to index.ts files."
```

The constitution captures the **direction**, not just the current state. Agents follow the direction, not the legacy pattern.

### Legacy Patterns

Scanned code may contain patterns the team wants to move away from. The constitution should explicitly call these out:

```markdown
## Legacy Patterns (do not replicate)
- Barrel exports in src/lib/ — remove when touching these files
- Class-based components in src/components/legacy/ — convert to function components
- Raw SQL in src/scripts/ — migrate to Prisma when modifying
```

This prevents agents from learning bad habits from existing code.

---

## `metta import` — One Command for Everything

`metta import` is the single entry point for understanding an existing project. It handles all input sources — code analysis, framework artifact ingestion, and reconciliation — in one pass. No separate scan command.

```bash
metta import                        # Auto-detect everything (code + framework artifacts)
metta import auth                   # Import a specific capability
metta import src/app/api/payments   # Import from a specific directory
metta import --all                  # Import entire codebase
metta import --dry-run              # Preview what specs would be generated
```

### What It Does

```
metta import --all

Phase 1: Detect sources
  ✓ Codebase found (TypeScript, Next.js, Prisma)
  ✓ GSD artifacts found (.planning/)
  ✓ Test suite found (Vitest, 347 tests)

Phase 2: Ingest
  ✓ Code analyzed (routes, middleware, models, types)
  ✓ Tests analyzed (scenarios extracted from test descriptions)
  ✓ GSD artifacts mapped:
    - PROJECT.md → docs/project.md (constitution seed)
    - REQUIREMENTS.md → spec extraction
    - 4 phase summaries → docs/archive/

Phase 3: Generate specs
  ✓ 8 spec drafts generated (from code + tests + imported requirements)
```

When framework artifacts exist, `metta import` merges them with what it finds in code. Framework specs provide the requirement language, code provides the verification of what's actually implemented. The result is a unified set of Metta specs with reconciliation status.

### Auto-Detection

`metta init` detects known framework markers and offers to run import:

```bash
metta init

Detected existing framework artifacts:
  ✓ GSD (.planning/ found)

Run metta import to ingest artifacts? [Y/n]
```

### Framework Artifact Mapping

Each framework's artifacts map to Metta's structure:

| Source (GSD) | Target (Metta) |
|-------------|----------------|
| `PROJECT.md` | `docs/project.md` (constitution seed) |
| `REQUIREMENTS.md` | `docs/specs/` (spec extraction) |
| `ROADMAP.md` | Workflow planning context |
| `.planning/N-CONTEXT.md` | Discovery context |
| `.planning/N-*-PLAN.md` | `docs/archive/` (historical reference) |
| `.planning/N-*-SUMMARY.md` | `docs/archive/` |

| Source (Spec Kit) | Target (Metta) |
|------------------|----------------|
| `specs/{branch}/spec.md` | `docs/specs/<capability>/spec.md` |
| `specs/{branch}/plan.md` | `docs/archive/` |
| `specs/{branch}/tasks.md` | `docs/archive/` |
| Constitution | `docs/project.md` (constitution seed) |

| Source (OpenSpec) | Target (Metta) |
|------------------|----------------|
| `openspec/specs/<capability>/spec.md` | `docs/specs/<capability>/spec.md` |
| `openspec/changes/<name>/` | `docs/changes/` or `docs/archive/` |
| `.openspec.yaml` | Change metadata |

| Source (BMAD) | Target (Metta) |
|--------------|----------------|
| `PRD.md` | `docs/specs/` (spec extraction) |
| `architecture.md` | `docs/architecture.md` |
| `epics.md` + stories | `docs/archive/` |
| `_bmad/bmm/config.yaml` | `docs/project.md` (constitution seed) |

| Source (Taskmaster) | Target (Metta) |
|--------------------|----------------|
| `docs/prd.md` | `docs/specs/` (spec extraction) |
| `tasks/tasks.json` | `docs/archive/` |
| `.taskmaster/config.json` | Config migration |

### Reconciliation — Trust Nothing, Verify Everything

Imported specs cannot be trusted at face value. Other frameworks may mark tasks as "complete" without verifying that the code actually implements what the spec says. Gaps accumulate silently.

`metta import` includes a mandatory **reconciliation step** that diffs imported specs against actual codebase behavior:

```
metta import gsd

Phase 1: Import artifacts
  ✓ PROJECT.md → docs/project.md (constitution draft)
  ✓ REQUIREMENTS.md → 8 spec drafts generated
  ✓ 4 phase summaries → docs/archive/

Phase 2: Reconciliation (imported specs vs actual code)

  docs/specs/auth/spec.md:
    ✓ Requirement: User Login — 3/3 scenarios verified in code
    ✓ Requirement: Session Management — 2/2 scenarios verified
    ✗ Requirement: Password Reset — spec says "email + SMS reset"
      but only email reset found in code (src/app/api/auth/reset/)
      → Marked as PARTIAL — SMS reset not implemented

  docs/specs/payments/spec.md:
    ✓ Requirement: Checkout Flow — 4/4 scenarios verified
    ✗ Requirement: Refund Processing — spec says "full and partial refunds"
      but only full refunds implemented (no partial refund endpoint found)
      → Marked as PARTIAL — partial refunds not implemented
    ✗ Requirement: Subscription Billing — entire requirement not implemented
      → Marked as MISSING — no code found

  docs/specs/notifications/spec.md:
    ✗ Entire spec — no corresponding code found
      → Marked as UNIMPLEMENTED — spec exists, zero code

  Reconciliation summary:
    8 specs generated
    5 fully verified      (code matches spec)
    2 partially verified  (some requirements missing from code)
    1 unimplemented       (spec only, no code)
```

This reconciliation runs whether the specs came from code analysis, imported framework artifacts, or both. The output is the same: verified specs you can trust, with gaps clearly flagged.

### Reconciliation States

Each imported requirement gets a reconciliation status:

| Status | Meaning |
|--------|---------|
| `verified` | Code behavior matches spec requirement |
| `partial` | Some scenarios implemented, others missing |
| `missing` | Requirement in spec, no implementation found |
| `unimplemented` | Entire spec has no corresponding code |
| `diverged` | Code exists but behaves differently from spec |
| `undocumented` | Code exists with no corresponding spec (found during scan) |

These states are recorded in the spec lock file:

```yaml
# docs/specs/payments/spec.lock
version: 1
hash: "sha256:..."
status: draft
source: import/gsd
reconciliation:
  verified_at: "2026-04-05T14:00:00Z"
  requirements:
    - id: checkout-flow
      status: verified
      evidence: [src/app/api/checkout/, tests/checkout.test.ts]
    - id: refund-processing
      status: partial
      gaps: ["partial refunds not implemented"]
      evidence: [src/app/api/refunds/]
    - id: subscription-billing
      status: missing
      gaps: ["no code found for subscription billing"]
```

### What Happens After Reconciliation

The user decides what to do with each gap:

```bash
metta specs review payments
```

```
Requirement: Refund Processing (PARTIAL)
  Spec says: "The system MUST support full and partial refunds"
  Code has:  Full refunds only (src/app/api/refunds/route.ts)
  Missing:   Partial refund endpoint, partial refund amount validation

  Options:
  [1] Keep spec as-is — partial refunds are planned work
  [2] Update spec to match code — remove partial refund requirement
  [3] Flag as tech debt — track but don't block

> 1

  → Requirement kept. "Partial refunds" will appear as a gap
    in any future metta verify run.
```

This ensures that when Metta runs `metta verify` later, it checks against **reality**, not against optimistic specs inherited from another framework.

### Gaps Become Specs

The gaps report isn't just documentation — it's actionable. Any gap can be promoted into a new spec or change:

```bash
metta propose --from-gap "payments/refund-processing"
```

This creates a new change pre-populated with the gap's context — what the spec claims, what code exists, what's missing. The discovery gate already has most of the answers, so it asks only what's still ambiguous.

For bulk gap resolution:

```bash
metta propose --from-gaps              # Interactive: pick which gaps to address
metta propose --from-gaps --all        # Create changes for all gaps
```

This closes the loop: import → reconcile → gaps report → specs → plan → execute → verify. The gaps report shrinks with each shipped change until spec and code are fully aligned.

### Import Does Not Delete Source

Imported artifacts are copied, not moved. The original framework's files remain untouched. This lets you:
- Run both frameworks in parallel during migration
- Roll back to the original framework if needed
- Verify the import before committing to Metta

```bash
# After import and review, you can safely remove the old framework's files
# But only when you're confident the specs are correct
rm -rf .planning/          # Remove GSD artifacts
rm -rf openspec/           # Remove OpenSpec artifacts
```

---

## CLI Additions for Brownfield

```bash
metta init                              # Auto-detects greenfield vs brownfield
metta init --skip-scan                  # Force greenfield-style init (ask everything)

metta import                            # Auto-detect everything (specs + code)
metta import <capability>               # Import a specific capability
metta import <directory>                # Import from a specific directory
metta import --all                      # Import entire codebase
metta import --dry-run                  # Preview what would be generated

metta verify --gaps                     # Re-run reconciliation, update gaps report

metta propose --from-gap <gap>          # Create change from a specific gap
metta propose --from-gaps               # Interactive: pick gaps to address
metta propose --from-gaps --all         # Create changes for all gaps

metta specs list                        # Shows draft/reviewed/approved status
metta specs review <capability>         # Interactive review of a draft spec
metta specs approve <capability>        # Mark a draft spec as approved
```
