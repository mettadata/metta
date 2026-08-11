import { describe, it, expect } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dirname, '..')
const DEPLOYED_DIR = join(REPO_ROOT, '.claude', 'hooks')
const TEMPLATE_DIR = join(REPO_ROOT, 'src', 'templates', 'hooks')

// Every deployed hook in `.claude/hooks/` must stay byte-identical to its
// `src/templates/hooks/` source template (and vice versa): the guard/mint trust
// model depends on the validating and minting halves shipping exactly the code
// that was reviewed. Data-driven over the directory listing so newly added
// hooks (e.g. release guard entries) are pinned automatically.
describe('hook byte identity (.claude/hooks vs src/templates/hooks)', () => {
  it('both directories contain the same set of .mjs hooks', async () => {
    const [deployed, templates] = await Promise.all([
      readdir(DEPLOYED_DIR),
      readdir(TEMPLATE_DIR),
    ])
    const deployedMjs = deployed.filter((f) => f.endsWith('.mjs')).sort()
    const templateMjs = templates.filter((f) => f.endsWith('.mjs')).sort()
    expect(deployedMjs).toEqual(templateMjs)
    expect(deployedMjs.length).toBeGreaterThan(0)
  })

  it('every deployed hook is byte-identical to its template counterpart', async () => {
    const deployed = (await readdir(DEPLOYED_DIR)).filter((f) => f.endsWith('.mjs')).sort()
    for (const name of deployed) {
      const [deployedContent, templateContent] = await Promise.all([
        readFile(join(DEPLOYED_DIR, name), 'utf8'),
        readFile(join(TEMPLATE_DIR, name), 'utf8'),
      ])
      expect(deployedContent, `byte mismatch for hook ${name}`).toBe(templateContent)
    }
  })
})
