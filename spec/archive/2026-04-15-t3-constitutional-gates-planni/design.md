# Design: Constitutional Gates in Planning (T3)

## Approach

The constitutional gate sits entirely within the plan phase and operates in two distinct invocation modes:

1. **CLI invocation** — `metta check-constitution` calls `AnthropicProvider.generateObject` directly (in-process SDK call). This path owns all parsing, cross-checking, file writing, and exit-code logic. It is the sole source of violation semantics and is fully unit-testable via a mocked provider.

2. **Skill invocation** — The `metta-constitution-checker` agent markdown file exists so that orchestrators using the Claude Code Agent tool can delegate to it. This is the same pattern used by `metta-verifier.md`. The agent reads both source files and emits structured JSON; the calling orchestrator (or the plan skill) feeds that JSON to the CLI command. The CLI command is always responsible for cross-checking, writing `violations.md`, and producing exit codes — the agent only identifies violations.

The plan phase skill (`metta-plan/SKILL.md`) gains a post-step (step 4) that calls `metta check-constitution` after all planning artifacts are complete. Re-entry after a constitution failure is handled by the existing `metta status --json` artifact-complete check — if research, design, and tasks are all marked done, the per-artifact loop produces no work and the skill falls through directly to step 4.

All decisions from research are locked. This design formalizes the component-level contracts those decisions imply.

---

## Components

### 1. `src/schemas/violation.ts`

New file in the existing schemas directory, consistent with `src/schemas/agent-definition.ts`. Exports Zod schemas and inferred TypeScript types.

**Exported surface:**

```ts
export const ViolationSchema: z.ZodObject<{
  article:    z.ZodString          // verbatim rule text from constitution
  severity:   z.ZodEnum<['critical','major','minor']>
  evidence:   z.ZodString          // verbatim excerpt from spec.md
  suggestion: z.ZodString          // actionable fix recommendation
}>

export type Violation = z.infer<typeof ViolationSchema>

export const ViolationListSchema: z.ZodObject<{
  violations: z.ZodArray<typeof ViolationSchema>
}>

export type ViolationList = z.infer<typeof ViolationListSchema>
```

`ViolationListSchema` wraps the array because `AnthropicProvider.generateObject` takes a `ZodSchema<T>` and the JSON response root is always an object (see `anthropic-provider.ts:44`). An empty `violations` array is valid and signals a clean spec (REQ-1.7).

This schema MUST be added to `src/schemas/index.ts` via barrel export.

---

### 2. `src/constitution/constitution-parser.ts` (new directory)

Extracts constitution articles from `spec/project.md` using the remark AST pattern established in `src/specs/spec-parser.ts:69`.

**Exported surface:**

```ts
export interface ConstitutionArticles {
  conventions: string[]   // bullet items under ## Conventions
  offLimits:   string[]   // bullet items under ## Off-Limits
}

export function parseConstitution(projectMdPath: string): Promise<ConstitutionArticles>
```

**Implementation contract:**

- Reads the file at `projectMdPath`, parses with `unified().use(remarkParse)`.
- Walks heading nodes: finds depth-2 headings with text `"Conventions"` and `"Off-Limits"`.
- Collects all `listItem` children under each heading until the next depth-2 heading.
- Uses `extractText` (same helper pattern as `spec-parser.ts:41`) to obtain plain-text article strings, stripping surrounding backticks for exact-match purposes.
- Returns articles in document order.
- Throws `ConstitutionParseError` (custom error class) if neither section is found.

The parsed articles are passed verbatim into the system prompt under `<CONSTITUTION>` XML delimiters (D6). They are also used as the article-key space for Complexity Tracking matching (component 3).

---

### 3. `src/constitution/complexity-tracking.ts`

Extracts the `## Complexity Tracking` section from a change's `spec.md` using a two-step regex approach (D4).

**Exported surface:**

```ts
export function parseComplexityTracking(specMdPath: string): Promise<Map<string, string>>
// returns Map<article, rationale>
// returns empty Map if section absent (not an error — many specs have no violations)
```

**Implementation contract:**

- Reads the file at `specMdPath`.
- Step 1: Extract section body with `/^## Complexity Tracking\n([\s\S]*?)(?:\n## |\s*$)/m`. Returns empty Map if no match.
- Step 2: Scan extracted body with `/^- (.+?):\s*(.+)$/gm`; for each match, `captures[1]` is the article key and `captures[2]` is the rationale value.
- Article keys are stored and looked up with exact string equality per REQ-2.8.
- Does not throw on a missing section; only throws on filesystem errors.

---

### 4. `src/constitution/checker.ts`

Orchestrates the full check: parse constitution, build prompt, call provider, cross-check Complexity Tracking, determine blocking status.

**Exported surface:**

```ts
export interface CheckResult {
  violations:    Violation[]
  blocking:      boolean                  // true if any critical or unjustified major violation
  justifiedMap:  Record<string, string>   // article -> rationale for justified violations
}

export interface CheckerOptions {
  provider:     AIProvider       // injected; allows mocking in tests
  projectRoot:  string
  changeName:   string
}

export async function checkConstitution(opts: CheckerOptions): Promise<CheckResult>
```

**Implementation contract:**

1. Resolve `projectMdPath = join(opts.projectRoot, 'spec', 'project.md')` and `specMdPath = join(opts.projectRoot, 'spec', 'changes', opts.changeName, 'spec.md')`.
2. Call `parseConstitution(projectMdPath)` — throws `ConstitutionParseError` on failure.
3. Read `specMdPath` content for embedding in user prompt.
4. Build system prompt (D6 literal text) and user prompt with `<CONSTITUTION>` and `<SPEC>` XML delimiters.
5. Call `opts.provider.generateObject(userPrompt, ViolationListSchema, { system })` — throws `ProviderError` on API or parse failure; these propagate to the CLI command which maps them to exit 4.
6. Call `parseComplexityTracking(specMdPath)` to get `Map<article, rationale>`.
7. For each violation:
   - If `severity === 'critical'`: `justified = false` (REQ-2.8 — critical violations are never excused).
   - If `severity === 'major'`: `justified = justifiedMap.has(violation.article)`.
   - If `severity === 'minor'`: `justified = true` (advisory; never blocks).
8. `blocking = violations.some(v => v.severity === 'critical' || (v.severity === 'major' && !justified))`.
9. Return `CheckResult` with enriched violations (each now carries its `justified` flag and `justification` text if present).

`checkConstitution` has no I/O side effects beyond the provider call. Writing `violations.md` is the CLI command's responsibility.

**No singletons.** `checker.ts` exports a pure function; the provider is injected by the caller.

---

### 5. `src/cli/commands/check-constitution.ts`

Registers `metta check-constitution [--change <name>] [--json]` following the exact pattern of `fix-issue.ts`.

**Exported surface:**

```ts
export function registerCheckConstitutionCommand(program: Command): void
```

**Implementation contract:**

- Resolves `changeName` from `--change` flag or active change via `createCliContext()` and `ctx.artifactStore.listChanges()` (same resolution path as `instructions.ts:34`). Exits 4 if no change can be determined.
- Constructs `AnthropicProvider` with default config.
- Calls `checkConstitution({ provider, projectRoot: ctx.projectRoot, changeName })`.
- On provider error or `ConstitutionParseError`: prints error, exits 4. Does NOT write `violations.md` with zero violations (REQ-2.4 / Scenario 10).
- On success: computes `specVersion` via `git rev-parse --short HEAD` (fallback: empty string). Writes `violations.md` at `spec/changes/<name>/violations.md` (always overwrites — REQ-4.4).
- Applies exit-code logic per REQ-2.7: exit 0 if not blocking, exit 4 if blocking.
- `--json` output shape: `{ violations: Violation[], blocking: boolean, violations_path: string }`.
- Human output: prints each violation's article + severity + evidence; prints blocking violations prominently; prints path to `violations.md`.

`violations.md` is written by the CLI command, not auto-committed. The plan skill handles commit if needed; standalone invocations leave it to the user. This avoids unexpected commits in dirty working trees (same conservative policy as `autoCommitFile` in `helpers.ts`).

---

### 6. `src/templates/agents/metta-constitution-checker.md`

New agent template following the frontmatter structure of `metta-verifier.md`.

**Frontmatter:**

```yaml
---
name: metta-constitution-checker
description: "Metta constitutional compliance checker — reads Conventions + Off-Limits from spec/project.md and checks a change spec.md for violations"
tools: [Read]
color: yellow
---
```

`tools: [Read]` only — the agent reads two files and emits structured JSON. It MUST NOT write files, run Bash, or perform git operations. This is intentional scope restriction per REQ-1.4.

**Persona and body:** Embeds the D6 system prompt verbatim. Instructs the agent to receive `spec/project.md` and `spec/changes/<name>/spec.md` paths as input, read them directly (using the Read tool), wrap constitution content in `<CONSTITUTION>` and spec content in `<SPEC path="...">` XML delimiters internally when reasoning, and emit `{"violations": [...]}` JSON as its final output.

**Deployed copy:** `.claude/agents/metta-constitution-checker.md` must be byte-identical (REQ-1.3). Build process copies `src/templates/agents/` to `dist/templates/agents/` — this is the existing pattern; no new build configuration is required.

---

### 7. `src/templates/skills/metta-check-constitution/SKILL.md`

Thin orchestration wrapper. Frontmatter consistent with `metta-fix-issues/SKILL.md`.

**Frontmatter:**

```yaml
---
name: metta:check-constitution
description: Run the constitutional compliance check against a change's spec.md
argument-hint: "[--change <name>]"
allowed-tools: [Bash]
---
```

**Body contract (REQ-5.3, REQ-5.4):**

- If `$ARGUMENTS` is empty and no active change is detected: use AskUserQuestion to obtain the change name.
- Run `metta check-constitution --change <name>` as a Bash call.
- Echo the path to `violations.md` and the exit code to the user.
- Do NOT re-implement violation parsing or severity logic.

**Deployed copy:** `dist/templates/skills/metta-check-constitution/SKILL.md` via existing build copy step.

---

### 8. Plan skill post-step

`src/templates/skills/metta-plan/SKILL.md` gains step 4 appended after the existing step 3 ("Continue until all planning artifacts are complete"):

```
4. After all planning artifacts (research, design, tasks) are complete:
   a. Run `metta check-constitution --change <name>` (Bash call).
   b. Exit 0 → advance to implementation phase as normal.
   c. Exit 4 →
      - Do NOT spawn any subagents.
      - Read spec/changes/<name>/violations.md and display its contents to the user.
      - Instruct the user: add or extend the ## Complexity Tracking section in
        spec/changes/<name>/spec.md with a bullet "- <article>: <rationale>" for each
        blocking violation, then re-run /metta-plan or metta check-constitution.
      - HALT.
   d. Re-entry after constitution failure: step 1 (metta status --json) will show
      research/design/tasks as complete — the per-artifact loop produces no work and
      falls through directly to step 4a. No new state tracking is needed.
```

---

## Data Model

### Violation (runtime, in-memory)

```ts
interface Violation {
  article:       string                       // verbatim rule text from constitution
  severity:      'critical' | 'major' | 'minor'
  evidence:      string                       // verbatim excerpt from spec.md
  suggestion:    string                       // actionable fix recommendation
  justified?:    boolean                      // set by checker after Complexity Tracking cross-check
  justification?: string                      // rationale text from Complexity Tracking if justified
}
```

The `justified` and `justification` fields are absent in the raw `ViolationSchema` (which covers agent output). They are added by `checkConstitution` before returning `CheckResult`. This avoids leaking internal cross-check fields into the Zod schema that validates agent output — keeping the schema minimal and the agent prompt unambiguous.

### ViolationList (schema / wire format)

```ts
interface ViolationList {
  violations: Violation[]   // without justified/justification fields
}
```

This is what `AnthropicProvider.generateObject` validates against. The wrapping object root is required because `generateObject` expects a JSON object, not a JSON array.

### `violations.md` artifact

```markdown
---
checked: <ISO 8601 timestamp>
spec_version: <git short SHA of HEAD at time of check>
---

# Constitution Violations

## <changeName> — <N> violation(s)

- **[<severity>] <article>** — evidence: `<verbatim excerpt>` — suggestion: <recommendation>. [Justified: "<rationale>".] [Not justified. **BLOCKING.**]
```

When no violations exist:

```markdown
---
checked: <ISO 8601 timestamp>
spec_version: <git short SHA>
---

No violations found.
```

The `justified` and blocking annotations are rendered by the CLI command, not the agent. `spec_version` is obtained via `git rev-parse --short HEAD`; if git is unavailable, the field is written as an empty string.

---

## API Design

### CLI surface

| Command | Options | Exit codes | Output |
|---------|---------|-----------|--------|
| `metta check-constitution` | `--change <name>`, `--json` | 0 (clean or all justified), 4 (blocking or agent error) | Human: per-violation lines + violations.md path. JSON: `{ violations, blocking, violations_path }` |

`minor` violations appear in output but do not affect exit code (REQ-2.7).

### Module function signatures

**`parseConstitution(projectMdPath: string): Promise<ConstitutionArticles>`**
- Input: absolute path to `spec/project.md`.
- Output: `{ conventions: string[], offLimits: string[] }`.
- Throws: `ConstitutionParseError` if sections absent; filesystem errors propagate.

**`parseComplexityTracking(specMdPath: string): Promise<Map<string, string>>`**
- Input: absolute path to a `spec.md`.
- Output: `Map<article, rationale>`; empty if section absent.
- Throws: only on filesystem errors.

**`checkConstitution(opts: CheckerOptions): Promise<CheckResult>`**
- Input: `{ provider: AIProvider, projectRoot: string, changeName: string }`.
- Output: `{ violations: Violation[], blocking: boolean, justifiedMap: Record<string,string> }`.
- Throws: `ConstitutionParseError`, `ProviderError`, filesystem errors. Callers map all throws to exit 4.

**`registerCheckConstitutionCommand(program: Command): void`**
- Side effects: registers Commander subcommand. Called once at startup.

### Provider interface contract

`checker.ts` depends on the `AIProvider` interface (`src/providers/provider.ts`), not the concrete `AnthropicProvider`. This allows test doubles to satisfy the interface without touching the network. The CLI command constructs `AnthropicProvider` and passes it in; production code is wired at the CLI edge (imperative shell, per project convention).

---

## Dependencies

### Internal (no new external packages)

| Dependency | Used by | Already present |
|-----------|---------|----------------|
| `unified` + `remark-parse` | `constitution-parser.ts` | Yes — `src/specs/spec-parser.ts` |
| `AnthropicProvider` / `AIProvider` | `checker.ts` (interface), CLI (concrete) | Yes — `src/providers/` |
| `createCliContext`, `outputJson` | `check-constitution.ts` | Yes — `src/cli/helpers.ts` |
| `ViolationSchema`, `ViolationListSchema` | `checker.ts`, `check-constitution.ts` | New — `src/schemas/violation.ts` |
| `zod` | `violation.ts` | Yes — project-wide |
| `node:fs/promises` | `constitution-parser.ts`, `complexity-tracking.ts` | Yes |
| `node:child_process` / `promisify` | `check-constitution.ts` (git rev-parse) | Yes — pattern in `helpers.ts` |

### External

None. This change adds no new npm dependencies. The Anthropic SDK is already present.

### Vendor lock-in flags

The `AnthropicProvider` is behind the `AIProvider` interface (`src/providers/provider.ts`). Swapping providers requires only a different implementation of `generateObject`. The constitution checker itself has no Anthropic-specific imports. **No new vendor lock-in is introduced.**

---

## Risks and Mitigations

### R1 — Anthropic API flakiness

**Risk:** The API call in `checkConstitution` fails due to a transient network error, rate limit, or timeout.

**Mitigation:** `AnthropicProvider.withRetry` already retries once (`maxRetries: 1` default). Non-retryable errors (`ProviderError`) propagate to the CLI command, which exits 4 with a descriptive message (REQ-2.4). The user must re-run; silent skip is prohibited (intent.md Out of Scope). Rate-limit errors surface the retry-after delay (see `anthropic-provider.ts:98`).

### R2 — `spec/project.md` parsing fails on formatting changes

**Risk:** Future edits to `spec/project.md` change heading names, nest sections, or use non-standard list formatting, causing `parseConstitution` to return an empty article list without error.

**Mitigation:** `parseConstitution` throws `ConstitutionParseError` if neither `## Conventions` nor `## Off-Limits` is found. Test coverage includes a fixture representing the current `spec/project.md` structure. The remark AST approach (D2) is more robust than regex to whitespace variation.

### R3 — Agent produces non-conforming output

**Risk:** The `metta-constitution-checker` agent emits JSON that does not conform to `ViolationListSchema` (e.g., wrong field names, missing severity).

**Mitigation:** `AnthropicProvider.generateObject` validates the response against `ViolationListSchema` via `schema.safeParse` and throws `ProviderError` on failure (see `anthropic-provider.ts:62`). The CLI command treats this as exit 4. The D6 system prompt uses explicit field names and a strict JSON-only instruction to minimize non-conformance.

### R4 — Complexity Tracking article mismatch

**Risk:** Engineers write justification bullets with paraphrased article text (`- No singleton pattern:`) rather than verbatim (`- No singletons:`), causing justified violations to remain blocking.

**Mitigation:** The D6 system prompt instructs the agent to copy article text verbatim from the `<CONSTITUTION>` section. The Complexity Tracking section spec (REQ-2.8) specifies exact string match. The `violations.md` output renders the exact article string for each violation; engineers can copy-paste it into the tracking section. If a match fails, the CLI output names the unmatched articles, making the required exact text visible.

### R5 — `violations.md` accumulates stale data

**Risk:** A prior run with many violations leaves `violations.md` in place; a subsequent clean run fails to overwrite it.

**Mitigation:** REQ-4.4 and Scenario 13 mandate full overwrite on every run. The CLI command opens the file with `{ flag: 'w' }` (truncate-then-write). Test coverage (Scenario 13) verifies byte count differs between runs.

### R6 — Plan skill re-entry re-runs subagents

**Risk:** After a constitution failure, re-invoking `/metta-plan` re-runs research, design, and tasks subagents unnecessarily.

**Mitigation:** Step 4d in the updated plan skill explicitly documents that `metta status --json` artifact-complete detection prevents re-spawning. This relies on the existing `metta complete` tracking mechanism; no new state is introduced. Covered by Scenario 12.

---

## Test Strategy

Tests follow the project convention of near 1:1 ratio with source files. All AI provider calls are mocked; no test hits the live Anthropic API.

### `tests/constitution-parser.test.ts`

Maps to `src/constitution/constitution-parser.ts`.

| Test ID | Spec ref | Description |
|---------|----------|-------------|
| CP-1 | D2 | Parses `## Conventions` bullets from fixture `spec/project.md` |
| CP-2 | D2 | Parses `## Off-Limits` bullets from fixture |
| CP-3 | R2 | Throws `ConstitutionParseError` if neither section found |
| CP-4 | D2 | Handles backtick-wrapped articles, strips them for match key |
| CP-5 | D2 | Returns articles in document order |

Fixture: a small inline markdown string covering both sections in the current format.

### `tests/complexity-tracking.test.ts`

Maps to `src/constitution/complexity-tracking.ts`.

| Test ID | Spec ref | Description |
|---------|----------|-------------|
| CT-1 | D4 | Returns populated Map from well-formed section |
| CT-2 | D4 | Returns empty Map when section absent |
| CT-3 | REQ-2.8 | Exact string match — paraphrased key does not match |
| CT-4 | D4 | Handles section at end of file (no trailing `##` heading) |
| CT-5 | D4 | Handles multiple entries in one section |

### `tests/constitution-checker.test.ts`

Maps to `src/constitution/checker.ts`. Uses a mock `AIProvider` that implements `generateObject`.

| Test ID | Spec ref | Description |
|---------|----------|-------------|
| CHK-1 | Scenario 4 / REQ-1.7 | Empty violations list → `blocking: false` |
| CHK-2 | Scenario 6 | Minor-only violations → `blocking: false`, no justified lookup |
| CHK-3 | Scenario 7 | Unjustified major → `blocking: true` |
| CHK-4 | Scenario 8 | Major with matching Complexity Tracking entry → `blocking: false`, `justified: true` |
| CHK-5 | Scenario 9 | Critical violation with Complexity Tracking entry → `blocking: true` (critical never justified) |
| CHK-6 | R3 / Scenario 10 | Provider throws `ProviderError` → error propagates unwrapped |
| CHK-7 | R4 | Exact article match required; paraphrased key does not justify |
| CHK-8 | CHK-1 | `justifiedMap` is empty when no violations |

### `tests/cli.test.ts` (additions)

New test cases within the existing CLI test suite.

| Test ID | Spec ref | Description |
|---------|----------|-------------|
| CLI-CC-1 | Scenario 5 / REQ-2.7 | Clean spec: exit 0, violations.md contains "No violations found." |
| CLI-CC-2 | Scenario 7 / REQ-2.7 | Unjustified major: exit 4, violations.md lists violation |
| CLI-CC-3 | Scenario 13 / REQ-4.4 | Re-run overwrites violations.md; prior content absent |
| CLI-CC-4 | Scenario 10 / REQ-2.4 | Agent error: exit 4, violations.md NOT written with zero violations |
| CLI-CC-5 | REQ-2.3 | `--json` flag emits `{ violations, blocking, violations_path }` |
| CLI-CC-6 | REQ-2.2 | `--change` omitted: resolves active change; errors if multiple ambiguous |

### Static file tests (byte-identity)

| Test ID | Spec ref | Description |
|---------|----------|-------------|
| BT-1 | Scenario 1 / REQ-1.2, REQ-1.3 | `src/templates/agents/metta-constitution-checker.md` == `dist/...` == `.claude/agents/...` (SHA256 digest) |
| BT-2 | Scenario 14 / REQ-5.2 | `src/templates/skills/metta-check-constitution/SKILL.md` == `dist/...` |

These tests read each file pair and compare SHA256 digests. They run as part of the standard `npm test` suite and are intentionally fast (no I/O beyond file reads).

### Scenario-to-test mapping summary

| Spec scenario | Covered by |
|--------------|-----------|
| Scenario 1 | BT-1 |
| Scenario 2 | CHK-3 (mocked) + manual fixture |
| Scenario 3 | CHK-3 checks `evidence` field preservation |
| Scenario 4 | CHK-1 |
| Scenario 5 | CLI-CC-1 |
| Scenario 6 | CHK-2, CLI-CC-1 |
| Scenario 7 | CHK-3, CLI-CC-2 |
| Scenario 8 | CHK-4 |
| Scenario 9 | CHK-5 |
| Scenario 10 | CHK-6, CLI-CC-4 |
| Scenario 11 | CLI-CC-1 (plan skill behavior is markdown, not unit-testable) |
| Scenario 12 | CLI-CC-2 (plan skill behavior is markdown, not unit-testable) |
| Scenario 13 | CLI-CC-3 |
| Scenario 14 | BT-2 |
| Scenario 15 | Skill body is markdown; documented in skill spec |

---

## ADR-1: CLI calls SDK directly; agent markdown exists for skill orchestration

**Context:** The spec (REQ-2.4) requires the CLI to parse agent output into typed `Violation` records via Zod. Three options were evaluated: direct SDK call, subprocess delegation to agent, and a combined approach.

**Decision:** The CLI command calls `AnthropicProvider.generateObject` directly. The `metta-constitution-checker.md` agent file exists separately for orchestrators that invoke it via the Claude Code Agent tool (same pattern as `metta-verifier.md`). These are two parallel invocation paths, not two implementations.

**Rationale:** Direct SDK call keeps all violation-parsing and exit-code logic in TypeScript where it is unit-testable without subprocess overhead. The agent file satisfies REQ-1.1 through REQ-1.3 without duplicating the parsing logic. Subprocess delegation would require the skill to own parsing (violating REQ-5.4) and would make testing the exit-code logic infeasible without live infrastructure.

**Tradeoff:** The system prompt text is duplicated — once in the agent markdown and once in `checker.ts`. This is acceptable because the agent markdown is a template artifact (not a runtime TypeScript module) and both copies are tested for behavioral consistency via CHK-1 through CHK-8.

## ADR-2: `justified` field is CLI-side, not part of the Zod schema

**Context:** REQ-2.8 defines justified violations as a cross-check between agent output and spec content. Adding `justified` to `ViolationSchema` would require the agent to compute justification, which violates the intent that engineers author justifications manually.

**Decision:** `ViolationSchema` contains exactly the four fields the agent emits (`article`, `severity`, `evidence`, `suggestion`). The `justified` and `justification` fields are added to the in-memory `Violation` type by `checkConstitution` after the Complexity Tracking cross-check.

**Rationale:** Keeps the Zod schema minimal and the agent prompt unambiguous. Separates agent responsibility (identify violations) from CLI responsibility (cross-check justifications). Changing justification logic does not require updating the schema or the agent prompt.

## ADR-3: `violations.md` is not auto-committed by the CLI command

**Context:** Other CLI commands (e.g., `fix-issue.ts`) sometimes call `autoCommitFile`. The `violations.md` artifact should be committed as part of the change record.

**Decision:** The CLI command writes `violations.md` but does not auto-commit it. The plan skill (which calls `check-constitution`) is responsible for committing the file as part of its artifact sequence. Standalone invocations (`/metta-check-constitution` skill, direct CLI use) leave committing to the user.

**Rationale:** `autoCommitFile` in `helpers.ts` is conservative — it aborts if the working tree has other uncommitted tracked changes. During the plan phase, other artifacts may already be staged. Auto-commit would fail or produce unexpected single-file commits. The plan skill already manages artifact commits; adding another auto-commit inside the command creates ordering conflicts. Advisory-only `minor`-violation runs during active development should not force a commit at all.
