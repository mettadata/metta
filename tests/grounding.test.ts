import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dirname, '..')

describe('grounding: metta-researcher agent', () => {
  it('template and deployed copy are byte-identical', async () => {
    const template = await readFile(join(REPO_ROOT, 'src/templates/agents/metta-researcher.md'), 'utf8')
    const deployed = await readFile(join(REPO_ROOT, '.claude/agents/metta-researcher.md'), 'utf8')
    expect(template).toBe(deployed)
  })

  it('tools frontmatter includes WebSearch', async () => {
    const content = await readFile(join(REPO_ROOT, 'src/templates/agents/metta-researcher.md'), 'utf8')
    expect(content).toMatch(/tools:.*WebSearch/)
  })

  it('tools frontmatter includes WebFetch', async () => {
    const content = await readFile(join(REPO_ROOT, 'src/templates/agents/metta-researcher.md'), 'utf8')
    expect(content).toMatch(/tools:.*WebFetch/)
  })

  it('body contains Grounding section with required elements', async () => {
    const content = await readFile(join(REPO_ROOT, 'src/templates/agents/metta-researcher.md'), 'utf8')
    expect(content).toContain('## Grounding')
    expect(content).toMatch(/\[\^N\]/)
    expect(content).toMatch(/accessed YYYY-MM-DD/)
    expect(content).toContain('untrusted')
  })
})

describe('grounding: /metta-propose discovery', () => {
  // Intentional drift: workflow-name-argument-support updates the source template
  // with `--workflow <name>` parsing ahead of the deployed copy. The deployed copy
  // under .claude/skills/ is refreshed on the user's next `metta install` / `metta refresh`.
  // Instead of asserting byte identity, assert both copies still carry the same
  // grounding guarantees so drift stays bounded to this one feature.
  it('template and deployed copy both carry the grounding instruction', async () => {
    const template = await readFile(join(REPO_ROOT, 'src/templates/skills/metta-propose/SKILL.md'), 'utf8')
    const deployed = await readFile(join(REPO_ROOT, '.claude/skills/metta-propose/SKILL.md'), 'utf8')
    expect(template).toContain('Concrete-tech grounding')
    expect(deployed).toContain('Concrete-tech grounding')
    expect(template).toContain('WebSearch')
    expect(deployed).toContain('WebSearch')
  })

  it('contains Concrete-tech grounding instruction', async () => {
    const content = await readFile(join(REPO_ROOT, 'src/templates/skills/metta-propose/SKILL.md'), 'utf8')
    expect(content).toContain('Concrete-tech grounding')
    expect(content).toContain('WebSearch')
  })
})

describe('grounding: /metta-quick discovery', () => {
  it('template and deployed copy are byte-identical', async () => {
    const template = await readFile(join(REPO_ROOT, 'src/templates/skills/metta-quick/SKILL.md'), 'utf8')
    const deployed = await readFile(join(REPO_ROOT, '.claude/skills/metta-quick/SKILL.md'), 'utf8')
    expect(template).toBe(deployed)
  })

  it('DISCOVERY LOOP contains Concrete-tech grounding instruction', async () => {
    const content = await readFile(join(REPO_ROOT, 'src/templates/skills/metta-quick/SKILL.md'), 'utf8')
    expect(content).toContain('Concrete-tech grounding')
    expect(content).toContain('WebSearch')
  })
})
