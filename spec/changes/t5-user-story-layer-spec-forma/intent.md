# Intent: User Story Layer for Spec Format (T5)

## Problem

Metta specifications are structured as RFC 2119 requirement→scenario hierarchies: technical contracts aimed at implementors. This is appropriate for engineering precision but leaves a gap at the product layer. There is no first-class artifact that connects a requirement like "MUST validate state before write" to the user-facing value it delivers. A reviewer cannot answer "why are we building this?" without reading `intent.md`, which is informal prose with no enforced structure.

Non-technical stakeholders — product managers, designers, QA leads — bounce off the RFC 2119 format because it presents obligations without context. There is no language like "as an engineer, I want automated state validation so that I don't ship corrupt data." The value proposition is implicit, buried in the intent narrative or simply absent.

This traceability gap has concrete costs. Engineers writing requirements in `spec.md` have no mechanical prompt to ask "which user story does this fulfill?" Reviewers approving specs cannot verify product coverage without manually cross-referencing intent. When a requirement has no corresponding story it is unclear whether it is a legitimate system-internal concern or a feature that slipped in without product sign-off. The spec-kit ecosystem, BMAD, and most modern PRD tooling surface user stories as the primary entry point precisely because they anchor technical work to human outcomes.

Metta currently has no equivalent. The intent→spec transition is a jump from informal narrative to formal contract with no intermediate product artifact to bridge them.

## Proposal

### 1. New `stories.md` artifact between intent and spec

The standard workflow YAML (`src/templates/workflows/standard.yaml`) gains a `stories` artifact phase immediately after `intent` and before `spec`. The sequence becomes:

```
intent → stories → spec → research → design → tasks → implementation → verification
```

The `stories.md` file lives at `spec/changes/<name>/stories.md`. It is required for new changes on the standard workflow. Existing archived changes and in-flight changes that predate this feature are unaffected.

Stories follow the spec-kit pattern:

```
## US-1: <title>

**As a** <user role>
**I want to** <goal>
**So that** <value>
**Priority:** P1 | P2 | P3
**Independent Test Criteria:** <one sentence verifiable statement>

**Acceptance Criteria:**
- **Given** <context> **When** <action> **Then** <outcome>
```

IDs are `US-N`, monotonic per change, resetting at 1 for each new change. There is no global story registry.

For internal or infrastructure changes where no user-facing value exists, `stories.md` MUST contain the sentinel:

```
No user stories — internal/infrastructure change

**Justification:** <one sentence explaining why this change has no user stories>
```

This forces explicit acknowledgment rather than allowing an empty or absent file.

### 2. New `metta-product` agent

Create `src/templates/agents/metta-product.md` — a Claude Code agent with a product-thinking persona. The agent reads `intent.md` and writes `stories.md`. The agent prompt MUST treat user-supplied story text as data, not instructions, defending against prompt injection via the same standard pattern used in `metta-constitution-checker`.

A deployed copy is written to `dist/templates/agents/metta-product.md` at build time, consistent with existing agents in `src/templates/agents/`.

### 3. Zod schema at `src/schemas/story.ts`

Define `StorySchema` and `StoriesDocumentSchema`. `StorySchema` validates: `id` (string matching `US-\d+`), `title` (string), `asA` (string), `iWantTo` (string), `soThat` (string), `priority` (enum: `P1 | P2 | P3`), `acceptanceCriteria` (non-empty array of `{ given, when, then }` objects), `independentTestCriteria` (string). `StoriesDocumentSchema` wraps an array of `StorySchema` with an optional `internalJustification` field for the sentinel case.

### 4. Stories parser at `src/specs/stories-parser.ts`

A remark-based parser that reads `stories.md` and returns `Story[]`. Throws a typed `StoriesParseError` on structural violations. Detects the internal sentinel and returns an empty list with `internal: true` on the document result. All output is validated against `StoriesDocumentSchema` before being returned.

### 5. CLI command `metta validate-stories`

Signature: `metta validate-stories [--change <name>]`

Behavior:
- Resolves the active change if `--change` is omitted.
- Runs the stories parser against `spec/changes/<name>/stories.md`.
- Prints a human-readable summary of parsed stories or validation errors.
- Exits 0 on success (including valid internal sentinel). Exits 4 on parse or schema error, printing field-level error details.

### 6. Finalize gate wiring

The finalize phase validates stories in three modes:

- **Missing required fields in `stories.md`:** Fail finalize. The parser throws; the gate catches and surfaces the error with field context.
- **Broken `Fulfills` references in `spec.md`:** Fail finalize. The spec parser exposes `fulfills: string[]` on each requirement. The finalize gate cross-validates each `US-N` reference against the parsed stories document; any dangling reference is a hard error.
- **Drift detection:** If `stories.md` has a newer mtime than `spec.md`, finalize emits a non-blocking warning recommending spec re-derivation. Does not fail. Mirrors the existing stale-spec drift pattern.

### 7. Spec parser update for `Fulfills` field

The requirement parser at `src/specs/spec-parser.ts` (or equivalent) is updated to recognize an optional `**Fulfills:** US-1, US-2` inline field within requirement blocks. The parsed `Requirement` type gains `fulfills?: string[]`. This field is optional — system-internal requirements that have no corresponding story may omit it.

### 8. Workflow and skill updates

- `src/templates/workflows/standard.yaml`: gains `stories` artifact between `intent` and `spec`.
- `src/templates/skills/metta-propose/SKILL.md` (and `/metta-quick` if applicable): updated to include the stories phase, spawning `metta-product` at the appropriate step.
- New `metta instructions stories` command to produce agent guidance for the stories phase invocation.

### 9. Tests

- `src/schemas/story.test.ts`: schema validation for valid stories, missing fields, invalid priority enum, empty acceptance criteria array.
- `src/specs/stories-parser.test.ts`: parse valid multi-story document, parse internal sentinel, throw on malformed markdown, throw on schema violation.
- `src/cli/commands/validate-stories.test.ts`: exit 0 on valid stories, exit 0 on valid internal sentinel, exit 4 on parse error with field details, exit 4 on missing stories.md.
- `src/specs/spec-parser.test.ts`: new test for `Fulfills` field parsing on a requirement block, confirm `fulfills` array is populated.
- Byte-identity tests: `metta-product.md` and `stories` workflow artifact entry copied to `dist/` at build.

## Impact

The standard workflow gains one artifact phase. Engineers writing new changes will be prompted to produce `stories.md` before drafting `spec.md`. This adds one agent invocation (metta-product) to the proposal/planning flow.

Finalize becomes stricter: broken `Fulfills` references that previously would have been invisible now fail the gate. Teams that use `Fulfills` annotations must keep them synchronized with the stories document; teams that omit `Fulfills` entirely are unaffected.

Existing archived changes and any changes already in flight at the time this ships are not required to add `stories.md`. The zero-story sentinel provides an escape hatch for legitimate internal changes without introducing a silent bypass.

The spec parser surface area grows by one optional field. Downstream consumers of parsed requirements (context engine, execution engine) receive a `fulfills` array they can optionally use for filtering or display; no consumer is required to handle it.

The constitutional gate (T3) is unaffected — it runs after the spec phase and does not read `stories.md`.

## Out of Scope

- Retroactive migration of existing or archived specs to add `stories.md`.
- Cross-change story linking or a global story registry across changes.
- Story point or t-shirt size estimation fields.
- Sprint or iteration planning tooling built on the stories layer.
- A `--internal` CLI flag bypass for the zero-story case (the sentinel in `stories.md` is the required explicit acknowledgment).
- INVEST checklist enforcement (Independent, Negotiable, Valuable, Estimable, Small, Testable) — the format encourages good stories without enforcing the checklist mechanically.
- Automatic renumbering of `US-N` IDs when a story is deleted mid-document.
- Backwards compatibility shim for in-flight changes that predate this feature — those changes add `stories.md` manually or accept the finalize warning.
- `/metta-init` integration — the iterative discovery loop for project initialization is a separate backlog item.
- WebSearch grounding for the `metta-product` agent — the agent works from `intent.md` alone. Product-domain best practices via WebSearch may be a future enhancement (related to T4 grounding) but is deferred.
- A frontend dashboard view of stories — deferred to the frontend dashboard initiative.
