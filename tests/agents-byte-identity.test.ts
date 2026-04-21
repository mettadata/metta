import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dirname, '..')

const agents = [
  'metta-product',
  'metta-verifier',
  // Add other agents here as we centralize
]

describe('agent template byte-identity', () => {
  for (const agent of agents) {
    it(`${agent} template and deployed copy are byte-identical`, async () => {
      const template = await readFile(join(REPO_ROOT, `src/templates/agents/${agent}.md`), 'utf8')
      const deployed = await readFile(join(REPO_ROOT, `.claude/agents/${agent}.md`), 'utf8')
      expect(template).toBe(deployed)
    })
  }

  it('metta-product agent has expected frontmatter', async () => {
    const content = await readFile(join(REPO_ROOT, 'src/templates/agents/metta-product.md'), 'utf8')
    expect(content).toMatch(/name:\s*metta-product/)
    expect(content).toMatch(/tools:.*Read.*Write/)
  })
})
