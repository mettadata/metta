import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dirname, '..')

// Byte-identity of every agent template vs its deployed `.claude/agents/` copy
// (and of all other deployed template families) is now enforced comprehensively
// and data-driven by tests/template-deploy-sync.test.ts. This file retains the
// agent-specific frontmatter validation that is not covered there.
describe('agent template frontmatter', () => {
  it('metta-product agent has expected frontmatter', async () => {
    const content = await readFile(join(REPO_ROOT, 'src/templates/agents/metta-product.md'), 'utf8')
    expect(content).toMatch(/name:\s*metta-product/)
    expect(content).toMatch(/tools:.*Read.*Write/)
  })

  it.each([
    'src/templates/agents/metta-verifier.md',
    '.claude/agents/metta-verifier.md',
  ])('%s contains the honest artifact-write contract line', async (relativePath) => {
    const content = await readFile(join(REPO_ROOT, relativePath), 'utf8')
    expect(content).toContain('ATTEMPT the Write tool first.')
    expect(content).toContain(
      'When Write is refused, fall back to writing the artifact via a shell heredoc',
    )
    expect(content).toContain('Never skip the artifact and never relocate it')
  })
})
