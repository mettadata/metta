# User Story Layer for Spec Format (T5) (Delta)

## ADDED: Requirement: Stories Artifact Phase in Standard Workflow

`src/templates/workflows/standard.yaml` MUST declare a `stories` artifact entry with `id: stories`, `type: stories`, `generates: stories.md`, `requires: [intent]`, and `agents: [metta-product]`. This entry MUST appear after the `intent` artifact and before the `spec` artifact so that the sequence is `intent → stories → spec → research → design → tasks → implementation → verification`.

The `spec` artifact entry MUST be updated so that `requires: [stories]` replaces `requires: [intent]`.

The quick workflow (`src/templates/workflows/quick.yaml`) MUST NOT include a `stories` artifact phase — it retains `intent → implementation → verification`.

Existing in-flight changes that predate this feature are exempt from requiring `stories.md`.

### Scenario: Standard workflow lists stories between intent and spec
- GIVEN `src/templates/workflows/standard.yaml` is loaded and parsed
- WHEN its `artifacts` array is examined
- THEN an artifact with `id: "stories"` exists
- AND the index of the `stories` artifact is exactly one greater than the index of the `intent` artifact
- AND the index of the `stories` artifact is exactly one less than the index of the `spec` artifact

### Scenario: Spec artifact requires stories in standard workflow
- GIVEN `src/templates/workflows/standard.yaml` is parsed
- WHEN the artifact with `id: "spec"` is inspected
- THEN its `requires` array contains `"stories"` and does not contain `"intent"`

### Scenario: Quick workflow has no stories artifact
- GIVEN `src/templates/workflows/quick.yaml` is loaded and parsed
- WHEN its `artifacts` array is examined
- THEN no artifact with `id: "stories"` exists
- AND an artifact with `id: "implementation"` has `requires` containing `"intent"`

## ADDED: Requirement: Stories Document Format

`spec/changes/<name>/stories.md` MUST follow the spec-kit-inspired per-story structure. Each story MUST be a level-2 heading of the form `## US-N: <title>` where N is a positive integer. Each story section MUST contain all of the following fields as bold-label lines in order: `**As a**`, `**I want to**`, `**So that**`, `**Priority:** P1|P2|P3`, `**Independent Test Criteria:**`, and `**Acceptance Criteria:**`. The `**Acceptance Criteria:**` field MUST be followed by a bulleted list where each item uses the pattern `- **Given** <context> **When** <action> **Then** <outcome>`.

US-N IDs MUST be monotonic per change, starting at 1 and incrementing by 1. Gaps and duplicate IDs are invalid. There is no global story registry; numbering resets to 1 for each new change.

When a change has no user-facing value, `stories.md` MUST contain exactly the sentinel line `No user stories — internal/infrastructure change` followed by `**Justification:** <rationale>`. An empty file or a file lacking the sentinel is invalid.

### Scenario: Well-formed multi-story document is accepted
- GIVEN a `stories.md` with three story sections `## US-1: …`, `## US-2: …`, `## US-3: …`
- AND each section contains all six required fields with non-empty values
- AND each `**Priority:**` value is one of `P1`, `P2`, or `P3`
- AND each `**Acceptance Criteria:**` is followed by at least one Given/When/Then bullet
- WHEN the document is validated
- THEN validation succeeds with `stories.length === 3`

### Scenario: Internal sentinel document is accepted
- GIVEN a `stories.md` containing only the line `No user stories — internal/infrastructure change` and a `**Justification:** <rationale>` line
- WHEN the document is validated
- THEN validation succeeds with `internal === true` and `stories.length === 0`

### Scenario: Missing required field causes rejection
- GIVEN a `stories.md` with a `## US-1: <title>` section that omits the `**So that**` line
- WHEN the document is validated
- THEN validation fails
- AND the error identifies the missing field and the story ID `US-1`

## ADDED: Requirement: Stories Zod Schema and Parser

`src/schemas/story.ts` MUST export `StorySchema` (Zod object) with required fields: `id` (string matching `/^US-\d+$/`), `title` (string, non-empty), `asA` (string, non-empty), `iWantTo` (string, non-empty), `soThat` (string, non-empty), `priority` (Zod enum `["P1", "P2", "P3"]`), `independentTestCriteria` (string, non-empty), and `acceptanceCriteria` (non-empty array of objects with `given`, `when`, `then` string fields). `StoriesDocumentSchema` MUST export a Zod object wrapping `stories: z.array(StorySchema)` and `internal: z.boolean()` (defaulting to `false`) and `internalJustification: z.string().optional()`.

`src/specs/stories-parser.ts` MUST export `parseStories(path: string): Promise<StoriesDocument>` using a `remark`/`unified` pipeline to extract story sections from the Markdown AST. The parser MUST detect the internal sentinel, set `internal: true`, and return an empty `stories` array in that case. All output MUST be validated against `StoriesDocumentSchema` before being returned. The parser MUST throw `StoriesParseError` (extending `Error` with a typed `field?: string` and `storyId?: string` property) on any structural violation. The parser MUST reject duplicate US-N IDs. The parser MUST reject non-monotonic IDs (e.g., US-1 followed by US-3).

### Scenario: Parser returns three stories from valid document
- GIVEN a `stories.md` file on disk with stories `US-1`, `US-2`, `US-3` all structurally valid
- WHEN `parseStories(path)` is awaited
- THEN the returned `StoriesDocument` has `stories.length === 3`
- AND `stories[0].id === "US-1"` and `stories[2].id === "US-3"`
- AND `internal === false`

### Scenario: Parser returns sentinel document
- GIVEN a `stories.md` with the internal sentinel line and a Justification
- WHEN `parseStories(path)` is awaited
- THEN the returned document has `internal === true`
- AND `stories.length === 0`
- AND `internalJustification` is a non-empty string

### Scenario: Parser throws StoriesParseError on missing field
- GIVEN a `stories.md` with a `## US-1: <title>` section missing the `**As a**` line
- WHEN `parseStories(path)` is awaited
- THEN a `StoriesParseError` is thrown
- AND `error.field === "asA"`
- AND `error.storyId === "US-1"`

### Scenario: Parser throws on duplicate US-N
- GIVEN a `stories.md` with two sections both headed `## US-1: <title>`
- WHEN `parseStories(path)` is awaited
- THEN a `StoriesParseError` is thrown
- AND the error message references duplicate ID `US-1`

### Scenario: Parser throws on non-monotonic IDs
- GIVEN a `stories.md` with sections `## US-1`, `## US-3` (gap at US-2)
- WHEN `parseStories(path)` is awaited
- THEN a `StoriesParseError` is thrown
- AND the error message identifies the sequence violation

## ADDED: Requirement: validate-stories CLI Command

The CLI MUST expose a `validate-stories` subcommand with the signature `metta validate-stories [--change <name>] [--json]`. When `--change <name>` is omitted the command MUST resolve the currently active change from state. Change names MUST be validated with `assertSafeSlug` before use. The command MUST locate `spec/changes/<name>/stories.md`, invoke `parseStories`, and on success print a human-readable summary of parsed stories (or acknowledge the internal sentinel) to stdout, then exit 0. On parse or schema error the command MUST print structured error details to stderr and exit with code 4. When the specified change does not exist on disk the command MUST print a `not_found` error and exit 4. The `--json` flag MUST switch both success and error output to JSON.

### Scenario: Valid stories exits 0
- GIVEN a change `my-feature` with a structurally valid `stories.md` containing two stories
- WHEN `metta validate-stories --change my-feature` is run
- THEN the process exits 0
- AND stdout contains a summary referencing `US-1` and `US-2`

### Scenario: Invalid stories exits 4 with error detail
- GIVEN a change `bad-feature` with a `stories.md` missing `**So that**` on `US-1`
- WHEN `metta validate-stories --change bad-feature` is run
- THEN the process exits 4
- AND stderr contains the field name `soThat` and story ID `US-1`

### Scenario: Missing change directory exits 4 not_found
- GIVEN no change named `ghost-feature` exists on disk
- WHEN `metta validate-stories --change ghost-feature` is run
- THEN the process exits 4
- AND the error output contains `not_found`

## ADDED: Requirement: Spec Parser Fulfills Field

`src/specs/spec-parser.ts` MUST recognize an optional `**Fulfills:** US-N[, US-M …]` line anywhere within the body text of a requirement block. When present, the parsed `Requirement` type MUST expose a `fulfills: string[]` field containing the trimmed story IDs in the order they appear. When the line is absent the `fulfills` field MUST be an empty array `[]`. A malformed `**Fulfills:**` line (e.g., `**Fulfills:** foo, bar` where IDs do not match `/^US-\d+$/`) MUST surface as a parse warning attached to the requirement and MUST NOT throw or fail parsing; `fulfills` MUST be set to `[]` for that requirement.

### Scenario: Requirement with Fulfills line exposes fulfills array
- GIVEN a spec Markdown document with a requirement body containing the line `**Fulfills:** US-1, US-3`
- WHEN `parseSpec` is called
- THEN `requirement.fulfills` equals `["US-1", "US-3"]`

### Scenario: Requirement without Fulfills line has empty array
- GIVEN a spec Markdown document with a requirement body that has no `**Fulfills:**` line
- WHEN `parseSpec` is called
- THEN `requirement.fulfills` equals `[]`

### Scenario: Malformed Fulfills produces warning not error
- GIVEN a spec Markdown document with a requirement body containing `**Fulfills:** wrong-format`
- WHEN `parseSpec` is called
- THEN parsing succeeds
- AND `requirement.fulfills` equals `[]`
- AND `requirement.warnings` contains at least one entry mentioning `Fulfills`

## ADDED: Requirement: Finalize Stories Gate

`metta finalize` MUST run stories validation as part of its gate suite. The gate MUST fail (status `"fail"`) in the following conditions:

1. The change uses the standard workflow and `spec/changes/<name>/stories.md` is missing entirely.
2. `stories.md` exists but `parseStories` throws a `StoriesParseError`.
3. Any `fulfills` reference in `spec.md` (e.g., `US-2`) refers to a story ID that does not exist in the parsed `StoriesDocument`.

When `stories.md` has a last-modified time (`mtime`) strictly greater than `spec.md`'s `mtime`, the gate MUST emit a non-blocking warning with the message recommending spec re-derivation; it MUST NOT set gate status to `"fail"`. Quick-workflow changes MUST have stories validation skipped (gate status `"skip"`).

### Scenario: Clean change with valid stories passes gate
- GIVEN a standard-workflow change with a valid `stories.md` (two stories)
- AND `spec.md` has `**Fulfills:** US-1` on one requirement where `US-1` exists in `stories.md`
- AND `stories.md` mtime is older than `spec.md` mtime
- WHEN `metta finalize` runs the stories gate
- THEN gate status is `"pass"`

### Scenario: Missing stories.md fails gate
- GIVEN a standard-workflow change with no `stories.md` on disk
- WHEN `metta finalize` runs the stories gate
- THEN gate status is `"fail"`
- AND the gate detail references `stories.md` missing

### Scenario: Broken Fulfills reference fails gate
- GIVEN a standard-workflow change with `stories.md` containing only `US-1`
- AND `spec.md` contains `**Fulfills:** US-99` on one requirement
- WHEN `metta finalize` runs the stories gate
- THEN gate status is `"fail"`
- AND the gate detail references dangling reference `US-99`

### Scenario: Drift warning does not block finalize
- GIVEN a standard-workflow change with a valid `stories.md` and a valid `spec.md`
- AND `stories.md` mtime is strictly greater than `spec.md` mtime
- WHEN `metta finalize` runs the stories gate
- THEN gate status is `"warn"`
- AND the gate detail recommends spec re-derivation
- AND finalize continues without aborting

## ADDED: Requirement: metta-product Agent

`src/templates/agents/metta-product.md` MUST exist and MUST contain a valid Claude Code agent frontmatter block with at minimum: `name: metta-product`, `description` (non-empty string describing the product-thinking persona), and `tools` listing at least `Read` and `Write`. The deployed copy at `.claude/agents/metta-product.md` MUST be byte-identical to the source template. The agent prompt body MUST state that `intent.md` content is read as data input and that `stories.md` will be written as output. The prompt MUST contain an explicit injection-defense statement treating user-supplied story text as data, not instructions — mirroring the pattern used in `metta-constitution-checker.md` (`<INTENT>...</INTENT>` XML tag framing or equivalent). The agent MUST follow the `stories.md` format defined in REQ-2 (US-N headings, six required fields, Given/When/Then acceptance criteria, internal sentinel).

### Scenario: Agent file exists with correct frontmatter
- GIVEN the file `src/templates/agents/metta-product.md` is read from disk
- WHEN its frontmatter is parsed
- THEN `name` equals `"metta-product"`
- AND `description` is a non-empty string
- AND `tools` contains at least `"Read"` and `"Write"`

### Scenario: Deployed copy is byte-identical to source template
- GIVEN `src/templates/agents/metta-product.md` and `.claude/agents/metta-product.md` both exist on disk
- WHEN the byte content of both files is compared
- THEN the contents are identical
