# Research: t4-research-model-tier-split-a

## 1. Current `metta-researcher` Agent State

File: `src/templates/agents/metta-researcher.md`

Frontmatter `tools:` array verbatim (line 5):

```
tools: [Read, Write, Grep, Glob, Bash]
```

The agent body (lines 9–21) defines the role, rules, and commit instruction. It has no model-tier directives, no tool conditional logic, and no WebSearch/WebFetch references. The full frontmatter block:

```yaml
---
name: metta-researcher
description: "Metta researcher agent — explores implementation approaches, evaluates tradeoffs, produces technical artifacts"
model: sonnet
tools: [Read, Write, Grep, Glob, Bash]
color: yellow
---
```

The executor MUST preserve all five existing tools when appending `WebSearch` and `WebFetch`. The `model: sonnet` field is also present and is the tier this change targets for modification.

## 2. Existing Grounding-like Sections

The current agent file contains no references to WebSearch, WebFetch, web citations, external sources, or grounding. The body is entirely local-codebase-oriented ("Always scan existing code patterns before recommending"). There is nothing to extend or avoid duplicating — the executor adds net-new sections.

## 3. Discovery Loop Insertion Points

### metta-propose SKILL.md

File: `src/templates/skills/metta-propose/SKILL.md`

The discovery loop body runs from line 16 ("DISCOVERY LOOP (mandatory)") through line 44. The loop's round descriptions occupy lines 30–43. The new grounding instruction ("when presenting concrete tech options, use WebSearch/WebFetch to verify current library versions, API availability, or recent breaking changes before surfacing them to the user") should be inserted:

- **After line 31** (end of the Round 1 scope+architecture description sentence), before the example questions block at line 33.
- Rationale: Round 1 is where architectural choices and technology picks are surfaced to the user. That is the natural gate for grounding. Lines 33–37 are the example block; the instruction precedes those examples so it applies before options are presented.

Exact insertion context (lines 30–33):

```
30:   - **Round 1 — Scope + architecture (ALWAYS run):** Ask 2–4 questions on scope boundaries (what's included vs excluded?), architectural choices (patterns, libraries, approaches), and technology picks.
31:
32:     Example questions for "add user authentication":
```

Insert between lines 31 and 32.

### metta-quick SKILL.md

File: `src/templates/skills/metta-quick/SKILL.md`

The discovery loop body runs from line 24 ("DISCOVERY LOOP (entered only when non-trivial)") through line 36. Round 1 is described on lines 28–28 (single line). The new grounding instruction should be inserted:

- **After line 28** (end of the Round 1 description), before Round 2 on line 29.
- Rationale: same — Round 1 is where scope and architectural approaches are surfaced; grounding applies at the moment concrete options are being formed.

Exact insertion context (lines 27–30):

```
27:   - **Exit-option declaration:** every `AskUserQuestion` call within the loop MUST include a final selectable option exactly spelled `I'm done — proceed with these answers`.
28:   - **Round 1 (scope + architecture):** always runs once the loop is engaged. Ask 2–4 questions covering scope boundaries and architectural approach.
29:   - **Round 2 (data model + integration points):** conditional — run when the change involves file schemas, API contracts, external system calls, or store methods. Skip otherwise.
```

Insert between lines 28 and 29.

## 4. Existing Test Patterns

All template/agent tests in `tests/cli.test.ts` follow two patterns. Examples:

**Pattern A — byte-identity + content assertion (agent, lines 642–658):**

```typescript
describe('byte-identity: metta-constitution-checker agent', () => {
  it('template and deployed copy are byte-identical with required frontmatter', async () => {
    const { readFile } = await import('node:fs/promises')
    const templatePath = join(
      import.meta.dirname, '..', 'src', 'templates', 'agents', 'metta-constitution-checker.md',
    )
    const deployedPath = join(
      import.meta.dirname, '..', '.claude', 'agents', 'metta-constitution-checker.md',
    )
    const template = await readFile(templatePath, 'utf8')
    const deployed = await readFile(deployedPath, 'utf8')
    expect(template).toBe(deployed)
    // content assertion:
    expect(template).toMatch(/tools:\s*\[\s*Read\s*\]/)
  })
})
```

**Pattern B — skill byte-identity split across two `it` blocks (skill, lines 751–758 + 760–766):**

```typescript
it('deployed copy is byte-identical to template', async () => {
  const { readFile } = await import('node:fs/promises')
  const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-fix-issues', 'SKILL.md')
  const deployedPath = join(import.meta.dirname, '..', '.claude', 'skills', 'metta-fix-issues', 'SKILL.md')
  const template = await readFile(templatePath, 'utf8')
  const deployed = await readFile(deployedPath, 'utf8')
  expect(template).toBe(deployed)
})

it('body references all four CLI invocation modes', async () => {
  const { readFile } = await import('node:fs/promises')
  const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-fix-issues', 'SKILL.md')
  const contents = await readFile(templatePath, 'utf8')
  expect(contents).toContain('fix-issue')
  expect(contents).toContain('fix-issue --all')
})
```

**Convention the executor MUST follow:**

- One `describe` block per template file, named `'byte-identity: <agent/skill name>'`
- Dynamic import of `node:fs/promises` inside each `it` block
- Paths constructed with `join(import.meta.dirname, '..', ...)` — no `__dirname`
- `expect(template).toBe(deployed)` for byte-identity
- Separate `it` blocks for content assertions (`toContain`, `toMatch`)
- For the `metta-researcher` agent, the tools regex should match the expanded array:
  `expect(template).toMatch(/tools:\s*\[.*WebSearch.*WebFetch.*\]/)` (or equivalent)
- No snapshot files — all assertions are inline string checks
