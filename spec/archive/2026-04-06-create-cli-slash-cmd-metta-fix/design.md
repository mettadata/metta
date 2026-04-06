# Design: metta fix-gap — Automated Gap Resolution Pipeline

**Change:** create-cli-slash-cmd-metta-fix  
**Date:** 2026-04-06  
**Status:** Draft

---

## 1. Overview

This design describes the implementation of `metta fix-gap`, a CLI command and accompanying skill that drives a reconciliation gap through the complete metta change lifecycle and removes the gap file on success. The approach is skill-orchestrated: the CLI command owns all pure-TypeScript concerns (argument parsing, gap validation, severity classification, `--all` batching, `--json` output, gap file removal), while a new skill file handles multi-agent pipeline orchestration (propose through ship, parallel review and verify fan-out).

This pattern is established by `auto.ts` / `metta-auto/SKILL.md` and `propose.ts` / `metta-propose/SKILL.md`. The fix-gap command is a third instance of the same architecture — it does not introduce a new pattern.

---

## 2. Architecture Decision Records

### ADR-1: Skill-orchestrated over CLI-orchestrated pipeline

**Decision:** Pipeline execution (propose → plan → execute → review ×3 → verify → finalize → ship) is delegated to a skill file, not driven by `execFile` chains in the CLI binary.

**Rationale:** The phases that require sequencing — artifact generation, parallel review fan-out, parallel verify fan-out — are AI agent operations. The CLI binary executes TypeScript; it has no mechanism to spawn three parallel `metta-reviewer` subagents. Every existing multi-phase lifecycle command (`metta auto`, `metta propose`) uses the skill layer for agent orchestration. Encoding pipeline logic in the CLI binary would produce a command that halts at the first AI-dependent phase when no skill is active, and would require the binary to parse subprocess JSON output from prior phases to carry state forward. The skill layer communicates through files on disk (`spec/changes/<change>/`), which is more robust.

**Trade-off documented in research.md:** Terminal-only use cannot run the full AI pipeline. This is intentional and consistent with every other lifecycle command.

**Vendor lock-in:** No vendor lock-in introduced. The skill file format is the project's own convention and invokes the CLI binary via standard subprocess calls.

### ADR-2: Severity is ephemeral, derived at runtime by keyword scan

**Decision:** Severity (`critical` / `medium` / `low`) is computed by scanning raw gap file content case-insensitively at invocation time. It is not stored in the gap file, not exposed on the `Gap` interface, and not committed to disk.

**Rationale:** The intent and spec explicitly prohibit extending the `Gap` interface or the on-disk format. Severity is used only for sort ordering in `--all` mode. Keeping it ephemeral avoids format drift and makes the classification logic fully testable without file writes.

### ADR-3: `--resolve` subcommand name changed to `--remove-gap`

**Decision:** The gap file removal subcommand that the skill calls after a successful ship is exposed as `metta fix-gap --remove-gap <slug>`, not as a positional subcommand.

**Rationale:** Commander.js distinguishes subcommands (positional strings) from options (flags). Removal is an idempotent cleanup operation with a single slug argument; making it a flag rather than a competing positional argument avoids ambiguity with `<gap-name>` and `--all`. The research's implementation boundary table used `--remove-gap`; this design formalises that name.

---

## 3. Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Claude session  (.claude/commands/fix-gap.md)                  │
│                                                                 │
│  /metta:fix-gap [slug]  ──invokes──►  metta-fix-gap/SKILL.md   │
└─────────────────────────────────────────────────────────────────┘
                                              │
                          ┌───────────────────┼───────────────────┐
                          │                   │                   │
                          ▼                   ▼                   ▼
                  metta fix-gap          metta propose       metta-auto/
                  <slug> --json         --from-gap <slug>    SKILL.md
                  (reads gap, sorts,    (creates change,     (review ×3,
                   removes on success,  checks out branch)    verify ×3)
                   emits JSON)
                          │
                          ▼
               ┌─────────────────────┐
               │  src/gaps/          │
               │  gaps-store.ts      │
               │  ─ exists(slug)     │
               │  ─ show(slug)       │
               │  ─ list()           │
               │  ─ remove(slug)     │
               └─────────────────────┘
                          │
                          ▼
               spec/gaps/<slug>.md  (deleted on success)
```

**Files produced by this change:**

| File | Role |
|---|---|
| `src/cli/commands/fix-gap.ts` | CLI command: arg parsing, severity, batch sort, JSON output, gap removal |
| `src/cli/commands/fix-gap.test.ts` | Vitest unit tests |
| `.claude/skills/metta-fix-gap/SKILL.md` | Skill: multi-agent pipeline orchestration |
| `.claude/commands/fix-gap.md` | Slash command: thin wrapper invoking the skill |
| `src/cli/index.ts` | Registration: add `registerFixGapCommand` import and call |

No new modules are created. The command composes `GapsStore` (existing), `createCliContext` (existing), `outputJson` (existing), and `execFile` (Node built-in) exclusively.

---

## 4. Data Flow

### 4.1 Single gap — `metta fix-gap <slug>`

```
User invokes: metta fix-gap execution-engine-callback-errors

1. CLI: GapsStore.exists(slug)
   └─ false → print error, exit 4
   └─ true  → continue

2. CLI: GapsStore.show(slug) → Gap { title, claim, ... }

3. CLI: emit human-readable start message (or JSON start object if --json)
   → message includes: gap slug, severity (computed from raw content), change TBD

4. Skill: metta propose --from-gap <slug> --discovery batch --json
   → returns { change, branch, path }

5. Skill: per-artifact loop (intent → spec → research → design → tasks)
   → one metta-proposer subagent per artifact, isolation: "worktree"

6. Skill: metta execute (parse tasks.md, spawn parallel metta-executors per batch)

7. Skill: spawn 3 metta-reviewer agents in parallel
   → merge results into review.md; review-fix loop up to 3 iterations

8. Skill: spawn 3 metta-verifier agents in parallel
   → merge results into summary.md; verify-fix loop if gates fail

9. Skill: metta finalize --json --change <change>
   → runs gates, archives, merges specs

10. Skill: git checkout main && git merge metta/<change> --no-ff

11. Skill: metta fix-gap --remove-gap <slug>
    └─ CLI: GapsStore.remove(slug)
    └─ CLI: git add spec/gaps/<slug>.md && git commit -m "chore(<slug>): gap resolved"
    └─ CLI: exit 0

12. CLI/Skill: emit final JSON object { gap, change, phases, status: "resolved" }
```

On any phase failure (step 4–10):
- Skill halts pipeline at the failing phase
- Skill calls `metta fix-gap --fail-report <slug> --phase <phase>` OR the orchestrator records the failure in the JSON output
- CLI emits `{ gap, change, phases, status: "failed", failed_phase: "<phase>" }`
- Gap file is NOT removed
- Branch `metta/<change>` remains for manual recovery

### 4.2 All gaps — `metta fix-gap --all`

```
1. CLI: GapsStore.list() → [{ slug, title, status }, ...]
   └─ empty → print "No gaps found.", exit 0

2. CLI: for each slug, read raw file content via fs.readFile
   → parseSeverity(rawContent) → "critical" | "medium" | "low"

3. CLI: sort gaps by severity (critical → medium → low),
   stable sort preserving GapsStore.list() order within each tier

4. CLI: for each sorted gap, invoke single-gap pipeline (delegated to skill)
   → after each attempt, print "[N/M] <slug>: resolved" or "[N/M] <slug>: failed at phase: <phase>"

5. CLI: after all gaps, print "Resolved: X / Failed: Y / Total: Z"
   └─ any failure → exit non-zero
   └─ all resolved → exit 0
```

---

## 5. API Signatures

### 5.1 CLI command registration

```typescript
// src/cli/commands/fix-gap.ts

export function registerFixGapCommand(program: Command): void
```

Commander.js options parsed by this function:

| Argument / Option | Type | Description |
|---|---|---|
| `<gap-name>` | positional string | Slug of a single gap to fix |
| `--all` | boolean flag | Fix all gaps in severity order |
| `--remove-gap <slug>` | string option | Remove gap file and commit (called by skill after ship) |
| `--json` | boolean (global) | Emit structured JSON to stdout; inherited from `program.opts()` |

Mutual exclusion: `<gap-name>` and `--all` are mutually exclusive. If both are supplied, print an error and exit 1.

### 5.2 `parseSeverity`

```typescript
// src/cli/commands/fix-gap.ts (exported for testing)

export function parseSeverity(rawContent: string): 'critical' | 'medium' | 'low'
```

Pure function. No I/O. Accepts the raw text content of a gap markdown file.

**Algorithm:**

```
const lower = rawContent.toLowerCase()
if (/\b(p1|high|critical|bug)\b/.test(lower)) return 'critical'
if (/\b(p2|medium)\b/.test(lower))             return 'medium'
return 'low'
```

Word-boundary anchors (`\b`) prevent `p1` from matching inside `p10` or `gap-1`. The `critical` keyword check runs before `medium` check, implementing precedence by construction (spec Requirement 1.6).

### 5.3 `sortBySeverity`

```typescript
// src/cli/commands/fix-gap.ts (exported for testing)

export type SeverityTier = 'critical' | 'medium' | 'low'

export interface GapWithSeverity {
  slug: string
  title: string
  status: string
  severity: SeverityTier
}

export function sortBySeverity(gaps: GapWithSeverity[]): GapWithSeverity[]
```

Stable sort. Uses numeric weight: `critical = 0`, `medium = 1`, `low = 2`. Preserves input order within a tier. Does not mutate the input array.

### 5.4 JSON output shapes

**Single gap — success:**

```typescript
interface FixGapSuccessOutput {
  gap: string                    // gap slug
  change: string                 // metta change name from propose
  phases: Array<{
    phase: string
    status: 'pass' | 'fail'
  }>
  status: 'resolved'
  // failed_phase intentionally absent
}
```

**Single gap — failure:**

```typescript
interface FixGapFailureOutput {
  gap: string
  change: string                 // present if propose succeeded; empty string otherwise
  phases: Array<{
    phase: string
    status: 'pass' | 'fail'
  }>
  status: 'failed'
  failed_phase: string           // name of the phase that returned non-zero
}
```

**`--all` output:**

```typescript
interface FixGapAllOutput {
  gaps: Array<FixGapSuccessOutput | FixGapFailureOutput>
  summary: {
    resolved: number
    failed: number
    total: number
  }
}
```

**Not-found error:**

```typescript
interface FixGapNotFoundOutput {
  error: {
    code: 4
    type: 'not_found'
    message: string   // "Gap '<slug>' not found"
  }
}
```

---

## 6. Skill Design (`.claude/skills/metta-fix-gap/SKILL.md`)

The skill follows the same structure as `metta-auto/SKILL.md` and `metta-propose/SKILL.md`: it is the orchestrator and spawns typed subagents for each phase. It does not implement any logic that belongs to the CLI command.

**Invocation entry points:**

1. Via slash command with a gap slug argument: `metta fix-gap <slug> --json` is called first to validate the gap and retrieve its details, then the pipeline runs.
2. Via slash command with no arguments: `metta gaps list --json` is called, severity is computed per the spec, a ranked table is displayed, and the user is prompted before any pipeline phase begins.
3. For `--all` mode from the slash command: the skill iterates the severity-sorted list from `metta gaps list --json`, calling the single-gap pipeline per gap sequentially.

**Pipeline steps the skill orchestrates:**

```
1. metta propose --from-gap <slug> --discovery batch --json
   → extract change name from JSON output

2. Per-artifact loop: intent, spec, research, design, tasks
   → one metta-proposer/metta-researcher/metta-architect subagent per artifact
   → isolation: "worktree" for each subagent
   → metta complete <artifact> --json --change <change> after each

3. Implementation
   → read spec/changes/<change>/tasks.md
   → parse batches; spawn parallel metta-executors for non-overlapping files
   → metta complete implementation --json --change <change>

4. Review fan-out: spawn 3 metta-reviewer subagents in parallel
   → correctness, security, quality
   → merge into review.md; review-fix loop up to 3 iterations

5. Verify fan-out: spawn 3 metta-verifier subagents in parallel
   → npm test, tsc + lint, spec scenario coverage
   → merge into summary.md; verify-fix loop if gates fail

6. metta finalize --json --change <change>

7. git checkout main && git merge metta/<change> --no-ff -m "chore: merge <change>"

8. metta fix-gap --remove-gap <slug>
   → CLI removes spec/gaps/<slug>.md and commits
```

**On phase failure:** The skill reports the failed phase name and halts the pipeline for that gap. It does NOT call `--remove-gap`. For `--all` mode it logs the failure and continues to the next gap.

**Discovery mode:** The skill passes `--discovery batch` to `metta propose`. It does NOT issue `AskUserQuestion` discovery prompts during fix-gap. The gap file is assumed to contain sufficient context (title, claim, evidence, action).

---

## 7. Slash Command Design (`.claude/commands/fix-gap.md`)

The slash command is a thin wrapper. It contains no pipeline logic.

**No-argument invocation behavior:**

1. Run `metta gaps list --json` to get gap list.
2. For each gap, read raw content and compute severity (or invoke `metta fix-gap --all --dry-run` if a dry-run flag is added in future; for now, the slash command performs the severity classification inline using the same keyword rules).
3. Display a ranked table sorted critical → medium → low with columns: Severity, Slug, Title.
4. Ask user which gap(s) to fix using `AskUserQuestion` before running any pipeline.
5. On user response, invoke the skill for each selected gap.

**Slug-argument invocation behavior:**

1. Invoke the `metta-fix-gap` skill with the given slug.
2. The skill calls `metta fix-gap <slug> --json` and drives the pipeline.
3. Stream structured JSON output back into the conversation.

The slash command file resides at `.claude/commands/fix-gap.md` (not `.claude/skills/`), consistent with the existing convention for user-facing slash commands.

---

## 8. Error Handling

| Error condition | CLI behavior | Exit code |
|---|---|---|
| Gap slug not found | Print `Gap '<slug>' not found`; with `--json` emit not-found error schema | 4 |
| `<gap-name>` and `--all` both supplied | Print usage error | 1 |
| Neither `<gap-name>` nor `--all` nor `--remove-gap` supplied | Commander.js shows help automatically | 1 |
| Pipeline phase fails (skill returns non-zero) | Print `fix-gap failed at phase: <phase>`; gap file NOT removed; branch left intact | Phase's exit code |
| `--all` with one or more phase failures | Continue to next gap; print per-gap status lines; final summary; exit non-zero | 1 |
| `GapsStore.remove` fails after successful ship | Print error to stderr; emit `status: "resolved"` in JSON (ship succeeded); exit 0 with warning | 0 (ship was successful) |
| `git commit` for gap removal fails | Print warning to stderr; gap file is already removed from disk; exit 0 | 0 |
| `spec/gaps/` directory missing or empty (`--all`) | Print `No gaps found.`; exit 0 | 0 |

**Partial pipeline recovery:** When a single gap fails mid-pipeline, the `metta/<change-name>` branch remains on the current working tree. The developer can resume manually: `git checkout metta/<change-name>` and then run the specific failed phase command (`metta verify`, `metta finalize`, etc.) directly. Fix-gap does not attempt to clean up partial branches or rollback changes already committed on the branch.

---

## 9. Registration

`src/cli/index.ts` requires one new import and one new registration call, inserted alphabetically among the existing register calls:

```typescript
import { registerFixGapCommand } from './commands/fix-gap.js'
// ...
registerFixGapCommand(program)
```

No other files in `src/cli/index.ts` require modification.

---

## 10. Testing Strategy

All tests live in `src/cli/commands/fix-gap.test.ts` using Vitest with `describe`/`it`/`expect`. Tests use temp-dir isolation (create a real `spec/gaps/` subtree in a temp directory) and do not invoke subprocesses or AI agents.

**Test groups:**

| Group | What is tested |
|---|---|
| `parseSeverity` | Critical keywords, medium keywords, low default, precedence (critical+medium → critical), case-insensitivity, empty content |
| `sortBySeverity` | Mixed tiers sorted correctly, stable sort preserves within-tier order, empty input |
| `--remove-gap` subcommand | Calls `GapsStore.remove`, runs git commit, exits 0; gap not found → exit 4 |
| single gap not found | Correct error message and exit code 4, no artifacts created |
| `--all` with no gaps | `No gaps found.` message, exit 0 |
| `--all` severity ordering | Three gaps with distinct tiers are returned in critical → medium → low order |
| `--json` output schema | Success output has no `failed_phase` key; failure output has `failed_phase`; `--all` emits `gaps` array and `summary` object; not-found emits error schema |

The skill file and slash command are not covered by Vitest (they are markdown orchestration instructions, not TypeScript modules). Integration correctness is validated through the spec's Given/When/Then scenarios during the verify phase of this change.

---

## 11. Dependencies

| Dependency | Type | Justification |
|---|---|---|
| `commander` | existing | CLI argument parsing; already used by all commands |
| `node:fs/promises` | built-in | Read raw gap file content for severity scanning (not routed through `GapsStore` to preserve the ephemeral-severity invariant) |
| `node:child_process` / `promisify` | built-in | `execAsync('git', [...])` for the gap-resolved commit; same pattern as `propose.ts` and `finalize.ts` |
| `GapsStore` (existing) | internal | `exists`, `show`, `list`, `remove` |
| `createCliContext` (existing) | internal | Provides `gapsStore` and `projectRoot` |
| `outputJson` (existing) | internal | Consistent JSON output formatting |

No new npm packages are required.

---

## 12. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `--all` processes a gap whose change branch conflicts with a prior gap's merge | Medium | High | Gaps are processed sequentially; each gap is proposed, merged, and the branch deleted before the next gap begins. Sequential ordering reduces but does not eliminate conflict probability. Conflict resolution remains manual. |
| `parseSeverity` word-boundary regex misclassifies a gap containing a phrase like "not a bug" | Low | Low | The spec requires `bug` → critical. A gap titled "this is not a bug fix" will be classified critical. This is acceptable per spec Requirement 1; no exception for negation context is specified. |
| Skill file and CLI command fall out of sync over time | Medium | Medium | The implementation boundary table in `research.md` is reproduced in section 6 of this design as the authoritative split. Tests on the CLI command side cover all CLI-owned behavior; the skill is validated by spec scenarios. |
| `GapsStore.remove` succeeds but the git commit fails | Low | Low | The gap file is already deleted from disk. The gap will not reappear on the next `metta gaps list`. The orphaned deletion is recoverable with a manual `git add` + `git commit`. This is logged as a warning, not a failure. |
| Skill spawns subagents in a worktree that already has uncommitted changes from a prior gap | Low | Medium | Each `metta propose --from-gap` creates a new branch from the current HEAD. Sequential processing means each gap starts from the clean post-merge HEAD of main. |
