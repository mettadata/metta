---
type: research
change: t5-user-story-layer-spec-forma
created: 2026-04-14
---

# Research: User Story Layer — Spec Format and Integration Points

Decisions are locked. This document confirms each integration point against the live codebase and establishes exact insertion targets for the executor.

---

## 1. Workflow YAML — `stories` Artifact Insertion Point

Both workflow templates are in `src/templates/workflows/`.

**standard.yaml** current sequence:

```
intent → spec → research → design → tasks → implementation → verification
```

The `stories` artifact belongs between `spec` and `research`. It is authored by a specifier (or planner) after the spec is written, so it gates both research and downstream planning.

**Before (standard.yaml lines 14–29):**
```yaml
  - id: spec
    type: spec
    template: spec.md
    generates: spec.md
    requires: [intent]
    agents: [specifier]
    gates: [spec-quality]

  - id: research
    type: research
    template: research.md
    generates: research.md
    requires: [spec]
    agents: [researcher]
    gates: []
```

**After:**
```yaml
  - id: spec
    type: spec
    template: spec.md
    generates: spec.md
    requires: [intent]
    agents: [specifier]
    gates: [spec-quality]

  - id: stories
    type: stories
    template: stories.md
    generates: stories.md
    requires: [spec]
    agents: [specifier]
    gates: [stories-valid]

  - id: research
    type: research
    template: research.md
    generates: research.md
    requires: [stories]
    agents: [researcher]
    gates: []
```

**quick.yaml** does not include a `spec` artifact (intent → implementation). No `stories` artifact is added to quick.yaml — the user story layer is a standard-workflow concern only.

The `WorkflowArtifactSchema` (line 3–12 of `src/schemas/workflow-definition.ts`) accepts any `type: z.string()` value, so `type: stories` requires no schema change.

---

## 2. Spec Parser — Where `Fulfills` Field Parsing Is Added

File: `src/specs/spec-parser.ts`

The new `parseStories` function is a sibling to `parseSpec` (line 68). The parser pattern to mirror is:

- `unified().use(remarkParse).parse(markdown)` — line 69
- Walk `tree.children as Content[]` in a `for...of` loop — line 78
- Detect headings by `heading.depth` and prefix text — lines 83–123
- Extract paragraph text with `extractText(node)` — lines 139–143
- Flush the current object on each new heading of the same depth — lines 89–98

**Insertion target**: Add `parseStories` after line 158 (end of `parseSpec`), before `parseDeltaSpec` at line 161. The function should expose:

```typescript
export interface ParsedUserStory {
  id: string          // slugified title
  role: string        // "As a <role>"
  action: string      // "I want <action>"
  benefit: string     // "So that <benefit>"
  fulfills: string[]  // requirement IDs extracted from "Fulfills:" field
}

export interface ParsedStories {
  title: string
  stories: ParsedUserStory[]
}

export function parseStories(markdown: string): ParsedStories { ... }
```

Detection pattern: `## Story:` headings at depth 2 (analogous to `## Requirement:` at line 88). The `Fulfills:` field will be a paragraph line whose text starts with `Fulfills:`, yielding a comma-separated list of requirement IDs. Use `extractText` (line 42) and `extractKeyword`-style inline extraction for the field.

`contentHash` (line 37) and `slugifyId` (line 54) are unexported helpers — `parseStories` can call them directly since it lives in the same file.

---

## 3. Artifact Phase — End-to-End Wiring

**ArtifactStore** (`src/artifacts/artifact-store.ts`) is artifact-type-agnostic. It stores artifacts as raw files and tracks their status in `.metta.yaml`. No changes needed here — `stories.md` will be written with `writeArtifact(changeName, 'stories.md', content)` like any other artifact.

**WorkflowEngine** (`src/workflow/workflow-engine.ts`) is also type-agnostic. `loadWorkflow` parses the YAML through `WorkflowDefinitionSchema`, runs `topologicalSort`, and exposes `getNext` / `getStatus` keyed on artifact `id`. No engine changes are needed — adding the YAML entry is sufficient.

**Checklist of files that need updates beyond the YAML:**

| File | Change |
|------|--------|
| `src/templates/workflows/standard.yaml` | Add `stories` artifact block; update `research.requires` from `[spec]` to `[stories]` |
| `src/templates/artifacts/stories.md` | New template file (does not exist yet) |
| `src/specs/spec-parser.ts` | Add `parseStories`, `ParsedUserStory`, `ParsedStories` exports |
| `src/cli/commands/validate-stories.ts` | New command (see section 5) |
| `src/cli/index.ts` | Add `registerValidateStoriesCommand` import + call (line 86 region) |
| `src/templates/agents/metta-specifier.md` | New or updated agent skill referencing stories format |
| `src/templates/skills/metta-validate-stories/SKILL.md` | New skill template |

No changes are needed to `ArtifactStore`, `WorkflowEngine`, `GateRegistry`, or `Finalizer` beyond what is listed under section 6 (gate) and section 5 (CLI).

---

## 4. Existing Parser Pattern — `parseSpec` as Canonical Template

`parseStories` must mirror `parseSpec` exactly in structure. Key conventions from `parseSpec` (lines 68–159):

1. **Remark setup** (line 69): `unified().use(remarkParse).parse(markdown) as Root` — identical call, no plugins added.
2. **Walk pattern** (line 78): single `for...of` over `children`, switch on `node.type`.
3. **Heading detection** (lines 83–123): `heading.depth === 2` for top-level items, prefix string match (`text.startsWith('Requirement:')`).
4. **Flush-on-new-heading** (lines 89–98): every new heading at the same depth finalises the previous item before starting a new one.
5. **Final flush** (lines 147–156): identical flush block after the loop for the last item.
6. **Helper reuse**: `getHeadingText`, `extractText`, `slugifyId`, `contentHash` — all in-file, all available.
7. **Export shape**: named exports for both the function and its return/param interfaces, no default exports.

For story body fields (`role`, `action`, `benefit`), parse the paragraph body following the `## Story:` heading. Each field is a separate line with a bold label (`**Role:**`, `**I want:**`, `**So that:**`) or a conventional single-paragraph structure — the exact format will be fixed in the stories template.

---

## 5. CLI Command Pattern — `validate-stories` Mirrors `check-constitution`

Template file: `src/cli/commands/check-constitution.ts`

The `metta validate-stories` command must follow this exact structure:

| Element | check-constitution | validate-stories |
|---------|--------------------|------------------|
| File | `check-constitution.ts` | `validate-stories.ts` |
| Export | `registerCheckConstitutionCommand` | `registerValidateStoriesCommand` |
| Commander name | `'check-constitution'` | `'validate-stories'` |
| `--change` flag | Yes | Yes |
| Input file | `spec/changes/<name>/spec.md` | `spec/changes/<name>/stories.md` |
| Output file | `violations.md` | `story-validation.md` |
| `resolveChangeName` | Inline helper (lines 69–82) | Copy verbatim |
| `assertSafeSlug` | Called on change name | Called on change name |
| Exit code on failure | `process.exit(4)` | `process.exit(4)` |
| `--json` branch | Yes, via `outputJson` | Yes, via `outputJson` |

Registration in `src/cli/index.ts`: add import and call adjacent to `registerCheckConstitutionCommand` at line 83/36.

The validation logic itself (`validateStories`) lives in a new `src/stories/story-validator.ts` module, analogous to `src/constitution/checker.ts`. The CLI command imports from that module and does no validation logic itself — consistent with the imperative shell pattern.

---

## 6. Finalize Gate Plumbing

File: `src/finalize/finalizer.ts`

Gates run in `finalize()` at **lines 50–68**. The mechanism:

```typescript
const gateNames = this.gateRegistry.list().map(g => g.name)
gates = await this.gateRegistry.runAll(gateNames, this.projectRoot)
gatesPassed = gates.every(g => g.status === 'pass' || g.status === 'skip' || g.status === 'warn')
```

`gateRegistry.runAll` picks up every gate registered via `loadFromDirectory` (gate-registry.ts line 26). This means **the stories-validation gate plugs in solely through a new YAML gate definition file** — no changes to `Finalizer` or `GateRegistry` source are needed.

**Action required**: create `src/templates/gates/stories-valid.yaml`. Format matches existing gate files (e.g., `src/templates/gates/tests.yaml`):

```yaml
name: stories-valid
description: Validate user stories against spec requirements
command: metta validate-stories --change $METTA_CHANGE
timeout: 60000
on_failure: fail
```

The gate name `stories-valid` matches the `gates: [stories-valid]` entry in the workflow YAML (section 1). `GateRegistry.run` returns `status: 'skip'` for unregistered names, so the gate is silently skipped when the gate file is absent — no hard failure in existing change flows that predate this feature.

---

## Summary of New Files

| Path | Purpose |
|------|---------|
| `src/templates/artifacts/stories.md` | Artifact template for story authoring |
| `src/templates/gates/stories-valid.yaml` | Gate definition wiring validate-stories into finalize |
| `src/templates/skills/metta-validate-stories/SKILL.md` | Agent skill for validate-stories command |
| `src/cli/commands/validate-stories.ts` | CLI command (mirrors check-constitution.ts) |
| `src/stories/story-validator.ts` | Validation logic (mirrors constitution/checker.ts) |
| `src/specs/spec-parser.ts` | Add `parseStories` + interfaces (in-place addition) |
