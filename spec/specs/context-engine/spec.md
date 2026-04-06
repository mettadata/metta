# Context Engine — Specification

## Overview

The context engine loads, budgets, and formats file-based context for AI agents operating within the metta change lifecycle. It provides per-artifact-type context manifests, token-budget enforcement, content caching with LRU-style eviction, loading strategy transformation, section extraction, and structured instruction generation.

---

## 1. Token Counting

### 1.1 Estimation Model

The system MUST estimate token counts using the formula:

```
tokens = ceil(characters / 4)
```

This approximation is accurate for English prose and source code. CJK and emoji-heavy content MAY undercount by 2–3x; callers MUST treat the count as a lower bound in such cases.

The `countTokens(text: string): number` function MUST:
- Return `0` for an empty string.
- Apply `Math.ceil` so fractional results round up.
- Accept Unicode input without error.

**Scenarios**

Given a string of exactly 4 characters,
When `countTokens` is called,
Then it MUST return `1`.

Given a string of 3 characters,
When `countTokens` is called,
Then it MUST return `1` (ceiling applied).

Given an empty string,
When `countTokens` is called,
Then it MUST return `0`.

---

## 2. Context Manifests

### 2.1 Per-Artifact Manifests

The system MUST maintain a static manifest for each artifact type. Each manifest declares:
- `required`: files that MUST be loaded when they exist.
- `optional`: files that SHOULD be loaded in declaration order until the budget is exhausted.
- `budget`: the default token budget for the artifact type.

| Artifact Type | Required Sources | Optional Sources | Budget (tokens) |
|---|---|---|---|
| `intent` | _(none)_ | `project_context`, `existing_specs` | 20,000 |
| `spec` | `intent` | `project_context`, `existing_specs`, `research` | 40,000 |
| `research` | `spec` | `project_context`, `existing_specs`, `architecture` | 50,000 |
| `design` | `research`, `spec` | `architecture`, `project_context` | 60,000 |
| `tasks` | `design`, `spec` | `research_contracts`, `research_schemas`, `architecture` | 40,000 |
| `execution` | `tasks` | `research_contracts`, `research_schemas` | 10,000 |
| `verification` | `spec`, `tasks`, `summary` | `research_contracts`, `research_schemas`, `design` | 50,000 |

### 2.2 Unknown Artifact Types

Given an unrecognized artifact type,
When `getManifest` is called,
Then the system MUST return a default manifest with empty `required`, empty `optional`, and a budget of `20,000` tokens.

---

## 3. Source Path Resolution

The system MUST resolve source names to filesystem paths according to the following rules, given `changePath` (the change's working directory) and `specDir` (the project spec root):

| Source Name | Resolved Path |
|---|---|
| `project_context` | `{specDir}/project.md` |
| `existing_specs` | `{specDir}/specs` |
| `architecture` | `{changePath}/architecture.md` |
| `research_contracts` | `{changePath}/research/contracts` |
| `research_schemas` | `{changePath}/research/schemas` |
| _(any other name)_ | `{changePath}/{name}.md` |

---

## 4. Context Resolution

### 4.1 Resolution Order

When `resolve(artifactType, changePath, specDir, agentBudget?)` is called, the system MUST:

1. Obtain the manifest for `artifactType`.
2. Use `agentBudget` as the effective budget if provided; otherwise use `manifest.budget`.
3. Load each `required` file in declaration order, accumulating token counts.
4. Load each `optional` file in declaration order, stopping when:
   - `totalTokens >= budget`, OR
   - fewer than `100` tokens remain in the budget.
5. Return a `LoadedContext` containing `files`, `totalTokens`, `budget`, and `truncations`.

### 4.2 Missing and Unreadable File Handling

**Required files — ENOENT (not found)**

Given a required source file that does not yet exist on disk,
When `resolve` is called,
Then the system MUST silently skip that file (no error thrown, no warning emitted), because artifacts may not exist at every workflow stage.

**Required files — non-ENOENT I/O errors**

Given a required source file that exists on disk but cannot be read (e.g., permission denied, hardware I/O error),
When `resolve` is called,
Then the system MUST:
- NOT throw an exception.
- Emit a `console.warn` message containing the text `"failed to read required context file"`.
- Add an entry to `truncations` that includes both the file path and the text `"read error"` followed by the OS error code (or `"unknown"` if no code is available).
- NOT include the file in `LoadedContext.files`.

**Optional files — any error**

Given an optional source file that does not exist or cannot be read,
When `resolve` is called,
Then the system MUST silently skip that file.

### 4.3 Budget Invariant

The system MUST guarantee that `totalTokens <= budget` after resolution completes.

---

## 5. File Loading

### 5.1 Load Behavior

When `loadFile(filePath, budgetRemaining)` is called, the system MUST:

1. Read the file from disk as UTF-8.
2. Compute a SHA-256 content hash truncated to 12 hex characters, prefixed with `sha256:`.
3. Check the in-memory cache. If the cached hash matches the on-disk content hash, use cached token count and content.
4. If not cached (or hash mismatch), count tokens with `countTokens` and populate the cache.
5. Select a loading strategy based on the raw token count (see Section 6).
6. Apply the strategy transformation to the content (see Section 6.2).
7. If the transformed token count exceeds `budgetRemaining`, truncate content and mark `truncated = true`.
8. Record the file path, content (possibly transformed and truncated), token count, hash, ISO-8601 load timestamp, truncation flag, and strategy.

### 5.2 Truncation

When a file's post-transformation token count exceeds `budgetRemaining`, the system MUST:
- Slice content to `budgetRemaining * 4` characters.
- Append the literal string `\n\n[... truncated due to context budget ...]`.
- Set `tokens` to `budgetRemaining` (not the original count).
- Set `truncated = true`.
- Add the file path to `truncations` in the containing `LoadedContext`.

**Scenario — truncation**

Given a file whose content encodes to 10,000 tokens,
When `loadFile` is called with `budgetRemaining = 100`,
Then `loaded.truncated` MUST be `true`, `loaded.tokens` MUST be `100`, and `loaded.content` MUST contain the string `"truncated due to context budget"`.

### 5.3 Caching

The engine MUST maintain an in-memory `Map` keyed by absolute file path. Cache entries store `{ hash, tokens, content }`.

Cache hits occur when the on-disk content hash matches the cached hash. On a cache hit, the system MUST NOT re-count tokens.

`clearCache()` MUST evict all entries. After clearing, re-reading a file that has changed on disk MUST return the updated content.

#### 5.3.1 Cache Capacity and Eviction

The `ContextEngine` constructor accepts an optional `maxCacheSize` parameter (default: `100`).

When a new file is added to the cache and the cache size would exceed `maxCacheSize`, the system MUST evict the oldest-inserted entry (insertion-order FIFO) before the new entry is stored.

**Scenario — eviction**

Given a `ContextEngine` constructed with `maxCacheSize = 3`,
When four distinct files are loaded in sequence,
Then the first file's cache entry MUST have been evicted.

Verifiable by: modifying the first file on disk and reloading it — the reloaded content MUST reflect the updated disk contents (confirming no stale cache hit).

---

## 6. Loading Strategy

### 6.1 Strategy Selection

The system MUST assign a `strategy` to every `LoadedFile` based on the file's raw (pre-transformation) token count:

| Token Count | Strategy |
|---|---|
| < 5,000 | `full` |
| 5,000 – 19,999 | `section` |
| >= 20,000 | `skeleton` |

The `strategy` field is recorded on the returned `LoadedFile` and serves both as a transformation selector (see 6.2) and as metadata for callers.

Valid strategy values are `'full'`, `'section'`, and `'skeleton'`. The `'delta'` strategy is not implemented and is not a valid value.

### 6.2 Strategy Transformation (Applied on Load)

Strategy transformation is applied automatically by `loadFile` before budget truncation. Callers do not need to invoke transformation separately.

| Strategy | Transformation Applied |
|---|---|
| `full` | None — content returned as-is |
| `section` | None — content returned as-is. Callers MAY further filter via `extractSections()` |
| `skeleton` | `headingSkeleton()` is applied, reducing the content to headings and first paragraphs |

For `skeleton` files, the transformed content (output of `headingSkeleton`) is what is evaluated against `budgetRemaining`, cached-hit token counts are re-counted if the content differs, and truncation (if needed) applies to the transformed content.

**Scenario — skeleton strategy applied on load**

Given a Markdown file whose content exceeds 20,000 tokens,
When `loadFile` is called with a large budget,
Then `loaded.strategy` MUST be `'skeleton'` and `loaded.content` MUST be shorter than the original file content and MUST still contain the original heading lines.

---

## 7. Section Extraction

### 7.1 `extractSections(content, options)`

Given Markdown content with ATX headings (levels 1–3),
When `extractSections` is called with `{ sections: [...] }`,
Then the system MUST include only the heading lines and their body content whose heading text contains one of the specified strings.

When called with `{ exclude: [...] }`,
Then the system MUST include all sections whose heading text does NOT contain any excluded string.

`sections` and `exclude` MAY be combined. `exclude` takes precedence.

**Scenario — include filter**

Given content with sections "Requirements", "Scenarios", "Changelog", and "Archive",
When `extractSections` is called with `{ sections: ['Requirements', 'Scenarios'] }`,
Then the result MUST contain "Requirements" and "Scenarios" and MUST NOT contain "Changelog".

**Scenario — exclude filter**

Given the same content,
When called with `{ exclude: ['Changelog', 'Archive'] }`,
Then the result MUST contain "Requirements" and MUST NOT contain "Changelog" or "Archive".

---

## 8. Heading Skeleton

### 8.1 `headingSkeleton(content)`

Given Markdown content,
When `headingSkeleton` is called,
Then the system MUST return a condensed representation containing:
- All heading lines (levels 1–6).
- Up to 2 non-empty lines from the first paragraph following each heading.
- Empty lines as paragraph separators where they appeared.

The resulting skeleton MUST be shorter than the original content whenever the original contains body paragraphs longer than 2 lines.

---

## 9. Context Formatting

### 9.1 `formatContext(files)`

Given an array of `LoadedFile` objects,
When `formatContext` is called,
Then the system MUST return a string where each file is wrapped in an XML-style element:

```
<context source="{path}" hash="{hash}" loaded_at="{loadedAt}">
{content}
</context>
```

Multiple files MUST be separated by a blank line (`\n\n`).

**Scenario**

Given a single `LoadedFile` with `path = "spec/project.md"` and `hash = "sha256:abc123"`,
When `formatContext` is called,
Then the output MUST contain `<context source="spec/project.md"`, `hash="sha256:abc123"`, the file content, and `</context>`.

---

## 10. Instruction Generation

### 10.1 `InstructionGenerator.generate(params)`

The `InstructionGenerator` composes context resolution, template rendering, and agent metadata into a structured `InstructionOutput` delivered to an AI agent before it begins work.

The system MUST:
1. Call `contextEngine.resolve` with `artifact.type`, `changePath`, `specDir`, and `agent.context_budget`.
2. Call `templateEngine.render` with `artifact.template` and a `TemplateContext` of `{ change_name, capability_name }`.
3. Normalize `agent.tools`: string entries are used as-is; object entries have their first key extracted.
4. Return `InstructionOutput` with all fields populated.

### 10.2 `InstructionOutput` Fields

| Field | Type | Description |
|---|---|---|
| `artifact` | `string` | The artifact `id` |
| `change` | `string` | The change name |
| `workflow` | `string` | Workflow name |
| `status` | `string` | Current lifecycle status |
| `agent.name` | `string` | Agent name |
| `agent.persona` | `string` | Agent persona text |
| `agent.tools` | `string[]` | Normalized tool names |
| `agent.rules` | `string[]` | Agent rules (empty array if omitted) |
| `template` | `string` | Rendered artifact template |
| `context.project` | `string \| undefined` | Content of `project.md` if loaded |
| `output_path` | `string` | `spec/changes/{changeName}/{artifact.generates}` |
| `next_steps` | `string[]` | Ordered list of next actions |
| `gates` | `string[]` | Gate IDs from the artifact definition |
| `budget.context_tokens` | `number` | Tokens actually consumed |
| `budget.budget_tokens` | `number` | Agent's declared context budget |
| `questions` | `InstructionQuestion[] \| undefined` | Optional discovery questions |

### 10.3 Output Path Convention

The `output_path` MUST follow the pattern:

```
spec/changes/{changeName}/{artifact.generates}
```

This path is relative to the project root and is not created by the generator; it informs the agent where to write its output.

### 10.4 Project Context Extraction

The system MUST scan loaded files for a file whose path ends with `project.md`. If found, its content is surfaced as `context.project`. If not found, `context.project` is `undefined`.

### 10.5 Discovery Questions

When `questions` is provided to `generate`, the system MUST include them in `InstructionOutput.questions` unchanged.

**Scenario**

Given a `generate` call with one question `{ question: "Should refunds support partial amounts?", ... }`,
When the output is returned,
Then `output.questions` MUST have length `1` and `output.questions[0].question` MUST contain `"refunds"`.

---

## 11. `InstructionQuestion` Schema

| Field | Type | Description |
|---|---|---|
| `question` | `string` | The question text |
| `header` | `string` | Display header for the question |
| `options` | `Array<{ label: string; description: string }>` | Selectable options |
| `multiSelect` | `boolean` | Whether multiple options can be chosen |

---

## 12. Error Handling Summary

| Situation | Required File Behavior | Optional File Behavior |
|---|---|---|
| File not found (ENOENT) | Silently skipped | Silently skipped |
| File unreadable (non-ENOENT I/O error) | Warning emitted; path added to `truncations` with `"read error"` annotation; file excluded from `files` | Silently skipped |
| Budget exhausted | File skipped (optional) or truncated (required, already loading) | Skipped when `< 100` tokens remain |

The context engine MUST NOT throw from `resolve` under any of the above conditions.
