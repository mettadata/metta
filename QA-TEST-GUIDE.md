# Metta v0.1 — QA Test Guide

## Prerequisites

```bash
node --version   # Must be >= 22
npm install      # Install dependencies
```

---

## 1. Automated Tests (185 tests)

```bash
# Run all tests
npm test

# Run with verbose output
npx vitest run --reporter=verbose

# Run a specific test file
npx vitest run tests/schemas.test.ts

# Run tests matching a pattern
npx vitest run -t "ChangeMetadata"

# Watch mode during development
npx vitest
```

### Test Coverage by Module

| Test File | Module | Tests | Covers |
|-----------|--------|-------|--------|
| `schemas.test.ts` | Zod Schemas | 28 | All state types, .strict() enforcement, defaults, validation |
| `state-store.test.ts` | State Store | 13 | Read/write, validation errors, locking, file operations |
| `config-loader.test.ts` | Config Loader | 8 | 4-layer resolution, cache, env overrides |
| `provider.test.ts` | Provider Registry | 8 | Register, get, list, mock provider |
| `workflow-engine.test.ts` | Workflow Engine | 13 | Topo sort, cycle detection, getNext, YAML loading |
| `artifact-store.test.ts` | Artifact Store | 12 | Create, list, archive, abandon, mark artifacts |
| `spec-parser.test.ts` | Spec Parser | 7 | Requirements, scenarios, deltas, hashing |
| `ideas-store.test.ts` | Ideas Store | 5 | Create, list, show, context capture |
| `issues-store.test.ts` | Issues Store | 5 | Create, list, show, severity |
| `backlog-store.test.ts` | Backlog Store | 4 | Add, list, show, remove |
| `context-engine.test.ts` | Context Engine | 15 | Budget, truncation, sections, skeleton, cache |
| `template-engine.test.ts` | Template Engine | 7 | Load, render, substitution, search paths |
| `instruction-generator.test.ts` | Instruction Gen | 2 | Full output format, questions |
| `discovery-gate.test.ts` | Discovery Gate | 6 | Completeness checks (scenarios, TODO, GWT, scope) |
| `batch-planner.test.ts` | Batch Planner | 7 | Dependency grouping, overlap, cycles, parsing |
| `gate-registry.test.ts` | Gate Registry | 9 | Register, run, YAML load, retry |
| `execution-engine.test.ts` | Execution Engine | 7 | Execute, state persist, failure, multi-batch |
| `spec-merger.test.ts` | Spec Merger | 5 | ADDED merge, conflict detection, dry-run |
| `finalizer.test.ts` | Finalizer | 2 | Finalize + archive, dry-run |
| `merge-safety.test.ts` | Merge Safety | 4 | Merge, dry-run, drift, conflicts |
| `delivery.test.ts` | Claude Code Adapter | 5 | Skill format, context markers, questions |
| `cli.test.ts` | CLI Commands | 13 | init, propose, quick, status, idea, issue, doctor, etc. |

---

## 2. Manual CLI Testing

Run all CLI commands via `npx tsx src/cli/index.ts` (or build first with `npm run build` then use `node dist/cli/index.js`).

### 2.1 Initialize a Project

```bash
mkdir /tmp/metta-qa && cd /tmp/metta-qa

# Initialize
npx tsx /path/to/metta/src/cli/index.ts init

# Verify created files
ls -la .metta/
ls -la spec/
cat spec/project.md

# JSON output
npx tsx /path/to/metta/src/cli/index.ts --json init
```

**Expected:**
- `.metta/config.yaml` exists
- `spec/project.md` (constitution template) exists
- `spec/specs/`, `spec/changes/`, `spec/archive/`, `spec/issues/`, `spec/backlog/`, `spec/gaps/` directories exist
- `.metta/.gitignore` excludes `state.yaml`, `local.yaml`, `logs/`

### 2.2 Propose a Change

```bash
# Standard workflow
npx tsx .../src/cli/index.ts propose "add user authentication"

# JSON output
npx tsx .../src/cli/index.ts --json propose "add user authentication"

# Quick workflow
npx tsx .../src/cli/index.ts quick "fix login button"

# Custom workflow
npx tsx .../src/cli/index.ts propose --workflow full "rebuild auth system"
```

**Expected:**
- `spec/changes/add-user-authentication/.metta.yaml` created
- Metadata contains: workflow, created timestamp, artifact statuses
- Standard workflow: 7 artifacts (intent→spec→research→design→tasks→implementation→verification)
- Quick workflow: 3 artifacts (intent→implementation→verification)
- Full workflow: 10 artifacts

### 2.3 Check Status

```bash
# Human-readable
npx tsx .../src/cli/index.ts status

# JSON
npx tsx .../src/cli/index.ts --json status

# Specific change
npx tsx .../src/cli/index.ts status add-user-authentication
```

**Expected:**
- Shows change name, workflow, artifact statuses
- First artifact should be `ready`, rest `pending`
- JSON format includes all metadata fields

### 2.4 Get Instructions

```bash
npx tsx .../src/cli/index.ts --json instructions intent
npx tsx .../src/cli/index.ts instructions intent
```

**Expected JSON fields:**
- `artifact`, `change`, `workflow`, `status`
- `agent.name`, `agent.persona`, `agent.tools`, `agent.rules`
- `template` (rendered intent template with change name)
- `output_path` (e.g., `spec/changes/add-user-authentication/intent.md`)
- `budget.context_tokens`, `budget.budget_tokens`
- `next_steps`, `gates`

### 2.5 Issues

```bash
# Log issues
npx tsx .../src/cli/index.ts issue "login flash on hydration" --severity major
npx tsx .../src/cli/index.ts issue "payment rounding error" --severity critical

# List issues
npx tsx .../src/cli/index.ts issues list

# Show issue
npx tsx .../src/cli/index.ts issues show login-flash-on-hydration
```

**Expected:**
- Files created in `spec/issues/`
- List shows slugs and titles
- Show displays full content with metadata
- Severity correctly recorded (critical/major/minor)

### 2.6 Backlog Management

```bash
npx tsx .../src/cli/index.ts backlog add "dark mode" --priority high --source "idea/dark-mode-toggle"
npx tsx .../src/cli/index.ts backlog list
npx tsx .../src/cli/index.ts backlog show dark-mode
npx tsx .../src/cli/index.ts backlog promote dark-mode
```

### 2.7 Specs Management

```bash
npx tsx .../src/cli/index.ts specs list
npx tsx .../src/cli/index.ts specs diff auth
npx tsx .../src/cli/index.ts specs history auth
```

### 2.8 Changes Management

```bash
# List active changes
npx tsx .../src/cli/index.ts changes list

# Show details
npx tsx .../src/cli/index.ts changes show add-user-authentication

# Abandon a change
npx tsx .../src/cli/index.ts changes abandon fix-login-button
```

**Expected:**
- Abandoned changes move to `spec/archive/YYYY-MM-DD-<name>-abandoned/`
- Status set to `abandoned` in metadata
- No longer appears in `changes list`

### 2.9 Gates

```bash
# List built-in gates
npx tsx .../src/cli/index.ts gate list

# Show gate config
npx tsx .../src/cli/index.ts gate show tests

# Run a gate (will use npm test)
npx tsx .../src/cli/index.ts gate run tests
```

**Expected:**
- 4 built-in gates: tests, lint, typecheck, build
- Gate show displays command, timeout, required, on_failure
- Gate run executes the command and reports pass/fail with duration

### 2.10 Verify

```bash
npx tsx .../src/cli/index.ts verify
npx tsx .../src/cli/index.ts --json verify
```

**Expected:**
- Runs all configured gates
- Reports pass/fail per gate with timing
- Exit code 1 if any gate fails, 0 if all pass

### 2.11 Finalize

```bash
# Dry run first
npx tsx .../src/cli/index.ts finalize --dry-run

# Actual finalize
npx tsx .../src/cli/index.ts finalize
```

**Expected:**
- Dry-run shows what would change without modifying files
- Finalize archives the change to `spec/archive/YYYY-MM-DD-<name>/`
- Delta specs are merged into living specs in `spec/specs/`
- Exit code 2 if spec merge conflicts detected

### 2.12 Ship

```bash
# Dry run
npx tsx .../src/cli/index.ts ship --branch feature-branch --dry-run

# Info without branch
npx tsx .../src/cli/index.ts ship
```

**Expected:**
- Without `--branch`: shows info about what target branch is
- With `--branch --dry-run`: runs 7-step pipeline in preview mode (merge/post-merge steps skipped)
- Reports each pipeline step with pass/fail/skip status

### 2.13 Doctor

```bash
npx tsx .../src/cli/index.ts doctor
npx tsx .../src/cli/index.ts --json doctor
```

**Expected checks:**
- Node.js version (>= 22)
- Framework version (0.1.0)
- `.metta` directory exists
- `spec` directory exists
- Constitution (`spec/project.md`) exists
- Git repository detected
- State file integrity

### 2.14 Config

```bash
npx tsx .../src/cli/index.ts config get project.name
npx tsx .../src/cli/index.ts config get defaults.workflow
```

### 2.15 Auto Mode

```bash
npx tsx .../src/cli/index.ts --json auto "build payment system"
npx tsx .../src/cli/index.ts --json auto --resume "anything"
```

---

## 3. Schema Validation Testing

Test that invalid data is rejected at every boundary:

```bash
# Create a corrupt state file
echo "schema_version: abc" > /tmp/metta-qa/.metta/state.yaml

# Doctor should report it
npx tsx .../src/cli/index.ts doctor
# Expected: State file integrity → FAIL
```

```bash
# Create invalid change metadata
mkdir -p /tmp/metta-qa/spec/changes/bad-change
echo "status: invalid_status" > /tmp/metta-qa/spec/changes/bad-change/.metta.yaml

# Status should fail gracefully
npx tsx .../src/cli/index.ts --json status bad-change
# Expected: error with code 4
```

---

## 4. Exit Code Testing

| Scenario | Expected Exit Code |
|----------|--------------------|
| Successful command | 0 |
| Gate failure (tests fail) | 1 |
| Spec conflict during finalize | 2 |
| AI provider error | 3 |
| Validation/missing artifact | 4 |
| User abort | 5 |

```bash
# Test exit code 0
npx tsx .../src/cli/index.ts --json status; echo "Exit: $?"

# Test exit code 4 (no active changes)
npx tsx .../src/cli/index.ts --json verify; echo "Exit: $?"
```

---

## 5. Edge Cases

### 5.1 Multiple Active Changes
```bash
npx tsx .../src/cli/index.ts propose "change one"
npx tsx .../src/cli/index.ts propose "change two"

# Commands requiring a target should error
npx tsx .../src/cli/index.ts status
# Expected: "Multiple active changes: change-one, change-two. Specify which one."

# Explicit targeting works
npx tsx .../src/cli/index.ts status change-one
```

### 5.2 Duplicate Change Names
```bash
npx tsx .../src/cli/index.ts propose "same name"
npx tsx .../src/cli/index.ts propose "same name"
# Expected: Error — "Change 'same-name' already exists"
```

### 5.3 Config Layering
```bash
# Set env override
METTA_DEFAULTS_WORKFLOW=full npx tsx .../src/cli/index.ts --json propose "env test"
# Expected: workflow should be "full" (env overrides config)
```

### 5.4 Workflow Cycle Detection
Create a custom workflow with circular deps and verify it fails:
```yaml
# .metta/workflows/bad.yaml
name: bad
version: 1
artifacts:
  - id: a
    type: test
    template: test.md
    generates: a.md
    requires: [b]
    agents: [executor]
    gates: []
  - id: b
    type: test
    template: test.md
    generates: b.md
    requires: [a]
    agents: [executor]
    gates: []
```
```bash
npx tsx .../src/cli/index.ts propose --workflow bad "test"
# Expected: Error with cycle detection message
```

---

## 6. Type Safety Verification

```bash
# Type-check entire codebase
npx tsc --noEmit

# Should produce zero errors
```

---

## 7. Cleanup

```bash
rm -rf /tmp/metta-qa
```
